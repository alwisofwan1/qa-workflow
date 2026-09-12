#!/usr/bin/env node
/**
 * Guard 2 — the healer leash.
 *
 * A self-healing agent may change HOW a test finds things (locators, waits, setup).
 * It may not change WHAT the test asserts. That distinction is the whole difference
 * between healing and faking, and it is not left to the agent's judgement.
 *
 * Usage:
 *   node tools/heal-guard.mjs [--base <ref>] [--json] <spec files...>
 *
 * Exit codes: 0 clean · 1 violation · 3 bad input
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { analyze } from './lib/heal-guard-core.mjs'

const argv = process.argv.slice(2)
const baseIdx = argv.indexOf('--base')
const base = baseIdx === -1 ? 'HEAD' : argv[baseIdx + 1]
const asJson = argv.includes('--json')
const files = argv.filter((a, i) => !a.startsWith('--') && i !== baseIdx + 1)

if (files.length === 0) {
  console.error('usage: node tools/heal-guard.mjs [--base <ref>] [--json] <spec files...>')
  process.exit(3)
}

function gitShow(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null // new file — no baseline to protect yet
  }
}

const results = []
for (const path of files) {
  if (!existsSync(path)) {
    results.push({ path, problems: ['file is gone — the healer may not delete spec files'] })
    continue
  }
  const before = gitShow(base, path)
  if (before === null) {
    results.push({ path, problems: [], note: 'new file, no baseline' })
    continue
  }
  results.push({ path, problems: analyze(before, readFileSync(path, 'utf8')) })
}

const violations = results.reduce((n, r) => n + r.problems.length, 0)

if (asJson) {
  console.log(JSON.stringify({ base, violations, results }, null, 2))
} else {
  for (const r of results) {
    if (r.problems.length === 0) {
      console.log(`✓ ${r.path}${r.note ? ` (${r.note})` : ''}`)
    } else {
      console.error(`✗ ${r.path}`)
      for (const p of r.problems) console.error(`    ${p}`)
    }
  }
  if (violations > 0) {
    console.error(
      `\n${violations} violation(s). A failing assertion is a FINDING, not a thing to edit.` +
        `\nIf the assertion is genuinely wrong, a human changes it — not the healer.`
    )
  } else {
    console.log('\nhealing stayed within scope')
  }
}

process.exit(violations > 0 ? 1 : 0)
