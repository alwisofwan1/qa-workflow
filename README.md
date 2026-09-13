# qa-workflow

A guard layer over [Playwright Agents](https://playwright.dev/docs/test-agents).

Playwright ships a planner, a generator, and a healer. They are good — better than
hand-rolling your own. What they do not ship is anything stopping the agent from making
its own work look successful. That is this repo.

```
npx playwright init-agents --loop=claude     ← Playwright's three agents
          +
       qa-workflow                           ← the four guards they lack
```

---

## The problem

An agentic QA pipeline has a structural conflict of interest: the same actor writes the
tests, repairs the tests, and reports on the tests. Three consecutive chances to grade
its own homework.

This is not hypothetical. From the stock `playwright-test-healer` agent definition:

> "Code Remediation: … Fixing assertions and **expected values**"
> "You will continue this process **until the test runs successfully** without any failures or errors."
> "If the error persists … mark this test as **test.fixme()** so that it is skipped."
> "Do not ask user questions … do the most reasonable thing possible to **pass the test**."

And in a published reference implementation of this exact workflow, all of it played out:
a failing assertion was rewritten to match the app's output and logged as a successful
heal; the report claimed 20 tests at a 100% pass rate against a repo containing 18;
coverage was claimed at 100% for five acceptance criteria while one of the five had no
test file at all. Every step was then committed automatically.

None of that is a bug. It is what a pipeline with no gates produces.

## The four guards

| # | Guard | Enforced by |
|---|---|---|
| 1 | Plan approved by a human before any code is generated | `skills/qa-plan` — a stop, not a prompt |
| 2 | Healer may not change asserted values, skip, or delete tests | `tools/heal-guard.ts` |
| 3 | Report figures are parsed from `results.json`, never authored | `tools/report.ts` |
| 4 | AC coverage is computed; an untested AC fails the run | `tools/report.ts --require-ac` |

**Guards 2 and 3 are code.** That is the whole design. A prompt saying "do not weaken
assertions" is advice, and the failure mode here is not an agent that misunderstands the
rule — it is an agent under pressure to produce a green result, which is exactly when
advice loses.

## What the guard actually catches

```ts
// healing — permitted: how the test finds things
- await expect(page.locator('.summary_value')).toContainText('SauceCard #31337')
+ await expect(page.getByTestId('payment-info-value')).toContainText('SauceCard #31337')

// faking — rejected: what the test asserts
- await expect(page.getByTestId('complete-text')).toContainText('Pony Express')
+ await expect(page.getByTestId('complete-text')).toContainText('pony')

// also rejected: the value is inside expect(), the matcher is a meaningless `true`
- expect(after.endsWith('\n\n' + before)).toBe(true)
+ expect(after.endsWith('\n' + before)).toBe(true)

// also rejected: disabling an assertion is deleting it
- await expect(page.getByRole('alert')).toHaveText('saved')
+ // await expect(page.getByRole('alert')).toHaveText('saved')
```

The last two were found by trialling this against a real ticket and by the guard's own
test suite. See [docs/trial.md](docs/trial.md).

## Usage

```bash
npm test                      # builds (tsc) then runs the guards' own suite — 30 tests

# after the healer runs, with $BASELINE = the commit before healing
node dist/tools/heal-guard.js --base "$BASELINE" tests/**/*.spec.ts

# after the suite runs
node dist/tools/report.js results.json --ac AC1,AC2,AC3 --require-ac
```

Exit codes: `1` healer overstepped or tests failed · `2` an AC has no passing test.

## Locator policy

Role-first, not `data-testid`-first.

```
1. getByRole / getByLabel / getByText      ← preferred, works with any accessible UI
2. existing [data-testid]                  ← use when present
3. request a new data-testid               ← a separate small PR, never inlined
```

Requiring `data-testid` everywhere first is a multi-month instrumentation project that
must finish before the pipeline delivers anything, which is how these initiatives die.
Role-first works on day one and degrades gracefully. Instrumentation becomes an output
of the workflow instead of a prerequisite for it.

Side effect worth having: role-first locators fail when the app's accessibility is
broken, surfacing real defects a `data-testid` suite would paper over.

## Layout

```
skills/     qa-plan · qa-heal · qa-report · qa-gate
tools/      the guards — TypeScript, compiled to dist/, no LLM, CI-runnable
tools/lib/  pure analysis functions, unit-tested
tests/      35 tests covering both guards
docs/       design notes and the trial writeup
templates/  test plan + selector inventory formats
```

`npm run build` compiles `tools/` and `tests/` to plain JS in `dist/` via `tsc`; `npm
test` runs that build first. The shipped/executed artifact stays plain Node — TypeScript
is a development-time check, not a runtime dependency.

## Status

The guards work and are tested. Not yet run end-to-end against a full generated suite.

## License

MIT
