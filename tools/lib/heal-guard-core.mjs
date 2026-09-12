/**
 * Core analysis for the healer leash. Pure functions, no I/O — the CLI wraps these.
 *
 * The rule being enforced: a healer may change HOW a test finds things (locators,
 * waits, setup). It may not change WHAT the test asserts.
 */

/** Matcher plus its literal argument, normalised. Ignores the locator — that is healable. */
const MATCHER = /\.(not\.)?(to[A-Z]\w*)\(([^)]*)\)/g

/**
 * Values can be load-bearing INSIDE expect(...), not only in the matcher:
 *   expect(after.endsWith('\n\n' + before)).toBe(true)
 * The matcher argument there is a meaningless `true`; the acceptance criterion is the
 * '\n\n'. But expect(page.getByRole('button', { name: 'Save' })) also holds a literal,
 * and swapping that locator is precisely what healing is for. So literals inside an
 * expect() argument are protected unless the argument is a locator expression.
 */
const LOCATOR_EXPR = /\b(?:page|frame)\b|\.locator\(|\bgetBy[A-Z]|\bframeLocator\(/
const LITERAL = /(['"`])(?:\\.|(?!\1)[^\\])*\1|\/(?:\\.|[^/\\\n])+\/[gimsuy]*|\b\d+(?:\.\d+)?\b/g

const SILENCERS = /\b(?:test|describe)\.(?:skip|only|fixme)\s*\(/g
const EXPECTS = /\bexpect(?:\.soft)?\s*\(/g
const TESTS = /^\s*test(?:\.\w+)*\s*\(/gm

/**
 * Strip comments before any analysis.
 *
 * Without this, commenting an assertion out is invisible: the text still matches every
 * pattern, so counts and fingerprints are unchanged and the guard waves it through.
 * Disabling an assertion with `//` is exactly as destructive as deleting it.
 *
 * String and template literals are preserved — a URL containing `//` is not a comment.
 */
export function stripComments(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1
    } else if (ch === '/' && next === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1
      i += 2
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      out += ch
      i += 1
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '')
          i += 2
        } else {
          out += src[i]
          i += 1
        }
      }
      out += src[i] ?? ''
      i += 1
    } else {
      out += ch
      i += 1
    }
  }
  return out
}

export function matcherFingerprints(src) {
  const out = []
  for (const [, negated, matcher, rawArg] of src.matchAll(MATCHER)) {
    const arg = rawArg.trim().replace(/^["'`]|["'`]$/g, '').replace(/\s+/g, ' ')
    out.push(`${negated ? 'not.' : ''}${matcher}(${arg})`)
  }
  return out
}

/** Balanced-paren extraction of every `expect(...)` / `expect.soft(...)` argument. */
export function expectArgs(src) {
  const out = []
  const re = new RegExp(EXPECTS.source, 'g')
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
    if (depth === 0) out.push(src.slice(start, i - 1))
  }
  return out
}

/** Literals sitting in a non-locator expect() argument — i.e. asserted data. */
export function assertedLiterals(src) {
  const out = []
  for (const arg of expectArgs(src)) {
    if (LOCATOR_EXPR.test(arg)) continue
    for (const [lit] of arg.matchAll(new RegExp(LITERAL.source, 'g'))) {
      out.push(lit.replace(/\s+/g, ' '))
    }
  }
  return out
}

const countOf = (src, re) => (src.match(new RegExp(re.source, re.flags)) ?? []).length

/** Multiset difference: entries present in `before` that `after` no longer covers. */
function missing(beforeList, afterList) {
  const pool = [...afterList]
  const gone = []
  for (const item of beforeList) {
    const at = pool.indexOf(item)
    if (at === -1) gone.push(item)
    else pool.splice(at, 1)
  }
  return gone
}

/**
 * Compare two versions of a spec file.
 * @returns {string[]} human-readable violations; empty means the healing stayed in scope.
 */
export function analyze(rawBefore, rawAfter) {
  const problems = []
  const before = stripComments(rawBefore)
  const after = stripComments(rawAfter)

  for (const fp of missing(matcherFingerprints(before), matcherFingerprints(after))) {
    problems.push(`assertion changed or removed: ${fp}`)
  }
  for (const lit of missing(assertedLiterals(before), assertedLiterals(after))) {
    problems.push(`asserted value changed or removed inside expect(): ${lit}`)
  }

  const beforeExpects = countOf(before, EXPECTS)
  const afterExpects = countOf(after, EXPECTS)
  if (afterExpects < beforeExpects) {
    problems.push(`assertion count dropped ${beforeExpects} -> ${afterExpects}`)
  }

  if (countOf(after, SILENCERS) > countOf(before, SILENCERS)) {
    problems.push('added test.skip / test.only / test.fixme')
  }

  const beforeTests = countOf(before, TESTS)
  const afterTests = countOf(after, TESTS)
  if (afterTests < beforeTests) {
    problems.push(`test count dropped ${beforeTests} -> ${afterTests}`)
  }

  return problems
}
