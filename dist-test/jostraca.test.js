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
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, () => (0, __1.Project)({ folder: 'sdk' }, () => {
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
    (0, node_test_1.test)('content', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)();
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, () => {
            (0, __1.Folder)({}, () => {
                (0, __1.File)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('A');
                });
            });
        });
        // console.log('INFO', info)
        const voljson = vol.toJSON();
        (0, code_1.expect)(JSON.parse(voljson['/top/.jostraca/jostraca.json.log']).exclude).equal([]);
        (0, code_1.expect)(voljson).equal({
            '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
            '/top/foo.txt': 'A',
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
        const jostraca = (0, __1.Jostraca)({
            model: { x: { y: 'Y', z: 'Z' } }
        });
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((props) => {
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
    (0, node_test_1.test)('fragment-basic', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({
            '/tmp/foo.txt': 'FOO\n',
            '/tmp/bar.txt': 'BAR\n',
            '/tmp/zed.txt': 'ZED+<[SLOT]> \n',
            '/tmp/qaz.txt': 'QAZ+<!--<[SLOT]>-->+// <[SLOT:alice]>+/* <[SLOT:bob]> */+ # <[SLOT:bob]>\n',
        });
        const jostraca = (0, __1.Jostraca)();
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((props) => {
            (0, __1.Project)({ folder: 'sdk' }, () => {
                (0, __1.File)({ name: 'foo.js' }, () => {
                    (0, __1.Content)('// custom-foo\n');
                    (0, __1.Fragment)({ from: '/tmp/foo.txt' });
                    (0, __1.Fragment)({ from: '/tmp/bar.txt', indent: '  ' });
                    (0, __1.Content)('// END\n');
                });
                (0, __1.File)({ name: 'bar.js' }, () => {
                    (0, __1.Fragment)({ from: '/tmp/zed.txt' }, () => {
                        (0, __1.Content)('red');
                    });
                });
                (0, __1.File)({ name: 'qaz.js' }, () => {
                    (0, __1.Fragment)({ from: '/tmp/qaz.txt' }, () => {
                        (0, __1.Content)('A');
                        (0, __1.Slot)({ name: 'bob' }, () => {
                            (0, __1.Content)('B');
                            (0, __1.Content)('OB');
                        });
                        (0, __1.Content)('B');
                        (0, __1.Slot)({ name: 'alice' }, () => {
                            (0, __1.Content)('ALICE');
                        });
                        (0, __1.Content)('C');
                    });
                });
            });
        }));
        // console.dir(info.root, { depth: null })
        const voljson = vol.toJSON();
        (0, code_1.expect)(voljson).equal({
            '/tmp/foo.txt': 'FOO\n',
            '/tmp/bar.txt': 'BAR\n',
            '/tmp/zed.txt': 'ZED+<[SLOT]> \n',
            '/tmp/qaz.txt': 'QAZ+<!--<[SLOT]>-->+// <[SLOT:alice]>+/* <[SLOT:bob]> */+ # <[SLOT:bob]>\n',
            '/top/sdk/bar.js': 'ZED+red\n',
            '/top/sdk/qaz.js': 'QAZ+ABC+ALICE+BOB+BOB\n',
            '/top/sdk/foo.js': '// custom-foo\nFOO\n  BAR\n// END\n',
            '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
        });
    });
    (0, node_test_1.test)('inject', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({
            '/top/foo.txt': 'FOO\n#--START--#\nBAR\n#--END--#\nZED',
        });
        const jostraca = (0, __1.Jostraca)();
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((props) => {
            (0, __1.Project)({}, () => {
                (0, __1.Inject)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('QAZ');
                });
            });
        }));
        const voljson = vol.toJSON();
        (0, code_1.expect)(voljson).equal({
            '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
            '/top/foo.txt': 'FOO\n#--START--#\nQAZ\n#--END--#\nZED',
        });
    });
    (0, node_test_1.test)('line', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)();
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((props) => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('ONE\n');
                    (0, __1.Line)('TWO');
                    (0, __1.Content)('THREE\n');
                });
            });
        }));
        const voljson = vol.toJSON();
        (0, code_1.expect)(voljson).equal({
            '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
            '/top/foo.txt': 'ONE\nTWO\nTHREE\n',
        });
    });
    (0, node_test_1.test)('fragment-subcmp', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({
            '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n'
        });
        const Foo = (0, __1.cmp)(function Foo(props) {
            (0, __1.Content)('FOO[');
            (0, __1.Content)(props.arg);
            (0, __1.Content)(']');
        });
        const jostraca = (0, __1.Jostraca)({
            model: { a: 'A' }
        });
        const info = await jostraca.generate({
            fs: () => fs, folder: '/top',
            // build: false
        }, (0, __1.cmp)((props) => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('ONE\n');
                    (0, __1.Fragment)({
                        from: '/f01.txt', replace: {
                            bar: 'BAR',
                            zed: () => 'ZED',
                            con: () => (0, __1.Content)('CON'),
                            foo: () => Foo('B')
                        }
                    }, () => {
                        (0, __1.Content)('S');
                    });
                    (0, __1.Content)('THREE\n');
                });
            });
        }));
        // console.dir(info.root, { depth: null })
        const voljson = vol.toJSON();
        (0, code_1.expect)(voljson).equal({
            '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
            '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n',
            '/top/foo.txt': 'ONE\nTWO-A-BAR-ZED-CON-FOO[B]+S\nTHREE\n',
        });
    });
    (0, node_test_1.test)('custom-cmp', async () => {
        const Foo = (0, __1.cmp)(function Foo(props, children) {
            const { ctx$: { model } } = props;
            (0, __1.Content)(`FOO[$$a$$:${props.b}`);
            (0, __1.each)(model.foo, (foo) => (0, __1.each)(children, { call: true, args: foo }));
            (0, __1.Content)(']');
        });
        const jostraca = (0, __1.Jostraca)({
            model: {
                a: 'A', foo: {
                    a: { x: 11 },
                    b: { x: 22 }
                }
            },
            mem: true,
            vol: {
                '/f01.txt': '<foo>'
            }
        });
        const info = await jostraca.generate({ folder: '/' }, (0, __1.cmp)(() => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('{');
                    (0, __1.Fragment)({
                        from: '/f01.txt',
                        replace: {
                            foo: () => Foo({ b: 'B' }, (foo) => {
                                (0, __1.Content)(`:${foo.key$}=(`);
                                (0, __1.Content)(`${foo.x}`);
                                (0, __1.Content)(')');
                            })
                        }
                    });
                    (0, __1.Content)('}');
                });
            });
        }));
        // console.dir(info.root, { depth: null })
        const voljson = info.vol.toJSON();
        (0, code_1.expect)(voljson).equal({
            '/f01.txt': '<foo>',
            '/foo.txt': '{<FOO[A:B:a=(11):b=(22)]>}',
            '/.jostraca/jostraca.json.log': voljson['/.jostraca/jostraca.json.log'],
        });
    });
});
//# sourceMappingURL=jostraca.test.js.map