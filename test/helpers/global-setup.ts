import { PostgreSqlContainer } from '@testcontainers/postgresql';

import { setContainer } from './container-holder';

/**
 * Starts one Postgres container for the whole integration project.
 *
 * globalSetup runs once, before any test file, in its own module registry — so
 * anything it wants to share has to go through globalThis (see
 * container-holder.ts) or the environment. The connection string goes in
 * process.env because that is what the tests actually read.
 *
 * A container per test file would be correct and unbearably slow. A container
 * per test would be unusable.
 */
export default async function globalSetup(): Promise<void> {
  try {
    // A pinned tag, never :latest. A suite whose dependency changes under it
    // fails for reasons nobody can reproduce.
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('weather_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    setContainer(container);
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.HAS_DATABASE = 'true';

    console.log(`\n  postgres ready on port ${container.getPort()}`);
  } catch (error) {
    // A missing Docker daemon is an environment problem, not a test failure.
    // Skipping loudly beats failing: it says what to start, and it does not
    // train anybody to ignore a red suite.
    process.env.HAS_DATABASE = 'false';
    console.warn(
      `\n  SKIPPING database tests: ${error instanceof Error ? error.message : String(error)}` +
        '\n  Start Docker and re-run: npm run test:integration\n',
    );
  }
}
