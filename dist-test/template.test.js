"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const code_1 = require("@hapi/code");
const __1 = require("../");
(0, node_test_1.describe)('utility-template', () => {
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
        (0, code_1.expect)((0, __1.template)('$$__JOSTRACA_REPLACE__$$', {}))
            .equal('/(?<J_O>\\$\\$)(?<J_R>[^$]+)(?<J_C>\\$\\$)/');
        (0, code_1.expect)((0, __1.template)('$$a$$', { a: '$$b$$' })).equal('$$b$$'); // NOPE - NOT A MACRO SYSTEM!
        (0, code_1.expect)((0, __1.template)('aQb', {}, { replace: { Q: 'Z' } })).equal('aZb');
        (0, code_1.expect)((0, __1.template)('aQQQb', {}, { replace: { '/Q+/': 'Z' } })).equal('aZb');
        (0, code_1.expect)(() => (0, __1.template)('aQQQb', {}, { replace: { '/Q*/': 'Z' } })).throws(/empty/);
        (0, code_1.expect)((0, __1.template)('aQbWc$$__JOSTRACA_REPLACE__$$', {}, { replace: { Q: 'Z', W: 'Y' } }))
            .equal('aZbYc/(?<J_O>\\$\\$)(?<J_R>[^$]+)(?<J_C>' +
            '\\$\\$)|(?<J_K1_Q>Q)|(?<J_K2_W>W)/');
        (0, code_1.expect)((0, __1.template)('aQb', {}, { replace: { Q: () => 'X' } })).equal('aXb');
        const m = { q: 'Q', w: 'W' };
        (0, code_1.expect)((0, __1.template)('a[q]b[w]c<x>;y', {}, {
            replace: {
                'a': 'A',
                '/\\[(?<cap>\\w)\\]/': ({ cap }) => m[cap],
                '/c<(?<mx>.)>;(?<my>.)/': ({ mx, my }) => mx.toUpperCase() + my.toUpperCase(),
                '/c<(?<nx>.)>;(?<ny>.)/': (_, match) => match.groups.nx.toUpperCase() + match.groups.ny.toUpperCase(),
            }
        })).equal('AQbWXY');
        (0, code_1.expect)((0, __1.template)('ab', {}, {
            replace: { '/(?<x>a)|(?<x>b)/': ({ x }) => x.toUpperCase() }
        })).equal('AB');
        // Tags
        (0, code_1.expect)((0, __1.template)('{\n//#Wax\n  //  #SeeSaw\n  // #Red-Bar\nAAA\n    //\t#GreenBlue-Zed \n}', {}, {
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
        (0, code_1.expect)((0, __1.template)('Name $$Name$$', {}, { replace: { Name: () => 'Foo' } }))
            .equal('Foo $$Name$$');
        // Escape format: $$"(.+)"$$
        (0, code_1.expect)((0, __1.template)('Name $$"Name"$$', {}, { replace: { Name: () => 'Foo' } }))
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
        (0, code_1.expect)((0, __1.template)(src0, m0, { eject: ['START', 'END'] })).equal('Q1\n');
        (0, code_1.expect)((0, __1.template)(src0, m0, { eject: [/START/, /END/] })).equal('  \nQ1\n  ');
    });
});
//# sourceMappingURL=template.test.js.map