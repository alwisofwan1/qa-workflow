#!/usr/bin/env node
/**
 * Guard 3 + 4 — the reporter.
 *
 * Turns a Playwright JSON report into hard numbers and computed AC coverage.
 * No model is involved in producing any figure here. An agent may write prose
 * around this output; it may not produce the output.
 *
 * Usage:
 *   node tools/report.mjs results.json --ac AC1,AC2,AC3,AC4,AC5 [--require-ac] [--json]
 *
 * Exit codes:
 *   0  all tests passed, and (with --require-ac) every AC is covered
 *   1  test failures
 *   2  AC coverage gap while --require-ac is set
 *   3  bad input
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const file = argv.find((a) => !a.startsWith('--'))
const flag = (name) => argv.includes(`--${name}`)
const opt = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? null : argv[i + 1]
}

if (!file) {
  console.error('usage: node tools/report.mjs <results.json> [--ac AC1,AC2] [--require-ac] [--json]')
  process.exit(3)
}

let report
try {
  report = JSON.parse(readFileSync(file, 'utf8'))
} catch (err) {
  console.error(`cannot read ${file}: ${err.message}`)
  process.exit(3)
}

/** Playwright nests suites arbitrarily deep; flatten to a list of specs. */
function collectSpecs(node, out = []) {
  for (const spec of node.specs ?? []) out.push(spec)
  for (const child of node.suites ?? []) collectSpecs(child, out)
  return out
}

const specs = (report.suites ?? []).flatMap((s) => collectSpecs(s))

const tally = { passed: 0, failed: 0, flaky: 0, skipped: 0 }
const failures = []
const acSeen = new Map()
// Tags may be plain (@AC3) or scoped to a sub-part of a ticket (@AC-P2-3).
const AC_TAG = /@(AC[A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)/g

for (const spec of specs) {
  // A spec's status lives on its test runs, not on the spec itself.
  const runs = (spec.tests ?? []).flatMap((t) => t.results ?? [])
  const statuses = runs.map((r) => r.status)

  let status
  if (statuses.length === 0) status = 'skipped'
  else if (statuses.every((s) => s === 'skipped')) status = 'skipped'
  else if (statuses.at(-1) === 'passed') status = statuses.some((s) => s === 'failed') ? 'flaky' : 'passed'
  else status = 'failed'

  tally[status] += 1

  if (status === 'failed') {
    const last = runs.at(-1)
    failures.push({
      title: spec.title,
      file: spec.file,
      line: spec.line,
      error: (last?.error?.message ?? '').split('\n')[0].slice(0, 300),
    })
  }

  // AC tags are read from the test title. A test that claims an AC and is
  // skipped does NOT count as covering it.
  for (const [, ac] of spec.title.matchAll(AC_TAG)) {
    if (!acSeen.has(ac)) acSeen.set(ac, { total: 0, passed: 0, flaky: 0 })
    const entry = acSeen.get(ac)
    entry.total += 1
    if (status === 'passed') entry.passed += 1
    if (status === 'flaky') entry.flaky += 1
  }
}

const declared = (opt('ac') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const uncovered = declared.filter((ac) => !acSeen.has(ac))
const unproven = declared.filter((ac) => acSeen.get(ac)?.passed === 0 && acSeen.has(ac))

const total = tally.passed + tally.failed + tally.flaky + tally.skipped
const pct = (n) => (total === 0 ? '0.0' : ((n / total) * 100).toFixed(1))

if (flag('json')) {
  console.log(JSON.stringify({ tally, total, failures, acSeen: Object.fromEntries(acSeen), uncovered, unproven }, null, 2))
} else {
  console.log(`# Test Execution Report\n`)
  console.log(`| Metric | Count | % |`)
  console.log(`|---|---|---|`)
  console.log(`| Total | ${total} | 100% |`)
  console.log(`| Passed | ${tally.passed} | ${pct(tally.passed)}% |`)
  console.log(`| Failed | ${tally.failed} | ${pct(tally.failed)}% |`)
  console.log(`| Flaky | ${tally.flaky} | ${pct(tally.flaky)}% |`)
  console.log(`| Skipped | ${tally.skipped} | ${pct(tally.skipped)}% |`)

  if (declared.length) {
    console.log(`\n## Acceptance Criteria Coverage\n`)
    console.log(`| AC | Tests | Passing | Status |`)
    console.log(`|---|---|---|---|`)
    for (const ac of declared) {
      const e = acSeen.get(ac)
      let status
      if (!e) status = 'NOT COVERED'
      else if (e.passed > 0) status = 'OK'
      else if (e.flaky > 0) status = 'FLAKY ONLY — NOT PROVEN'
      else status = 'COVERED BUT FAILING'
      console.log(`| ${ac} | ${e?.total ?? 0} | ${e?.passed ?? 0} | ${status} |`)
    }
    const stray = [...acSeen.keys()].filter((ac) => !declared.includes(ac))
    if (stray.length) console.log(`\n> Tests tagged with undeclared ACs: ${stray.join(', ')}`)
  }

  if (failures.length) {
    console.log(`\n## Failures\n`)
    for (const f of failures) console.log(`- \`${f.file}:${f.line}\` — ${f.title}\n  - ${f.error}`)
  }
}

if (tally.failed > 0) process.exit(1)
if (flag('require-ac') && (uncovered.length || unproven.length)) {
  console.error(`\nAC gap — uncovered: [${uncovered.join(', ')}] unproven: [${unproven.join(', ')}]`)
  process.exit(2)
}
