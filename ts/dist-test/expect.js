"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.expect = expect;
const node_assert_1 = __importDefault(require("node:assert"));
function expect(actual) {
    return {
        equal: (expected) => node_assert_1.default.deepStrictEqual(actual, expected),
        equals: (expected) => node_assert_1.default.deepStrictEqual(actual, expected),
        exist: () => node_assert_1.default.ok(actual !== null && actual !== undefined),
        include: (expected) => node_assert_1.default.partialDeepStrictEqual(actual, expected),
        includes: (expected) => node_assert_1.default.partialDeepStrictEqual(actual, expected),
        throws: (matcher) => node_assert_1.default.throws(actual, matcher),
        true: () => node_assert_1.default.strictEqual(actual, true),
    };
}
//# sourceMappingURL=expect.js.map