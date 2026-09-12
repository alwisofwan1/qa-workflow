---
name: qa-generate
description: Stage 3 — generate Playwright specs from an approved plan plus a verified selector inventory.
---

# qa-generate

Input: approved `test-plan.md` + `selector-inventory.md`.
Output: spec files in the **app repo**, on a branch, never on develop.

## Hard constraints

1. **Locators may only come from the inventory.** If the plan needs an element the
   inventory does not have, stop and return to `qa-explore`. Do not improvise.
2. **Every test title carries its AC tag** — `test('cart shows all items @AC1', ...)`.
   `tools/report.mjs` computes coverage from these. An untagged test is invisible to the
   coverage gate.
3. **No literal expected values that were not in the plan.** If the plan says the tax rate
   is 8%, assert the computed relationship, not a hardcoded `$7.20` that only holds for
   one cart.
4. **No vacuous assertions.** `expect(errorBanner).not.toBeVisible()` on a page where the
   banner never existed passes without testing anything. Assert absence only where the
   element could plausibly be present.
5. **One concern per test.** A 100-line mega-test reports failures uselessly. Use
   `test.step()` for multi-step flows that genuinely belong together.
6. **Share setup through fixtures**, not copy-pasted `beforeEach` login blocks. Reuse
   authenticated state via `storageState` where the app allows it.
7. **No `waitForTimeout`.** Playwright auto-waits; a sleep is a latent flake.

## File naming

Name the file after the unit or flow under test — `checkout-flow.spec.ts`. Do not create
aspect-suffixed variants (`checkout-flow.doubleSubmit.spec.ts`); use multiple `describe`
blocks in one file.
