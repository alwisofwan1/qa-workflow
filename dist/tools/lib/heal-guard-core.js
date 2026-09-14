/**
 * Core analysis for the healer leash. Pure functions, no I/O — the CLI wraps these.
 *
 * The rule being enforced: a healer may change HOW a test finds things (locators,
 * waits, setup). It may not change WHAT the test asserts.
 */
/** Matcher plus its literal argument, normalised. Ignores the locator — that is healable. */
const MATCHER = /\.(not\.)?(to[A-Z]\w*)\(([^)]*)\)/g;
/**
 * Values can be load-bearing INSIDE expect(...), not only in the matcher:
 *   expect(after.endsWith('\n\n' + before)).toBe(true)
 * The matcher argument there is a meaningless `true`; the acceptance criterion is the
 * '\n\n'. But expect(page.getByRole('button', { name: 'Save' })) also holds a literal,
 * and swapping that locator is precisely what healing is for. So literals inside an
 * expect() argument are protected unless the argument is a locator expression.
 */
const LOCATOR_EXPR = /\b(?:page|frame)\b|\.locator\(|\bgetBy[A-Z]|\bframeLocator\(/;
const LITERAL = /(['"`])(?:\\.|(?!\1)[^\\])*\1|\/(?:\\.|[^/\\\n])+\/[gimsuy]*|\b\d+(?:\.\d+)?\b/g;
const SILENCERS = /\b(?:test|describe)\.(?:skip|only|fixme)\s*\(/g;
const EXPECTS = /\bexpect(?:\.soft)?\s*\(/g;
const TESTS = /^\s*test(?:\.\w+)*\s*\(/gm;
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
    let out = '';
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        const next = src[i + 1];
        if (ch === '/' && next === '/') {
            while (i < src.length && src[i] !== '\n')
                i += 1;
        }
        else if (ch === '/' && next === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/'))
                i += 1;
            i += 2;
        }
        else if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            out += ch;
            i += 1;
            while (i < src.length && src[i] !== quote) {
                if (src[i] === '\\') {
                    out += src[i] + (src[i + 1] ?? '');
                    i += 2;
                }
                else {
                    out += src[i];
                    i += 1;
                }
            }
            out += src[i] ?? '';
            i += 1;
        }
        else {
            out += ch;
            i += 1;
        }
    }
    return out;
}
/**
 * A trailing options object is not part of what a matcher asserts:
 *   toHaveCount(1, { timeout: 30_000 })  ->  toHaveCount(1, { timeout: 60_000 })
 * changes the wait budget, not the expected count. Raising a timeout is textbook
 * healing, so the options object is stripped before fingerprinting — otherwise every
 * legitimate wait adjustment is reported as a tampered assertion.
 */
function stripMatcherOptions(rawArg) {
    return rawArg.replace(/,\s*\{[^}]*\}\s*$/, '').replace(/^\s*\{[^}]*\}\s*$/, '');
}
export function matcherFingerprints(src) {
    const out = [];
    for (const [, negated, matcher, rawArg] of src.matchAll(MATCHER)) {
        const arg = stripMatcherOptions(rawArg ?? '')
            .trim()
            .replace(/^["'`]|["'`]$/g, '')
            .replace(/\s+/g, ' ');
        out.push(`${negated ? 'not.' : ''}${matcher}(${arg})`);
    }
    return out;
}
/** Balanced-paren extraction of every `expect(...)` / `expect.soft(...)` argument. */
export function expectArgs(src) {
    const out = [];
    const re = new RegExp(EXPECTS.source, 'g');
    let m;
    while ((m = re.exec(src)) !== null) {
        let depth = 1;
        let i = m.index + m[0].length;
        const start = i;
        while (i < src.length && depth > 0) {
            const ch = src[i];
            if (ch === '(')
                depth += 1;
            else if (ch === ')')
                depth -= 1;
            else if (ch === '"' || ch === "'" || ch === '`') {
                const quote = ch;
                i += 1;
                while (i < src.length && src[i] !== quote)
                    i += src[i] === '\\' ? 2 : 1;
            }
            i += 1;
        }
        if (depth === 0)
            out.push(src.slice(start, i - 1));
    }
    return out;
}
/** Literals sitting in a non-locator expect() argument — i.e. asserted data. */
export function assertedLiterals(src) {
    const out = [];
    for (const arg of expectArgs(src)) {
        if (LOCATOR_EXPR.test(arg))
            continue;
        for (const [lit] of arg.matchAll(new RegExp(LITERAL.source, 'g'))) {
            out.push(lit.replace(/\s+/g, ' '));
        }
    }
    return out;
}
/**
 * Expected values are usually hoisted into named constants — the planner recommends it,
 * and it reads better:
 *
 *   const GENERAL_MEETING_OPENING = '会議の書き起こしから、…'
 *   expect(prefix.startsWith(GENERAL_MEETING_OPENING)).toBe(true)
 *
 * Fingerprinting only the literals that appear inline in an assertion misses this
 * completely: editing the constant guts the test while every assertion line stays
 * byte-identical. So resolve identifiers referenced from a protected position back to
 * their declared literal and protect that instead.
 *
 * A constant only used to build a locator is NOT protected, because expect() arguments
 * that are locator expressions are skipped before this runs — renaming a button label is
 * healing, not faking.
 */
// The type-annotation group must not cross a newline. `[^=]+` spanning lines lets a
// declaration with no initialiser (`declare const process: {...}`) swallow everything up
// to the next `=` in the file and steal the NEXT constant's literal — which silently
// removes that constant from protection.
const CONST_LITERAL = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*((['"`])(?:\\.|(?!\3)[^\\])*\3)/g;
const IDENTIFIER = /\b([A-Za-z_$][\w$]*)\b/g;
/** Map of module constants that hold a plain string literal. */
export function constantLiterals(src) {
    const out = new Map();
    for (const m of src.matchAll(CONST_LITERAL)) {
        const name = m[1];
        const value = m[2];
        if (name && value)
            out.set(name, value.replace(/\s+/g, ' '));
    }
    return out;
}
/** Relative module specifiers this file imports — the only ones worth resolving. */
export function relativeImports(src) {
    const out = [];
    const re = /\bfrom\s+['"](\.[^'"]*)['"]/g;
    for (const m of stripComments(src).matchAll(re))
        if (m[1])
            out.push(m[1]);
    return [...new Set(out)];
}
/**
 * Literal values reachable from an assertion via a named constant.
 *
 * `imported` carries the source of files this spec imports. Without it, moving an
 * expected value into a fixture module defeats the guard entirely: the spec still
 * references the name, but the literal lives elsewhere and nothing links the two.
 */
export function referencedConstants(src, imported = []) {
    const constants = constantLiterals(src);
    for (const extra of imported) {
        for (const [name, value] of constantLiterals(extra)) {
            if (!constants.has(name))
                constants.set(name, value);
        }
    }
    if (constants.size === 0)
        return [];
    const positions = [];
    for (const arg of expectArgs(src)) {
        if (LOCATOR_EXPR.test(arg))
            continue;
        positions.push(arg);
    }
    for (const m of src.matchAll(new RegExp(MATCHER.source, 'g'))) {
        if (m[3])
            positions.push(m[3]);
    }
    const out = [];
    for (const text of positions) {
        for (const m of text.matchAll(new RegExp(IDENTIFIER.source, 'g'))) {
            const name = m[1];
            if (!name)
                continue;
            const literal = constants.get(name);
            if (literal !== undefined)
                out.push(`${name}=${literal}`);
        }
    }
    return out;
}
const countOf = (src, re) => (src.match(new RegExp(re.source, re.flags)) ?? []).length;
/** Multiset difference: entries present in `before` that `after` no longer covers. */
function missing(beforeList, afterList) {
    const pool = [...afterList];
    const gone = [];
    for (const item of beforeList) {
        const at = pool.indexOf(item);
        if (at === -1)
            gone.push(item);
        else
            pool.splice(at, 1);
    }
    return gone;
}
export function analyze(rawBefore, rawAfter, options = {}) {
    const problems = [];
    const before = stripComments(rawBefore);
    const after = stripComments(rawAfter);
    for (const fp of missing(matcherFingerprints(before), matcherFingerprints(after))) {
        problems.push(`assertion changed or removed: ${fp}`);
    }
    for (const lit of missing(assertedLiterals(before), assertedLiterals(after))) {
        problems.push(`asserted value changed or removed inside expect(): ${lit}`);
    }
    const beforeRefs = referencedConstants(before, (options.beforeImported ?? []).map(stripComments));
    const afterRefs = referencedConstants(after, (options.afterImported ?? []).map(stripComments));
    for (const ref of missing(beforeRefs, afterRefs)) {
        problems.push(`expected value changed via a named constant: ${ref}`);
    }
    const beforeExpects = countOf(before, EXPECTS);
    const afterExpects = countOf(after, EXPECTS);
    if (afterExpects < beforeExpects) {
        problems.push(`assertion count dropped ${beforeExpects} -> ${afterExpects}`);
    }
    if (countOf(after, SILENCERS) > countOf(before, SILENCERS)) {
        problems.push('added test.skip / test.only / test.fixme');
    }
    const beforeTests = countOf(before, TESTS);
    const afterTests = countOf(after, TESTS);
    if (afterTests < beforeTests) {
        problems.push(`test count dropped ${beforeTests} -> ${afterTests}`);
    }
    // One constant referenced from several positions yields the same violation repeatedly.
    // Report each distinct problem once — a doubled line reads like two separate defects.
    return [...new Set(problems)];
}
