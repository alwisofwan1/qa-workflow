# Trial: the official planner on a real ticket

Run against a production React + MUI app with Japanese UI, behind a feature flag, on a
shared test environment. The ticket had seven acceptance criteria covering a prompt
editor: a free-text area replacing a block UI, a template-insertion rule, and a
single-default-at-a-time badge.

The question was narrow: **is the stock `playwright-test-planner` good enough that this
repo should stop rebuilding it and become a guard layer instead?**

## Verdict: yes

Three criteria were set before the run.

**Can it find controls with no `data-testid`?** Yes. The app had `data-testid` on roughly
2% of components and none on the screens under test. Every locator came back as role +
accessible name, and the plan explicitly warned that the MUI-generated element ids
(React `useId` values like `_r_3l_`) are unstable and must never be used.

**Do the locators survive a non-English UI?** Yes — all accessible names captured in
Japanese, with an instruction to use them verbatim and not translate.

**Does it capture the hard part?** This was the real test. One AC read: *inserting a
template places it above existing content, separated by exactly one blank line*. A
shallow plan asserts "the template appears in the textarea". The planner produced:

```ts
expect(afterValue.endsWith('\n\n' + beforeValue)).toBe(true)
const insertedPrefix = afterValue.slice(0, afterValue.length - (beforeValue.length + 2))
expect(insertedPrefix.endsWith('\n')).toBe(false)   // not \n\n\n
```

It called the first line "the primary, load-bearing assertion", and for the neighbouring
AC deliberately placed a blank line *inside* the pre-existing content to prove insertion
does not collapse it.

Unprompted, it also: generated unique names to avoid collisions on the shared
environment, refused to hardcode which item currently held the default badge ("read it
live"), recognised that the badge is org-wide shared state and prescribed serial
execution with a teardown restoring the original, and noticed that the built-in item has
no delete action so naive teardown would fail.

It surfaced two genuine product defects nobody asked it to look for: success toasts
localised inconsistently (one language for one action, another for two others, under a
pinned locale), and no unsaved-changes warning when closing a dirty editor panel.

## What it got wrong

- **Spec paths pointed into the plans directory**, not the tests directory. The runner's
  `testMatch` would have found nothing — seven files generated, zero tests executed, no
  error raised. Exactly the silent-green failure this repo exists to prevent.
- **Left an ambiguity for the generator**: two options for one assertion ("exact match,
  or fall back to structural"), which the generator would resolve toward the easier one.
- **One brittle assertion**: enumerating the exact set of toolbar buttons, which breaks
  on any future addition without anything being wrong.

## What the trial found in *this* repo

Two holes in `heal-guard.ts`, both now closed and both now regression-tested.

**Values inside `expect()` were unprotected.** The guard fingerprinted matcher arguments
only. In the plan's dominant assertion style the matcher argument is a meaningless
`true`, and the acceptance criterion lives inside the `expect()` call:

```ts
expect(after.endsWith('\n\n' + before)).toBe(true)
```

Rewriting `'\n\n'` to `'\n'` guts the AC and passed the guard cleanly. Literals in a
non-locator `expect()` argument are now protected; locator expressions stay healable, so
legitimate locator swaps still pass.

**Commented-out assertions were invisible.** Found by the guard's own test suite, not by
the trial. `// await expect(...)` still matched every pattern, so counts and fingerprints
were unchanged. Source is now stripped of comments before analysis — disabling an
assertion with `//` is exactly as destructive as deleting it.

## Environment lessons worth keeping

- **Pin the UI language explicitly.** Accessible names are the locators; if the app picks
  its language from stored state, a test that passes locally fails in CI purely on
  locale. Pin it in the seed.
- **Never read flag-dependent UI without a retrying assertion.** A flag hook that starts
  `false` and resolves asynchronously will serve the pre-flag UI to any immediate read.
  An early probe here reported the feature as disabled when it was enabled — the probe
  was racing the fetch. Retrying assertions only.
- **Confirm the flag from the backend, not the UI.** One request to the flag endpoint
  settles in seconds what UI inspection gets wrong.
