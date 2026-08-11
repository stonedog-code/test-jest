import { getContainer, setContainer } from './container-holder';

/**
 * Stops the shared container.
 *
 * globalTeardown runs even when tests fail, which is what stops a red run from
 * leaving a container behind. Testcontainers' Ryuk sidecar reaps orphans as a
 * backstop, but relying on it means a developer who kills the run with Ctrl-C
 * accumulates containers until they notice.
 */
export default async function globalTeardown(): Promise<void> {
  const container = getContainer();
  if (container) {
    await container.stop();
    setContainer(undefined);
  }
}
