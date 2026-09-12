---
name: qa-gate
description: Run both guards over a healed test run and return a release verdict. The single command CI calls.
---

# qa-gate

The one command that decides whether a test run may be believed.

```bash
# 1. did the healer stay inside its scope?
node tools/heal-guard.mjs --base "$BASELINE" $(git diff --name-only "$BASELINE" -- '*.spec.ts')

# 2. do the numbers and the coverage hold up?
node tools/report.mjs results.json --ac "$DECLARED_ACS" --require-ac
```

`$BASELINE` is the commit the specs were at **before** healing — not `HEAD`, if the
healer has already committed. Getting this wrong makes the guard compare a file to
itself and pass everything.

## Exit codes

| Code | From | Meaning |
|---|---|---|
| 0 | both | run is trustworthy |
| 1 | heal-guard | healer edited assertions, skipped, or deleted tests |
| 1 | report | tests failed |
| 2 | report | an acceptance criterion has no passing test |

Any non-zero result blocks the release and must be stated first in the report. Do not
re-run the pipeline hoping for a different answer: a flaky pass is reported as
`FLAKY ONLY — NOT PROVEN` by design, and re-rolling it is the same act as healing an
assertion away.

## What this cannot catch

Be honest about the boundary. The guards check that the agent did not weaken the tests
it was given. They cannot tell you the tests were worth writing. A suite that passes
every gate can still test the wrong thing — that is what plan approval and PR review
are for, and neither is optional.
