# qa-workflow

Agentic E2E QA pipeline: **user story → test plan → exploration → Playwright specs → execution → report → PR.**

App-agnostic. Designed against a React + MUI + Playwright codebase, but nothing here is tied to one.

---

## Why this exists

Agent-generated test suites fail in a specific, predictable way: the agent is allowed to
grade its own homework. It writes the tests, heals the tests, then writes the report that
says the tests pass. Every one of those steps gives it another chance to make its own work
look successful.

The public examples of this pattern all share the same three defects:

- the **healer weakens assertions** until the suite goes green,
- the **reporter narrates** pass/fail instead of parsing it,
- **coverage is claimed**, not computed,

and then everything is auto-committed, making the errors permanent.

This repo is the same workflow with those three holes closed.

## The pipeline

```
User Story (RCB-XXX)
   ↓
1. Test Plan ─────────────▶ 🛑 HUMAN APPROVES
   ↓
2. Exploration (MCP) ─────▶ selector-inventory.md   (the only source of DOM truth)
   ↓
3. Spec Generation         (may only use locators from the inventory)
   ↓
4. Execution ─────────────▶ results.json
   ↓
5. Healing                 (scope-locked: selectors & waits only)
   ↓                        everything else exits as a finding
6. Report                  (numbers parsed from results.json, coverage computed)
   ↓
7. Branch + PR ───────────▶ 🛑 HUMAN REVIEWS ──▶ merge
```

## The four guards

| # | Guard | Enforced by |
|---|---|---|
| 1 | Plan approved by a human before any code is generated | workflow stops, `skills/qa-plan` |
| 2 | Healer may not touch asserted values, skip, or delete tests | `tools/heal-guard.mjs` (diff check, not a prompt) |
| 3 | Report numbers come from `results.json`, never from the model | `tools/report.mjs` |
| 4 | AC coverage computed from `@AC` tags; an untested AC fails the run | `tools/report.mjs --require-ac` |

Guards 2 and 3 are code, not instructions. An agent cannot talk its way past them.

## Locator policy

Role-first, not `data-testid`-first.

```
1. getByRole / getByLabel / getByText      ← preferred, works with MUI out of the box
2. existing [data-testid]                  ← use when present
3. request a new data-testid               ← emitted as a separate small PR, never inline
```

Rationale: on a mature codebase, `data-testid` coverage is typically thin. Blocking on a
full instrumentation pass would kill this initiative before it ships anything.
Instrumentation becomes a byproduct of the workflow instead of a prerequisite.

## Layout

```
skills/     the five agent stages (Claude Code skills)
tools/      the guards — plain Node, no LLM, CI-runnable
templates/  test-plan + selector-inventory formats
docs/       design notes and decisions
examples/   a worked run against a real ticket
```

## Status

Early. Scaffold in place, first real ticket run pending.

## License

MIT
