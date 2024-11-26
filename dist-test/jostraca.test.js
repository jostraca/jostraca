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
    (0, node_test_1.test)('content', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)();
        const info = await jostraca.generate({ fs, folder: '/top' }, () => {
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
            '/tmp/zed.txt': 'ZED <[SLOT]> \n',
            '/tmp/qaz.txt': 'QAZ <[SLOT:alice]> - <[SLOT:bob]> \n',
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
                (0, __1.File)({ name: 'bar.js' }, () => {
                    (0, __1.Fragment)({ from: '/tmp/zed.txt' }, () => {
                        (0, __1.Content)('red');
                    });
                });
                (0, __1.File)({ name: 'qaz.js' }, () => {
                    (0, __1.Fragment)({ from: '/tmp/qaz.txt' }, () => {
                        (0, __1.Content)({ name: 'bob' }, 'B');
                        (0, __1.Content)({ name: 'alice' }, 'ALICE');
                        (0, __1.Content)({ name: 'bob' }, 'OB');
                    });
                });
            });
        }));
        const voljson = vol.toJSON();
        (0, code_1.expect)(voljson).equal({
            '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
            '/tmp/foo.txt': 'FOO\n',
            '/tmp/bar.txt': 'BAR\n',
            '/tmp/zed.txt': 'ZED <[SLOT]> \n',
            '/top/sdk/bar.js': 'ZED red \n',
            '/tmp/qaz.txt': 'QAZ <[SLOT:alice]> - <[SLOT:bob]> \n',
            '/top/sdk/qaz.js': 'QAZ ALICE - BOB \n',
            '/top/sdk/foo.js': '// custom-foo\nFOO\n  BAR\n// END\n',
        });
    });
    (0, node_test_1.test)('inject', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({
            '/top/foo.txt': 'FOO\n#--START--#\nBAR\n#--END--#\nZED',
        });
        const jostraca = (0, __1.Jostraca)();
        const info = await jostraca.generate({ fs, folder: '/top' }, (0, __1.cmp)((props) => {
            props.ctx$.model = {};
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
});
//# sourceMappingURL=jostraca.test.js.map