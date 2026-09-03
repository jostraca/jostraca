"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const Assert = __importStar(require("node:assert"));
const expect_1 = require("./expect");
const Package = __importStar(require("../"));
const memfs_1 = require("../dist/util/memfs");
const __1 = require("../");
(0, node_test_1.describe)('util', () => {
    (0, node_test_1.test)('each', () => {
        (0, expect_1.expect)((0, __1.each)()).equal([]);
        (0, expect_1.expect)((0, __1.each)(null)).equal([]);
        (0, expect_1.expect)((0, __1.each)(1)).equal([]);
        (0, expect_1.expect)((0, __1.each)([11])).equal([{ val$: 11, index$: 0 }]);
        (0, expect_1.expect)((0, __1.each)([11], { oval: false })).equal([11]);
        (0, expect_1.expect)((0, __1.each)([11, 22])).equal([{ val$: 11, index$: 0 }, { val$: 22, index$: 1 }]);
        (0, expect_1.expect)((0, __1.each)([11, 22], { oval: false })).equal([11, 22]);
        (0, expect_1.expect)((0, __1.each)(['b', 'a'], { oval: false, sort: true })).equal(['a', 'b']);
        (0, expect_1.expect)((0, __1.each)(['b', 'a'], { sort: true }))
            .equal([{ val$: 'a', index$: 0 }, { val$: 'b', index$: 1 }]);
        (0, expect_1.expect)((0, __1.each)([1], { oval: false }, (x) => 2 * x)).equal([2]);
        (0, expect_1.expect)((0, __1.each)([1], (x) => 2 * x.val$)).equal([2]);
        (0, expect_1.expect)((0, __1.each)({})).equal([]);
        (0, expect_1.expect)((0, __1.each)({ a: 1 })).equal([{ 'key$': 'a', 'val$': 1 }]);
        (0, expect_1.expect)((0, __1.each)({ b: 22, c: 11, a: 33 }, { sort: true })).equal([
            { 'key$': 'a', 'val$': 33 },
            { 'key$': 'b', 'val$': 22 },
            { 'key$': 'c', 'val$': 11 },
        ]);
        // each now sorts map entries by key alphabetically for cross-stack
        // determinism (matches the Go port; previously TS preserved
        // insertion order).
        (0, expect_1.expect)((0, __1.each)({ b: 22, c: 11, a: 33 }, (v, n, i) => n + '-' + i + '-' + JSON.stringify(v)))
            .equal([
            'a-0-{"key$":"a","val$":33}',
            'b-1-{"key$":"b","val$":22}',
            'c-2-{"key$":"c","val$":11}',
        ]);
    });
    (0, node_test_1.test)('getx', () => {
        (0, expect_1.expect)((0, __1.getx)(undefined, undefined)).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)(undefined, 'x')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({}, undefined)).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)(null, null)).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)(null, 'x')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({}, null)).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({}, '')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({}, 'x')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ a: 1 }, 'a')).equal(1);
        (0, expect_1.expect)((0, __1.getx)({ a: 1 }, 'x')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a b')).equal(1);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a x')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'x b')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a.b')).equal(1);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a.x')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'x.b')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a b c')).equal(1);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: { d: 1 } } } }, 'a b c d')).equal(1);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a.b.c')).equal(1);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: { d: 1 } } } }, 'a.b.c.d')).equal(1);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a:b')).equal({ a: { b: 1 } });
        (0, expect_1.expect)((0, __1.getx)({ a: { x: 1 } }, 'a:b')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a:b:c')).equal({ a: { b: { c: 1 } } });
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { x: 1 } } }, 'a:b:c')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ a: { x: { c: 1 } } }, 'a:b:c')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ x: { b: { c: 1 } } }, 'a:b:c')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: { d: 1 } } } }, 'a:b:c:d')).equal({ a: { b: { c: { d: 1 } } } });
        (0, expect_1.expect)((0, __1.getx)({ a: 1 }, 'a=1')).equal({ a: 1 });
        (0, expect_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a:b=1')).equal({ a: { b: 1 } });
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a:b:c=1')).equal({ a: { b: { c: 1 } } });
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a b c=1')).equal({ c: 1 });
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a b:c=1')).equal({ b: { c: 1 } });
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: { d: 1 } } } }, 'a b:c:d=1')).equal({ b: { c: { d: 1 } } });
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a:b a')).equal({ b: { c: 1 } });
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a:b a b')).equal({ c: 1 });
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a:b a b c')).equal(1);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: 1 } } }, 'a:b a b c=1')).equal({ c: 1 });
        (0, expect_1.expect)((0, __1.getx)({ a: 1, b: 2 }, 'a=1 b')).equal(2);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: 1 }, d: { c: 2 } } }, 'a?c=1')).equal({ b: { c: 1 } });
        (0, expect_1.expect)((0, __1.getx)({ a: [{ c: 1 }, { c: 2 }] }, 'a?c=1')).equal([{ c: 1 }]);
        (0, expect_1.expect)((0, __1.getx)([{ c: 1 }, { c: 2 }], '?c=1')).equal([{ c: 1 }]);
        (0, expect_1.expect)((0, __1.getx)({ a: { b: { c: { e: 1 } }, d: { c: { e: 2 } } } }, 'a?c:e=1'))
            .equal({ b: { c: { e: 1 } } });
        // TODO: fix filter end detection
        // expect(getx({ a: { b: { c: { e: 1 } }, d: { c: { e: 2 } } } }, 'a?c.e=1'))
        //  .equal({ b: { c: { e: 1 } } })
        (0, expect_1.expect)((0, __1.getx)({ x: [{ y: 1 }, { y: 2 }, { y: 2 }] }, 'x?y=2'))
            .equal([{ y: 2 }, { y: 2 }]);
        (0, expect_1.expect)((0, __1.getx)({ x: { y: 1 } }, 'x:y x')).equal({ y: 1 });
        (0, expect_1.expect)((0, __1.getx)({ x: { y: 1 } }, 'x:y x y')).equal(1);
        (0, expect_1.expect)((0, __1.getx)({ x: { y: 1 } }, 'x y=1 y')).equal(1);
        (0, expect_1.expect)((0, __1.getx)({ x: { y: 1 } }, 'x y!=1')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ x: 3 }, '')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ x: 1 }, 'x=1 x')).equal(1);
        (0, expect_1.expect)((0, __1.getx)({ x: 1 }, 'x!=1')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ x: [{ y: 1 }, { y: 2 }, { y: 2 }] }, 'x?y=2'))
            .equal([{ y: 2 }, { y: 2 }]);
        (0, expect_1.expect)((0, __1.getx)({ x: [{ y: 1 }, { y: 2 }, { y: 2 }] }, 'x?y!=2'))
            .equal([{ y: 1 }]);
        (0, expect_1.expect)((0, __1.getx)({ x: { m: { y: 1 }, n: { y: 2 }, k: { y: 2 } } }, 'x?y=2'))
            .equal({ n: { y: 2 }, k: { y: 2 } });
        (0, expect_1.expect)((0, __1.getx)({ m: { y: 1 }, n: { y: 2 }, k: { y: 2 } }, '?y=2'))
            .equal({ n: { y: 2 }, k: { y: 2 } });
        (0, expect_1.expect)((0, __1.getx)([{ y: 1 }, { y: 2 }, { y: 2 }], '?y=2'))
            .equal([{ y: 2 }, { y: 2 }]);
        (0, expect_1.expect)((0, __1.getx)([11, 22, 33], '0')).equal(11);
        (0, expect_1.expect)((0, __1.getx)([11, 22, 33], '1')).equal(22);
        (0, expect_1.expect)((0, __1.getx)([11, 22, 33], '2')).equal(33);
        (0, expect_1.expect)((0, __1.getx)({ a: [11, 22, 33] }, 'a 0')).equal(11);
        (0, expect_1.expect)((0, __1.getx)([[11, 22, 33]], '0 1')).equal(22);
        (0, expect_1.expect)((0, __1.getx)([[{ a: 11 }, { a: 22 }, { a: 33 }]], '0 1 a')).equal(22);
        (0, expect_1.expect)((0, __1.getx)([[{ a: 11 }, { a: 22 }, { a: 33 }]], '0?a=11')).equal([{ a: 11 }]);
        (0, expect_1.expect)((0, __1.getx)([{ y: 1 }, { y: 2 }, { y: 2 }], '0'))
            .equal({ y: 1 });
        (0, expect_1.expect)((0, __1.getx)([{ y: 1 }, { y: 2 }, { y: 2 }], '?y=2'))
            .equal([{ y: 2 }, { y: 2 }]);
        (0, expect_1.expect)((0, __1.getx)([{ y: 1 }, { y: 2 }, { y: 2 }], '?y=2 0'))
            .equal({ y: 2 });
        (0, expect_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a "b"')).equal(1);
        // Regression: the comparison operators `<`, `>`, `~` do not contain `=`
        // and were previously unreachable (the guard only matched operators
        // containing `=`), so they silently returned undefined and diverged from
        // the Go port. See getx() in src/util/basic.ts.
        (0, expect_1.expect)((0, __1.getx)({ a: 5 }, 'a>3')).equal({ a: 5 });
        (0, expect_1.expect)((0, __1.getx)({ a: 5 }, 'a>9')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ a: 5 }, 'a<9')).equal({ a: 5 });
        (0, expect_1.expect)((0, __1.getx)({ a: 5 }, 'a<3')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ a: 5 }, 'a>=5')).equal({ a: 5 });
        (0, expect_1.expect)((0, __1.getx)({ a: 5 }, 'a<=5')).equal({ a: 5 });
        (0, expect_1.expect)((0, __1.getx)({ a: 'hello' }, 'a~ell')).equal({ a: 'hello' });
        (0, expect_1.expect)((0, __1.getx)({ a: 'hello' }, 'a~xyz')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ x: [{ n: 1 }, { n: 5 }, { n: 9 }] }, 'x?n>3'))
            .equal([{ n: 5 }, { n: 9 }]);
        (0, expect_1.expect)((0, __1.getx)({ x: [{ n: 1 }, { n: 5 }, { n: 9 }] }, 'x?n<5'))
            .equal([{ n: 1 }]);
        // Ordering on string operands is lexicographic, mirroring JS `<`/`>`.
        // The Go port (getxCompare) is kept in parity with this.
        (0, expect_1.expect)((0, __1.getx)({ a: 'm' }, 'a>d')).equal({ a: 'm' });
        (0, expect_1.expect)((0, __1.getx)({ a: 'd' }, 'a>m')).equal(undefined);
        (0, expect_1.expect)((0, __1.getx)({ a: 'foo' }, 'a<goo')).equal({ a: 'foo' });
        (0, expect_1.expect)((0, __1.getx)({ a: 'foo' }, 'a>=foo')).equal({ a: 'foo' });
        (0, expect_1.expect)((0, __1.getx)({ a: 'foo' }, 'a<=foo')).equal({ a: 'foo' });
        (0, expect_1.expect)((0, __1.getx)({ x: [{ s: 'a' }, { s: 'm' }, { s: 'z' }] }, 'x?s>k'))
            .equal([{ s: 'm' }, { s: 'z' }]);
        // Type-based, like JS: a string value compares lexicographically even when
        // it looks numeric ('10' < '9' is true), whereas a numeric value compares
        // numerically (10 < 9 is false).
        (0, expect_1.expect)((0, __1.getx)({ a: '10' }, 'a<9')).equal({ a: '10' });
        (0, expect_1.expect)((0, __1.getx)({ a: 10 }, 'a<9')).equal(undefined);
    });
    (0, node_test_1.test)('indent', () => {
        (0, expect_1.expect)((0, __1.indent)('a', 2)).equal('  a');
        (0, expect_1.expect)((0, __1.indent)('\na', 2)).equal('\n  a');
        (0, expect_1.expect)((0, __1.indent)('\n a', 2)).equal('\n   a');
        (0, expect_1.expect)((0, __1.indent)('\n  a', 2)).equal('\n    a');
        (0, expect_1.expect)((0, __1.indent)('\n   a', 2)).equal('\n     a');
        (0, expect_1.expect)((0, __1.indent)('\n    a', 2)).equal('\n      a');
        (0, expect_1.expect)((0, __1.indent)('\n\ta', 2)).equal('\n  \ta');
        (0, expect_1.expect)((0, __1.indent)('{\n  a\n}', 2)).equal('  {\n    a\n  }');
        (0, expect_1.expect)((0, __1.indent)('a', '    ')).equal('    a');
        (0, expect_1.expect)((0, __1.indent)('\na', '    ')).equal('\n    a');
        (0, expect_1.expect)((0, __1.indent)('\n a', '    ')).equal('\n     a');
        (0, expect_1.expect)((0, __1.indent)('\n  a', '    ')).equal('\n      a');
        (0, expect_1.expect)((0, __1.indent)('\n   a', '    ')).equal('\n       a');
        (0, expect_1.expect)((0, __1.indent)('\n\ta', '    ')).equal('\n    \ta');
        (0, expect_1.expect)((0, __1.indent)('a\nb', 2)).equal('  a\n  b');
        (0, expect_1.expect)((0, __1.indent)('a\nb\nc', 2)).equal('  a\n  b\n  c');
        (0, expect_1.expect)((0, __1.indent)('a\nb\nc\n', 2)).equal('  a\n  b\n  c\n');
        (0, expect_1.expect)((0, __1.indent)('\na\nb', 2)).equal('\n  a\n  b');
        (0, expect_1.expect)((0, __1.indent)('\na\nb\nc', 2)).equal('\n  a\n  b\n  c');
        (0, expect_1.expect)((0, __1.indent)('\na\nb\nc\n', 2)).equal('\n  a\n  b\n  c\n');
        (0, expect_1.expect)((0, __1.indent)('a\n b', 2)).equal('  a\n   b');
        (0, expect_1.expect)((0, __1.indent)('a\n b\n c', 2)).equal('  a\n   b\n   c');
        (0, expect_1.expect)((0, __1.indent)(' a\n b\nc\n', 2)).equal('   a\n   b\n  c\n');
        (0, expect_1.expect)((0, __1.indent)(' a\n b\n c\n', 2)).equal('   a\n   b\n   c\n');
    });
    (0, node_test_1.test)('isbinext', () => {
        (0, expect_1.expect)((0, __1.isbinext)('/foo/bar.png')).equal(true);
    });
    (0, node_test_1.test)('name-formats', () => {
        (0, expect_1.expect)((0, __1.ucf)('foo')).equal('Foo');
        (0, expect_1.expect)((0, __1.ucf)('Foo')).equal('Foo');
        (0, expect_1.expect)((0, __1.ucf)('f')).equal('F');
        (0, expect_1.expect)((0, __1.ucf)('F')).equal('F');
        (0, expect_1.expect)((0, __1.ucf)('')).equal('');
        (0, expect_1.expect)((0, __1.ucf)(null)).equal('Null');
        (0, expect_1.expect)((0, __1.lcf)('foo')).equal('foo');
        (0, expect_1.expect)((0, __1.lcf)('Foo')).equal('foo');
        (0, expect_1.expect)((0, __1.lcf)('f')).equal('f');
        (0, expect_1.expect)((0, __1.lcf)('F')).equal('f');
        (0, expect_1.expect)((0, __1.lcf)('')).equal('');
        (0, expect_1.expect)((0, __1.lcf)(null)).equal('null');
        (0, expect_1.expect)((0, __1.partify)(undefined)).equal(['undefined']);
        (0, expect_1.expect)((0, __1.partify)(null)).equal(['null']);
        (0, expect_1.expect)((0, __1.partify)('')).equal([]);
        (0, expect_1.expect)((0, __1.partify)('Foo')).equal(['Foo']);
        (0, expect_1.expect)((0, __1.partify)('FooBar')).equal(['Foo', 'Bar']);
        (0, expect_1.expect)((0, __1.partify)('foobar')).equal(['foobar']);
        (0, expect_1.expect)((0, __1.partify)('foo-bar')).equal(['foo', 'bar']);
        (0, expect_1.expect)((0, __1.partify)('foo_bar')).equal(['foo', 'bar']);
        (0, expect_1.expect)((0, __1.partify)(['foo'])).equal(['foo']);
        (0, expect_1.expect)((0, __1.partify)(['foo', 'bar'])).equal(['foo', 'bar']);
        (0, expect_1.expect)((0, __1.partify)(true)).equal(['true']);
        (0, expect_1.expect)((0, __1.partify)([true])).equal(['true']);
        // Single lowercase tokens between separators must stay separate.
        (0, expect_1.expect)((0, __1.partify)('yes-as-a-service')).equal(['yes', 'as', 'a', 'service']);
        (0, expect_1.expect)((0, __1.partify)('a-b-c')).equal(['a', 'b', 'c']);
        (0, expect_1.expect)((0, __1.partify)('YesAsAService')).equal(['Yes', 'As', 'A', 'Service']);
        (0, expect_1.expect)((0, __1.kebabify)('yes-as-a-service')).equal('yes-as-a-service');
        (0, expect_1.expect)((0, __1.kebabify)((0, __1.camelify)('yes-as-a-service'))).equal('yes-as-a-service');
        (0, expect_1.expect)((0, __1.snakify)('yes-as-a-service')).equal('yes_as_a_service');
        (0, expect_1.expect)((0, __1.camelify)(null)).equal('Null');
        (0, expect_1.expect)((0, __1.camelify)(undefined)).equal('Undefined');
        (0, expect_1.expect)((0, __1.camelify)('foo')).equal('Foo');
        (0, expect_1.expect)((0, __1.camelify)('Foo')).equal('Foo');
        (0, expect_1.expect)((0, __1.camelify)('FooBar')).equal('FooBar');
        (0, expect_1.expect)((0, __1.camelify)('foo_bar')).equal('FooBar');
        (0, expect_1.expect)((0, __1.camelify)('foo-bar')).equal('FooBar');
        (0, expect_1.expect)((0, __1.camelify)('fooBar')).equal('FooBar');
        (0, expect_1.expect)((0, __1.camelify)('')).equal('');
        (0, expect_1.expect)((0, __1.camelify)(['foo'])).equal('Foo');
        (0, expect_1.expect)((0, __1.camelify)(['foo', 'bar'])).equal('FooBar');
        (0, expect_1.expect)((0, __1.camelify)('')).equal('');
        (0, expect_1.expect)((0, __1.camelify)(true)).equal('True');
        (0, expect_1.expect)((0, __1.camelify)([true])).equal('True');
        (0, expect_1.expect)((0, __1.snakify)(null)).equal('null');
        (0, expect_1.expect)((0, __1.snakify)(undefined)).equal('undefined');
        (0, expect_1.expect)((0, __1.snakify)('foo')).equal('foo');
        (0, expect_1.expect)((0, __1.snakify)('Foo')).equal('foo');
        (0, expect_1.expect)((0, __1.snakify)('FooBar')).equal('foo_bar');
        (0, expect_1.expect)((0, __1.snakify)('foo_bar')).equal('foo_bar');
        (0, expect_1.expect)((0, __1.snakify)('foo-bar')).equal('foo_bar');
        (0, expect_1.expect)((0, __1.snakify)('fooBar')).equal('foo_bar');
        (0, expect_1.expect)((0, __1.snakify)('foo bar')).equal('foo_bar');
        (0, expect_1.expect)((0, __1.snakify)('FOO_BAR')).equal('foo_bar');
        (0, expect_1.expect)((0, __1.snakify)('FOO_bar')).equal('foo_bar');
        (0, expect_1.expect)((0, __1.snakify)('foo_BAR')).equal('foo_bar');
        (0, expect_1.expect)((0, __1.snakify)('')).equal('');
        (0, expect_1.expect)((0, __1.snakify)(['foo'])).equal('foo');
        (0, expect_1.expect)((0, __1.snakify)(['foo', 'bar'])).equal('foo_bar');
        (0, expect_1.expect)((0, __1.snakify)('')).equal('');
        (0, expect_1.expect)((0, __1.snakify)(true)).equal('true');
        (0, expect_1.expect)((0, __1.snakify)([true])).equal('true');
        (0, expect_1.expect)((0, __1.kebabify)(null)).equal('null');
        (0, expect_1.expect)((0, __1.kebabify)(undefined)).equal('undefined');
        (0, expect_1.expect)((0, __1.kebabify)('foo')).equal('foo');
        (0, expect_1.expect)((0, __1.kebabify)('Foo')).equal('foo');
        (0, expect_1.expect)((0, __1.kebabify)('FooBar')).equal('foo-bar');
        (0, expect_1.expect)((0, __1.kebabify)('foo_bar')).equal('foo-bar');
        (0, expect_1.expect)((0, __1.kebabify)('foo-bar')).equal('foo-bar');
        (0, expect_1.expect)((0, __1.kebabify)('fooBar')).equal('foo-bar');
        (0, expect_1.expect)((0, __1.kebabify)('')).equal('');
        (0, expect_1.expect)((0, __1.kebabify)(['foo'])).equal('foo');
        (0, expect_1.expect)((0, __1.kebabify)(['foo', 'bar'])).equal('foo-bar');
        (0, expect_1.expect)((0, __1.kebabify)('')).equal('');
        (0, expect_1.expect)((0, __1.kebabify)(true)).equal('true');
        (0, expect_1.expect)((0, __1.kebabify)([true])).equal('true');
        (0, expect_1.expect)((0, __1.names)({}, 'Foo')).equal({
            name__orig: 'Foo',
            Name: 'Foo',
            name_: 'foo',
            'name-': 'foo',
            name: 'foo',
            NAME: 'FOO'
        });
        (0, expect_1.expect)((0, __1.names)({}, 'FooBar')).equal({
            name__orig: 'FooBar',
            Name: 'FooBar',
            name_: 'foo_bar',
            'name-': 'foo-bar',
            name: 'foobar',
            NAME: 'FOOBAR'
        });
    });
    // `deep` and `omap` used to be re-exports of `jsonic.util`. They are now
    // inlined in src/util/basic.ts; these lock the behaviour that was
    // inherited, so a future edit cannot quietly drift from it.
    (0, node_test_1.test)('deep', () => {
        (0, expect_1.expect)((0, __1.deep)({}, { a: 1 })).equal({ a: 1 });
        (0, expect_1.expect)((0, __1.deep)({ a: 1 }, { b: 2 })).equal({ a: 1, b: 2 });
        (0, expect_1.expect)((0, __1.deep)({ a: 1 }, { a: 2 })).equal({ a: 2 });
        // Right-most wins, across more than two sources.
        (0, expect_1.expect)((0, __1.deep)({}, { a: 1 }, { b: 2 }, { a: 3 })).equal({ a: 3, b: 2 });
        // Nested plain objects merge key-by-key rather than replacing.
        (0, expect_1.expect)((0, __1.deep)({ a: { x: 1, y: 2 } }, { a: { y: 9, z: 8 } }))
            .equal({ a: { x: 1, y: 9, z: 8 } });
        // Arrays merge by index, and do not replace wholesale.
        (0, expect_1.expect)((0, __1.deep)({ a: [1, 2, 3] }, { a: [9] })).equal({ a: [9, 2, 3] });
        // `undefined` never overwrites; `null` does. go/util.go reproduces
        // this split by position -- a nil argument is absent, a nil map value
        // or slice element wins -- because Go has no `undefined`.
        (0, expect_1.expect)((0, __1.deep)({ a: 1 }, { a: undefined })).equal({ a: 1 });
        (0, expect_1.expect)((0, __1.deep)({ a: 1 }, { a: null })).equal({ a: null });
        (0, expect_1.expect)((0, __1.deep)({ a: 1 }, undefined)).equal({ a: 1 });
        (0, expect_1.expect)((0, __1.deep)({ a: 1 }, undefined, { b: 2 })).equal({ a: 1, b: 2 });
        (0, expect_1.expect)((0, __1.deep)({ a: { x: 1 } }, { a: null })).equal({ a: null });
        (0, expect_1.expect)((0, __1.deep)({ a: null }, { a: 1 })).equal({ a: 1 });
        (0, expect_1.expect)((0, __1.deep)({ a: [1, 2] }, { a: null })).equal({ a: null });
        (0, expect_1.expect)((0, __1.deep)({ a: [1, 2] }, { a: [9, null] })).equal({ a: [9, null] });
        (0, expect_1.expect)((0, __1.deep)([1, 2, 3], [9], [null, 8])).equal([null, 8, 3]);
        // The SKIP sentinel leaves the base value untouched. Resolved from the
        // global registry, so it is the same symbol jsonic publishes.
        const SKIP = Symbol.for('tabnas.SKIP');
        (0, expect_1.expect)((0, __1.deep)({ a: 1 }, { a: SKIP })).equal({ a: 1 });
        // Values with a custom constructor are taken by reference, not walked.
        const when = new Date(0);
        (0, expect_1.expect)((0, __1.deep)({ a: 1 }, { a: when }).a).equal(when);
        // AND THAT HOLDS WHATEVER SITS UNDER THE SAME KEY IN `base`. It used to
        // hold only where the base value was a scalar: two objects sent the
        // merge down its WALK branch instead, which copies the enumerable
        // properties of one custom instance into the other. A Date and a RegExp
        // have none, so nothing was copied and `over` was silently discarded.
        //
        // `Copy`'s `cmp.Copy.ignore` is merged over a default of `[/~$/]`, so
        // this cost every caller the FIRST pattern of their ignore list.
        const later = new Date(1);
        (0, expect_1.expect)((0, __1.deep)({ a: when }, { a: later }).a).equal(later);
        const re = /b/;
        (0, expect_1.expect)((0, __1.deep)({ a: /a/ }, { a: re }).a).equal(re);
        // Element-wise, which is the shape the ignore lists are merged in.
        (0, expect_1.expect)((0, __1.deep)({ a: [/a/, /b/] }, { a: [/x/] }).a).equal([/x/, /b/]);
        // A class instance replaces whole rather than merging field by field
        // into the instance already there, which produced a hybrid of the two
        // belonging to neither.
        class Holder {
            x;
            y;
            constructor(x, y) {
                this.x = x;
                this.y = y;
            }
        }
        (0, expect_1.expect)((0, __1.deep)({ a: new Holder(1, 2) }, { a: new Holder(9) }).a)
            .equal(new Holder(9));
        // Plain by any other name: a null-prototype object has no constructor
        // at all, and is a bag of keys like any other.
        const bare = Object.create(null);
        bare.y = 2;
        (0, expect_1.expect)((0, __1.deep)({ a: { x: 1 } }, { a: bare }).a).equal({ x: 1, y: 2 });
        // Mutates the first argument, as it always has.
        const base = { a: 1 };
        (0, expect_1.expect)((0, __1.deep)(base, { b: 2 })).equal(base);
        (0, expect_1.expect)(base).equal({ a: 1, b: 2 });
    });
    // Key order is the cross-stack contract. Go maps have no insertion order
    // to reproduce, so go/util.go `OMap` sorts and this must sort too --
    // the same convention `each`, `cmap`, `vmap` and `jsonify` follow.
    (0, node_test_1.test)('deep-key-order', () => {
        // Existing base keys hold their position; new keys append in the
        // order `over` enumerates them.
        (0, expect_1.expect)(Object.keys((0, __1.deep)({ b: 1, a: 1 }, { a: 2, c: 3 })))
            .equal(['b', 'a', 'c']);
        (0, expect_1.expect)(Object.keys((0, __1.deep)({ z: 1, m: 2, a: 3 }, { a: 9, zz: 10, b: 11 })))
            .equal(['z', 'm', 'a', 'zz', 'b']);
    });
    (0, node_test_1.test)('omap', () => {
        (0, expect_1.expect)((0, __1.omap)({ a: 1, b: 2 })).equal({ a: 1, b: 2 });
        (0, expect_1.expect)((0, __1.omap)(null)).equal({});
        (0, expect_1.expect)((0, __1.omap)(undefined)).equal({});
        (0, expect_1.expect)((0, __1.omap)({})).equal({});
        // The transform receives, and returns, a [key, value] pair.
        (0, expect_1.expect)((0, __1.omap)({ a: 1, b: 2 }, ([k, v]) => [k, v * 2]))
            .equal({ a: 2, b: 4 });
        (0, expect_1.expect)((0, __1.omap)({ a: 1, b: 2 }, ([k, v]) => [k.toUpperCase(), v]))
            .equal({ A: 1, B: 2 });
        // An undefined replacement key drops the entry.
        (0, expect_1.expect)((0, __1.omap)({ a: 1, b: 2 }, ([k, v]) => 'a' === k ? [undefined] : [k, v]))
            .equal({ b: 2 });
        // Additional pairs set additional keys.
        (0, expect_1.expect)((0, __1.omap)({ a: 1 }, ([k, v]) => [k, v, k + '2', v * 10]))
            .equal({ a: 1, a2: 10 });
    });
    (0, node_test_1.test)('omap-key-order', () => {
        // Sorted, not insertion order -- this is the deliberate divergence
        // from the jsonic original, and what makes go/util.go `OMap` agree.
        (0, expect_1.expect)(Object.keys((0, __1.omap)({ z: 1, m: 2, a: 3 }))).equal(['a', 'm', 'z']);
        (0, expect_1.expect)(Object.keys((0, __1.omap)({ b: 1, a: 2 }, ([k, v]) => [k, v])))
            .equal(['a', 'b']);
        // Renaming keys does not re-sort: entries are visited in sorted
        // *source* key order, and written in that visit order.
        (0, expect_1.expect)(Object.keys((0, __1.omap)({ b: 1, a: 2 }, ([k, v]) => [k + 'x', v])))
            .equal(['ax', 'bx']);
        // Numeric-looking keys follow JS integer-key ordering once written to
        // the result object, regardless of visit order.
        (0, expect_1.expect)(Object.keys((0, __1.omap)({ 10: 'a', 2: 'b', 1: 'c' }))).equal(['1', '2', '10']);
    });
    // THE PUBLIC SURFACE, CHECKED FROM OUTSIDE. Every suite here imports the
    // helpers it needs by name, and spec.test.ts reaches past the entry point
    // into '../dist/util/basic' -- so nothing asserted that the package's own
    // exports resolve. They did not: `get` was `undefined` on the built
    // package for as long as a commented-out `// select,` sat between `each,`
    // and `get,` in the export list. tsc emits each re-export as a one-line
    // getter body, the comment pushed `basic_1.get` onto its own line, and
    // automatic semicolon insertion terminated the bare `return`. Typechecking
    // could not see it -- the declaration file was correct -- and neither
    // could any test that imported the function directly.
    //
    // Hence a census rather than a spot check: name the surface, and require
    // every entry to resolve to the kind of thing it claims to be.
    (0, node_test_1.test)('package-exports-resolve', () => {
        const FUNCTIONS = [
            'Jostraca', 'BuildContext', 'cmp',
            'each', 'get', 'getx',
            'camelify', 'snakify', 'kebabify', 'partify', 'ucf', 'lcf', 'names',
            'cmap', 'vmap', 'deep', 'omap',
            'template', 'escre', 'indent', 'isbincontent', 'isbinext',
            'Project', 'Content', 'File', 'Inject', 'Fragment', 'Folder',
            'Copy', 'Line', 'Slot', 'List',
        ];
        const NAMESPACES = ['PointUtil', 'DiffUtil'];
        const pkg = Package;
        const missing = FUNCTIONS.filter((n) => 'function' !== typeof pkg[n]);
        Assert.deepEqual(missing, [], 'package exports that are not functions: ' + missing.join(', '));
        const badns = NAMESPACES.filter((n) => null == pkg[n] || 'object' !== typeof pkg[n]);
        Assert.deepEqual(badns, [], 'package namespace exports missing: ' + badns.join(', '));
        // And the one that regressed, exercised rather than merely typed.
        (0, expect_1.expect)(pkg.get({ a: { b: { c: 1 } } }, 'a.b.c')).equal(1);
    });
});
// Caller-side state is recorded by no corpus: all four record OUTPUT only,
// never the model, the options object, or returned slices. So a helper that
// quietly mutates its input is invisible cross-stack, and one did -- getx's `?`
// filter left key$/index$ on every child the filter REJECTED, because the
// cleanup only ever reached the survivors. That pollution is observable in
// generated files, since Content shallow-copies the model and nested objects
// are shared for the whole run. Go rebuilds instead of stamping, so TS was the
// side that was wrong. See docs/design/PARITY_PLAN.md 2.3.
(0, node_test_1.describe)('caller-state', () => {
    (0, node_test_1.test)('getx-filter-does-not-mutate-the-model', () => {
        const model = { a: { x: { v: 1 }, y: { v: 2 } } };
        const before = JSON.stringify(model);
        const out = (0, __1.getx)(model, 'a?v=1');
        (0, expect_1.expect)(out).equal({ x: { v: 1 } });
        (0, expect_1.expect)(JSON.stringify(model)).equal(before);
    });
    (0, node_test_1.test)('getx-filter-does-not-mutate-an-array-model', () => {
        const model = { a: [{ v: 1 }, { v: 2 }] };
        const before = JSON.stringify(model);
        const out = (0, __1.getx)(model, 'a?v=1');
        (0, expect_1.expect)(out).equal([{ v: 1 }]);
        (0, expect_1.expect)(JSON.stringify(model)).equal(before);
    });
    (0, node_test_1.test)('getx-filter-leaves-no-stamp-on-rejected-children', () => {
        const rejected = { v: 2 };
        const model = { a: { x: { v: 1 }, y: rejected } };
        (0, __1.getx)(model, 'a?v=1');
        // The specific leak: `y` was filtered out and kept its bookkeeping key.
        (0, expect_1.expect)(undefined === rejected.key$).true();
        (0, expect_1.expect)(undefined === rejected.index$).true();
    });
    // The third instance of the same class, and the one a user hits without
    // reaching for an internal: `OptionsShape` injects its defaults into the
    // object it is handed and returns that same object, so `generate` used to
    // write `build`, `cmp`, `control`, `exclude` and `name` into the caller's
    // own options -- and `bin` into an `existing` they passed. Reusing one
    // options object across two calls then passed something different the
    // second time. Go's Options is a value struct and never had it.
    (0, node_test_1.test)('generate-does-not-mutate-the-caller-options', async () => {
        const { fs } = (0, memfs_1.memfs)({});
        const model = { v: 'V' };
        const existing = { txt: { preserve: true } };
        const opts = { fs: () => fs, folder: '/out', model, existing };
        const before = JSON.stringify({
            keys: Object.keys(opts).sort(),
            existing,
        });
        await Package.Jostraca({ now: () => 1735689600000 }).generate(opts, Package.cmp(() => Package.Project({ folder: 'p' }, () => {
            Package.File({ name: 'a.txt' }, () => Package.Content('A'));
        })));
        (0, expect_1.expect)(JSON.stringify({
            keys: Object.keys(opts).sort(),
            existing,
        })).equal(before);
        // The model is passed by reference on purpose -- it is the caller's
        // data, not option structure -- so this asserts identity, not a copy.
        (0, expect_1.expect)(opts.model === model).true();
    });
    // The injection is RECURSIVE, so the copy has to be. A one-level copy
    // handed `cmp.Copy` straight through and shape wrote `ignore: []` into
    // the caller's object two levels down -- measuring `existing` and `meta`,
    // finding one level enough, and generalising is how that was missed.
    //
    // The RegExp assertion is the other half: `cmp.Copy.ignore` holds RegExp
    // values, and copying a RegExp's enumerable properties is not copying it,
    // so those have to survive as the same object.
    (0, node_test_1.test)('generate-does-not-mutate-nested-caller-options', async () => {
        const { fs } = (0, memfs_1.memfs)({});
        // `Copy` is EMPTY on purpose. A `Copy` that already carries `ignore`
        // gives the injection nothing to add, so it passes against a one-level
        // copy and pins nothing -- which is what the first version of this test
        // did.
        const empty = {};
        const opts = {
            fs: () => fs,
            folder: '/out',
            cmp: { Copy: empty },
            existing: { txt: { preserve: true } },
        };
        const before = JSON.stringify({
            copyKeys: Object.keys(empty).sort(),
            existing: opts.existing,
        });
        await Package.Jostraca({ now: () => 1735689600000 }).generate(opts, Package.cmp(() => Package.Project({ folder: 'p' }, () => {
            Package.File({ name: 'a.txt' }, () => Package.Content('A'));
        })));
        (0, expect_1.expect)(JSON.stringify({
            copyKeys: Object.keys(empty).sort(),
            existing: opts.existing,
        })).equal(before);
        // And a `Copy` that DOES carry `ignore` keeps its RegExp as the same
        // object: copying a RegExp's enumerable properties is not copying it.
        const re = /~$/;
        const ignore = [re];
        await Package.Jostraca({ now: () => 1735689600000 }).generate({ fs: () => fs, folder: '/out', cmp: { Copy: { ignore } } }, Package.cmp(() => Package.Project({ folder: 'q' }, () => {
            Package.File({ name: 'b.txt' }, () => Package.Content('B'));
        })));
        (0, expect_1.expect)(1 === ignore.length).true();
        (0, expect_1.expect)(ignore[0] === re).true();
    });
});
//# sourceMappingURL=utility.test.js.map