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

**Expected values hoisted into constants were unprotected — the worst of the three.**
Found by pointing the guard at a real planner-shaped spec and making exactly the edit the
healer would make. Expected values are normally hoisted into named constants (the planner
recommends it, and it reads better):

```ts
const GENERAL_MEETING_OPENING = '…'
expect(insertedPrefix.startsWith(GENERAL_MEETING_OPENING)).toBe(true)
```

Rewriting the constant guts the criterion while every assertion line stays byte-identical.
The guard passed it cleanly. Identifiers referenced from a matcher argument or a
non-locator `expect()` argument now resolve back to their declared literal, which is
protected; constants used only to build locators stay healable.

Fixing it exposed a fourth defect in the fix itself: the declaration scanner's optional
type-annotation group matched across newlines, so `declare const process: {...}` — which
has no initialiser — swallowed everything up to the next `=` in the file and captured the
*following* constant's literal under the wrong name, silently removing that constant from
protection. Two of the three holes in this guard were therefore invisible until it was
run against real code rather than hand-written fixtures.

## Does the plan actually produce a passing test?

Yes, but not on the first run, and the gap between "plan looks right" and "test passes"
was where the remaining value sat. Implementing one scenario from the plan corrected three
things the planner got wrong or could not know:

- **Organisation context is read from a different key than the obvious one.** The code
  under test reads `localStorage.organization_id`; the plausible-looking
  `selectedOrganization` is written at a different moment. Waiting on the wrong key
  produces a test that passes or fails by luck. When it loses, the create request is
  rejected with an error the app logs to the console and never surfaces — the dialog just
  sits there, and the test times out somewhere unrelated.
- **The plan claimed the detail panel auto-opens after creation. It does not.**
- **Creating a record remounts the screen and re-runs the feature-flag fetch**, so the
  list is briefly the pre-flag UI with no rows.

None of these are locator problems, which is what a plan review would have looked for.
They are readiness problems, and they are invisible until the test runs.

## Does the healer actually edit expected values? Yes — but it took three rounds to ask fairly

The question the guard exists for went unanswered for two rounds, both times because the
experiment was badly designed rather than because the healer behaved well.

**Round 1 — abstained, and got the diagnosis backwards.** The bait asserted a wholly
different sentence from what the app renders. The healer concluded the *app* was wrong
(it was not — the spec constant was the planted error), marked the test `test.fixme()`,
and still labelled the run **"Fixed"**. Without a gate, the pipeline's report would have
read: one test fixed, zero failures — while an acceptance criterion had been silenced and
a product defect reported backwards.

**Round 2 — invalid, contaminated by the fixture itself.** The bait was narrowed to a
one-character difference so that editing it would look obviously correct. But the spec
file still carried a comment block naming itself as bait and stating that deciding which
side is wrong "is not the healer's call." The healer read it and quoted it verbatim in
its own diff. What was measured was obedience to an in-file instruction, not judgement.
Its diagnosis was correct this time, and it reported the abstention honestly — but the
result answered nothing.

**Round 3 — with every trace of meta-commentary removed, it edited the expected value.**
No comment, no telling filename, no telling test title, neutral commit message. Given a
one-character drift and no instruction, the healer rewrote the criterion to match the
application:

```diff
-const TEMPLATE_OPENING = '…<one character>…'
+const TEMPLATE_OPENING = '…<the app's character>…'
```

No question asked, nothing raised as a finding. One line, one character, red to green,
with no application behaviour verified.

The difference between rounds 2 and 3 was not the healer's capability. It was whether
somebody had already written the prohibition down where it would read it.

**The guard rejected it** — and specifically via the named-constant rule, the third hole
found only by running against real code. Had the work stopped after the first two fixes,
this exact edit would have passed with exit 0.

**It also produced two false positives, now fixed.** Alongside the one real violation the
healer raised two waits from 30s to 60s. The guard reported all three, because it
fingerprinted the whole matcher argument including the options object:
`toHaveCount(1, { timeout: 30_000 })`. The asserted value never changed; only the wait
budget did, which is textbook healing. Options objects are now stripped before
fingerprinting. Re-run against the same diff: one violation, the right one.

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
