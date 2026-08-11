# test-jest

Reference test framework for TypeScript/Node services using Jest. Public, MIT,
and written to be read — the README is the deliverable, pasted into OneNote as a
development reference. Treat the code as documentation that happens to run.

## Commits go direct to `main`

**This repo is a sanctioned exception to the trunk-based PR rule in
`~/.claude/CLAUDE.md`.** Commit straight to `main`; no branch, no PR, no review
gate. The marker `.claude/allow-commit-on-main` at the repo root is what tells
the `block-commit-on-main` hook to allow it.

Single-author reference repo, no runtime, no deploy, no consumers to break. A PR
gate buys nothing here and costs the thing the repo exists for — writing an
example down while it is fresh.

The exemption is **not inherited**. It covers this repo only, at this root.

## What must stay true

- **All three tiers are green at every commit.** `npm run ci` before committing.
  A reference framework whose own tests fail teaches the wrong lesson better
  than any README teaches the right one.
- **Typecheck and lint are part of green.** Both are clean today; keep them so.
- **Never suppress a lint rule.** No `eslint-disable`, in any form, for any
  rule. Fix the code, or replace the rule with a better-informed one — as this
  repo does with `jest/unbound-method` in place of the base rule.
- **The README quotes real output.** Test counts, timings and coverage
  percentages are pasted from actual runs. When behaviour changes, re-run and
  paste the new numbers rather than editing them by hand.
- **Every example carries its "why".** A snippet showing `clearMocks` is worth
  little; one explaining that without it a test passes alone and fails in the
  suite is why somebody reads this instead of the Jest docs.
- **No internal detail leaks.** This repo is public: no tracker ids, no branch
  names, no internal hostnames anywhere a stranger reads.

## Layout

```
src/weather/       domain, upstream client, service   (unit tier)
src/app.ts         express app factory                (unit tier)
src/config.ts      env parsing                        (unit tier)
src/store/         postgres persistence               (integration tier)
src/index.ts       entry point — wiring only          (e2e tier)
test/unit/         fast, no I/O
test/integration/  real Postgres via testcontainers, real HTTP
test/e2e/          spawns the real process
test/helpers/      shared harness
```

## Commands

`npm test` (unit), `npm run test:integration` (needs Docker), `npm run test:e2e`,
`npm run ci` (typecheck + lint + all tiers).

## Toolchain notes

- Node 24 via nvm — fresh shells give 22.17.1, so `nvm use 24` first.
- Jest 30 with `projects`, one per tier. Jest 29's types reject a per-project
  `testTimeout`; that is why this repo is on 30 and should stay there.
- The e2e tier spawns `process.execPath --import tsx`, never `npx tsx`. npx
  runs the command as a child, so SIGTERM never reaches the service and the
  graceful-shutdown test hangs until the tier times out.
