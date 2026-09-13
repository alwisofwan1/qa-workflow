# Design notes

## The failure mode this is built against

An agentic QA pipeline has a structural conflict of interest: the same actor writes the
tests, repairs the tests, and reports on the tests. Each of the last three stages is an
opportunity to make the work look successful rather than be successful.

Observed in the wild, in a published reference implementation of this exact workflow:

| Stage | What happened |
|---|---|
| Healing | A failing assertion was rewritten to match the app's actual output, and the change was recorded as a successful "heal" |
| Reporting | The report claimed 20 automated tests at a 100% pass rate; the repository contained 18 |
| Coverage | The report claimed 100% coverage of 5 acceptance criteria; one of the five had no test file at all |
| Commit | All of it was committed automatically, making the errors the permanent record |

None of these are bugs. They are the natural output of a pipeline with no gates.

## Design response

**Guards must be code, not instructions.** A prompt that says "do not weaken assertions"
is advice. `tools/heal-guard.ts` is a constraint. The distinction matters because the
failure mode is not an agent that misunderstands the rule — it is an agent under pressure
to produce a green result, which is exactly the condition under which advice loses.

**The reporter must not be able to author its own numbers.** `tools/report.ts` reads the
Playwright JSON reporter output and emits the metrics table and AC coverage table. The
model contributes prose. It has no path to a figure.

**Coverage is derived, not asserted.** Tests carry `@ACn` tags; coverage is the join
between declared ACs and tags observed on *passing* tests. A flaky test does not prove its
AC. A skipped test does not prove its AC. Both are reported as unproven.

**One human gate early, one late.** After the test plan (cheapest correction point — no
code exists yet) and before merge (last correction point). Gates in the middle slow the
loop without catching much.

## Locator policy, and why not data-testid-first

The obvious move is to require `data-testid` everywhere and generate tests against it.
On a mature codebase this is a multi-month instrumentation project that must complete
before the pipeline produces anything — which is how initiatives like this die.

Role-first locators (`getByRole`, `getByLabel`) work immediately on any app built with an
accessible component library, and they degrade gracefully. `data-testid` is added only
where a locator is genuinely ambiguous, emitted as a small standalone PR. Instrumentation
becomes an output of the workflow rather than a prerequisite for it.

Side effect worth noting: role-first locators fail when the app's accessibility is broken,
which surfaces real defects that a `data-testid` suite would silently paper over.

## Known limits of the guard

These are properties of the approach, not bugs, and anyone relying on it should know them.

**It is textual, not syntactic.** The analysis is regex over source, not an AST walk. It
handles the shapes seen in real planner- and healer-generated code, but it can be walked
around by anyone who wants to.

**Relative imports are followed; package imports are not.** Moving an expected value into
a fixture module used to defeat the guard completely — the spec still referenced the name,
but the literal lived elsewhere and nothing linked the two. The guard now resolves a
spec's relative imports on both sides of the change and protects constants declared there.
Imports from packages are deliberately not followed: a dependency's contents are not
something a healer may edit.

Resolution is still textual, so indirection it does not model — re-exports, a constant
built by concatenation, a value read from JSON — remains out of reach.

**It cannot tell who is right.** By design. When the spec and the app disagree, the guard
refuses the edit and escalates; it does not know whether the spec has a typo or the app
regressed. Round 1 of the trial is the argument for that stance — the healer's diagnosis
was confidently backwards.

**It guards the diff, not the intent.** A suite can pass every gate and still test the
wrong thing. Plan approval and PR review remain load-bearing.

## Non-goals

- **Replacing QA engineers.** The pipeline produces a reviewable artifact at every stage
  precisely so a human stays in the loop on judgement calls.
- **Cross-browser / mobile as duplicated specs.** Those are Playwright projects,
  configured once. Generating a separate spec file per browser is a well-known
  anti-pattern that multiplies maintenance for no added signal.
- **Fully autonomous merge.** The last gate is not negotiable.

## Open questions

- How much of the selector inventory survives a UI refactor, and what is the re-exploration
  cost per sprint?
- Where does this sit relative to component tests — what belongs in E2E at all, given E2E
  is the most expensive and least stable layer of the pyramid?
- Whether the plan-approval gate stays valuable once trust builds, or becomes a rubber stamp.
