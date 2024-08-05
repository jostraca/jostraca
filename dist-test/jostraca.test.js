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
        const { Project, Folder, File, Code } = jostraca;
        // console.log('QQQ', Project, jostraca)
        const { fs, vol } = (0, memfs_1.memfs)({});
        // console.log('MEMFS', fs, vol)
        // return;
        jostraca.generate({ fs, folder: '/top' }, () => Project({}, () => {
            Folder({ name: 'js' }, () => {
                File({ name: 'foo.js' }, () => {
                    Code('// custom-foo\n');
                });
                File({ name: 'bar.js' }, () => {
                    Code('// custom-bar\n');
                });
            });
            Folder({ name: 'go' }, () => {
                File({ name: 'zed.go' }, () => {
                    Code('// custom-zed\n');
                });
            });
        }));
        // console.dir(vol.toJSON(), { depth: null })
        (0, code_1.expect)(vol.toJSON()).equal({
            '/top/js/foo.js': '// FILE START: foo.js\n// custom-foo\n// FILE END: foo.js\n',
            '/top/js/bar.js': '// FILE START: bar.js\n// custom-bar\n// FILE END: bar.js\n',
            '/top/go/zed.go': '// FILE START: zed.go\n// custom-zed\n// FILE END: zed.go\n'
        });
    });
});
//# sourceMappingURL=jostraca.test.js.map