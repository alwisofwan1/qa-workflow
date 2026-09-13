import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, assertedLiterals, expectArgs } from '../tools/lib/heal-guard-core.js'

const wrap = (body: string): string =>
  `import { test, expect } from '@playwright/test'\ntest('t @AC1', async ({ page }) => {\n${body}\n})\n`

const clean = (before: string, after: string, msg?: string) => assert.deepEqual(analyze(before, after), [], msg)
const flags = (before: string, after: string, re: RegExp, msg: string) => {
  const problems = analyze(before, after)
  assert.ok(problems.length > 0, `${msg}: expected a violation, got none`)
  assert.ok(problems.some((p) => re.test(p)), `${msg}: got ${JSON.stringify(problems)}`)
}

test('identical files produce no violations', () => {
  const src = wrap(`  await expect(page.getByRole('heading')).toHaveText('Total: $97.17')`)
  clean(src, src)
})

test('swapping a locator is permitted — that is what healing is for', () => {
  clean(
    wrap(`  await expect(page.locator('.summary_value')).toContainText('SauceCard #31337')`),
    wrap(`  await expect(page.getByTestId('payment-info-value')).toContainText('SauceCard #31337')`),
    'locator swap'
  )
})

test('replacing a wait is permitted', () => {
  clean(
    wrap(`  await page.waitForSelector('#x')\n  await expect(page.getByRole('alert')).toBeVisible()`),
    wrap(`  await expect(page.getByRole('alert')).toBeVisible()`),
    'wait removal keeps every assertion'
  )
})

test('adding an assertion is permitted', () => {
  clean(
    wrap(`  await expect(page.getByRole('alert')).toBeVisible()`),
    wrap(`  await expect(page.getByRole('alert')).toBeVisible()\n  await expect(page.getByRole('alert')).toContainText('ok')`),
    'added assertion'
  )
})

test('weakening a matcher value is rejected — the real-world "Pony Express" -> "pony" heal', () => {
  flags(
    wrap(`  await expect(page.getByTestId('complete-text')).toContainText('Pony Express')`),
    wrap(`  await expect(page.getByTestId('complete-text')).toContainText('pony')`),
    /assertion changed or removed/,
    'matcher value'
  )
})

test('loosening a strict matcher is rejected', () => {
  flags(
    wrap(`  await expect(page.getByRole('cell')).toHaveText('Total: $97.17')`),
    wrap(`  await expect(page.getByRole('cell')).toContainText('Total')`),
    /assertion changed or removed/,
    'toHaveText -> toContainText'
  )
})

test('dropping a .not negation is rejected', () => {
  flags(
    wrap(`  await expect(page.getByTestId('badge')).not.toBeVisible()`),
    wrap(`  await expect(page.getByTestId('badge')).toBeVisible()`),
    /assertion changed or removed/,
    'negation dropped'
  )
})

test('changing a value asserted INSIDE expect() is rejected', () => {
  // The gap found while trialling the official planner: the matcher argument here is a
  // meaningless `true`, so matcher-only fingerprinting let this through.
  flags(
    wrap(`  expect(after.endsWith('\\n\\n' + before)).toBe(true)`),
    wrap(`  expect(after.endsWith('\\n' + before)).toBe(true)`),
    /inside expect\(\)/,
    'blank-line rule gutted'
  )
})

test('changing a number asserted inside expect() is rejected', () => {
  flags(
    wrap(`  expect(rows.length).toBeGreaterThan(3)`),
    wrap(`  expect(rows.length).toBeGreaterThan(0)`),
    /assertion changed or removed/,
    'threshold weakened'
  )
})

test('a literal inside a locator expression in expect() stays healable', () => {
  clean(
    wrap(`  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()`),
    wrap(`  await expect(page.getByRole('button', { name: '保存' })).toBeEnabled()`),
    'locator name change inside expect()'
  )
})

test('deleting an assertion is rejected', () => {
  flags(
    wrap(`  await expect(a).toBeVisible()\n  await expect(b).toHaveText('x')`),
    wrap(`  await expect(a).toBeVisible()`),
    /assertion count dropped|assertion changed or removed/,
    'assertion deleted'
  )
})

test('commenting an assertion out is rejected', () => {
  flags(
    wrap(`  await expect(page.getByRole('alert')).toHaveText('saved')`),
    wrap(`  // await expect(page.getByRole('alert')).toHaveText('saved')`),
    /assertion count dropped|assertion changed/,
    'assertion commented out'
  )
})

test('adding test.fixme is rejected', () => {
  const before = `test('a @AC1', async () => { await expect(x).toBeVisible() })\ntest('b @AC2', async () => { await expect(y).toBeVisible() })\n`
  const after = `test('a @AC1', async () => { await expect(x).toBeVisible() })\ntest.fixme('b @AC2', async () => { await expect(y).toBeVisible() })\n`
  flags(before, after, /test\.skip \/ test\.only \/ test\.fixme/, 'fixme added')
})

test('deleting a whole test is rejected', () => {
  const before = `test('a @AC1', async () => { await expect(x).toBeVisible() })\ntest('b @AC2', async () => { await expect(y).toBeVisible() })\n`
  const after = `test('a @AC1', async () => { await expect(x).toBeVisible() })\n`
  flags(before, after, /test count dropped|assertion count dropped/, 'test deleted')
})

test('expect.soft is counted like expect', () => {
  flags(
    wrap(`  expect.soft(total).toBe(97.17)\n  await expect(page.getByRole('alert')).toBeVisible()`),
    wrap(`  await expect(page.getByRole('alert')).toBeVisible()`),
    /assertion count dropped|assertion changed or removed/,
    'soft assertion removed'
  )
})

test('expectArgs handles nested parentheses and quoted parens', () => {
  const src = `expect(fn(a, g(b)) + ')').toBe(true)`
  assert.deepEqual(expectArgs(src), [`fn(a, g(b)) + ')'`])
})

test('assertedLiterals ignores locator arguments but keeps data arguments', () => {
  const src = `expect(page.getByText('hello')).toBeVisible()\nexpect(value).toBe('world')`
  assert.deepEqual(assertedLiterals(src), [])
})

test('a brand-new assertion style does not crash the analyzer', () => {
  const before = wrap('  await expect(page.getByRole("row")).toHaveCount(3)')
  const after = wrap('  await expect(page.getByRole("row")).toHaveCount(3)\n  await expect.poll(() => n).toBe(3)')
  assert.deepEqual(analyze(before, after), [])
})

test('changing an expected value held in a named constant is rejected', () => {
  // The hole the RCB-919 trial exposed: the planner hoists expected values into
  // constants, so every assertion line stays byte-identical while the criterion is
  // rewritten one line above.
  const before = `const OPENING = 'the real opening'\ntest('t @AC1', async () => {\n  expect(prefix.startsWith(OPENING)).toBe(true)\n})\n`
  const after = `const OPENING = 'whatever the app happens to emit'\ntest('t @AC1', async () => {\n  expect(prefix.startsWith(OPENING)).toBe(true)\n})\n`
  flags(before, after, /named constant/, 'constant rewritten')
})

test('a constant used only to build a locator stays healable', () => {
  const before = `const SAVE = 'Save'\ntest('t @AC1', async ({ page }) => {\n  await expect(page.getByRole('button', { name: SAVE })).toBeEnabled()\n})\n`
  const after = `const SAVE = '保存'\ntest('t @AC1', async ({ page }) => {\n  await expect(page.getByRole('button', { name: SAVE })).toBeEnabled()\n})\n`
  clean(before, after, 'locator constant')
})

test('a constant referenced from a matcher argument is protected', () => {
  const before = `const EXPECTED = 'abc'\ntest('t @AC1', async () => {\n  expect(value).toBe(EXPECTED)\n})\n`
  const after = `const EXPECTED = 'xyz'\ntest('t @AC1', async () => {\n  expect(value).toBe(EXPECTED)\n})\n`
  flags(before, after, /named constant/, 'matcher constant')
})

test('renaming a constant without changing its value is permitted', () => {
  const before = `const OPENING = 'same text'\ntest('t @AC1', async () => {\n  expect(p.startsWith(OPENING)).toBe(true)\n})\n`
  const after = `const TEMPLATE_OPENING = 'same text'\ntest('t @AC1', async () => {\n  expect(p.startsWith(TEMPLATE_OPENING)).toBe(true)\n})\n`
  // The value is what matters, not the name — but the fingerprint includes the name, so
  // this is reported. Documented deliberately: a rename during healing is suspicious
  // enough to warrant a human glance, and renames are not part of healing's job.
  flags(before, after, /named constant/, 'constant renamed')
})

test('a declaration with no initialiser does not steal the next constant', () => {
  // `declare const process: {...}` has no `=`. A type-annotation pattern that crosses
  // newlines swallows up to the next `=` in the file and captures the FOLLOWING
  // constant's literal under the wrong name — silently unprotecting it.
  const src = `declare const process: { env: Record<string, string> }\n\nconst EXPECTED = 'real value'\ntest('t @AC1', async () => {\n  expect(v.startsWith(EXPECTED)).toBe(true)\n})\n`
  const after = src.replace("'real value'", "'whatever the app emits'")
  flags(src, after, /named constant/, 'declare-const shadowing')
})

test('one constant referenced from several positions reports a single violation', () => {
  const before = `const X = 'a'\ntest('t @AC1', async () => {\n  expect(v.slice(0, X.length)).toBe(X)\n})\n`
  const after = before.replace("'a'", "'b'")
  const problems = analyze(before, after)
  assert.equal(problems.length, 1, `expected one problem, got ${JSON.stringify(problems)}`)
})

test('raising a matcher timeout is permitted — the asserted value is unchanged', () => {
  // Caught in round 3: the healer bumped two waits from 30s to 60s alongside its one
  // real violation, and the guard reported all three. Wait adjustment is healing.
  clean(
    wrap(`  await expect(page.getByRole('row')).toHaveCount(1, { timeout: 30_000 })`),
    wrap(`  await expect(page.getByRole('row')).toHaveCount(1, { timeout: 60_000 })`),
    'timeout bump'
  )
})

test('changing the asserted value is still rejected when options are present', () => {
  flags(
    wrap(`  await expect(page.getByRole('row')).toHaveCount(1, { timeout: 30_000 })`),
    wrap(`  await expect(page.getByRole('row')).toHaveCount(0, { timeout: 30_000 })`),
    /assertion changed or removed/,
    'count changed with options'
  )
})

test('an options-only matcher argument is ignored', () => {
  clean(
    wrap(`  await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 })`),
    wrap(`  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })`),
    'options-only'
  )
})
