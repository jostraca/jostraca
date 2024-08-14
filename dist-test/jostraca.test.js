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
    (0, node_test_1.test)('copy', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({
            '/tm/bar.txt': '// BAR TXT\n'
        });
        const jostraca = (0, __1.Jostraca)();
        jostraca.generate({ fs, folder: '/top' }, () => (0, __1.Project)({}, () => {
            (0, __1.Folder)({ name: 'js' }, () => {
                (0, __1.File)({ name: 'foo.js' }, () => {
                    (0, __1.Code)('// custom-foo\n');
                });
                (0, __1.Copy)({ from: '/tm/bar.txt', name: 'bar.txt' });
            });
        }));
        // console.dir(vol.toJSON(), { depth: null })
        (0, code_1.expect)(vol.toJSON()).equal({
            '/tm/bar.txt': '// BAR TXT\n',
            '/top/js/foo.js': '// custom-foo\n',
            '/top/js/bar.txt': '// BAR TXT\n',
        });
    });
    (0, node_test_1.test)('each', () => {
        (0, code_1.expect)((0, __1.each)()).equal([]);
        (0, code_1.expect)((0, __1.each)(null)).equal([]);
        (0, code_1.expect)((0, __1.each)(1)).equal([]);
        (0, code_1.expect)((0, __1.each)([1])).equal([1]);
        (0, code_1.expect)((0, __1.each)(['b', 'a'])).equal(['a', 'b']);
        (0, code_1.expect)((0, __1.each)([1], (x) => 2 * x)).equal([2]);
        (0, code_1.expect)((0, __1.each)({})).equal([]);
        (0, code_1.expect)((0, __1.each)({ a: 1 })).equal([{ name: 'a', 'key$': 'a', 'val$': 1 }]);
        (0, code_1.expect)((0, __1.each)({ b: 22, c: 11, a: 33 })).equal([
            { name: 'a', 'key$': 'a', 'val$': 33 },
            { name: 'b', 'key$': 'b', 'val$': 22 },
            { name: 'c', 'key$': 'c', 'val$': 11 },
        ]);
        (0, code_1.expect)((0, __1.each)({ b: 22, c: 11, a: 33 }, (v, n, i) => n + '-' + i + '-' + JSON.stringify(v)))
            .equal([
            'a-0-{"name":"a","key$":"a","val$":33}',
            'b-1-{"name":"b","key$":"b","val$":22}',
            'c-2-{"name":"c","key$":"c","val$":11}'
        ]);
    });
});
//# sourceMappingURL=jostraca.test.js.map