---
name: qa-heal
description: Stage 5 — run the Playwright healer, then adjudicate its output with heal-guard. Rejected edits become findings.
---

# qa-heal

The official `playwright-test-healer` is useful and will be used. It also cannot be
trusted unsupervised, and this is not a suspicion — it is what its own agent definition
instructs it to do:

> "Code Remediation: … Fixing assertions and **expected values**"
> "You will continue this process **until the test runs successfully** without any failures or errors."
> "If the error persists … mark this test as **test.fixme()** so that it is skipped."
> "Do not ask user questions … do the most reasonable thing possible to **pass the test**."

An agent told to make tests pass, given permission to edit expected values, will
eventually edit an expected value. This stage exists to catch that moment.

## Procedure

1. **Commit the generated specs first.** That commit is the baseline. Without it the
   guard has nothing to compare against and will pass everything.
2. Run the healer.
3. Adjudicate:

```bash
node tools/heal-guard.mjs --base "$BASELINE" $(git diff --name-only "$BASELINE" -- '*.spec.ts')
```

4. **Exit 0** — the healing was locator/wait work. Keep it.
5. **Non-zero** — revert those files and convert each rejected edit into a finding.
   Do not re-run the healer on the same failure with different wording. The guard's
   verdict is not a puzzle to route around.

## The distinction that matters

A test fails for one of two reasons:

- **the test is wrong** — bad locator, bad wait, bad setup → *heal it*
- **the app is wrong, or the spec is wrong** — the asserted value does not match reality
  → *finding; escalate, do not edit*

Assume the second until the first is proven.

## Findings format

```md
### Finding: <one line>
- Test: `file.spec.ts:LINE` — <test title> (@ACn)
- Expected: <what the plan says>
- Actual: <what the app did>
- Assessment: app defect | spec defect | environment
- Evidence: trace / screenshot path
```
