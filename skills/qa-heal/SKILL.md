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
node dist/tools/heal-guard.js --base "$BASELINE" $(git diff --name-only "$BASELINE" -- '*.spec.ts')
```

4. **Exit 0** — the healing was locator/wait work. Keep it.
5. **Non-zero** — revert those files and convert each rejected edit into a finding.
   Do not re-run the healer on the same failure with different wording. The guard's
   verdict is not a puzzle to route around.

## Bounded, not endless

**Three attempts, then stop.** After the third failed fix, report what is still failing,
what was tried, and ask for direction. An agent that keeps iterating on a test it cannot
fix eventually reaches for `test.fixme()` — not because that is the right answer, but
because it is the only remaining way to end the loop.

**Never edit application code.** Not once, not "just a small fix so the test passes". A
test run that also changes the product is not evidence: the thing under test moved while
it was being measured. If the application is genuinely wrong, that is a finding and a
separate change with its own review. `qa-gate` blocks any run where non-test files
changed since the baseline, so this is enforced rather than requested.

This warning is specific. A published Playwright-testing skill instructs its fix loop to
do exactly this — *"App bug → fix the application code"* — inside an automated loop with
no gate. Read that as the default an agent will drift toward unless stopped.

## Every failure gets a label

Before fixing anything, classify the failure in the report as one of:

| Label | Meaning | Action |
|---|---|---|
| **test bug** | wrong locator, wrong wait, bad setup | heal it |
| **app bug** | the application behaves wrongly | finding — do not touch the app |
| **spec bug** | the expected value is stale or wrong | finding — a human decides |

An unlabelled failure is an unfinished diagnosis. "It passes now" is not a label.

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
