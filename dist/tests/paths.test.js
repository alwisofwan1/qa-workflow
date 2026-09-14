import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestFile, partitionChangedFiles } from '../tools/lib/paths.js';
test('recognises test files by directory and by name', () => {
    for (const p of [
        'tests/checkout.spec.ts',
        'e2e/login.spec.ts',
        'src/__tests__/thing.ts',
        'apps/web/test/helpers.ts',
        'anywhere/Component.test.tsx',
        'seed.spec.ts',
    ]) {
        assert.ok(isTestFile(p), `${p} should count as a test file`);
    }
});
test('treats application code as application code', () => {
    for (const p of [
        'src/pages/Editor/store.ts',
        'src/components/Button.tsx',
        'package.json',
        'playwright.config.ts',
        'src/latest/notes.md',
    ]) {
        assert.ok(!isTestFile(p), `${p} should NOT count as a test file`);
    }
});
test('a path merely containing the word test is not a test file', () => {
    // `src/utils/testimonials.ts` and `src/contest/index.ts` are product code.
    assert.ok(!isTestFile('src/utils/testimonials.ts'));
    assert.ok(!isTestFile('src/contest/index.ts'));
});
test('partitions a changed-file list', () => {
    const { tests, source } = partitionChangedFiles([
        'tests/a.spec.ts',
        'src/store.ts',
        'e2e/b.spec.ts',
        'src/Button.tsx',
    ]);
    assert.deepEqual(tests, ['tests/a.spec.ts', 'e2e/b.spec.ts']);
    assert.deepEqual(source, ['src/store.ts', 'src/Button.tsx']);
});
