#!/usr/bin/env node
/**
 * Guard 2 — the healer leash.
 *
 * A self-healing agent is allowed to fix HOW a test finds things (locators, waits,
 * setup). It is not allowed to change WHAT the test asserts. That distinction is the
 * whole difference between healing and faking.
 *
 * This compares each spec file against a git ref and rejects the change if the healer:
 *   - removed or altered an asserted value  (toHaveText('$97.17') -> toHaveText('$0.00'))
 *   - reduced the number of assertions
 *   - added .skip / .only / .fixme
 *   - deleted a test
 *
 * Locator swaps, wait changes, and ADDED assertions pass cleanly.
 *
 * Usage:
 *   node tools/heal-guard.mjs --base HEAD e2e/tests/*.spec.ts
 *
 * Exit codes: 0 clean · 1 violation · 3 bad input
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const argv = process.argv.slice(2)
const baseIdx = argv.indexOf('--base')
const base = baseIdx === -1 ? 'HEAD' : argv[baseIdx + 1]
const files = argv.filter((a, i) => !a.startsWith('--') && i !== baseIdx + 1)

if (files.length === 0) {
  console.error('usage: node tools/heal-guard.mjs [--base <ref>] <spec files...>')
  process.exit(3)
}

/**
 * An assertion fingerprint is the matcher plus its literal argument, normalised for
 * quote style and whitespace. Deliberately ignores the locator: that part is healable.
 */
const MATCHER = /\.(not\.)?(to[A-Z]\w*)\(([^)]*)\)/g

function fingerprints(src) {
  const out = []
  for (const [, negated, matcher, rawArg] of src.matchAll(MATCHER)) {
    const arg = rawArg.trim().replace(/^["'`]|["'`]$/g, '').replace(/\s+/g, ' ')
    out.push(`${negated ? 'not.' : ''}${matcher}(${arg})`)
  }
  return out
}

/**
 * Values can also be load-bearing INSIDE expect(...), not just in the matcher:
 *   expect(after.endsWith('\n\n' + before)).toBe(true)
 * Here the matcher argument is a useless `true`; the real acceptance criterion is the
 * '\n\n'. Weakening it to '\n' guts the test while leaving the matcher untouched.
 *
 * But expect(page.getByRole('button', { name: 'Save' })) also holds a literal, and
 * swapping that locator is exactly what healing is FOR. So: literals inside an
 * expect() argument are protected unless the argument is a locator expression.
 */
const LOCATOR_EXPR = /\b(?:page|frame)\b|\.locator\(|\bgetBy[A-Z]|\bframeLocator\(/
const LITERAL = /(['"`])(?:\\.|(?!\1)[^\\])*\1|\/(?:\\.|[^/\\\n])+\/[gimsuy]*|\b\d+(?:\.\d+)?\b/g

/** Extract the balanced argument text of every `expect(...)` call. */
function expectArgs(src) {
  const out = []
  const re = /\bexpect\s*\(/g
  let m
  while ((m = re.exec(src)) !== null) {
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < src.length && depth > 0) {
      const ch = src[i]
      if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
      else if (ch === '"' || ch === "'" || ch === '`') {
        const quote = ch
        i += 1
        while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1
      }
      i += 1
    }
    out.push(src.slice(start, i - 1))
  }
  return out
}

/** Literals that sit in a non-locator expect() argument — i.e. asserted data. */
function assertedLiterals(src) {
  const out = []
  for (const arg of expectArgs(src)) {
    if (LOCATOR_EXPR.test(arg)) continue // a locator: healable
    for (const [lit] of arg.matchAll(LITERAL)) out.push(lit.replace(/\s+/g, ' '))
  }
  return out
}

const countOf = (src, re) => (src.match(re) ?? []).length

function gitShow(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null // new file — nothing to protect yet
  }
}

let violations = 0

for (const path of files) {
  if (!existsSync(path)) {
    console.error(`✗ ${path}: file is gone — the healer may not delete spec files`)
    violations += 1
    continue
  }

  const before = gitShow(base, path)
  if (before === null) continue // newly added spec, no baseline
  const after = readFileSync(path, 'utf8')

  const problems = []

  // 1. asserted values that disappeared or mutated
  const beforeFp = fingerprints(before)
  const afterFp = fingerprints(after)
  const pool = [...afterFp]
  for (const fp of beforeFp) {
    const at = pool.indexOf(fp)
    if (at === -1) problems.push(`assertion changed or removed: ${fp}`)
    else pool.splice(at, 1)
  }

  // 1b. literals asserted inside expect(...) — the AC values that live outside the matcher
  const beforeLit = assertedLiterals(before)
  const afterLit = assertedLiterals(after)
  const litPool = [...afterLit]
  for (const lit of beforeLit) {
    const at = litPool.indexOf(lit)
    if (at === -1) problems.push(`asserted value changed or removed inside expect(): ${lit}`)
    else litPool.splice(at, 1)
  }

  // 2. assertion count must not shrink
  const beforeExpects = countOf(before, /\bexpect\s*\(/g)
  const afterExpects = countOf(after, /\bexpect\s*\(/g)
  if (afterExpects < beforeExpects) {
    problems.push(`assertion count dropped ${beforeExpects} -> ${afterExpects}`)
  }

  // 3. tests must not be silenced
  const SILENCERS = /\b(test|describe)\.(skip|only|fixme)\s*\(/g
  if (countOf(after, SILENCERS) > countOf(before, SILENCERS)) {
    problems.push('added test.skip / test.only / test.fixme')
  }

  // 4. tests must not vanish
  const beforeTests = countOf(before, /^\s*test\s*\(/gm)
  const afterTests = countOf(after, /^\s*test\s*\(/gm)
  if (afterTests < beforeTests) {
    problems.push(`test count dropped ${beforeTests} -> ${afterTests}`)
  }

  if (problems.length) {
    violations += problems.length
    console.error(`✗ ${path}`)
    for (const p of problems) console.error(`    ${p}`)
  } else {
    console.log(`✓ ${path}`)
  }
}

if (violations > 0) {
  console.error(
    `\n${violations} violation(s). A failing assertion is a FINDING, not a thing to edit.` +
      `\nIf the assertion is genuinely wrong, a human changes it — not the healer.`
  )
  process.exit(1)
}
console.log('\nhealing stayed within scope')
