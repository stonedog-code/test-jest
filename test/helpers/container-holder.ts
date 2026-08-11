import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * A typed handle on the container stashed across globalSetup and globalTeardown.
 *
 * Those two hooks run in their own module registry, so a plain module-level
 * variable is not reliably shared between them — the value has to live on
 * globalThis. This file wraps that in a type so the rest of the code never
 * casts, and never needs a `declare global { var ... }` block.
 */
interface ContainerHolder {
  // The explicit `| undefined` is required under exactOptionalPropertyTypes:
  // that flag distinguishes "absent" from "present and undefined", and this
  // property is genuinely assigned undefined on teardown.
  __PG_CONTAINER__?: StartedPostgreSqlContainer | undefined;
}

const holder = globalThis as unknown as ContainerHolder;

export function setContainer(container: StartedPostgreSqlContainer | undefined): void {
  holder.__PG_CONTAINER__ = container;
}

export function getContainer(): StartedPostgreSqlContainer | undefined {
  return holder.__PG_CONTAINER__;
}
