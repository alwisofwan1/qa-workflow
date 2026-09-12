import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, assertedLiterals, expectArgs } from '../tools/lib/heal-guard-core.mjs'

const wrap = (body) => `import { test, expect } from '@playwright/test'\ntest('t @AC1', async ({ page }) => {\n${body}\n})\n`

const clean = (before, after, msg) => assert.deepEqual(analyze(before, after), [], msg)
const flags = (before, after, re, msg) => {
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
