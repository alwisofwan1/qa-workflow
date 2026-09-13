---
name: qa-gate
description: Run both guards over a healed test run and return a release verdict. The single command CI calls.
---

# qa-gate

The one command that decides whether a test run may be believed.

```sh
qa-gate --results results.json --ac AC1,AC2,AC3 [--base <reviewed-commit>] [--out gate.md]
```

It answers two independent questions, and either one blocks:

1. **Did anything tamper with the tests since the baseline?** Only when `--base` is given.
   Spec files are taken from `git diff --name-only <base>` unless `--specs` names them.
2. **Do the results and the coverage hold up?** Failures, acceptance criteria with no
   test, and criteria proven only by a flaky pass all block.

A green run is still blocked if a spec was tampered with. That combination — all tests
passing, release refused — is the whole reason this exists.

`--base` is the commit the specs were last **reviewed** at, not `HEAD`. Pointing it at
HEAD compares a file to itself and passes everything.

For a release gate in CI, start from `templates/release-gate.yml`.

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
