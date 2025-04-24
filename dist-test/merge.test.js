"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const memfs_1 = require("memfs");
const __1 = require("../");
const START_TIME = 1735689600000;
(0, node_test_1.describe)('merge', () => {
    (0, node_test_1.test)('basic', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const jostraca = (0, __1.Jostraca)({ now });
        const root = () => (0, __1.Project)({ folder: 'sdk' }, (props) => {
            const m = props.ctx$.model;
            (0, __1.Folder)({ name: 'js' }, () => {
                (0, __1.File)({ name: 'foo.js' }, () => {
                    (0, __1.Content)('// custom-foo:' + m.a + '\n// FOO\n');
                });
                (0, __1.File)({ name: 'bar.js' }, () => {
                    let extra = '';
                    if (1 === m.a) {
                        extra = '// EXTRA1';
                    }
                    (0, __1.Content)('// custom-bar\n// BAR\n' + extra);
                });
            });
            (0, __1.Folder)({ name: 'go' }, () => {
                (0, __1.File)({ name: 'zed.go' }, () => {
                    let extra = '';
                    if (1 === m.a) {
                        extra = '// EXTRA1';
                    }
                    (0, __1.Content)('// custom-zed:' + m.a + '\n' + extra);
                });
            });
        });
        const mfs = (0, memfs_1.memfs)({});
        const fs = mfs.fs;
        const vol = mfs.vol;
        const m0 = { a: 0 };
        const res0 = await jostraca.generate({ fs: () => fs, folder: '/top', model: m0 }, root);
        console.log('res0', res0, vol.toJSON());
        fs.appendFileSync('/top/sdk/js/foo.js', '// added1\n', { encoding: 'utf8' });
        fs.appendFileSync('/top/sdk/js/bar.js', '// added1\n', { encoding: 'utf8' });
        console.log('ADD1', vol.toJSON());
        const m1 = { a: 1 };
        const res1 = await jostraca.generate({
            fs: () => fs, folder: '/top', model: m1,
            existing: { txt: { merge: true } }
        }, root);
        console.log('res1', res1, vol.toJSON());
    });
});
//# sourceMappingURL=merge.test.js.map