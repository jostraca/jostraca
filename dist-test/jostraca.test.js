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
        jostraca.generate({ fs, folder: '/top' }, () => (0, __1.Project)({}, () => {
            (0, __1.Folder)({ name: 'js' }, () => {
                (0, __1.File)({ name: 'foo.js' }, () => {
                    (0, __1.Code)('// custom-foo\n');
                });
                (0, __1.File)({ name: 'bar.js' }, () => {
                    (0, __1.Code)('// custom-bar\n');
                });
            });
            (0, __1.Folder)({ name: 'go' }, () => {
                (0, __1.File)({ name: 'zed.go' }, () => {
                    (0, __1.Code)('// custom-zed\n');
                });
            });
        }));
        // console.dir(vol.toJSON(), { depth: null })
        (0, code_1.expect)(vol.toJSON()).equal({
            '/top/js/foo.js': '// custom-foo\n',
            '/top/js/bar.js': '// custom-bar\n',
            '/top/go/zed.go': '// custom-zed\n'
        });
    });
});
//# sourceMappingURL=jostraca.test.js.map