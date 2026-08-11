import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A real HTTP server standing in for the upstream weather API.
 *
 * Why not call the real OpenWeatherMap? Because a test that depends on somebody
 * else's uptime, rate limit, and today's actual weather is not a test, it is a
 * monitor. Keep the real call in a separate contract test that is allowed to
 * fail loudly without blocking a merge.
 *
 * Why a real server rather than a fetch stub? Because at this tier the point is
 * to exercise the real network path — DNS, sockets, headers, JSON parsing — and
 * a stub replaces exactly the code the tier exists to test.
 */

export const FIXTURES: Record<string, unknown> = {
  'Cape Canaveral': {
    name: 'Cape Canaveral',
    weather: [{ main: 'Clouds', description: 'broken clouds' }],
    main: { temp: 27.5, humidity: 74 },
    dt: 1_723_400_000,
    cod: 200,
  },
  Orlando: {
    name: 'Orlando',
    weather: [{ main: 'Rain', description: 'light rain' }],
    main: { temp: 24.0, humidity: 88 },
    dt: 1_723_400_500,
    cod: 200,
  },
};

export interface StubUpstream {
  url: string;
  /** Every path+query the stub was asked for, so tests can assert on requests. */
  requests: string[];
  close: () => Promise<void>;
}

export async function startStubUpstream(): Promise<StubUpstream> {
  const requests: string[] = [];

  const server = http.createServer((req, res) => {
    requests.push(req.url ?? '');

    const url = new URL(req.url ?? '/', 'http://localhost');
    const city = url.searchParams.get('q') ?? '';

    res.setHeader('Content-Type', 'application/json');

    if (!url.searchParams.get('appid')) {
      res.statusCode = 401;
      res.end(JSON.stringify({ cod: 401, message: 'Invalid API key' }));
      return;
    }

    const fixture = FIXTURES[city];
    if (!fixture) {
      res.statusCode = 404;
      res.end(JSON.stringify({ cod: '404', message: 'city not found' }));
      return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify(fixture));
  });

  // Port 0 asks the kernel for a free port. Hardcoding one makes the suite fail
  // when it runs twice at once, or on a machine where something else has it.
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
