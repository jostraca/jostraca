"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const code_1 = require("@hapi/code");
const memfs_1 = require("memfs");
const __1 = require("../");
const META_FOLDER = '.jostraca';
const META_FILE = 'jostraca.meta.log';
const TOP_META = '/top/' + META_FOLDER + '/' + META_FILE;
// 2025-01-01T00:00:00.000Z
const START_TIME = 1735689600000;
(0, node_test_1.describe)('jostraca', () => {
    (0, node_test_1.test)('happy', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        (0, code_1.expect)(__1.Jostraca).exist();
        const jostraca = (0, __1.Jostraca)({ now });
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
        (0, code_1.expect)(info).equal({
            when: 1735689660000,
            files: {
                preserved: [],
                written: [
                    '/top/sdk/js/foo.js',
                    '/top/sdk/js/bar.js',
                    '/top/sdk/go/zed.go'
                ],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, code_1.expect)(JSON.parse(voljson[TOP_META]).last > START_TIME).true();
        (0, code_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/top/sdk/js/foo.js': '// custom-foo\n',
            '/top/sdk/js/bar.js': '// custom-bar\n',
            '/top/sdk/go/zed.go': '// custom-zed\n'
        });
    });
    (0, node_test_1.test)('content', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)({ now });
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, () => {
            (0, __1.Folder)({}, () => {
                (0, __1.File)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('A');
                });
            });
        });
        (0, code_1.expect)(info).equal({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/top/foo.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, code_1.expect)(JSON.parse(voljson[TOP_META]).last > 0).true();
        (0, code_1.expect)(voljson).equal({
            '/top/foo.txt': 'A',
            '/top/.jostraca/generated/foo.txt': 'A',
            '/top/.jostraca/jostraca.meta.log': '{\n' +
                '  "foldername": ".jostraca",\n' +
                '  "filename": "jostraca.meta.log",\n' +
                '  "last": 1735689900000,\n' +
                '  "hlast": 2025010100050000,\n' +
                '  "files": {\n' +
                '    "foo.txt": {\n' +
                '      "action": "write",\n' +
                '      "path": "foo.txt",\n' +
                '      "exists": false,\n' +
                '      "actions": [\n' +
                '        "write"\n' +
                '      ],\n' +
                '      "protect": false,\n' +
                '      "conflict": false,\n' +
                '      "when": 1735689840000,\n' +
                '      "hwhen": 2025010100040000\n' +
                '    }\n' +
                '  }\n' +
                '}',
            '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
        });
    });
    (0, node_test_1.test)('basic-copy', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/tm/bar.txt': '// BAR $$x.z$$ TXT\n',
            '/tm/bar.txt~': '// BAR TXT\n',
            '/tm/sub/a.txt': '// SUB-A $$x.y$$ TXT\n',
            '/tm/sub/b.txt': '// SUB-B $$x.y$$ TXT\n',
            '/tm/sub/c/d.txt': '// SUB-C-D $$x.y$$ $$x.z$$ TXT\n',
        });
        const jostraca = (0, __1.Jostraca)({
            now,
            model: { x: { y: 'Y', z: 'Z' } }
        });
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({ folder: 'sdk' }, () => {
                (0, __1.Folder)({ name: 'js' }, () => {
                    (0, __1.File)({ name: 'foo.js' }, () => {
                        (0, __1.Content)('// custom-foo\n');
                    });
                    (0, __1.Copy)({ from: '/tm/bar.txt', to: 'bar.txt' });
                    (0, __1.Copy)({ from: '/tm/sub' });
                });
            });
        }));
        (0, code_1.expect)(info).equal({
            when: 1735689660000,
            files: {
                preserved: [],
                written: [
                    '/top/sdk/js/foo.js',
                    '/top/sdk/js/bar.txt',
                    '/top/sdk/js/a.txt',
                    '/top/sdk/js/b.txt',
                    '/top/sdk/js/c/d.txt'
                ],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, code_1.expect)(JSON.parse(voljson[TOP_META]).last > 0).true();
        (0, code_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
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
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/tmp/foo.txt': 'FOO\n',
            '/tmp/bar.txt': 'BAR\n',
            '/tmp/zed.txt': 'ZED+<[SLOT]> \n',
            '/tmp/qaz.txt': 'QAZ+<!--<[SLOT]>-->+// <[SLOT:alice]>+/* <[SLOT:bob]> */+ # <[SLOT:bob]>\n',
        });
        const jostraca = (0, __1.Jostraca)({ now });
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
        (0, code_1.expect)(info).equal({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/top/sdk/foo.js', '/top/sdk/bar.js', '/top/sdk/qaz.js'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, code_1.expect)(voljson).includes({
            '/tmp/foo.txt': 'FOO\n',
            '/tmp/bar.txt': 'BAR\n',
            '/tmp/zed.txt': 'ZED+<[SLOT]> \n',
            '/tmp/qaz.txt': 'QAZ+<!--<[SLOT]>-->+// <[SLOT:alice]>+/* <[SLOT:bob]> */+ # <[SLOT:bob]>\n',
            '/top/sdk/bar.js': 'ZED+red\n',
            '/top/sdk/qaz.js': 'QAZ+ABC+ALICE+BOB+BOB\n',
            '/top/sdk/foo.js': '// custom-foo\nFOO\n  BAR\n// END\n',
            [TOP_META]: voljson[TOP_META],
        });
    });
    (0, node_test_1.test)('inject', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/top/foo.txt': 'FOO\n#--START--#\nBAR\n#--END--#\nZED',
        });
        const jostraca = (0, __1.Jostraca)({ now });
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({}, () => {
                (0, __1.Inject)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('QAZ');
                });
            });
        }));
        (0, code_1.expect)(info).equal({
            when: 1735689660000,
            files: {
                preserved: [],
                written: [],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, code_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/top/foo.txt': 'FOO\n#--START--#\nQAZ\n#--END--#\nZED',
        });
    });
    (0, node_test_1.test)('line', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)({ now });
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('ONE\n');
                    (0, __1.Line)('TWO');
                    (0, __1.Content)('THREE\n');
                });
            });
        }));
        (0, code_1.expect)(info).equal({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/top/foo.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, code_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/top/foo.txt': 'ONE\nTWO\nTHREE\n',
        });
    });
    (0, node_test_1.test)('fragment-subcmp', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n'
        });
        const Foo = (0, __1.cmp)(function Foo(props) {
            (0, __1.Content)('FOO[');
            (0, __1.Content)(props.arg);
            (0, __1.Content)(']');
        });
        const jostraca = (0, __1.Jostraca)({
            now,
            model: { a: 'A' }
        });
        const info = await jostraca.generate({
            fs: () => fs, folder: '/top',
            // build: false
        }, (0, __1.cmp)((_props) => {
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
        (0, code_1.expect)(info).equal({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/top/foo.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, code_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n',
            '/top/foo.txt': 'ONE\nTWO-A-BAR-ZED-CON-FOO[B]+S\nTHREE\n',
        });
    });
    (0, node_test_1.test)('custom-cmp', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const Foo = (0, __1.cmp)(function Foo(props, children) {
            const { ctx$: { model } } = props;
            (0, __1.Content)(`FOO[$$a$$:${props.b}`);
            (0, __1.each)(model.foo, (foo) => (0, __1.each)(children, { call: true, args: foo }));
            (0, __1.Content)(']');
        });
        const jostraca = (0, __1.Jostraca)({
            now,
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
        (0, code_1.expect)(info).includes({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/foo.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            },
        });
        const voljson = info.vol().toJSON();
        (0, code_1.expect)(voljson).includes({
            '/f01.txt': '<foo>',
            '/foo.txt': '{<FOO[A:B:a=(11):b=(22)]>}',
            ['/' + META_FOLDER + '/' + META_FILE]: voljson['/' + META_FOLDER + '/' + META_FILE],
        });
    });
    (0, node_test_1.test)('existing-file', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const jostraca = (0, __1.Jostraca)({
            now,
            mem: true,
            vol: {
                '/f01.txt': 'a0',
                '/h01.txt': 'c0',
            }
        });
        const info0 = await jostraca.generate({ folder: '/', existing: { txt: { write: false } } }, (0, __1.cmp)(() => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'f01.txt' }, () => {
                    (0, __1.Content)('a1');
                });
                (0, __1.File)({ name: 'g01.txt' }, () => {
                    (0, __1.Content)('b1');
                });
            });
        }));
        (0, code_1.expect)(info0).includes({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/g01.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            },
        });
        const voljson0 = info0.vol().toJSON();
        (0, code_1.expect)(voljson0).includes({
            '/f01.txt': 'a0',
            '/g01.txt': 'b1',
            '/h01.txt': 'c0',
            ['/' + META_FOLDER + '/' + META_FILE]: voljson0['/' + META_FOLDER + '/' + META_FILE],
        });
        const info1 = await jostraca.generate({ folder: '/', existing: { txt: { preserve: true } } }, (0, __1.cmp)(() => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'f01.txt' }, () => {
                    (0, __1.Content)('a1');
                });
                (0, __1.File)({ name: 'h01.txt' }, () => {
                    (0, __1.Content)('c0');
                });
            });
        }));
        (0, code_1.expect)(info1).includes({
            when: 1735690260000,
            files: {
                preserved: ['/f01.txt'],
                written: ['/f01.txt', '/h01.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            },
        });
        const voljson1 = info1.vol().toJSON();
        (0, code_1.expect)(voljson1).includes({
            '/f01.txt': 'a1',
            '/f01.old.txt': 'a0',
            '/h01.txt': 'c0',
            ['/' + META_FOLDER + '/' + META_FILE]: voljson1['/' + META_FOLDER + '/' + META_FILE],
        });
        const info2 = await jostraca.generate({ folder: '/', existing: { txt: { write: false, present: true } } }, (0, __1.cmp)(() => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'f01.txt' }, () => {
                    (0, __1.Content)('a1');
                });
            });
        }));
        (0, code_1.expect)(info2).includes({
            when: 1735691100000,
            files: {
                preserved: [],
                written: [],
                presented: ['/f01.txt'],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            },
        });
        const voljson2 = info2.vol().toJSON();
        (0, code_1.expect)(voljson2).includes({
            '/f01.txt': 'a0',
            '/f01.new.txt': 'a1',
            '/h01.txt': 'c0',
            ['/' + META_FOLDER + '/' + META_FILE]: voljson2['/' + META_FOLDER + '/' + META_FILE],
        });
    });
    (0, node_test_1.test)('existing-copy', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/top/tm0/foo.txt': 'F0\nF1\nF2\n',
            '/top/tm0/bar.txt': 'B0\nB1\nB2\n',
            '/top/tm1/zed.txt': 'Z0\nZ1\nZ2\n',
            '/top/tm2/qaz.bin': Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]),
            '/top/tm2/haz.bin': Buffer.from([0x05, 0x06, 0x07, 0x08, 0x09]),
            '/top/p0/bar.txt': 'B0\nB8\nB9\n',
            '/top/p0/zed.txt': 'Z0\nZ7\nZ8\nZ9',
            '/top/p0/haz.bin': Buffer.from([0x09, 0x08, 0x07, 0x06, 0x05]),
        });
        const jostraca = (0, __1.Jostraca)({ now });
        const info = await jostraca.generate({
            fs: () => fs, folder: '/top',
            existing: { txt: { diff: true }, bin: { preserve: true } },
        }, (0, __1.cmp)(() => {
            (0, __1.Project)({ folder: 'p0' }, () => {
                (0, __1.Folder)({}, () => {
                    (0, __1.Copy)({ from: '/top/tm0' });
                    (0, __1.Copy)({ from: '/top/tm1/zed.txt' });
                    (0, __1.Copy)({ from: '/top/tm2' });
                });
            });
        }));
        (0, code_1.expect)(info.files).equal({
            preserved: ['/top/p0/haz.bin'],
            written: ['/top/p0/foo.txt', '/top/p0/haz.bin', '/top/p0/qaz.bin'],
            presented: [],
            diffed: ['/top/p0/bar.txt', '/top/p0/zed.txt'],
            merged: [],
            conflicted: ['/top/p0/bar.txt', '/top/p0/zed.txt'],
            unchanged: []
        });
        const voljson = vol.toJSON();
        (0, code_1.expect)(JSON.parse(voljson[TOP_META]).last > 0).true();
        (0, code_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/top/tm0/foo.txt': 'F0\nF1\nF2\n',
            '/top/tm0/bar.txt': 'B0\nB1\nB2\n',
            '/top/tm1/zed.txt': 'Z0\nZ1\nZ2\n',
            '/top/tm2/haz.bin': '\x05\x06\x07\b\t',
            '/top/tm2/qaz.bin': '\x00\x01\x02\x03\x04',
            '/top/p0/bar.txt': 'B0\n' +
                '<<<<<<< EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
                'B8\n' +
                'B9\n' +
                '>>>>>>> EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
                '<<<<<<< GENERATED: 2025-01-01T00:01:00.000Z/diff\n' +
                'B1\n' +
                'B2\n' +
                '>>>>>>> GENERATED: 2025-01-01T00:01:00.000Z/diff\n',
            '/top/p0/zed.txt': 'Z0\n' +
                '<<<<<<< EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
                'Z7\n' +
                'Z8\n' +
                'Z9>>>>>>> EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
                '<<<<<<< GENERATED: 2025-01-01T00:01:00.000Z/diff\n' +
                'Z1\n' +
                'Z2\n' +
                '>>>>>>> GENERATED: 2025-01-01T00:01:00.000Z/diff\n',
            '/top/p0/haz.bin': '\x05\x06\x07\b\t',
            '/top/p0/foo.txt': 'F0\nF1\nF2\n',
            '/top/p0/haz.old.bin': '\t\b\x07\x06\x05',
            '/top/p0/qaz.bin': '\x00\x01\x02\x03\x04',
            '/top/.jostraca/generated/p0/foo.txt': 'F0\nF1\nF2\n',
            '/top/.jostraca/generated/p0/bar.txt': 'B0\nB1\nB2\n',
            '/top/.jostraca/generated/p0/zed.txt': 'Z0\nZ1\nZ2\n',
            '/top/.jostraca/generated/p0/haz.bin': '\x05\x06\x07\b\t',
            '/top/.jostraca/generated/p0/qaz.bin': '\x00\x01\x02\x03\x04',
        });
    });
    (0, node_test_1.test)('protect', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/top/t0/p0/foo.txt': 'FOO new',
            '/top/t0/p0/bar.txt': 'BAR new',
            '/top/t0/p1/z0.txt': 'z0 new',
            '/top/t0/p1/z1.txt': 'z1 new',
            '/top/s0/p0/foo.txt': 'foo old # JOSTRACA_PROTECT',
            '/top/s0/p0/bar.txt': 'bar old',
            '/top/s0/p1/z0.txt': 'z0 old',
            '/top/s0/p1/z1.txt': 'z1 old # JOSTRACA_PROTECT',
        });
        const jostraca = (0, __1.Jostraca)({ now });
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({ folder: 's0' }, () => {
                (0, __1.Folder)({ name: 'p0' }, () => {
                    (0, __1.File)({ name: 'foo.txt' }, () => {
                        (0, __1.Content)('FOO new');
                    });
                    (0, __1.File)({ name: 'bar.txt' }, () => {
                        (0, __1.Content)('BAR new');
                    });
                });
                (0, __1.Copy)({ from: '/top/t0' });
            });
        }));
        (0, code_1.expect)(info).equal({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/top/s0/p0/bar.txt', '/top/s0/p0/bar.txt', '/top/s0/p1/z0.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, code_1.expect)(JSON.parse(voljson[TOP_META]).last > 0).true();
        (0, code_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/top/t0/p0/foo.txt': 'FOO new',
            '/top/t0/p0/bar.txt': 'BAR new',
            '/top/t0/p1/z0.txt': 'z0 new',
            '/top/t0/p1/z1.txt': 'z1 new',
            '/top/s0/p0/foo.txt': 'foo old # JOSTRACA_PROTECT',
            '/top/s0/p0/bar.txt': 'BAR new',
            '/top/s0/p1/z0.txt': 'z0 new',
            '/top/s0/p1/z1.txt': 'z1 old # JOSTRACA_PROTECT'
        });
    });
});
//# sourceMappingURL=jostraca.test.js.map