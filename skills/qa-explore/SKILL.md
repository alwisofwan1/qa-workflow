---
name: qa-explore
description: Stage 2 — drive the real app via Playwright MCP and produce a selector inventory. The only source of DOM truth in the pipeline.
---

# qa-explore

Input: an approved test plan.
Output: `plans/<TICKET>/selector-inventory.md` following `templates/selector-inventory.md`.

## Why this stage exists

Without it, the generator hallucinates selectors. It will produce plausible, well-formed,
entirely fictional locators — and they will look correct in review. Every locator that
reaches stage 3 must be traceable to a line in this inventory.

## Procedure

1. Open the app through Playwright MCP (or chrome-devtools MCP) against the test environment.
2. Walk each screen the plan touches. Snapshot the accessibility tree, not raw HTML.
3. For each element the plan needs, record a locator using this priority:

   | Priority | Locator | Note |
   |---|---|---|
   | 1 | `getByRole(...)` / `getByLabel(...)` | preferred; MUI exposes these already |
   | 2 | `getByText(...)` | only when stable and not i18n-fragile |
   | 3 | `getByTestId(...)` | when the app already has one |
   | 4 | **instrumentation request** | element is unreachable — see below |

4. Verify every recorded locator actually resolves, and resolves to exactly one node.
   Record the resolved count. An untested locator is not inventory, it is a guess.

## Instrumentation requests

When an element cannot be addressed reliably, do **not** fall back to a CSS class or
`nth()`. Record it under `## Instrumentation Needed` with the component file path and the
proposed `data-testid`. These become a separate small PR against the app repo. They never
get inlined into a test as a brittle workaround.

## i18n

The target app is Japanese/English. Prefer role and label over visible text. Where text is
unavoidable, note the locale the string belongs to.
