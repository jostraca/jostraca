"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const expect_1 = require("./expect");
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
        (0, expect_1.expect)(res0).includes({
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
        (0, expect_1.expect)(res1).includes({
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
        (0, expect_1.expect)({ ...res0.vol().toJSON() }).equal(res1.vol().toJSON());
    });
    // A GLOBAL `control` setting used to be discarded. OptionsShape declared
    // dryrun/duplicate/version as literal defaults, so shape injected them into
    // every per-call options object -- including an empty one -- and the merge
    // `deep({}, gOpts.control, opts.control)` then let the injected default beat
    // the global. A global `dryrun: true` therefore wrote the user's files, byte
    // for byte identical to no dry run at all. See docs/design/PARITY_PLAN.md 1.1.
    (0, node_test_1.describe)('global-control-precedence', () => {
        const root = () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('SECRET'));
        });
        const gen = async (gopts, opts) => {
            const j = (0, __1.Jostraca)({ mem: true, now: () => START_TIME, ...gopts });
            const res = await j.generate({ folder: '/out', ...opts }, root);
            return Object.keys(res.vol().toJSON()).sort();
        };
        const ALL = [
            '/out/.jostraca/.gitignore',
            '/out/.jostraca/generated/a.txt',
            '/out/.jostraca/jostraca.meta.log',
            '/out/a.txt',
        ];
        (0, node_test_1.test)('global-dryrun-writes-nothing', async () => {
            (0, expect_1.expect)(await gen({ control: { dryrun: true } }, {})).equal([]);
        });
        (0, node_test_1.test)('per-call-dryrun-writes-nothing', async () => {
            (0, expect_1.expect)(await gen({}, { control: { dryrun: true } })).equal([]);
        });
        (0, node_test_1.test)('per-call-overrides-global', async () => {
            // Precedence is defaults < global < per-call, so an explicit per-call
            // `false` still wins over a global `true`.
            (0, expect_1.expect)(await gen({ control: { dryrun: true } }, { control: { dryrun: false } }))
                .equal(ALL);
        });
        (0, node_test_1.test)('no-control-writes-everything', async () => {
            (0, expect_1.expect)(await gen({}, {})).equal(ALL);
        });
        (0, node_test_1.test)('global-duplicate-false-skips-baseline', async () => {
            (0, expect_1.expect)(await gen({ control: { duplicate: false } }, {}))
                .equal(ALL.filter((p) => !p.includes('/generated/')));
        });
        (0, node_test_1.test)('global-version-true-skips-gitignore', async () => {
            (0, expect_1.expect)(await gen({ control: { version: true } }, {}))
                .equal(ALL.filter((p) => !p.endsWith('.gitignore')));
        });
    });
});
//# sourceMappingURL=control.test.js.map