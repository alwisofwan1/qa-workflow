---
name: qa-plan
description: Stage 1 gate — review a Playwright planner's test plan against the ticket's acceptance criteria before any code is generated.
---

# qa-plan

This does **not** write the plan. `npx playwright init-agents` ships a planner that
explores the live app and writes a better one than a blind LLM pass can. This is the
gate that plan must clear.

## Input

A plan from `playwright-test-planner` plus the ticket's acceptance criteria.

## Checklist

1. **Every AC is accounted for.** Each one is either covered by a scenario or listed
   under `## Untestable` with a reason. An AC that is simply absent is the single most
   common way an agentic QA run reports success while proving nothing.
2. **Every scenario carries its AC tag** (`@AC1`, `@AC-P2-3`) in the title that will
   become the test title. `tools/report.ts` computes coverage from these; an untagged
   test is invisible to the gate.
3. **File paths point where the test runner actually looks.** Planners have been
   observed writing spec paths into the plans directory, which produces files Playwright
   never runs and a report of zero tests with no error.
4. **Assertions are observable outcomes**, not intentions. "Total shows $97.17", not
   "totals are correct".
5. **No ambiguity is left for the generator to resolve.** If the plan offers two ways to
   assert something, pick one now. The generator will otherwise pick the easier one.
6. **Values that must not rot are not hardcoded.** Prefer comparing the app against
   itself (does the pre-filled value equal what the template menu inserts?) over pinning
   a test to today's copy.
7. **Shared state is identified.** Anything org-wide or environment-wide needs serial
   execution and a teardown that restores the original value — read live, never hardcoded.

## Stop condition

Print the verdict and **wait**. Generation does not begin until a human approves. This
is the cheapest correction point in the pipeline and the only one that costs nothing
to act on.
