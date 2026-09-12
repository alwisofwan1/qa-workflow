/**
 * Core analysis for the reporter. Pure functions, no I/O.
 *
 * Every figure a report publishes comes from here, derived from the Playwright JSON
 * reporter output. No model authors a number.
 */

// Tags may be plain (@AC3) or scoped to a part of a ticket (@AC-P2-3).
const AC_TAG = /@(AC[A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)/g

// Playwright result statuses that mean the test did not pass.
const FAILING = new Set(['failed', 'timedOut', 'interrupted'])

/** Playwright nests suites arbitrarily deep; flatten to a flat list of specs. */
export function collectSpecs(node, out = []) {
  for (const spec of node.specs ?? []) out.push(spec)
  for (const child of node.suites ?? []) collectSpecs(child, out)
  return out
}

/**
 * Reduce one spec's run history to a single status.
 * A spec that failed then passed on retry is flaky — not passed. Flaky proves nothing.
 */
export function specStatus(spec) {
  const runs = (spec.tests ?? []).flatMap((t) => t.results ?? [])
  const statuses = runs.map((r) => r.status)
  if (statuses.length === 0) return 'skipped'
  if (statuses.every((s) => s === 'skipped')) return 'skipped'
  const last = statuses.at(-1)
  if (last === 'passed') return statuses.some((s) => FAILING.has(s)) ? 'flaky' : 'passed'
  return 'failed'
}

/**
 * @param {object} report parsed Playwright JSON report
 * @param {string[]} declared acceptance criteria that must be covered
 */
export function summarize(report, declared = []) {
  const specs = (report.suites ?? []).flatMap((s) => collectSpecs(s))
  const tally = { passed: 0, failed: 0, flaky: 0, skipped: 0 }
  const failures = []
  const acSeen = new Map()

  for (const spec of specs) {
    const status = specStatus(spec)
    tally[status] += 1

    if (status === 'failed') {
      const runs = (spec.tests ?? []).flatMap((t) => t.results ?? [])
      const last = runs.at(-1)
      failures.push({
        title: spec.title,
        file: spec.file,
        line: spec.line,
        error: (last?.error?.message ?? '').split('\n')[0].slice(0, 300),
      })
    }

    // A test that claims an AC but is skipped or flaky does NOT cover it.
    for (const [, ac] of spec.title.matchAll(new RegExp(AC_TAG.source, 'g'))) {
      if (!acSeen.has(ac)) acSeen.set(ac, { total: 0, passed: 0, flaky: 0 })
      const entry = acSeen.get(ac)
      entry.total += 1
      if (status === 'passed') entry.passed += 1
      if (status === 'flaky') entry.flaky += 1
    }
  }

  const total = tally.passed + tally.failed + tally.flaky + tally.skipped
  const uncovered = declared.filter((ac) => !acSeen.has(ac))
  const unproven = declared.filter((ac) => acSeen.has(ac) && acSeen.get(ac).passed === 0)
  const stray = [...acSeen.keys()].filter((ac) => !declared.includes(ac))

  return { tally, total, failures, acSeen, uncovered, unproven, stray, declared }
}

export function acStatus(entry) {
  if (!entry) return 'NOT COVERED'
  if (entry.passed > 0) return 'OK'
  if (entry.flaky > 0) return 'FLAKY ONLY — NOT PROVEN'
  return 'COVERED BUT FAILING'
}

/** Render the parts of a report a model is not allowed to write. */
export function renderMarkdown(s) {
  const pct = (n) => (s.total === 0 ? '0.0' : ((n / s.total) * 100).toFixed(1))
  const out = ['# Test Execution Report', '', '| Metric | Count | % |', '|---|---|---|']
  out.push(`| Total | ${s.total} | 100% |`)
  for (const k of ['passed', 'failed', 'flaky', 'skipped']) {
    out.push(`| ${k[0].toUpperCase()}${k.slice(1)} | ${s.tally[k]} | ${pct(s.tally[k])}% |`)
  }

  if (s.declared.length) {
    out.push('', '## Acceptance Criteria Coverage', '', '| AC | Tests | Passing | Status |', '|---|---|---|---|')
    for (const ac of s.declared) {
      const e = s.acSeen.get(ac)
      out.push(`| ${ac} | ${e?.total ?? 0} | ${e?.passed ?? 0} | ${acStatus(e)} |`)
    }
    if (s.stray.length) out.push('', `> Tests tagged with undeclared ACs: ${s.stray.join(', ')}`)
  }

  if (s.failures.length) {
    out.push('', '## Failures', '')
    for (const f of s.failures) out.push(`- \`${f.file}:${f.line}\` — ${f.title}\n  - ${f.error}`)
  }
  return out.join('\n')
}
