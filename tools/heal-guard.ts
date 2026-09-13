#!/usr/bin/env node
/**
 * Guard 2 — the healer leash.
 *
 * A self-healing agent may change HOW a test finds things (locators, waits, setup).
 * It may not change WHAT the test asserts. That distinction is the whole difference
 * between healing and faking, and it is not left to the agent's judgement.
 *
 * Usage:
 *   node dist/tools/heal-guard.js [--base <ref>] [--json] <spec files...>
 *
 * Exit codes: 0 clean · 1 violation · 3 bad input
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import { analyze, relativeImports } from './lib/heal-guard-core.js'

interface Result {
  path: string
  problems: string[]
  note?: string
}

const argv = process.argv.slice(2)
const baseIdx = argv.indexOf('--base')
const base: string | undefined = baseIdx === -1 ? 'HEAD' : argv[baseIdx + 1]
const asJson = argv.includes('--json')
const files = argv.filter((a, i) => !a.startsWith('--') && i !== baseIdx + 1)

if (files.length === 0) {
  console.error('usage: node dist/tools/heal-guard.js [--base <ref>] [--json] <spec files...>')
  process.exit(3)
}

/** Candidate on-disk paths for a relative module specifier. */
function candidates(fromFile: string, spec: string): string[] {
  const base = resolve(dirname(fromFile), spec)
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
}

/**
 * Resolve a spec's relative imports to source text, on both sides of the change.
 *
 * This is what stops an expected value being smuggled out of the spec and edited in a
 * fixture module instead. Non-relative imports are ignored: a package's contents are not
 * part of what the healer may edit.
 */
function importedSources(
  specPath: string,
  ref: string | undefined,
  before: string,
  after: string
): { beforeImported: string[]; afterImported: string[] } {
  const specs = new Set([...relativeImports(before), ...relativeImports(after)])
  const beforeImported: string[] = []
  const afterImported: string[] = []

  for (const spec of specs) {
    for (const candidate of candidates(specPath, spec)) {
      const rel = relative(process.cwd(), candidate)
      const past = gitShow(ref, rel)
      const present = existsSync(candidate) ? readFileSync(candidate, 'utf8') : null
      if (past === null && present === null) continue
      if (past !== null) beforeImported.push(past)
      if (present !== null) afterImported.push(present)
      break
    }
  }
  return { beforeImported, afterImported }
}

function gitShow(ref: string | undefined, path: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null // new file — no baseline to protect yet
  }
}

const results: Result[] = []
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
  const after = readFileSync(path, 'utf8')
  results.push({ path, problems: analyze(before, after, importedSources(path, base, before, after)) })
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
