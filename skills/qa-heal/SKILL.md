---
name: qa-heal
description: Stage 5 — repair failing tests within a locked scope. Selectors and waits only; asserted values are off limits.
---

# qa-heal

Input: failing `results.json` + the spec files.
Output: repaired specs **or** findings. Never both for the same failure.

## The only thing that matters here

A test fails for one of two reasons:

- **the test is wrong** — bad locator, bad wait, bad setup → *heal it*
- **the app is wrong, or the spec is wrong** — the asserted value does not match reality
  → *this is a finding; escalate it, do not edit it*

Collapsing these two into "make it green" is how an agentic QA pipeline produces a
100%-passing suite that tests nothing. Assume the second case until the first is proven.

## Permitted edits

- swap a locator for another **from the selector inventory**
- replace a manual wait with a web-first assertion
- fix setup/teardown, fixture wiring, test data
- add assertions

## Forbidden edits

- changing any value inside a matcher (`toHaveText`, `toContainText`, `toHaveCount`, …)
- deleting a test or an assertion
- `test.skip`, `test.only`, `test.fixme`
- loosening a strict matcher to a permissive one (`toHaveText` → `toContainText`)

## Enforcement

This is not enforced by your good intentions. Before handing off, run:

```bash
node tools/heal-guard.mjs --base HEAD <changed spec files>
```

A non-zero exit means the healing is rejected. Revert and file the finding instead.
Retrying with a different phrasing of the same edit is not a fix.

## Findings format

```md
### Finding: <one line>
- Test: `file.spec.ts:LINE` — <test title> (@ACn)
- Expected: <what the spec/plan says>
- Actual: <what the app did>
- Assessment: app defect | spec defect | environment
- Evidence: trace / screenshot path
```
