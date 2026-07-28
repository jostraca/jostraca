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
function expect(actual) {
    return {
        equal: (expected) => node_assert_1.default.deepStrictEqual(actual, expected),
        equals: (expected) => node_assert_1.default.deepStrictEqual(actual, expected),
        exist: () => node_assert_1.default.ok(actual !== null && actual !== undefined),
        include: (expected) => node_assert_1.default.partialDeepStrictEqual(actual, expected),
        includes: (expected) => node_assert_1.default.partialDeepStrictEqual(actual, expected),
        throws: (matcher) => node_assert_1.default.throws(actual, matcher),
        rejects: (matcher) => node_assert_1.default.rejects(actual, matcher),
        true: () => node_assert_1.default.strictEqual(actual, true),
        false: () => node_assert_1.default.strictEqual(actual, false),
    };
}
//# sourceMappingURL=expect.js.map