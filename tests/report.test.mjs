import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarize, specStatus, collectSpecs, acStatus, renderMarkdown } from '../tools/lib/report-core.mjs'

const spec = (title, statuses, extra = {}) => ({
  title,
  file: 'a.spec.ts',
  line: 1,
  tests: [{ results: statuses.map((status) => ({ status })) }],
  ...extra,
})
const report = (specs, nested = []) => ({ suites: [{ title: 's', specs, suites: nested }] })

test('an empty report yields zeros, not a crash', () => {
  const s = summarize({}, [])
  assert.equal(s.total, 0)
  assert.deepEqual(s.tally, { passed: 0, failed: 0, flaky: 0, skipped: 0 })
})

test('statuses are classified from the run history', () => {
  assert.equal(specStatus(spec('t', ['passed'])), 'passed')
  assert.equal(specStatus(spec('t', ['failed'])), 'failed')
  assert.equal(specStatus(spec('t', ['skipped'])), 'skipped')
  assert.equal(specStatus(spec('t', [])), 'skipped')
})

test('a retry that eventually passes is flaky, never passed', () => {
  // Flaky must not count as proof. This is the difference between "it works" and
  // "it worked once out of two".
  assert.equal(specStatus(spec('t', ['failed', 'passed'])), 'flaky')
})

test('timedOut and interrupted count as failures, not as passes', () => {
  assert.equal(specStatus(spec('t', ['timedOut'])), 'failed')
  assert.equal(specStatus(spec('t', ['interrupted'])), 'failed')
  assert.equal(specStatus(spec('t', ['timedOut', 'passed'])), 'flaky')
})

test('specs nested in deep suites are still counted', () => {
  const r = { suites: [{ suites: [{ suites: [{ specs: [spec('deep @AC1', ['passed'])] }] }] }] }
  assert.equal(summarize(r, ['AC1']).total, 1)
  assert.equal(collectSpecs(r.suites[0]).length, 1)
})

test('coverage is computed from tags on PASSING tests only', () => {
  const s = summarize(
    report([
      spec('a @AC1', ['passed']),
      spec('b @AC2', ['failed']),
      spec('c @AC3', ['failed', 'passed']),
      spec('d @AC4', ['skipped']),
    ]),
    ['AC1', 'AC2', 'AC3', 'AC4', 'AC5']
  )
  assert.equal(acStatus(s.acSeen.get('AC1')), 'OK')
  assert.equal(acStatus(s.acSeen.get('AC2')), 'COVERED BUT FAILING')
  assert.equal(acStatus(s.acSeen.get('AC3')), 'FLAKY ONLY — NOT PROVEN')
  assert.equal(acStatus(s.acSeen.get('AC4')), 'COVERED BUT FAILING')
  assert.equal(acStatus(s.acSeen.get('AC5')), 'NOT COVERED')
  assert.deepEqual(s.uncovered, ['AC5'])
  assert.deepEqual(s.unproven, ['AC2', 'AC3', 'AC4'])
})

test('scoped AC tags are recognised (@AC-P2-3, not just @AC3)', () => {
  const s = summarize(report([spec('insert above @AC-P2-3', ['passed'])]), ['AC-P2-3'])
  assert.equal(acStatus(s.acSeen.get('AC-P2-3')), 'OK')
  assert.deepEqual(s.uncovered, [])
})

test('an untagged test contributes nothing to coverage', () => {
  // The whole suite can be green while an AC has no proof behind it.
  const s = summarize(report([spec('does something', ['passed'])]), ['AC1'])
  assert.deepEqual(s.uncovered, ['AC1'])
  assert.equal(s.tally.passed, 1)
})

test('tags for ACs that were never declared are surfaced, not silently accepted', () => {
  const s = summarize(report([spec('x @AC9', ['passed'])]), ['AC1'])
  assert.deepEqual(s.stray, ['AC9'])
})

test('one test may prove several ACs', () => {
  const s = summarize(report([spec('covers both @AC1 @AC2', ['passed'])]), ['AC1', 'AC2'])
  assert.deepEqual(s.uncovered, [])
  assert.equal(s.total, 1)
})

test('failures report only the first line of the error', () => {
  const r = {
    suites: [
      {
        specs: [
          {
            title: 'boom @AC1',
            file: 'b.spec.ts',
            line: 7,
            tests: [{ results: [{ status: 'failed', error: { message: 'first line\nsecond line' } }] }],
          },
        ],
      },
    ],
  }
  const s = summarize(r, ['AC1'])
  assert.equal(s.failures.length, 1)
  assert.equal(s.failures[0].error, 'first line')
  assert.equal(s.failures[0].line, 7)
})

test('the rendered report states NOT COVERED rather than omitting the AC', () => {
  const md = renderMarkdown(summarize(report([spec('a @AC1', ['passed'])]), ['AC1', 'AC2']))
  assert.match(md, /\| AC2 \| 0 \| 0 \| NOT COVERED \|/)
  assert.match(md, /\| Passed \| 1 \| 100.0% \|/)
})
