#!/usr/bin/env node
/**
 * The release gate — one command, one verdict.
 *
 * Intended use: a happy-path suite runs before a release, and this decides whether its
 * green is worth believing. Two independent questions, either of which blocks:
 *
 *   1. Did anything tamper with the tests since the baseline? (heal-guard)
 *   2. Was application code changed during the test run?
 *   3. Do the results and the acceptance-criteria coverage hold up? (report)
 *
 * A gate that is noisy gets ignored, and a gate that is lenient is decoration. This one
 * treats a flaky pass as unproven rather than as a pass, on purpose.
 *
 * Usage:
 *   qa-gate --results results.json --ac AC1,AC2 [--base <ref>] [--specs <glob-expanded files...>]
 *           [--out report.md] [--json]
 *
 * Exit codes: 0 release may proceed · 1 blocked · 3 bad input
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { analyze } from './lib/heal-guard-core.js';
import { isTestFile } from './lib/paths.js';
import { summarize, renderMarkdown } from './lib/report-core.js';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? undefined : argv[i + 1];
};
const list = (n) => {
    const i = argv.indexOf(`--${n}`);
    if (i === -1)
        return [];
    const out = [];
    for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j += 1)
        out.push(argv[j]);
    return out;
};
const resultsPath = opt('results');
if (!resultsPath) {
    console.error('usage: qa-gate --results <results.json> --ac AC1,AC2 [--base <ref>] [--specs <files...>] [--out FILE] [--json]');
    process.exit(3);
}
let report;
try {
    report = JSON.parse(readFileSync(resultsPath, 'utf8'));
}
catch (err) {
    console.error(`cannot read ${resultsPath}: ${err instanceof Error ? err.message : err}`);
    process.exit(3);
}
const declared = (opt('ac') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const summary = summarize(report, declared);
// --- tamper check (only when a baseline is given) ---------------------------------
const base = opt('base');
const tamper = [];
let touchedSource = [];
if (base) {
    let specs = list('specs');
    if (specs.length === 0) {
        try {
            specs = execFileSync('git', ['diff', '--name-only', base, '--', '*.spec.ts', '*.spec.tsx'], {
                encoding: 'utf8',
            })
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
        }
        catch {
            console.error(`cannot diff against ${base} — pass --specs explicitly`);
            process.exit(3);
        }
    }
    // Guard against the worst possible "fix": editing the application until the tests
    // agree with it. A published Playwright-testing skill instructs exactly that —
    // "App bug -> fix the application code" — inside an automated fix loop. Changing the
    // product to make its own tests pass is not healing, and it is not the runner's call.
    try {
        touchedSource = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' })
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .filter((p) => !isTestFile(p));
    }
    catch {
        touchedSource = [];
    }
    for (const path of specs) {
        let before;
        try {
            before = execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        }
        catch {
            continue; // new spec, nothing to protect yet
        }
        const problems = analyze(before, readFileSync(path, 'utf8'));
        if (problems.length)
            tamper.push({ path, problems });
    }
}
// --- verdict ----------------------------------------------------------------------
const reasons = [];
if (summary.setupFailed) {
    reasons.push('the suite did not run — a setup spec failed and its tests were skipped');
}
if (summary.tally.failed > 0)
    reasons.push(`${summary.tally.failed} test(s) failed`);
if (summary.uncovered.length)
    reasons.push(`no test covers ${summary.uncovered.join(', ')}`);
// When setup failed the unproven list is every AC in the suite, which is noise on top of
// the real reason. Report it only when the run actually happened.
if (!summary.setupFailed && summary.unproven.length) {
    reasons.push(`unproven (failing or flaky only): ${summary.unproven.join(', ')}`);
}
if (tamper.length)
    reasons.push(`${tamper.length} spec file(s) were tampered with since ${base}`);
if (touchedSource.length)
    reasons.push(`${touchedSource.length} application file(s) changed since ${base}`);
const blocked = reasons.length > 0;
const lines = [];
lines.push(blocked ? '# Release gate: BLOCKED' : '# Release gate: PASS');
lines.push('');
if (blocked) {
    lines.push('Blocked because:');
    for (const r of reasons)
        lines.push(`- ${r}`);
}
else {
    lines.push(`All ${summary.tally.passed} test(s) passed and every declared acceptance criterion has a passing test.`);
}
if (tamper.length) {
    lines.push('', '## Tampering', '');
    for (const t of tamper) {
        lines.push(`- \`${t.path}\``);
        for (const p of t.problems)
            lines.push(`  - ${p}`);
    }
    lines.push('', 'A failing assertion is a finding, not a thing to edit. A human decides.');
}
if (touchedSource.length) {
    lines.push('', '## Application code changed during the run', '');
    for (const p of touchedSource)
        lines.push(`- \`${p}\``);
    lines.push('', 'These are not test files. A test run that also edits the product is not evidence —', 'the thing under test changed while it was being measured.');
}
lines.push('', renderMarkdown(summary));
const output = flag('json')
    ? JSON.stringify({
        blocked,
        reasons,
        tamper,
        touchedSource,
        ...summary,
        acSeen: Object.fromEntries(summary.acSeen),
    }, null, 2)
    : lines.join('\n');
const outFile = opt('out');
if (outFile)
    writeFileSync(outFile, output + '\n');
console.log(output);
process.exit(blocked ? 1 : 0);
