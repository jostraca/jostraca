"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const code_1 = require("@hapi/code");
const __1 = require("../");
(0, node_test_1.describe)('util', () => {
    (0, node_test_1.test)('each', () => {
        (0, code_1.expect)((0, __1.each)()).equal([]);
        (0, code_1.expect)((0, __1.each)(null)).equal([]);
        (0, code_1.expect)((0, __1.each)(1)).equal([]);
        (0, code_1.expect)((0, __1.each)([11])).equal([{ val$: 11, index$: 0 }]);
        (0, code_1.expect)((0, __1.each)([11], { oval: false })).equal([11]);
        (0, code_1.expect)((0, __1.each)([11, 22])).equal([{ val$: 11, index$: 0 }, { val$: 22, index$: 1 }]);
        (0, code_1.expect)((0, __1.each)([11, 22], { oval: false })).equal([11, 22]);
        (0, code_1.expect)((0, __1.each)(['b', 'a'], { oval: false, sort: true })).equal(['a', 'b']);
        (0, code_1.expect)((0, __1.each)(['b', 'a'], { sort: true }))
            .equal([{ val$: 'a', index$: 0 }, { val$: 'b', index$: 1 }]);
        (0, code_1.expect)((0, __1.each)([1], { oval: false }, (x) => 2 * x)).equal([2]);
        (0, code_1.expect)((0, __1.each)([1], (x) => 2 * x.val$)).equal([2]);
        (0, code_1.expect)((0, __1.each)({})).equal([]);
        (0, code_1.expect)((0, __1.each)({ a: 1 })).equal([{ 'key$': 'a', 'val$': 1 }]);
        (0, code_1.expect)((0, __1.each)({ b: 22, c: 11, a: 33 }, { sort: true })).equal([
            { 'key$': 'a', 'val$': 33 },
            { 'key$': 'b', 'val$': 22 },
            { 'key$': 'c', 'val$': 11 },
        ]);
        (0, code_1.expect)((0, __1.each)({ b: 22, c: 11, a: 33 }, (v, n, i) => n + '-' + i + '-' + JSON.stringify(v)))
            .equal([
            'b-0-{"key$":"b","val$":22}',
            'c-1-{"key$":"c","val$":11}',
            'a-2-{"key$":"a","val$":33}',
        ]);
    });
    (0, node_test_1.test)('getx', () => {
        (0, code_1.expect)((0, __1.getx)(undefined, undefined)).equal(undefined);
        (0, code_1.expect)((0, __1.getx)(undefined, 'x')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({}, undefined)).equal(undefined);
        (0, code_1.expect)((0, __1.getx)(null, null)).equal(undefined);
        (0, code_1.expect)((0, __1.getx)(null, 'x')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({}, null)).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({}, '')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({}, 'x')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ a: 1 }, 'a')).equal(1);
        (0, code_1.expect)((0, __1.getx)({ a: 1 }, 'x')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a b')).equal(1);
        (0, code_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a x')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'x b')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a.b')).equal(1);
        (0, code_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a.x')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'x.b')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a b c')).equal(1);
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: { d: 1 } } } }, 'a b c d')).equal(1);
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a.b.c')).equal(1);
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: { d: 1 } } } }, 'a.b.c.d')).equal(1);
        (0, code_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a:b')).equal({ a: { b: 1 } });
        (0, code_1.expect)((0, __1.getx)({ a: { x: 1 } }, 'a:b')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a:b:c')).equal({ a: { b: { c: 1 } } });
        (0, code_1.expect)((0, __1.getx)({ a: { b: { x: 1 } } }, 'a:b:c')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ a: { x: { c: 1 } } }, 'a:b:c')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ x: { b: { c: 1 } } }, 'a:b:c')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: { d: 1 } } } }, 'a:b:c:d')).equal({ a: { b: { c: { d: 1 } } } });
        (0, code_1.expect)((0, __1.getx)({ a: 1 }, 'a=1')).equal({ a: 1 });
        (0, code_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a:b=1')).equal({ a: { b: 1 } });
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a:b:c=1')).equal({ a: { b: { c: 1 } } });
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a b c=1')).equal({ c: 1 });
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a b:c=1')).equal({ b: { c: 1 } });
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: { d: 1 } } } }, 'a b:c:d=1')).equal({ b: { c: { d: 1 } } });
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a:b a')).equal({ b: { c: 1 } });
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a:b a b')).equal({ c: 1 });
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a:b a b c')).equal(1);
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a:b a b c=1')).equal({ c: 1 });
        (0, code_1.expect)((0, __1.getx)({ a: 1, b: 2 }, 'a=1 b')).equal(2);
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: 1 }, d: { c: 2 } } }, 'a?c=1')).equal({ b: { c: 1 } });
        (0, code_1.expect)((0, __1.getx)({ a: [{ c: 1 }, { c: 2 }] }, 'a?c=1')).equal([{ c: 1 }]);
        (0, code_1.expect)((0, __1.getx)([{ c: 1 }, { c: 2 }], '?c=1')).equal([{ c: 1 }]);
        (0, code_1.expect)((0, __1.getx)({ a: { b: { c: { e: 1 } }, d: { c: { e: 2 } } } }, 'a?c:e=1'))
            .equal({ b: { c: { e: 1 } } });
        // TODO: fix filter end detection
        // expect(getx({ a: { b: { c: { e: 1 } }, d: { c: { e: 2 } } } }, 'a?c.e=1'))
        //  .equal({ b: { c: { e: 1 } } })
        (0, code_1.expect)((0, __1.getx)({ x: [{ y: 1 }, { y: 2 }, { y: 2 }] }, 'x?y=2'))
            .equal([{ y: 2 }, { y: 2 }]);
        (0, code_1.expect)((0, __1.getx)({ x: { y: 1 } }, 'x:y x')).equal({ y: 1 });
        (0, code_1.expect)((0, __1.getx)({ x: { y: 1 } }, 'x:y x y')).equal(1);
        (0, code_1.expect)((0, __1.getx)({ x: { y: 1 } }, 'x y=1 y')).equal(1);
        (0, code_1.expect)((0, __1.getx)({ x: { y: 1 } }, 'x y!=1')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ x: 3 }, '')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ x: 1 }, 'x=1 x')).equal(1);
        (0, code_1.expect)((0, __1.getx)({ x: 1 }, 'x!=1')).equal(undefined);
        (0, code_1.expect)((0, __1.getx)({ x: [{ y: 1 }, { y: 2 }, { y: 2 }] }, 'x?y=2'))
            .equal([{ y: 2 }, { y: 2 }]);
        (0, code_1.expect)((0, __1.getx)({ x: [{ y: 1 }, { y: 2 }, { y: 2 }] }, 'x?y!=2'))
            .equal([{ y: 1 }]);
        (0, code_1.expect)((0, __1.getx)({ x: { m: { y: 1 }, n: { y: 2 }, k: { y: 2 } } }, 'x?y=2'))
            .equal({ n: { y: 2 }, k: { y: 2 } });
        (0, code_1.expect)((0, __1.getx)({ m: { y: 1 }, n: { y: 2 }, k: { y: 2 } }, '?y=2'))
            .equal({ n: { y: 2 }, k: { y: 2 } });
        (0, code_1.expect)((0, __1.getx)([{ y: 1 }, { y: 2 }, { y: 2 }], '?y=2'))
            .equal([{ y: 2 }, { y: 2 }]);
        (0, code_1.expect)((0, __1.getx)([11, 22, 33], '0')).equal(11);
        (0, code_1.expect)((0, __1.getx)([11, 22, 33], '1')).equal(22);
        (0, code_1.expect)((0, __1.getx)([11, 22, 33], '2')).equal(33);
        (0, code_1.expect)((0, __1.getx)({ a: [11, 22, 33] }, 'a 0')).equal(11);
        (0, code_1.expect)((0, __1.getx)([[11, 22, 33]], '0 1')).equal(22);
        (0, code_1.expect)((0, __1.getx)([[{ a: 11 }, { a: 22 }, { a: 33 }]], '0 1 a')).equal(22);
        (0, code_1.expect)((0, __1.getx)([[{ a: 11 }, { a: 22 }, { a: 33 }]], '0?a=11')).equal([{ a: 11 }]);
        (0, code_1.expect)((0, __1.getx)([{ y: 1 }, { y: 2 }, { y: 2 }], '0'))
            .equal({ y: 1 });
        (0, code_1.expect)((0, __1.getx)([{ y: 1 }, { y: 2 }, { y: 2 }], '?y=2'))
            .equal([{ y: 2 }, { y: 2 }]);
        (0, code_1.expect)((0, __1.getx)([{ y: 1 }, { y: 2 }, { y: 2 }], '?y=2 0'))
            .equal({ y: 2 });
    });
    (0, node_test_1.test)('template', () => {
        (0, code_1.expect)((0, __1.template)('a$$b.c$$d', { b: { c: 'X' } })).equal('aXd');
        (0, code_1.expect)((0, __1.template)('a$$1$$d', [22, 222])).equal('a222d');
        (0, code_1.expect)((0, __1.template)('a$$b$$c$$b$$', { b: true })).equal('atruectrue');
        (0, code_1.expect)((0, __1.template)('$$b$$a$$b$$c', { b: false })).equal('falseafalsec');
        (0, code_1.expect)((0, __1.template)('$$a$$$$b$$$$c$$', { a: null, b: undefined, c: NaN }))
            .equal('$$a$$$$b$$$$c$$');
        (0, code_1.expect)((0, __1.template)('$$a$$', { a: { b: 1 } })).equal('{"b":1}');
        (0, code_1.expect)((0, __1.template)('$$a$$', { a: ['b', 'c'] })).equal('["b","c"]');
        (0, code_1.expect)((0, __1.template)('$$a$$', { a: () => 'A' })).equal('A');
        (0, code_1.expect)((0, __1.template)('$$__insert__$$', {})).equal('/(\\$\\$)([^$]+)(\\$\\$)/');
        (0, code_1.expect)((0, __1.template)('$$a$$', { a: '$$b$$' })).equal('$$b$$'); // NOPE - NOT A MACRO SYSTEM!
        (0, code_1.expect)((0, __1.template)('aQb', {}, { replace: { Q: 'Z' } })).equal('aZb');
        (0, code_1.expect)((0, __1.template)('aQQQb', {}, { replace: { '/Q+/': 'Z' } })).equal('aZb');
        (0, code_1.expect)(() => (0, __1.template)('aQQQb', {}, { replace: { '/Q*/': 'Z' } })).throws(/empty/);
        (0, code_1.expect)((0, __1.template)('aQbWc$$__insert__$$', {}, { replace: { Q: 'Z', W: 'Y' } }))
            .equal('aZbYc/(\\$\\$)([^$]+)(\\$\\$)|(Q)|(W)/');
    });
});
//# sourceMappingURL=util.test.js.map