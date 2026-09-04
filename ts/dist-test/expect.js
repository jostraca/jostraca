"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.POSIX_MODES = void 0;
exports.expect = expect;
const node_assert_1 = __importDefault(require("node:assert"));
// Whether POSIX permission bits mean anything on this platform.
//
// They do not on Windows: `fs.chmod` there only toggles the read-only
// attribute, and `fs.stat` always reports 0o666 (or 0o444 when read-only).
// A `mode` asserted as 0o755 comes back as 0o666, and nothing is wrong —
// there is no execute bit to set.
//
// So the mode ASSERTIONS are skipped on Windows, not the tests. Everything
// around them — the content written, the atomic rename completing, no temp
// file left behind — is platform-independent and still checked. Guard the
// narrowest thing that is actually untestable.
exports.POSIX_MODES = 'win32' !== process.platform;
// `assert.partialDeepStrictEqual` landed in Node 22 and does not exist on
// Node 20, which the package now declares as its floor (`engines.node`).
// Calling it there fails every `include` assertion with "not a function" --
// 18 of them -- so the suite could not run on the version the package
// promises to support.
//
// This is the check itself rather than a fallback used only where the
// native one is missing: one behaviour on every Node version is worth more
// than a suite that asserts something subtly different depending on where
// it runs. Semantics follow Node's: `expected` is a pattern, and every part
// of it must appear in `actual`, which may carry more.
//
// Verified against the native implementation before replacing it -- the
// whole suite passes identically with each, and a deliberately broken
// expectation fails under both.
function typeName(v) {
    if (null === v)
        return 'null';
    if (Array.isArray(v))
        return 'Array';
    if (v instanceof Date)
        return 'Date';
    if (v instanceof RegExp)
        return 'RegExp';
    if (v instanceof Map)
        return 'Map';
    if (v instanceof Set)
        return 'Set';
    return typeof v;
}
function partial(actual, expected, path) {
    if (Object.is(actual, expected)) {
        return null;
    }
    if (null === expected || 'object' !== typeof expected) {
        return `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    }
    // A built-in must be met by the same built-in. Comparing string forms
    // alone let a string '/x/' satisfy an expected /x/.
    const kind = typeName(expected);
    if (kind !== typeName(actual)) {
        return `${path}: expected ${kind}, got ${typeName(actual)}`;
    }
    if (expected instanceof Date) {
        return actual.getTime() === expected.getTime() ? null :
            `${path}: expected ${expected.toISOString()}, got ${actual.toISOString()}`;
    }
    if (expected instanceof RegExp) {
        return String(actual) === String(expected) ? null :
            `${path}: expected ${expected}, got ${actual}`;
    }
    // ORDER IS PART OF THE ASSERTION. Expected entries must appear in actual
    // in the same relative order, gaps allowed -- a subsequence, not a
    // set. Matching any-order made a reordered `files.written` pass, and the
    // order of that list is exactly what several tests are pinning.
    if (Array.isArray(expected)) {
        let from = 0;
        for (let i = 0; i < expected.length; i++) {
            let found = -1;
            for (let j = from; j < actual.length; j++) {
                if (null === partial(actual[j], expected[i], `${path}[${i}]`)) {
                    found = j;
                    break;
                }
            }
            if (-1 === found) {
                return `${path}[${i}]: no match for ${JSON.stringify(expected[i])} ` +
                    `at or after index ${from} in ${JSON.stringify(actual)}`;
            }
            from = found + 1;
        }
        return null;
    }
    if (expected instanceof Set) {
        for (const want of expected) {
            let hit = false;
            for (const got of actual) {
                if (null === partial(got, want, `${path}{}`)) {
                    hit = true;
                    break;
                }
            }
            if (!hit) {
                return `${path}: no member matching ${JSON.stringify(want)}`;
            }
        }
        return null;
    }
    if (expected instanceof Map) {
        for (const [key, want] of expected) {
            if (!actual.has(key)) {
                return `${path}: no entry for key ${JSON.stringify(key)}`;
            }
            const fail = partial(actual.get(key), want, `${path}(${String(key)})`);
            if (null !== fail) {
                return fail;
            }
        }
        return null;
    }
    for (const key of Object.keys(expected)) {
        if (!(key in actual)) {
            return `${path}.${key}: missing`;
        }
        const fail = partial(actual[key], expected[key], `${path}.${key}`);
        if (null !== fail) {
            return fail;
        }
    }
    return null;
}
function partialEqual(actual, expected) {
    const fail = partial(actual, expected, 'value');
    node_assert_1.default.ok(null === fail, fail);
}
function expect(actual) {
    return {
        equal: (expected) => node_assert_1.default.deepStrictEqual(actual, expected),
        equals: (expected) => node_assert_1.default.deepStrictEqual(actual, expected),
        exist: () => node_assert_1.default.ok(actual !== null && actual !== undefined),
        include: (expected) => partialEqual(actual, expected),
        includes: (expected) => partialEqual(actual, expected),
        throws: (matcher) => node_assert_1.default.throws(actual, matcher),
        rejects: (matcher) => node_assert_1.default.rejects(actual, matcher),
        true: () => node_assert_1.default.strictEqual(actual, true),
        false: () => node_assert_1.default.strictEqual(actual, false),
    };
}
//# sourceMappingURL=expect.js.map