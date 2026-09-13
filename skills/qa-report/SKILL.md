---
name: qa-report
description: Stage 6 — assemble the execution report. All figures come from tooling; the model writes prose only.
---

# qa-report

Input: `results.json`, findings from `qa-heal`, the approved plan.
Output: `test-results/<TICKET>-report.md`.

## Division of labour

| Produced by | What |
|---|---|
| `tools/report.ts` | totals, pass/fail/flaky/skipped, AC coverage table, failure list |
| you | executive summary, risk assessment, finding narratives, recommendation |

Generate the numeric sections by running the tool and pasting its output verbatim:

```bash
node dist/tools/report.js results.json --ac AC1,AC2,AC3,AC4,AC5 --require-ac
```

## Prohibited

- **Do not write a number the tool did not produce.** Not a total, not a percentage, not
  a count of scenarios "planned".
- **Do not claim coverage the tool did not compute.** If `report.ts` says an AC is NOT
  COVERED, the report says NOT COVERED — regardless of how thorough the work felt.
- **Do not recommend release when the gate failed.** A non-zero exit from `report.ts` is
  a blocked release, and the report must lead with that.
- Do not describe manual exploratory testing that did not happen.

## Required sections

1. Gate result (pass/blocked) and why — first, before anything else
2. Tool output, verbatim
3. Findings from `qa-heal`, each with assessment
4. Coverage gaps, stated plainly
5. Recommendation, consistent with 1
