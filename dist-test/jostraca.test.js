"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const code_1 = require("@hapi/code");
const memfs_1 = require("memfs");
const __1 = require("../");
(0, node_test_1.describe)('jostraca', () => {
    (0, node_test_1.test)('happy', async () => {
        (0, code_1.expect)(__1.Jostraca).exist();
        const jostraca = (0, __1.Jostraca)();
        (0, code_1.expect)(jostraca).exist();
        const { fs, vol } = (0, memfs_1.memfs)({});
        const info = await jostraca.generate({ fs, folder: '/top' }, () => (0, __1.Project)({ folder: 'sdk' }, () => {
            (0, __1.Folder)({ name: 'js' }, () => {
                (0, __1.File)({ name: 'foo.js' }, () => {
                    (0, __1.Content)('// custom-foo\n');
                });
                (0, __1.File)({ name: 'bar.js' }, () => {
                    (0, __1.Content)('// custom-bar\n');
                });
            });
            (0, __1.Folder)({ name: 'go' }, () => {
                (0, __1.File)({ name: 'zed.go' }, () => {
                    (0, __1.Content)('// custom-zed\n');
                });
            });
        }));
        // console.log('INFO', info)
        const voljson = vol.toJSON();
        (0, code_1.expect)(JSON.parse(voljson['/top/.jostraca/jostraca.json.log']).exclude).equal([]);
        (0, code_1.expect)(voljson).equal({
            '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
            '/top/sdk/js/foo.js': '// custom-foo\n',
            '/top/sdk/js/bar.js': '// custom-bar\n',
            '/top/sdk/go/zed.go': '// custom-zed\n'
        });
    });
    (0, node_test_1.test)('copy', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({
            '/tm/bar.txt': '// BAR $$x.z$$ TXT\n',
            '/tm/bar.txt~': '// BAR TXT\n',
            '/tm/sub/a.txt': '// SUB-A $$x.y$$ TXT\n',
            '/tm/sub/b.txt': '// SUB-B $$x.y$$ TXT\n',
            '/tm/sub/c/d.txt': '// SUB-C-D $$x.y$$ $$x.z$$ TXT\n',
        });
        const jostraca = (0, __1.Jostraca)();
        const info = await jostraca.generate({ fs, folder: '/top' }, (0, __1.cmp)((props) => {
            props.ctx$.model = {
                x: { y: 'Y', z: 'Z' }
            };
            (0, __1.Project)({ folder: 'sdk' }, () => {
                (0, __1.Folder)({ name: 'js' }, () => {
                    (0, __1.File)({ name: 'foo.js' }, () => {
                        (0, __1.Content)('// custom-foo\n');
                    });
                    (0, __1.Copy)({ from: '/tm/bar.txt', name: 'bar.txt' });
                    (0, __1.Copy)({ from: '/tm/sub' });
                });
            });
        }));
        const voljson = vol.toJSON();
        (0, code_1.expect)(JSON.parse(voljson['/top/.jostraca/jostraca.json.log']).exclude).equal([]);
        (0, code_1.expect)(voljson).equal({
            '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
            '/tm/bar.txt': '// BAR $$x.z$$ TXT\n',
            '/tm/bar.txt~': '// BAR TXT\n',
            '/tm/sub/a.txt': '// SUB-A $$x.y$$ TXT\n',
            '/tm/sub/b.txt': '// SUB-B $$x.y$$ TXT\n',
            '/tm/sub/c/d.txt': '// SUB-C-D $$x.y$$ $$x.z$$ TXT\n',
            '/top/sdk/js/foo.js': '// custom-foo\n',
            '/top/sdk/js/bar.txt': '// BAR Z TXT\n',
            '/top/sdk/js/a.txt': '// SUB-A Y TXT\n',
            '/top/sdk/js/b.txt': '// SUB-B Y TXT\n',
            '/top/sdk/js/c/d.txt': '// SUB-C-D Y Z TXT\n',
        });
    });
    (0, node_test_1.test)('fragment', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({
            '/tmp/foo.txt': 'FOO\n',
            '/tmp/bar.txt': 'BAR\n',
        });
        const jostraca = (0, __1.Jostraca)();
        const info = await jostraca.generate({ fs, folder: '/top' }, (0, __1.cmp)((props) => {
            props.ctx$.model = {};
            (0, __1.Project)({ folder: 'sdk' }, () => {
                (0, __1.File)({ name: 'foo.js' }, () => {
                    (0, __1.Content)('// custom-foo\n');
                    (0, __1.Fragment)({ from: '/tmp/foo.txt' });
                    (0, __1.Fragment)({ from: '/tmp/bar.txt', indent: '  ' });
                    (0, __1.Content)('// END\n');
                });
            });
        }));
        const voljson = vol.toJSON();
        (0, code_1.expect)(voljson).equal({
            '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
            '/tmp/foo.txt': 'FOO\n',
            '/tmp/bar.txt': 'BAR\n',
            '/top/sdk/foo.js': '// custom-foo\nFOO\n  BAR\n// END\n',
        });
    });
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
});
//# sourceMappingURL=jostraca.test.js.map