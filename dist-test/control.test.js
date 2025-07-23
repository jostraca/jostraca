"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const code_1 = require("@hapi/code");
const __1 = require("../");
const START_TIME = 1735689600000;
(0, node_test_1.describe)('control', () => {
    (0, node_test_1.test)('dryrun', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const root = () => (0, __1.Project)({}, (props) => {
            const m = props.ctx$.model;
            (0, __1.Folder)({ name: 'x' }, () => {
                (0, __1.File)({ name: 'a' }, () => {
                    (0, __1.Content)('A' + m.a);
                });
                (0, __1.File)({ name: 'b' }, () => {
                    (0, __1.Content)('B');
                });
                (0, __1.File)({ name: 'c' }, () => {
                    (0, __1.Content)('C' + m.c);
                });
                (0, __1.File)({ name: 'd' }, () => {
                    (0, __1.Content)('D' + m.d);
                });
                if (1 === m.a) {
                    (0, __1.File)({ name: 'e' }, () => {
                        (0, __1.Content)('E');
                    });
                }
            });
        });
        const m0 = { a: 0, c: 10, d: 20 };
        const j0 = (0, __1.Jostraca)({
            model: m0,
            now,
            mem: true,
            folder: '/',
            existing: { txt: { merge: true } }
        });
        const res0 = await j0.generate({}, root);
        //console.log(res0)
        // console.log(res0.vol().toJSON())
        (0, code_1.expect)(res0).includes({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/x/a', '/x/b', '/x/c', '/x/d'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            },
        });
        res0.fs().writeFileSync('/x/c', 'C0' + '!');
        res0.fs().writeFileSync('/x/d', 'D30');
        m0.a = 1;
        m0.d = 21;
        const res1 = await j0.generate({ control: { dryrun: true } }, root);
        // console.log(res1)
        // console.log(res1.vol().toJSON())
        (0, code_1.expect)(res1).includes({
            when: 1735690500000,
            files: {
                preserved: [],
                written: ['/x/e'],
                presented: [],
                diffed: [],
                merged: ['/x/a', '/x/c', '/x/d'],
                conflicted: ['/x/d'],
                unchanged: ['/x/b']
            },
        });
        (0, code_1.expect)({ ...res0.vol().toJSON() }).equal(res1.vol().toJSON());
    });
});
//# sourceMappingURL=control.test.js.map