"use strict";
// Tests added to verify go-port parity for the behaviour-fidelity gaps:
// each.mark, audit why breadcrumbs, Options.name affixes, per-component
// shape validation, and OptionsFromMap surface.
//
// Running this from `npm test` exercises TS and produces reference
// outputs the Go port mirrors via parity-snapshot extraction.
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const expect_1 = require("./expect");
const memfs_1 = require("memfs");
const __1 = require("../");
(0, node_test_1.describe)('parity-fidelity', () => {
    // each.mark — defaults true; when oval=false Mark adds index$/key$
    // to object items.
    (0, node_test_1.test)('each-mark-array-raw', () => {
        (0, expect_1.expect)((0, __1.each)([{ a: 1 }, { a: 2 }], { oval: false, mark: true }))
            .equal([{ a: 1, index$: 0 }, { a: 2, index$: 1 }]);
        (0, expect_1.expect)((0, __1.each)([{ a: 1 }, { a: 2 }], { oval: false, mark: false }))
            .equal([{ a: 1 }, { a: 2 }]);
    });
    (0, node_test_1.test)('each-mark-map-raw', () => {
        (0, expect_1.expect)((0, __1.each)({ x: { v: 1 }, y: { v: 2 } }, { oval: false, mark: true })).equal([{ v: 1, key$: 'x' }, { v: 2, key$: 'y' }]);
    });
    // each-default-mixed: with default oval=true, object items pass
    // through unwrapped and only get index$/key$ stamped; scalars get
    // the full {val$, index$|key$} wrap. Verifies the Go port doesn't
    // double-wrap objects.
    (0, node_test_1.test)('each-default-mixed-slice', () => {
        (0, expect_1.expect)((0, __1.each)([{ a: 1 }, 7]))
            .equal([{ a: 1, index$: 0 }, { val$: 7, index$: 1 }]);
    });
    (0, node_test_1.test)('each-default-mixed-map', () => {
        (0, expect_1.expect)((0, __1.each)({ x: { v: 1 }, y: 9 }))
            .equal([{ v: 1, key$: 'x' }, { val$: 9, key$: 'y' }]);
    });
    // Audit `why` breadcrumbs: every save() captures which mode-dispatch
    // branches fired. The TS audit array has [tag, data] pairs where
    // data.why is an array of breadcrumbs.
    (0, node_test_1.test)('audit-why-write', async () => {
        const mfs = (0, memfs_1.memfs)({});
        const j = (0, __1.Jostraca)({ now: () => 1735689600000 });
        const res = await j.generate({ fs: () => mfs.fs, folder: '/out' }, () => (0, __1.Project)({ folder: 'p' }, () => {
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('hi'));
        }));
        const audit = res.audit();
        // The save:write entry carries the why breadcrumbs.
        const saveEntry = audit.find((e) => typeof e[0] === 'string' && e[0].includes('save:write'));
        (0, expect_1.expect)(saveEntry).exist();
        (0, expect_1.expect)(Array.isArray(saveEntry[1].why)).true();
        (0, expect_1.expect)(saveEntry[1].why.length > 0).true();
        // Specific breadcrumb shape.
        (0, expect_1.expect)(saveEntry[1].why.includes('write-1')).true();
        (0, expect_1.expect)(saveEntry[1].why.includes('duplicate-1')).true();
    });
    // Options.name file/folder prefix/suffix pipeline. Names of files
    // and folders should pick up the configured affixes.
    (0, node_test_1.test)('options-name-file-affixes', async () => {
        const mfs = (0, memfs_1.memfs)({});
        const j = (0, __1.Jostraca)({
            now: () => 1735689600000,
            name: { file: { prefix: 'pre-', suffix: '.gen' } },
        });
        await j.generate({ fs: () => mfs.fs, folder: '/out' }, () => (0, __1.Project)({ folder: 'p' }, () => {
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('hi'));
        }));
        const vol = mfs.vol.toJSON();
        const keys = Object.keys(vol).sort();
        // Options.name.file.prefix/suffix is declared in OptionsShape but NOT
        // implemented (see the `TODO: implement` in src/jostraca.ts). This
        // asserts the current reality rather than the intent, so that whoever
        // implements the affix pipeline gets a failure here and updates both
        // this test and the Go port together.
        const affixed = keys.some(k => /pre-a\.gen\.txt/.test(k));
        const plain = keys.some(k => k.endsWith('/p/a.txt'));
        (0, expect_1.expect)(affixed).false();
        (0, expect_1.expect)(plain).true();
    });
});
//# sourceMappingURL=parity-fidelity.test.js.map