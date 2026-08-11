/**
 * The entry point. It reads config, wires dependencies, and serves — nothing
 * else. Everything worth testing lives in a module the tests can import, which
 * is what makes the unit tier possible at all.
 */
import { Pool } from 'pg';

import { createApp } from './app';
import { load } from './config';
import { ObservationStore } from './store/observations';
import { WeatherClient } from './weather/client';
import { WeatherService, type ObservationRecorder } from './weather/service';

async function main(): Promise<void> {
  const config = load(process.env);

  const client = new WeatherClient({
    baseUrl: config.upstreamUrl,
    apiKey: config.apiKey,
    timeoutMs: config.requestTimeoutMs,
  });

  let pool: Pool | undefined;
  let recorder: ObservationRecorder | undefined;

  if (config.databaseUrl) {
    pool = new Pool({ connectionString: config.databaseUrl });
    const store = new ObservationStore(pool);
    await store.migrate();
    recorder = store;
    console.log('recording observations to postgres');
  }

  const service = new WeatherService(client, recorder ? { recorder } : {});
  const server = createApp(service).listen(config.port, () => {
    console.log(`listening on port ${config.port}`);
  });

  // Graceful shutdown. The e2e tier sends SIGTERM and expects exit code 0;
  // without this the process is killed and deploys drop in-flight requests.
  const shutdown = (signal: string): void => {
    console.log(`received ${signal}, shutting down`);
    server.close(() => {
      void pool?.end().then(() => {
        console.log('stopped cleanly');
        process.exit(0);
      });
      if (!pool) {
        console.log('stopped cleanly');
        process.exit(0);
      }
    });

    // A hung connection must not block the deploy forever.
    setTimeout(() => {
      console.error('shutdown timed out, forcing exit');
      process.exit(1);
    }, 5_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  // Config errors must be loud and must exit non-zero: a service that starts
  // without its API key and fails on the first request is strictly worse than
  // one that refuses to start.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
