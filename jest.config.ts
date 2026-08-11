import type { Config } from 'jest';

/**
 * One config, three projects.
 *
 * `projects` is what makes the tiers first-class: `--selectProjects unit` runs
 * only the fast tier, and each tier gets its own timeout, setup, and worker
 * policy. The common alternative — one config plus `testPathIgnorePatterns` —
 * cannot give the integration tier a 120s timeout without giving it to the unit
 * tier as well, and a unit tier that is allowed to hang for two minutes will.
 */

// The explicit annotation matters: without it TypeScript widens the tuple to an
// array, and Jest's config type requires exactly two elements. The error it
// produces ("Target requires 2 element(s)") reads like a Jest problem and is a
// TypeScript inference one.
const transform: NonNullable<Config['transform']> = {
  // isolatedModules belongs in tsconfig.json, not here — ts-jest's own option
  // of that name is deprecated. It makes each file compile independently, which
  // is what keeps the transform fast.
  '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
};

const config: Config = {
  projects: [
    {
      displayName: { name: 'unit', color: 'green' },
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
      transform,

      // Short on purpose. A "unit" test that needs longer than 5s is doing I/O
      // and belongs in another tier.
      testTimeout: 5_000,

      // Reset mock state between tests so one test cannot see another's calls.
      // Without this, a test that passes alone fails in the suite, which is the
      // single most expensive kind of flake to diagnose.
      clearMocks: true,
      restoreMocks: true,
    },
    {
      displayName: { name: 'integration', color: 'yellow' },
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
      transform,

      // Long enough to pull and start a Postgres container on a cold machine.
      testTimeout: 120_000,
      globalSetup: '<rootDir>/test/helpers/global-setup.ts',
      globalTeardown: '<rootDir>/test/helpers/global-teardown.ts',
      clearMocks: true,
      restoreMocks: true,
    },
    {
      displayName: { name: 'e2e', color: 'blue' },
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/e2e/**/*.test.ts'],
      transform,
      testTimeout: 60_000,
      clearMocks: true,
      restoreMocks: true,
    },
  ],

  // Coverage is collected from src, never from test files — a test file's own
  // coverage is meaningless and inflates the number.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts', // the entry point; the e2e tier covers it as a process
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],

  /**
   * A threshold is a ratchet, not a target. Set it just under where you are
   * now so it fails when coverage drops, and raise it as coverage rises.
   *
   * Per-glob thresholds beat one global number: a global 80% lets somebody
   * delete tests for the payment logic and make it up with tests for a helper.
   */
  /**
   * IMPORTANT, and not obvious from the docs: a path-specific threshold REMOVES
   * those files from the `global` group. `global` then applies only to files no
   * glob matched — so once every file is listed, `global` governs nothing and
   * passes trivially.
   *
   * That makes `global` a useful backstop for NEW files rather than a summary
   * of the repo: anything added tomorrow that nobody wrote a threshold for must
   * clear 80% or the build fails.
   */
  coverageThreshold: {
    global: { branches: 88, functions: 68, lines: 80, statements: 80 },

    /**
     * Per-glob thresholds are where the rigour lives. Everything that CAN be
     * unit tested is held at 100%, which a single global number could never
     * express: an 80% global lets somebody delete the payment tests and make
     * the number back up with tests for a string helper.
     */
    './src/weather/': { branches: 100, functions: 100, lines: 100, statements: 100 },
    './src/config.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
    './src/app.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },

    /**
     * src/store is pure SQL and scores 0% in the unit tier, because the unit
     * tier cannot test it and should not try — its real coverage comes from
     * test/integration/store.test.ts, running against a real Postgres.
     *
     * The zero is written down deliberately rather than hidden by excluding the
     * file: an exclusion is invisible, while this line is a claim somebody can
     * check. Raising it would mean writing a mocked-pg test that proves only
     * that the mock works.
     */
    './src/store/': { branches: 0, functions: 0, lines: 0, statements: 0 },
  },

  verbose: false,
  errorOnDeprecated: true,
};

export default config;
