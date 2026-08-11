import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

import { startStubUpstream, type StubUpstream } from '../helpers/stub-upstream';

/**
 * The e2e tier runs the real entry point as a separate process and drives it
 * only over HTTP.
 *
 * Nothing here imports the app's modules. That restriction is the point: this
 * tier answers "does the thing we ship actually work", including the parts no
 * in-process test can reach — environment parsing, the wiring in index.ts, the
 * listen call, and shutdown on SIGTERM.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');

interface RunningService {
  baseUrl: string;
  child: ChildProcessWithoutNullStreams;
  output: () => string;
  stop: () => Promise<number | null>;
}

/** Starts the service and waits until /healthz answers. */
async function startService(env: Record<string, string>): Promise<RunningService> {
  const port = await freePort();

  // process.execPath + --import tsx, NOT `npx tsx`.
  //
  // `npx` spawns the real command as a CHILD, so a SIGTERM sent to the npx
  // process never reaches the service: it keeps running, the test's stop()
  // never resolves, and the whole tier hangs until Jest's timeout. Spawning
  // node directly gives one process, so signals and exit codes are real —
  // which matters here because testing graceful shutdown is the point.
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), ...env },
  });

  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHttp(`${baseUrl}/healthz`, 30_000, () => output);

  return {
    baseUrl,
    child,
    output: () => output,
    stop: () =>
      new Promise<number | null>((resolve) => {
        if (child.exitCode !== null) return resolve(child.exitCode);
        child.on('exit', (code) => resolve(code));
        child.kill('SIGTERM');
      }),
  };
}

/**
 * Polls until the URL answers, instead of sleeping.
 *
 * A fixed sleep is either too short (flaky) or too long (slow), and it is wrong
 * on a different machine either way. Polling is correct on both and returns as
 * soon as the service is actually up.
 */
async function waitForHttp(url: string, timeoutMs: number, output: () => string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'never attempted';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Include the child's output in the failure. Without it, "never became ready"
  // is a dead end and you re-run by hand to find out why.
  throw new Error(
    `${url} never became ready within ${timeoutMs}ms (last: ${lastError})\n` +
      `service output:\n${output()}`,
  );
}

async function freePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

let upstream: StubUpstream;

beforeAll(async () => {
  upstream = await startStubUpstream();
});

afterAll(async () => {
  await upstream.close();
});

describe('the running service', () => {
  let service: RunningService;

  afterEach(async () => {
    await service?.stop();
  });

  it('serves weather over HTTP', async () => {
    service = await startService({
      WEATHER_API_KEY: 'e2e-key',
      WEATHER_UPSTREAM_URL: upstream.url,
    });

    const response = await fetch(`${service.baseUrl}/weather?city=Cape+Canaveral`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.city).toBe('Cape Canaveral');
    expect(body.temp).toBeCloseTo(81.5, 5);
    expect(body.units).toBe('imperial'); // the real default, parsed by the real app
  });

  it('returns 404 for an unknown city', async () => {
    service = await startService({
      WEATHER_API_KEY: 'e2e-key',
      WEATHER_UPSTREAM_URL: upstream.url,
    });

    const response = await fetch(`${service.baseUrl}/weather?city=Atlantis`);

    expect(response.status).toBe(404);
  });

  // /healthz must be independent of every downstream dependency, or the load
  // balancer pulls all instances out during an upstream blip.
  it('answers /healthz even when the upstream is unreachable', async () => {
    service = await startService({
      WEATHER_API_KEY: 'e2e-key',
      WEATHER_UPSTREAM_URL: 'http://127.0.0.1:1',
    });

    const response = await fetch(`${service.baseUrl}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  // Graceful shutdown is invisible to every other tier. If it breaks, deploys
  // drop in-flight requests and nobody notices until a customer does.
  it('exits cleanly on SIGTERM', async () => {
    service = await startService({
      WEATHER_API_KEY: 'e2e-key',
      WEATHER_UPSTREAM_URL: upstream.url,
    });

    const exitCode = await service.stop();

    expect(exitCode).toBe(0);
    expect(service.output()).toContain('stopped cleanly');
  });
});

/**
 * Configuration failures are an entry-point concern, so this is the only tier
 * that can check them. A service that starts happily without its API key and
 * fails on the first request is strictly worse than one that refuses to start.
 */
describe('startup validation', () => {
  it('refuses to start without WEATHER_API_KEY, and says why', async () => {
    const result = await new Promise<{ code: number | null; output: string }>((resolve) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
        cwd: REPO_ROOT,
        env: { ...process.env, WEATHER_API_KEY: '', PORT: '0' },
      });

      let output = '';
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.on('exit', (code) => resolve({ code, output }));
    });

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('WEATHER_API_KEY is required');
  });
});
