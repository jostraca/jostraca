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
function partial(actual, expected, path) {
    if (Object.is(actual, expected)) {
        return null;
    }
    if (null === expected || 'object' !== typeof expected) {
        return `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    }
    if (expected instanceof Date || expected instanceof RegExp) {
        return String(actual) === String(expected) ? null :
            `${path}: expected ${expected}, got ${actual}`;
    }
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual)) {
            return `${path}: expected an array, got ${JSON.stringify(actual)}`;
        }
        // Each expected entry must claim a distinct actual entry, which is how
        // the native one treats an array: a subset, not a whole.
        const taken = new Set();
        for (let i = 0; i < expected.length; i++) {
            let found = -1;
            for (let j = 0; j < actual.length; j++) {
                if (!taken.has(j) && null === partial(actual[j], expected[i], `${path}[${i}]`)) {
                    found = j;
                    break;
                }
            }
            if (-1 === found) {
                return `${path}[${i}]: no match for ${JSON.stringify(expected[i])} in ` +
                    JSON.stringify(actual);
            }
            taken.add(found);
        }
        return null;
    }
    if (null === actual || 'object' !== typeof actual) {
        return `${path}: expected an object, got ${JSON.stringify(actual)}`;
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