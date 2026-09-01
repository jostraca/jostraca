"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const expect_1 = require("./expect");
const __1 = require("../");
(0, node_test_1.describe)('utility-template', () => {
    (0, node_test_1.test)('template', () => {
        (0, expect_1.expect)((0, __1.template)('a$$b.c$$d', { b: { c: 'X' } })).equal('aXd');
        (0, expect_1.expect)((0, __1.template)('a$$1$$d', [22, 222])).equal('a222d');
        (0, expect_1.expect)((0, __1.template)('a$$b$$c$$b$$', { b: true })).equal('atruectrue');
        (0, expect_1.expect)((0, __1.template)('$$b$$a$$b$$c', { b: false })).equal('falseafalsec');
        (0, expect_1.expect)((0, __1.template)('$$a$$$$b$$$$c$$', { a: null, b: undefined, c: NaN }))
            .equal('$$a$$$$b$$$$c$$');
        (0, expect_1.expect)((0, __1.template)('$$a$$', { a: { b: 1 } })).equal('{"b":1}');
        (0, expect_1.expect)((0, __1.template)('$$a$$', { a: ['b', 'c'] })).equal('["b","c"]');
        (0, expect_1.expect)((0, __1.template)('$$a$$', { a: () => 'A' })).equal('A');
        (0, expect_1.expect)((0, __1.template)('$$__JOSTRACA_REPLACE__$$', {}))
            .equal('/(?<J_O>\\$\\$)(?<J_R>[^$]+)(?<J_C>\\$\\$)/');
        (0, expect_1.expect)((0, __1.template)('$$a$$', { a: '$$b$$' })).equal('$$b$$'); // NOPE - NOT A MACRO SYSTEM!
        (0, expect_1.expect)((0, __1.template)('aQb', {}, { replace: { Q: 'Z' } })).equal('aZb');
        (0, expect_1.expect)((0, __1.template)('aQQQb', {}, { replace: { '/Q+/': 'Z' } })).equal('aZb');
        (0, expect_1.expect)(() => (0, __1.template)('aQQQb', {}, { replace: { '/Q*/': 'Z' } })).throws(/empty/);
        (0, expect_1.expect)((0, __1.template)('aQbWc$$__JOSTRACA_REPLACE__$$', {}, { replace: { Q: 'Z', W: 'Y' } }))
            .equal('aZbYc/(?<J_O>\\$\\$)(?<J_R>[^$]+)(?<J_C>' +
            '\\$\\$)|(?<J_K1_Q>Q)|(?<J_K2_W>W)/');
        (0, expect_1.expect)((0, __1.template)('aQb', {}, { replace: { Q: () => 'X' } })).equal('aXb');
        const m = { q: 'Q', w: 'W' };
        (0, expect_1.expect)((0, __1.template)('a[q]b[w]c<x>;y', {}, {
            replace: {
                'a': 'A',
                '/\\[(?<cap>\\w)\\]/': ({ cap }) => m[cap],
                '/c<(?<mx>.)>;(?<my>.)/': ({ mx, my }) => mx.toUpperCase() + my.toUpperCase(),
                '/c<(?<nx>.)>;(?<ny>.)/': (_, match) => match.groups.nx.toUpperCase() + match.groups.ny.toUpperCase(),
            }
        })).equal('AQbWXY');
        (0, expect_1.expect)((0, __1.template)('ab', {}, {
            replace: { '/(?<x>a)|(?<x>b)/': ({ x }) => x.toUpperCase() }
        })).equal('AB');
        // Tags
        (0, expect_1.expect)((0, __1.template)('{\n//#Wax\n  //  #SeeSaw\n  // #Red-Bar\nAAA\n    //\t#GreenBlue-Zed \n}', {}, {
            replace: {
                '#Wax': (g) => g.indent + '-Wax:' + g.TAG.toUpperCase() + '-' + JSON.stringify(g['$&']) + '\n',
                '#SeeSaw': (g) => g.indent + '-SeeSaw:' + g.TAG.toUpperCase() + '-' + JSON.stringify(g['$&']) + '\n',
                '#Foo-Bar': (g) => g.indent + g.Bar.toUpperCase() + '-' + g.TAG + '-' + JSON.stringify(g['$&']) + '\n',
                '#QazDin-Zed': (g) => g.indent + g.name.toUpperCase() + '-' + g.TAG + '-' + JSON.stringify(g['$&']) + '\n',
            }
        })).equal('{\n-Wax:WAX-"//#Wax\\n"\n  -SeeSaw:SEESAW-"  //  #SeeSaw\\n"\n' +
            '  RED-Bar-"  // #Red-Bar\\n"\n' +
            'AAA\n    GREENBLUE-Zed-"    //\\t#GreenBlue-Zed \\n"\n}');
        // Missing refs are not replaced.
        (0, expect_1.expect)((0, __1.template)('Name $$Name$$', {}, { replace: { Name: () => 'Foo' } }))
            .equal('Foo $$Name$$');
        // Escape format: $$"(.+)"$$
        (0, expect_1.expect)((0, __1.template)('Name $$"Name"$$', {}, { replace: { Name: () => 'Foo' } }))
            .equal('Foo Name');
    });
    (0, node_test_1.test)('eject', () => {
        let src0 = `
A
  START  
Q$$a$$
  END  
B
`;
        let m0 = { a: 1 };
        (0, expect_1.expect)((0, __1.template)(src0, m0, { eject: ['START', 'END'] })).equal('Q1\n');
        (0, expect_1.expect)((0, __1.template)(src0, m0, { eject: [/START/, /END/] })).equal('  \nQ1\n  ');
    });
    (0, node_test_1.test)('eject-inverted', () => {
        // End marker resolving before the start marker: there is no region
        // between them, so the source is left alone — the same thing that
        // happens when neither marker is found.
        //
        // This used to reach `substring`, which SWAPS its arguments when
        // start > end, handing back the reversed region as an accident of
        // the JS built-in. Go guarded the case and returned '' instead, so
        // the two stacks silently disagreed. Neither was designed.
        const src = 'a\nEND\nmiddle\nSTART\nb\n';
        (0, expect_1.expect)((0, __1.template)(src, {}, { eject: ['START', 'END'] })).equal(src);
        (0, expect_1.expect)((0, __1.template)('ENDSTART\n', {}, { eject: ['START', 'END'] }))
            .equal('ENDSTART\n');
    });
    (0, node_test_1.test)('jsonify-sorts-keys', () => {
        // Go maps have no insertion order, so `json.Marshal` sorts and TS
        // has to sort too or the same model emits different bytes on each
        // stack. Found by the cross-stack template corpus.
        (0, expect_1.expect)((0, __1.template)('$$a$$', { a: { z: 1, a: 2, m: 3 } }))
            .equal('{"a":2,"m":3,"z":1}');
        // All the way down, and arrays keep their own (meaningful) order.
        (0, expect_1.expect)((0, __1.template)('$$a$$', { a: { b: [{ y: 1, x: 2 }, { n: 3 }] } }))
            .equal('{"b":[{"x":2,"y":1},{"n":3}]}');
        // Same object, different insertion order, same output.
        const one = {};
        one.z = 1;
        one.a = 2;
        const two = {};
        two.a = 2;
        two.z = 1;
        (0, expect_1.expect)((0, __1.template)('$$v$$', { v: one })).equal((0, __1.template)('$$v$$', { v: two }));
    });
    (0, node_test_1.test)('jsonify-edge-values', () => {
        // toJSON is honoured, so Date and friends serialize as they always
        // did rather than collapsing to `{}` once sorting was introduced.
        (0, expect_1.expect)((0, __1.template)('$$d$$', { d: new Date(0) }))
            .equal('"1970-01-01T00:00:00.000Z"');
        // A repeated (non-cyclic) reference is fine, as it is for
        // JSON.stringify.
        const shared = { s: 1 };
        (0, expect_1.expect)((0, __1.template)('$$v$$', { v: { a: shared, b: shared } }))
            .equal('{"a":{"s":1},"b":{"s":1}}');
        // A cycle is rejected, not recursed until the stack blows.
        const cyclic = { a: 1 };
        cyclic.self = cyclic;
        (0, expect_1.expect)(() => (0, __1.template)('$$v$$', { v: cyclic })).throws(/circular/);
        (0, expect_1.expect)((0, __1.template)('$$v$$', { v: [] })).equal('[]');
        (0, expect_1.expect)((0, __1.template)('$$v$$', { v: {} })).equal('{}');
    });
    // A replace value that is a FUNCTION used to have its return value put
    // into the output with no formatting at all, so an object arrived as
    // "[object Object]" and an array as its comma-joined elements - while the
    // same object reached through `$$path$$`, or supplied as a plain
    // (non-function) replacement, was JSONified. One value formatted two ways
    // depending on how it was supplied.
    //
    // Go cannot reproduce the JS coercion: a ReplaceFunc returns a string, so
    // there is nothing to inherit it from. Rather than teach the port to
    // imitate `[object Object]`, TS moved to its own JSON convention, which
    // is what `test/spec/template.tsv`'s template-object-value already pins
    // for the model path. See #40 and the list_item_macro parity snapshot.
    (0, node_test_1.test)('replace-function-jsonifies-objects', () => {
        const fn = (v) => () => v;
        (0, expect_1.expect)((0, __1.template)('x=[V]', {}, { replace: { '[V]': fn({ a: 1 }) } }))
            .equal('x={"a":1}');
        (0, expect_1.expect)((0, __1.template)('x=[V]', {}, { replace: { '[V]': fn([1, 2]) } }))
            .equal('x=[1,2]');
        // Keys sort, the same as every other JSONified value here.
        (0, expect_1.expect)((0, __1.template)('x=[V]', {}, { replace: { '[V]': fn({ b: 1, a: 2 }) } }))
            .equal('x={"a":2,"b":1}');
        // Scalars are untouched by the change.
        (0, expect_1.expect)((0, __1.template)('x=[V]', {}, { replace: { '[V]': fn('S') } })).equal('x=S');
        (0, expect_1.expect)((0, __1.template)('x=[V]', {}, { replace: { '[V]': fn(42) } })).equal('x=42');
        (0, expect_1.expect)((0, __1.template)('x=[V]', {}, { replace: { '[V]': fn(true) } }))
            .equal('x=true');
        // A function returning nothing yields the empty string - it does NOT
        // pick up the leave-in-place branch that an unresolved `$$path$$` has.
        // That asymmetry is the documented `{item.path}` contract and predates
        // this change.
        (0, expect_1.expect)((0, __1.template)('x=[V]', {}, { replace: { '[V]': fn(undefined) } }))
            .equal('x=');
        (0, expect_1.expect)((0, __1.template)('x=[V]', {}, { replace: { '[V]': fn(null) } })).equal('x=');
        (0, expect_1.expect)((0, __1.template)('x=$$nope$$', {})).equal('x=$$nope$$');
    });
});
//# sourceMappingURL=template.test.js.map