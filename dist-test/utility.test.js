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
        (0, code_1.expect)((0, __1.getx)({ a: { b: 1 } }, 'a "b"')).equal(1);
    });
    (0, node_test_1.test)('indent', () => {
        (0, code_1.expect)((0, __1.indent)('a', 2)).equal('  a');
        (0, code_1.expect)((0, __1.indent)('\na', 2)).equal('\n  a');
        (0, code_1.expect)((0, __1.indent)('\n a', 2)).equal('\n   a');
        (0, code_1.expect)((0, __1.indent)('\n  a', 2)).equal('\n    a');
        (0, code_1.expect)((0, __1.indent)('\n   a', 2)).equal('\n     a');
        (0, code_1.expect)((0, __1.indent)('\n    a', 2)).equal('\n      a');
        (0, code_1.expect)((0, __1.indent)('\n\ta', 2)).equal('\n  \ta');
        (0, code_1.expect)((0, __1.indent)('{\n  a\n}', 2)).equal('  {\n    a\n  }');
        (0, code_1.expect)((0, __1.indent)('a', '    ')).equal('    a');
        (0, code_1.expect)((0, __1.indent)('\na', '    ')).equal('\n    a');
        (0, code_1.expect)((0, __1.indent)('\n a', '    ')).equal('\n     a');
        (0, code_1.expect)((0, __1.indent)('\n  a', '    ')).equal('\n      a');
        (0, code_1.expect)((0, __1.indent)('\n   a', '    ')).equal('\n       a');
        (0, code_1.expect)((0, __1.indent)('\n\ta', '    ')).equal('\n    \ta');
        (0, code_1.expect)((0, __1.indent)('a\nb', 2)).equal('  a\n  b');
        (0, code_1.expect)((0, __1.indent)('a\nb\nc', 2)).equal('  a\n  b\n  c');
        (0, code_1.expect)((0, __1.indent)('a\nb\nc\n', 2)).equal('  a\n  b\n  c\n');
        (0, code_1.expect)((0, __1.indent)('\na\nb', 2)).equal('\n  a\n  b');
        (0, code_1.expect)((0, __1.indent)('\na\nb\nc', 2)).equal('\n  a\n  b\n  c');
        (0, code_1.expect)((0, __1.indent)('\na\nb\nc\n', 2)).equal('\n  a\n  b\n  c\n');
        (0, code_1.expect)((0, __1.indent)('a\n b', 2)).equal('  a\n   b');
        (0, code_1.expect)((0, __1.indent)('a\n b\n c', 2)).equal('  a\n   b\n   c');
        (0, code_1.expect)((0, __1.indent)(' a\n b\nc\n', 2)).equal('   a\n   b\n  c\n');
        (0, code_1.expect)((0, __1.indent)(' a\n b\n c\n', 2)).equal('   a\n   b\n   c\n');
    });
    (0, node_test_1.test)('isbinext', () => {
        (0, code_1.expect)((0, __1.isbinext)('/foo/bar.png')).equal(true);
    });
    (0, node_test_1.test)('name-formats', () => {
        (0, code_1.expect)((0, __1.ucf)('foo')).equal('Foo');
        (0, code_1.expect)((0, __1.ucf)('Foo')).equal('Foo');
        (0, code_1.expect)((0, __1.ucf)('f')).equal('F');
        (0, code_1.expect)((0, __1.ucf)('F')).equal('F');
        (0, code_1.expect)((0, __1.ucf)('')).equal('');
        (0, code_1.expect)((0, __1.ucf)(null)).equal('Null');
        (0, code_1.expect)((0, __1.lcf)('foo')).equal('foo');
        (0, code_1.expect)((0, __1.lcf)('Foo')).equal('foo');
        (0, code_1.expect)((0, __1.lcf)('f')).equal('f');
        (0, code_1.expect)((0, __1.lcf)('F')).equal('f');
        (0, code_1.expect)((0, __1.lcf)('')).equal('');
        (0, code_1.expect)((0, __1.lcf)(null)).equal('null');
        (0, code_1.expect)((0, __1.partify)(undefined)).equal(['undefined']);
        (0, code_1.expect)((0, __1.partify)(null)).equal(['null']);
        (0, code_1.expect)((0, __1.partify)('')).equal([]);
        (0, code_1.expect)((0, __1.partify)('Foo')).equal(['Foo']);
        (0, code_1.expect)((0, __1.partify)('FooBar')).equal(['Foo', 'Bar']);
        (0, code_1.expect)((0, __1.partify)('foobar')).equal(['foobar']);
        (0, code_1.expect)((0, __1.partify)('foo-bar')).equal(['foo', 'bar']);
        (0, code_1.expect)((0, __1.partify)('foo_bar')).equal(['foo', 'bar']);
        (0, code_1.expect)((0, __1.partify)(['foo'])).equal(['foo']);
        (0, code_1.expect)((0, __1.partify)(['foo', 'bar'])).equal(['foo', 'bar']);
        (0, code_1.expect)((0, __1.partify)(true)).equal(['true']);
        (0, code_1.expect)((0, __1.partify)([true])).equal(['true']);
        (0, code_1.expect)((0, __1.camelify)(null)).equal('Null');
        (0, code_1.expect)((0, __1.camelify)(undefined)).equal('Undefined');
        (0, code_1.expect)((0, __1.camelify)('foo')).equal('Foo');
        (0, code_1.expect)((0, __1.camelify)('Foo')).equal('Foo');
        (0, code_1.expect)((0, __1.camelify)('FooBar')).equal('FooBar');
        (0, code_1.expect)((0, __1.camelify)('foo_bar')).equal('FooBar');
        (0, code_1.expect)((0, __1.camelify)('foo-bar')).equal('FooBar');
        (0, code_1.expect)((0, __1.camelify)('fooBar')).equal('FooBar');
        (0, code_1.expect)((0, __1.camelify)('')).equal('');
        (0, code_1.expect)((0, __1.camelify)(['foo'])).equal('Foo');
        (0, code_1.expect)((0, __1.camelify)(['foo', 'bar'])).equal('FooBar');
        (0, code_1.expect)((0, __1.camelify)('')).equal('');
        (0, code_1.expect)((0, __1.camelify)(true)).equal('True');
        (0, code_1.expect)((0, __1.camelify)([true])).equal('True');
        (0, code_1.expect)((0, __1.snakify)(null)).equal('null');
        (0, code_1.expect)((0, __1.snakify)(undefined)).equal('undefined');
        (0, code_1.expect)((0, __1.snakify)('foo')).equal('foo');
        (0, code_1.expect)((0, __1.snakify)('Foo')).equal('foo');
        (0, code_1.expect)((0, __1.snakify)('FooBar')).equal('foo_bar');
        (0, code_1.expect)((0, __1.snakify)('foo_bar')).equal('foo_bar');
        (0, code_1.expect)((0, __1.snakify)('foo-bar')).equal('foo_bar');
        (0, code_1.expect)((0, __1.snakify)('fooBar')).equal('foo_bar');
        (0, code_1.expect)((0, __1.snakify)('foo bar')).equal('foo_bar');
        (0, code_1.expect)((0, __1.snakify)('FOO_BAR')).equal('foo_bar');
        (0, code_1.expect)((0, __1.snakify)('FOO_bar')).equal('foo_bar');
        (0, code_1.expect)((0, __1.snakify)('foo_BAR')).equal('foo_bar');
        (0, code_1.expect)((0, __1.snakify)('')).equal('');
        (0, code_1.expect)((0, __1.snakify)(['foo'])).equal('foo');
        (0, code_1.expect)((0, __1.snakify)(['foo', 'bar'])).equal('foo_bar');
        (0, code_1.expect)((0, __1.snakify)('')).equal('');
        (0, code_1.expect)((0, __1.snakify)(true)).equal('true');
        (0, code_1.expect)((0, __1.snakify)([true])).equal('true');
        (0, code_1.expect)((0, __1.kebabify)(null)).equal('null');
        (0, code_1.expect)((0, __1.kebabify)(undefined)).equal('undefined');
        (0, code_1.expect)((0, __1.kebabify)('foo')).equal('foo');
        (0, code_1.expect)((0, __1.kebabify)('Foo')).equal('foo');
        (0, code_1.expect)((0, __1.kebabify)('FooBar')).equal('foo-bar');
        (0, code_1.expect)((0, __1.kebabify)('foo_bar')).equal('foo-bar');
        (0, code_1.expect)((0, __1.kebabify)('foo-bar')).equal('foo-bar');
        (0, code_1.expect)((0, __1.kebabify)('fooBar')).equal('foo-bar');
        (0, code_1.expect)((0, __1.kebabify)('')).equal('');
        (0, code_1.expect)((0, __1.kebabify)(['foo'])).equal('foo');
        (0, code_1.expect)((0, __1.kebabify)(['foo', 'bar'])).equal('foo-bar');
        (0, code_1.expect)((0, __1.kebabify)('')).equal('');
        (0, code_1.expect)((0, __1.kebabify)(true)).equal('true');
        (0, code_1.expect)((0, __1.kebabify)([true])).equal('true');
        (0, code_1.expect)((0, __1.names)({}, 'Foo')).equal({
            name__orig: 'Foo',
            Name: 'Foo',
            name_: 'foo',
            'name-': 'foo',
            name: 'foo',
            NAME: 'FOO'
        });
        (0, code_1.expect)((0, __1.names)({}, 'FooBar')).equal({
            name__orig: 'FooBar',
            Name: 'FooBar',
            name_: 'foo_bar',
            'name-': 'foo-bar',
            name: 'foobar',
            NAME: 'FOOBAR'
        });
    });
});
//# sourceMappingURL=utility.test.js.map