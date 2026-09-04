"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const node_assert_2 = __importDefault(require("node:assert"));
const expect_1 = require("./expect");
// `expect().include()` carries its own partial-match rather than calling
// `assert.partialDeepStrictEqual`, which does not exist before Node 22 and
// so made the whole suite unrunnable on the floor `engines.node` declares.
//
// The risk that replacement introduces is not a false failure -- those show
// up the moment the suite runs -- but a false PASS: a matcher looser than
// the one it replaced quietly stops asserting something. Six of those were
// real. Arrays matched in any order, so a reordered `files.written` passed;
// a Map or Set fell through to the object branch and matched anything; a
// string '/x/' satisfied an expected /x/.
//
// So the two are compared directly, case by case, wherever the native one
// exists. On Node 20 there is nothing to compare against and this suite
// skips; on 22 and up it fails the moment the two disagree.
(0, node_test_1.describe)('expect-native', () => {
    const NATIVE = 'function' === typeof node_assert_2.default.partialDeepStrictEqual;
    // Each case is [name, actual, expected]. Both matchers see the same pair
    // and must agree on pass or fail. The list is the divergences that were
    // found plus the shapes around them, so a regression lands on a named row
    // rather than somewhere in the 461.
    const CASES = [
        ['order-reversed', [2, 1], [1, 2]],
        ['order-strings', ['b', 'a'], ['a', 'b']],
        ['array-prefix', [1, 2, 3], [1, 2]],
        ['array-subsequence', [1, 2, 3], [1, 3]],
        ['array-out-of-order', [1, 2, 3], [3, 1]],
        ['array-vs-object', { 0: 1 }, [1]],
        ['written-order', { files: { written: ['/x/b', '/x/a'] } },
            { files: { written: ['/x/a', '/x/b'] } }],
        ['nested-array-order', { f: { w: ['a', 'b', 'c'] } }, { f: { w: ['a', 'c'] } }],
        ['set-subset', new Set([1, 2]), new Set([1])],
        ['set-missing', new Set([1]), new Set([5])],
        ['set-vs-object', {}, new Set([1])],
        ['map-subset', new Map([['a', 1], ['b', 2]]), new Map([['a', 1]])],
        ['map-wrong-value', new Map([['a', 9]]), new Map([['a', 1]])],
        ['map-vs-object', {}, new Map([['a', 1]])],
        ['regexp-match', { r: /x/ }, { r: /x/ }],
        ['regexp-vs-string', { r: '/x/' }, { r: /x/ }],
        ['date-match', { d: new Date(0) }, { d: new Date(0) }],
        ['date-vs-string', { d: '1970-01-01T00:00:00.000Z' }, { d: new Date(0) }],
        ['nested-partial', { a: { b: 1, c: 2 } }, { a: { b: 1 } }],
        ['missing-key', { a: 1 }, { b: 1 }],
        ['number-vs-string', { n: '1' }, { n: 1 }],
    ];
    const passes = (f) => {
        try {
            f();
            return true;
        }
        catch {
            return false;
        }
    };
    (0, node_test_1.test)('agrees-with-native', (t) => {
        if (!NATIVE) {
            t.skip('assert.partialDeepStrictEqual needs Node 22 or newer');
            return;
        }
        for (const [name, actual, expected] of CASES) {
            const native = passes(() => node_assert_2.default.partialDeepStrictEqual(actual, expected));
            const ours = passes(() => (0, expect_1.expect)(actual).include(expected));
            node_assert_1.default.equal(ours, native, `${name}: native ${native ? 'passes' : 'fails'}, ` +
                `expect().include() ${ours ? 'passes' : 'fails'}`);
        }
    });
    // An assertion that cannot fail is worse than no assertion, and the list
    // above would be satisfied by a matcher that rejects everything. This
    // pins that some of those cases really do pass.
    (0, node_test_1.test)('not-vacuous', () => {
        const passing = CASES.filter(([, actual, expected]) => passes(() => (0, expect_1.expect)(actual).include(expected)));
        node_assert_1.default.ok(8 <= passing.length, `only ${passing.length} cases pass; the corpus should exercise both outcomes`);
    });
});
//# sourceMappingURL=expect-native.test.js.map