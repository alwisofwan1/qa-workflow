/**
 * Core analysis for the reporter. Pure functions, no I/O.
 *
 * Every figure a report publishes comes from here, derived from the Playwright JSON
 * reporter output. No model authors a number.
 */

// Minimal shape of a Playwright JSON reporter report — only what this module reads.
export interface PwResult {
  status: string
  error?: { message?: string }
}
export interface PwTest {
  results?: PwResult[]
}
export interface PwSpec {
  title: string
  file: string
  line: number
  tests?: PwTest[]
}
export interface PwSuite {
  specs?: PwSpec[]
  suites?: PwSuite[]
}
export interface PwReport {
  suites?: PwSuite[]
}

export type SpecStatus = 'passed' | 'failed' | 'flaky' | 'skipped'

export interface AcEntry {
  total: number
  passed: number
  flaky: number
}

export interface Failure {
  title: string
  file: string
  line: number
  error: string
}

export interface Summary {
  tally: Record<SpecStatus, number>
  total: number
  failures: Failure[]
  acSeen: Map<string, AcEntry>
  uncovered: string[]
  unproven: string[]
  stray: string[]
  declared: string[]
}

// Tags may be plain (@AC3) or scoped to a part of a ticket (@AC-P2-3).
const AC_TAG = /@(AC[A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)/g

// Playwright writes terminal colour codes into error messages. They are noise in a
// markdown report and corrupt the table when pasted into a ticket.
const ANSI = /\u001B\[[0-9;]*m/g

// Playwright result statuses that mean the test did not pass.
const FAILING = new Set(['failed', 'timedOut', 'interrupted'])

/** Playwright nests suites arbitrarily deep; flatten to a flat list of specs. */
export function collectSpecs(node: PwSuite, out: PwSpec[] = []): PwSpec[] {
  for (const spec of node.specs ?? []) out.push(spec)
  for (const child of node.suites ?? []) collectSpecs(child, out)
  return out
}

/**
 * Reduce one spec's run history to a single status.
 * A spec that failed then passed on retry is flaky — not passed. Flaky proves nothing.
 */
export function specStatus(spec: PwSpec): SpecStatus {
  const runs = (spec.tests ?? []).flatMap((t) => t.results ?? [])
  const statuses = runs.map((r) => r.status)
  if (statuses.length === 0) return 'skipped'
  if (statuses.every((s) => s === 'skipped')) return 'skipped'
  const last = statuses.at(-1)
  if (last === 'passed') return statuses.some((s) => FAILING.has(s)) ? 'flaky' : 'passed'
  return 'failed'
}

/**
 * @param report parsed Playwright JSON report
 * @param declared acceptance criteria that must be covered
 */
export function summarize(report: PwReport, declared: string[] = []): Summary {
  const specs = (report.suites ?? []).flatMap((s) => collectSpecs(s))
  const tally: Record<SpecStatus, number> = { passed: 0, failed: 0, flaky: 0, skipped: 0 }
  const failures: Failure[] = []
  const acSeen = new Map<string, AcEntry>()

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
        error: (last?.error?.message ?? '').replace(ANSI, '').split('\n')[0]!.slice(0, 300),
      })
    }

    // A test that claims an AC but is skipped or flaky does NOT cover it.
    for (const [, ac] of spec.title.matchAll(new RegExp(AC_TAG.source, 'g'))) {
      if (!ac) continue
      if (!acSeen.has(ac)) acSeen.set(ac, { total: 0, passed: 0, flaky: 0 })
      const entry = acSeen.get(ac)!
      entry.total += 1
      if (status === 'passed') entry.passed += 1
      if (status === 'flaky') entry.flaky += 1
    }
  }

  const total = tally.passed + tally.failed + tally.flaky + tally.skipped
  const uncovered = declared.filter((ac) => !acSeen.has(ac))
  const unproven = declared.filter((ac) => acSeen.has(ac) && acSeen.get(ac)!.passed === 0)
  const stray = [...acSeen.keys()].filter((ac) => !declared.includes(ac))

  return { tally, total, failures, acSeen, uncovered, unproven, stray, declared }
}

export function acStatus(entry: AcEntry | undefined): string {
  if (!entry) return 'NOT COVERED'
  if (entry.passed > 0) return 'OK'
  if (entry.flaky > 0) return 'FLAKY ONLY — NOT PROVEN'
  return 'COVERED BUT FAILING'
}

const STATUS_KEYS: SpecStatus[] = ['passed', 'failed', 'flaky', 'skipped']

/** Render the parts of a report a model is not allowed to write. */
export function renderMarkdown(s: Summary): string {
  const pct = (n: number) => (s.total === 0 ? '0.0' : ((n / s.total) * 100).toFixed(1))
  const out = ['# Test Execution Report', '', '| Metric | Count | % |', '|---|---|---|']
  out.push(`| Total | ${s.total} | 100% |`)
  for (const k of STATUS_KEYS) {
    out.push(`| ${k[0]!.toUpperCase()}${k.slice(1)} | ${s.tally[k]} | ${pct(s.tally[k])}% |`)
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
