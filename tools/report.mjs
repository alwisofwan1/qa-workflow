#!/usr/bin/env node
/**
 * Guards 3 and 4 — the reporter.
 *
 * Turns a Playwright JSON report into hard numbers and computed AC coverage. No model
 * is involved in producing any figure here. An agent may write prose around this
 * output; it may not produce the output.
 *
 * Usage:
 *   node tools/report.mjs <results.json> [--ac AC1,AC2] [--require-ac] [--json] [--out FILE]
 *
 * Exit codes:
 *   0  all tests passed (and every declared AC covered, with --require-ac)
 *   1  test failures
 *   2  AC coverage gap while --require-ac is set
 *   3  bad input
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { summarize, renderMarkdown } from './lib/report-core.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
const opt = (n) => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? null : argv[i + 1]
}
const consumed = new Set()
for (const n of ['ac', 'out']) {
  const i = argv.indexOf(`--${n}`)
  if (i !== -1) consumed.add(i + 1)
}
const file = argv.find((a, i) => !a.startsWith('--') && !consumed.has(i))

if (!file) {
  console.error('usage: node tools/report.mjs <results.json> [--ac AC1,AC2] [--require-ac] [--json] [--out FILE]')
  process.exit(3)
}

let report
try {
  report = JSON.parse(readFileSync(file, 'utf8'))
} catch (err) {
  console.error(`cannot read ${file}: ${err.message}`)
  process.exit(3)
}

const declared = (opt('ac') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const summary = summarize(report, declared)

const output = flag('json')
  ? JSON.stringify({ ...summary, acSeen: Object.fromEntries(summary.acSeen) }, null, 2)
  : renderMarkdown(summary)

const outFile = opt('out')
if (outFile) writeFileSync(outFile, output + '\n')
else console.log(output)

if (summary.tally.failed > 0) process.exit(1)
if (flag('require-ac') && (summary.uncovered.length || summary.unproven.length)) {
  console.error(
    `\nAC gap — uncovered: [${summary.uncovered.join(', ')}] unproven: [${summary.unproven.join(', ')}]`
  )
  process.exit(2)
}
