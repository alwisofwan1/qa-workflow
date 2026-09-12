---
name: qa-plan
description: Stage 1 — turn a ticket / user story into a reviewable E2E test plan. Stops for human approval before any code is generated.
---

# qa-plan

Input: a ticket (RCB-XXX) or user story with acceptance criteria.
Output: `plans/<TICKET>/test-plan.md` following `templates/test-plan.md`.

## Rules

1. **Every scenario must name the AC it proves** (`@AC1`, `@AC2`, …). A scenario that
   proves nothing in the AC list does not belong in the plan.
2. **Every AC must appear in at least one scenario.** If an AC cannot be tested through
   the UI, say so explicitly under `## Untestable` with the reason — do not silently drop it.
3. Write `expect:` lines as observable outcomes, not intentions. "Total shows $97.17",
   not "totals are correct".
4. Do not invent selectors here. The plan describes behaviour; stage 2 discovers the DOM.
5. Do not plan cross-browser or mobile matrix scenarios as separate specs — those are
   Playwright projects, configured once, not duplicated test bodies.

## Stop condition

This stage ends by printing the plan path and **waiting**. Do not proceed to `qa-explore`
until a human has approved the plan. This is the cheapest correction point in the pipeline
and the only one that costs nothing to act on.
