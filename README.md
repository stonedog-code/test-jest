# Jest Test Framework — Reference

A working, runnable reference for testing TypeScript and Node services at all
three tiers: unit, integration, and end-to-end. Everything here passes, lints
clean, and typechecks. Copy the patterns, not just the words.

The subject under test is a small Express service that calls an upstream weather
API and optionally records observations in Postgres. It is the same service as
in **test-go**, deliberately, so the patterns can be compared side by side.

**Repo:** `github.com/nehsa-net/test-jest` · **Licence:** MIT
**Stack:** Jest 30 · TypeScript 5.7 · ts-jest · supertest · testcontainers

---

## Pasting this into OneNote

Open the README on GitHub in a browser (the rendered view, not "Raw"), select
the article body, copy, paste into OneNote. Headings, tables and code blocks
survive intact.

Pasting from the raw `.md` gives plain text with `#` and backticks showing — if
that happens, you copied the wrong view.

After pasting: select all and set code blocks to Consolas 10pt, and drag the
right edge of any table to widen it.

---

## The three tiers

| Tier | Answers | Runs against | Speed | Needs |
|---|---|---|---|---|
| **Unit** | Does this function do what it says? Every branch, every error path. | Injected fakes. No I/O. | 0.4s | Nothing |
| **Integration** | Do the seams hold? Real HTTP, real SQL, real serialisation. | Real Postgres in Docker, real sockets. | 15s cold / 0.3s warm | Docker |
| **E2E** | Does the shipped process work? Env parsing, startup, shutdown. | The real entry point, spawned and driven over HTTP. | 1.2s | Nothing |

The rule that decides where a test belongs: **write it at the cheapest tier that
can still fail for the right reason.** A test that mocks the thing it is meant to
be testing belongs one tier up.

---

## Quick start

```bash
git clone git@github.com:nehsa-net/test-jest.git
cd test-jest
npm ci

npm test                  # unit tier — no setup at all
npm run test:integration  # needs Docker running
npm run test:e2e
npm run test:all          # all three
npm run ci                # typecheck + lint + all three
```

Node 24 is required. Fresh shells on this machine give 22.17.1, so:

```bash
source ~/.nvm/nvm.sh && nvm use 24
```

---

## Running the tests without CI

**GitHub Actions is disabled on this repository.** Nothing runs automatically on
push, so the gate is whatever you run by hand.

The workflow in `.github/workflows/test.yml` is kept deliberately: it is
reference material, and it has been verified by executing it in a real runner
container with [`act`](https://github.com/nektos/act). It is accurate; it is
simply not switched on.

| Command | What it covers |
|---|---|
| `npm test` | Unit tier. The one to run on every change |
| `npm run test:integration` | Integration tier — needs Docker running |
| `npm run test:e2e` | E2E tier — spawns the real process |
| `npm run test:all` | All three tiers |
| `npm run test:coverage` | Unit coverage plus the thresholds |
| `npm run typecheck` / `npm run lint` | Types and lint on their own |
| `npm run ci` | Everything the workflow would run |

**`npm run ci` is the gate.** With Actions off it is the only thing between a
mistake and `main`, so run it before every commit — not just before the ones
that feel risky.

---

## How it works

### Layout

```
src/weather/model.ts       pure values, parsing, conversion
src/weather/client.ts      the ONE place that does network I/O
src/weather/service.ts     orchestration over an interface
src/app.ts                 express app factory (returns the app, does not listen)
src/config.ts              environment parsing
src/store/observations.ts  Postgres persistence
src/index.ts               entry point — wiring only
test/unit/                 fast, no I/O
test/integration/          real Postgres, real HTTP
test/e2e/                  spawns the real process
test/helpers/              shared harness
jest.config.ts             one config, three projects
```

### One config, three projects

`projects` is what makes the tiers first-class:

```ts
const config: Config = {
  projects: [
    { displayName: 'unit',        testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
      testTimeout: 5_000 },
    { displayName: 'integration', testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
      testTimeout: 120_000, globalSetup: '...', globalTeardown: '...' },
    { displayName: 'e2e',         testMatch: ['<rootDir>/test/e2e/**/*.test.ts'],
      testTimeout: 60_000 },
  ],
};
```

Then `jest --selectProjects unit`. The common alternative — one config plus
`testPathIgnorePatterns` — cannot give the integration tier a 120s timeout
without giving it to the unit tier too, and a unit tier allowed to hang for two
minutes eventually will.

The 5s unit timeout is deliberate: a "unit" test that needs longer is doing I/O
and belongs in a different tier.

### The seams that make tiers possible

A test tier is not something you add to code. It is something the code's shape
either permits or forbids. Three seams do all the work:

**1. `fetch` is a parameter, not a global.**

```ts
export type FetchLike = (input: string, init?: {...}) => Promise<Response>;

constructor({ baseUrl, apiKey, fetchImpl }: ClientOptions) {
  this.fetchImpl = fetchImpl ?? globalThis.fetch;   // production still terse
}
```

This is why no test in this repo calls `jest.mock('node-fetch')` or patches a
global. Nothing leaks between test files, so no test "passes alone and fails in
the suite".

**2. `createApp` returns the app; it does not listen.**

```ts
export function createApp(service: Describer): Express { ... }
```

That is what lets supertest drive it in-process. No port is bound and nothing
needs tearing down, so the tests cannot collide over a fixed port.

**3. Time and environment are injected.**

```ts
new WeatherService(provider, { now: () => frozen })
load({ WEATHER_API_KEY: 'test' })   // not process.env
```

`load` taking the environment as a parameter is what lets the config tests run
in parallel — nothing mutates shared process state, so nothing leaks.

---

## Running each tier

### Unit tier

```bash
npm test
```

No Docker, no network, no environment variables. **Actual output:**

```
Running one project: unit

Test Suites: 5 passed, 5 total
Tests:       85 passed, 85 total
Snapshots:   0 total
Time:        0.393 s
```

Useful variations:

```bash
npm run test:watch                       # re-run on save
npm run test:changed                     # only files changed vs the base
npx jest --selectProjects unit model      # by filename substring
npx jest -t "rounds half up"              # by test NAME (regex)
npx jest --selectProjects unit --verbose  # list every test name
```

### Integration tier

```bash
npm run test:integration
```

**Requires Docker.** `globalSetup` starts one `postgres:17-alpine` for the whole
project, and `globalTeardown` stops it — including when tests fail, which is
what stops a red run from leaving containers behind.

**Actual output:**

```
  postgres ready on port 32783

Test Suites: 2 passed, 2 total
Tests:       14 passed, 14 total
Snapshots:   1 passed, 1 total
Time:        0.265 s
```

The first run also pulls the image (~15s); afterwards it is cached.

Without Docker the tier skips with an explanation rather than failing:

```
  SKIPPING database tests: <reason>
  Start Docker and re-run: npm run test:integration
```

A missing daemon is an environment problem. Failing on it trains people to
ignore red suites.

**What this tier proves that a unit test cannot:**

- `NUMERIC(5,2)` comes back from node-postgres as a **string**, not a number.
  The `Number(row.temp_c)` in the store exists because of that, and only a real
  database can prove it is still needed.
- The `UNIQUE (city, observed_at)` constraint actually fires — that rule lives
  only in the database.
- The `CHECK (humidity BETWEEN 0 AND 100)` constraint rejects bad data.
- A city name containing `'` and `;` does not break the query (parameterised
  queries, not concatenation).
- An upstream 401 becomes a 502 whose body mentions no API key.

### E2E tier

```bash
npm run test:e2e
```

Spawns the real entry point as a separate process and drives it only over HTTP.
**Actual output:**

```
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Time:        1.226 s
```

**What this tier proves that nothing else can:**

- The service refuses to start without `WEATHER_API_KEY` and exits non-zero,
  rather than starting happily and failing on the first request.
- `SIGTERM` produces exit code 0, so deploys do not drop in-flight requests.
- `/healthz` answers even when the upstream is unreachable — otherwise the load
  balancer pulls every instance during an upstream blip.
- The real `PORT` variable is parsed by the real entry point.

**One trap, learned the hard way here.** Spawn `process.execPath` with
`--import tsx`, never `npx tsx`:

```ts
// Correct — one process, so signals and exit codes are real
spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd, env });

// Wrong — npx runs the service as a CHILD, so SIGTERM never reaches it
spawn('npx', ['tsx', 'src/index.ts'], { cwd, env });
```

With `npx`, the graceful-shutdown test hangs until the tier times out, and the
failure looks like a Jest problem rather than a process-tree one.

---

## Coverage

```bash
npm run test:coverage       # unit tier
npm run test:coverage:all   # every tier
```

**Actual output, unit tier:**

```
File              | % Stmts | % Branch | % Funcs | % Lines |
------------------|---------|----------|---------|---------|
 src              |     100 |      100 |     100 |     100 |
  app.ts          |     100 |      100 |     100 |     100 |
  config.ts       |     100 |      100 |     100 |     100 |
 src/store        |       0 |        0 |       0 |       0 |
  observations.ts |       0 |        0 |       0 |       0 |
 src/weather      |     100 |      100 |     100 |     100 |
  client.ts       |     100 |      100 |     100 |     100 |
  model.ts        |     100 |      100 |     100 |     100 |
  service.ts      |     100 |      100 |     100 |     100 |
```

**Everything the unit tier owns is at 100%. `src/store` is at 0% and that is
correct** — it is pure SQL, the unit tier cannot test it, and its real coverage
comes from the integration tier. Writing a mocked-`pg` test to raise that number
would prove only that the mock works.

### Thresholds: two things worth knowing

**Per-glob beats one global number.** A single global 80% lets somebody delete
the payment tests and make it back up with tests for a string helper:

```ts
coverageThreshold: {
  global:            { branches: 88, functions: 68, lines: 80, statements: 80 },
  './src/weather/':  { branches: 100, functions: 100, lines: 100, statements: 100 },
  './src/config.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
  './src/app.ts':    { branches: 100, functions: 100, lines: 100, statements: 100 },
  './src/store/':    { branches: 0, functions: 0, lines: 0, statements: 0 },
}
```

**A path-specific threshold REMOVES those files from the `global` group.** This
is not obvious from the docs and it surprises everybody once. Once every file is
listed, `global` governs nothing and passes trivially — which makes it a useful
backstop for *new* files: anything added tomorrow that nobody wrote a threshold
for must clear 80% or the build fails.

The explicit `'./src/store/': 0` is deliberate rather than an exclusion. An
exclusion is invisible; a written-down zero is a claim somebody can check.

**Two caveats that apply to any coverage number:**

- Coverage counts lines executed, not assertions made. A test that calls a
  function and asserts nothing scores the same as one checking every field.
- 100% is not the goal. It is achievable here because the code was written with
  seams; chasing it in code without them produces tests that assert mocks.

---

## Patterns worth copying

### Naming: read it out loud

```ts
describe('parseUnits', () => {
  it('defaults to imperial when empty', () => { ... });
});
```

Read as "parseUnits defaults to imperial when empty". A name that does not
survive that reading is a test nobody will understand at 3am.

### `it.each` — the table-driven form

```ts
it.each<[string, string | undefined, Units]>([
  ['empty string defaults to imperial', '', 'imperial'],
  ['metric', 'metric', 'metric'],
  ['mixed case is accepted', 'MeTrIc', 'metric'],
])('%s', (_name, input, expected) => {
  expect(parseUnits(input)).toBe(expected);
});
```

Adding a case is one line. The `%s`/`%p`/`%i` placeholders are interpolated into
the test name, so a failure names the case rather than saying "row 4".

### Async assertions — the mistake everybody makes once

```ts
await expect(client.fetchConditions('x')).rejects.toThrow(CityNotFoundError);  // correct
await expect(promise).resolves.toEqual(value);                                 // correct

expect(client.fetchConditions('x')).toThrow();   // WRONG — passes unconditionally
```

A Promise is not a function that throws, so the third line asserts nothing and
always passes. `rejects`/`resolves` plus `await` is the only correct form. The
`jest/valid-expect` lint rule in this repo catches it.

### Assert the type of an error, not its message

```ts
expect(() => parseUnits('kelvin')).toThrow(InvalidUnitsError);   // survives rewording
expect(() => parseUnits('kelvin')).toThrow('unknown units: kelvin');  // brittle
```

### Three ways to fake, in order of preference

```ts
// 1. A plain object — when you only need a return value
const provider = { fetchConditions: async () => SAMPLE };

// 2. jest.fn() — when you need to assert on the calls
const provider = { fetchConditions: jest.fn().mockResolvedValue(SAMPLE) };
expect(provider.fetchConditions).toHaveBeenCalledWith('Orlando');

// 3. jest.mock('../module') — ONLY when the dependency cannot be injected
```

Module mocking is last for a reason: it is global to the test file, it runs
before imports (`jest.mock` is hoisted, which surprises everyone), and it
couples the test to the module graph rather than to the interface. If you find
yourself reaching for it, the missing seam is usually the real problem.

### Assert on the request sent, not only the response parsed

```ts
const [url, init] = fetchImpl.mock.calls[0] ?? [];
const parsed = new URL(url as string);

expect(parsed.searchParams.get('q')).toBe('Cape Canaveral');
expect(init?.headers).toEqual({ Accept: 'application/json' });
```

A client that silently drops the city parameter passes every response-shaped
assertion.

### `clearMocks` and `restoreMocks`

```ts
clearMocks: true,     // wipes calls between tests
restoreMocks: true,   // restores spies to their originals
```

Without these, a test that passes alone fails in the suite — the single most
expensive kind of flake to diagnose, because the failing test is not the broken
one.

### Fake timers

```ts
jest.useFakeTimers();
jest.advanceTimersByTime(1_000);
expect(signal.aborted).toBe(true);
jest.useRealTimers();   // ALWAYS restore
```

```ts
jest.useFakeTimers().setSystemTime(new Date('2026-08-11T16:04:05Z'));
```

Fake timers make a timeout test instant and deterministic instead of slow and
flaky. Leaked fake-timer state breaks every later test in the same worker, and
the failure surfaces somewhere unrelated — so restore in the same test.

Prefer an injected clock where you can: it is local to one object rather than
global to the process.

### supertest for HTTP

```ts
const response = await request(createApp(service)).get('/weather?city=Orlando');

expect(response.status).toBe(200);
expect(response.headers['content-type']).toMatch(/application\/json/);
expect(response.body).toEqual(SAMPLE_REPORT);
```

### Silencing expected console noise

```ts
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
// ...
expect(errorSpy).toHaveBeenCalled();   // it must still have logged
errorSpy.mockRestore();
```

Silence it *and* assert it happened. A handler that stops logging its cause
leaves operators blind, and a test that only silences the output would not
notice.

### Snapshots — useful, and easy to misuse

```ts
expect(response.body).toMatchInlineSnapshot();   // leave EMPTY; Jest fills it in
```

Never hand-write a snapshot: one that happens to be wrong turns the test into a
permanent lie. And never snapshot anything containing a timestamp, an id, or a
random value — it will fail on the second run.

Use them for large stable payloads where an inline literal would swamp the test.
The cost is that `--updateSnapshot` makes any failure disappear, so review the
diff every single time.

### Avoid `expect` inside a `catch`

```ts
// Wrong — if the code unexpectedly succeeds, the catch never runs and the
// test passes while proving nothing.
try { load(bad); } catch (e) { expect(e).toBeInstanceOf(ConfigError); }

// Right
expect(attempt).toThrow(ConfigError);
let message = '';
try { attempt(); } catch (e) { message = (e as Error).message; }
expect(message).not.toContain(secret);
```

`jest/no-conditional-expect` enforces this.

---

## Lint and types

Both are part of "green" here, and both are clean.

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (flat config)
```

Three things worth copying from the setup:

**`eslint.config.mjs`, not `.eslintrc`.** Since ESLint 9 the old format is
silently ignored — which looks exactly like "no lint errors".

**Replace a rule rather than suppress it.** `@typescript-eslint/unbound-method`
flags every `expect(obj.method)`, which is how you assert on a mock. The fix is
not a disable comment; it is `jest/unbound-method`, which understands `expect()`
and still catches the real cases.

**Strict tsconfig catches what tests otherwise must.** `noUncheckedIndexedAccess`
turns `array[0]` into `T | undefined`, which is why the code reads
`mock.calls[0] ?? []`. That flag alone removes a whole category of test.

---

## Setting this up in a new repo

### Step 1 — Create the seams first

Tests are easy once the code permits them and impossible before.

- **Inject `fetch`** (or the DB pool, or the clock) rather than importing a
  global. One constructor parameter replaces every `jest.mock` you would
  otherwise write.
- **Export an app factory** that returns the app instead of calling `listen`.
- **Pass the environment in** rather than reading `process.env` at module scope.
  Module-scope reads happen at import time, before any test can set them.
- **Keep the entry point to wiring only.** Nothing in it can be imported by a
  test, so anything worth testing must live elsewhere.

### Step 2 — Copy the scaffolding

```bash
cp <test-jest>/jest.config.ts .
cp <test-jest>/eslint.config.mjs .
cp <test-jest>/tsconfig.json .
cp -r <test-jest>/.github/workflows/test.yml .github/workflows/
mkdir -p test/{unit,integration,e2e,helpers}
cp <test-jest>/test/helpers/*.ts test/helpers/
```

### Step 3 — Install

```bash
npm i -D jest@^30 @types/jest ts-jest typescript @types/node \
         supertest @types/supertest \
         @testcontainers/postgresql \
         eslint @eslint/js typescript-eslint eslint-plugin-jest tsx
```

Add the scripts from this repo's `package.json` — the `--selectProjects` ones
are what give each tier its own command.

### Step 4 — Write the tiers in this order

1. **Unit tests for pure functions.** Fastest to write, and they force the seams
   to be real.
2. **Unit tests for the client**, with an injected fetch stub — happy path plus
   every status the upstream can return.
3. **Unit tests for the routes**, with supertest and a fake service — one per
   status-code branch.
4. **Integration tests** for anything crossing a process boundary: SQL, the
   assembled stack, serialisation.
5. **E2E tests** for the process: config validation, startup, shutdown, health.

### Step 5 — Wire the gate

> **Note:** Actions is switched off on *this* repository (see "Running the tests
> without CI"), so the gate here is `npm run ci`, run by hand. The advice in this
> section is for the repo you are setting up, where you should wire it properly.


Copy the workflow, then require the **All tiers green** check in branch
protection. A tier that runs only on somebody's laptop is documentation, not a
gate.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Jest did not exit one second after the test run` | A leaked handle — an open pool, server, or timer | `await pool.end()`, `server.close()`, `clearTimeout`; run with `--detectOpenHandles` |
| Test passes alone, fails in the suite | Shared state between tests | `clearMocks`/`restoreMocks`; stop mutating `process.env`; give each test unique data |
| A promise assertion always passes | Missing `await` or `rejects` | `await expect(p).rejects.toThrow()` |
| `toBe` fails on numbers that look equal | Floating point | `toBeCloseTo(expected, 9)` |
| `jest.mock` seems to run too early | It is hoisted above the imports | Prefer injection; that is the whole reason |
| Fake timers break a later test file | `useRealTimers()` never called | Restore in the same test |
| Integration tier skips | Docker is not running | Start Docker, re-run |
| E2E hangs on shutdown | Spawned via `npx`, so SIGTERM hit the wrapper | Spawn `process.execPath --import tsx` |
| ESLint reports nothing at all | `.eslintrc` with ESLint 9 | Use `eslint.config.mjs` |
| `testTimeout` rejected in a project | Jest 29's types | Upgrade to Jest 30 |
| Coverage thresholds pass despite bad coverage | Path globs removed those files from `global` | Give each area its own threshold |

---

## Commands reference

| Command | What it does |
|---|---|
| `npm test` | Unit tier |
| `npm run test:integration` | Integration tier (needs Docker) |
| `npm run test:e2e` | E2E tier |
| `npm run test:all` | All three |
| `npm run test:watch` | Unit tier, re-run on save |
| `npm run test:changed` | Only tests for changed files |
| `npm run test:coverage` | Unit coverage + thresholds |
| `npm run test:coverage:all` | Coverage across every tier |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run ci` | Typecheck + lint + all tiers |
| `npx jest -t "name"` | Run tests matching a name |
| `npx jest --detectOpenHandles` | Find what is keeping Node alive |
| `npx jest -u` | Update snapshots (review the diff!) |

---

## See also

- **test-go** — the same three tiers for Go services, same subject domain.
- **test-playwright** — the browser tier, plus API testing from the browser stack.
