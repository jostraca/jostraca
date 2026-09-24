"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const Fs = __importStar(require("node:fs"));
const Os = __importStar(require("node:os"));
const Path = __importStar(require("node:path"));
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
        // Control merges PER KEY: a per-call control that sets one key leaves
        // every other global key in force.
        (0, node_test_1.test)('global-dryrun-survives-per-call-version', async () => {
            (0, expect_1.expect)(await gen({ control: { dryrun: true } }, { control: { version: true } }))
                .equal([]);
        });
        (0, node_test_1.test)('global-dryrun-survives-per-call-duplicate-false', async () => {
            (0, expect_1.expect)(await gen({ control: { dryrun: true } }, { control: { duplicate: false } }))
                .equal([]);
        });
        (0, node_test_1.test)('global-version-survives-per-call-duplicate-false', async () => {
            (0, expect_1.expect)(await gen({ control: { version: true } }, { control: { duplicate: false } }))
                .equal(['/out/.jostraca/jostraca.meta.log', '/out/a.txt']);
        });
        (0, node_test_1.test)('global-duplicate-false-survives-per-call-version', async () => {
            (0, expect_1.expect)(await gen({ control: { duplicate: false } }, { control: { version: true } }))
                .equal(['/out/.jostraca/jostraca.meta.log', '/out/a.txt']);
        });
    });
    // `existing.txt` and `existing.bin` deep-merge PER KEY over the global
    // values: every key a call omits inherits the global one. Each case is a
    // generate, a user edit, and a regenerate under a global and a per-call
    // `existing`.
    (0, node_test_1.describe)('global-existing-precedence', () => {
        const run = async (gexisting, cexisting, first, user, second) => {
            const j = (0, __1.Jostraca)({
                mem: true, folder: '/out', now: () => START_TIME, existing: gexisting
            });
            const gen = (body) => () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)(body)));
            const res0 = await j.generate({}, gen(first));
            res0.fs().writeFileSync('/out/a.txt', user);
            const res = await j.generate({ existing: cexisting }, gen(second));
            const fs = res.fs();
            const meta = JSON.parse(fs.readFileSync('/out/.jostraca/jostraca.meta.log', 'utf8'));
            return {
                files: res.files,
                text: fs.readFileSync('/out/a.txt', 'utf8'),
                vol: Object.keys(res.vol().toJSON()).filter((p) => !p.includes('.jostraca')).sort(),
                actions: meta.files['a.txt'].actions,
            };
        };
        (0, node_test_1.test)('global-merge-with-per-call-preserve-merges', async () => {
            const r = await run({ txt: { merge: true } }, { txt: { preserve: true } }, 'L1\nL2\nL3\n', 'L1\nUSER\nL3\n', 'L1\nGEN\nL3\n');
            (0, expect_1.expect)(r.text).equal('L1\n' +
                '<<<<<<< GENERATED: 2025-01-01T00:00:00.000Z/merge\n' +
                'GEN\n=======\nUSER\n' +
                '>>>>>>> EXISTING: 2025-01-01T00:00:00.000Z/merge\n' +
                'L3\n');
            (0, expect_1.expect)(r.files.merged).equal(['/out/a.txt']);
            (0, expect_1.expect)(r.files.conflicted).equal(['/out/a.txt']);
            (0, expect_1.expect)(r.files.written).equal([]);
            (0, expect_1.expect)(r.files.preserved.length).equal(1);
            (0, expect_1.expect)(r.actions).equal(['preserve', 'merge']);
            (0, expect_1.expect)(r.vol).equal(['/out/a.old.txt', '/out/a.txt']);
        });
        (0, node_test_1.test)('global-merge-with-per-call-write-still-merges', async () => {
            const r = await run({ txt: { merge: true } }, { txt: { write: true } }, 'L1\nL2\nL3\n', 'L1\nUSER\nL3\n', 'L1\nL2\nL3\nL4\n');
            (0, expect_1.expect)(r.text).equal('L1\nUSER\nL3\nL4\n');
            (0, expect_1.expect)(r.files.merged).equal(['/out/a.txt']);
            (0, expect_1.expect)(r.files.conflicted).equal([]);
            (0, expect_1.expect)(r.files.written).equal([]);
            (0, expect_1.expect)(r.actions).equal(['merge']);
        });
        (0, node_test_1.test)('global-txt-write-false-with-per-call-bin-skips', async () => {
            const r = await run({ txt: { write: false } }, { bin: { preserve: true } }, 'A1\n', 'USER\n', 'A2\n');
            (0, expect_1.expect)(r.text).equal('USER\n');
            (0, expect_1.expect)(r.files.written).equal([]);
            (0, expect_1.expect)(r.files.preserved).equal([]);
            (0, expect_1.expect)(r.actions).equal(['skip']);
            (0, expect_1.expect)(r.vol).equal(['/out/a.txt']);
        });
        (0, node_test_1.test)('global-txt-preserve-with-per-call-bin-preserves', async () => {
            const r = await run({ txt: { preserve: true } }, { bin: { write: true } }, 'A1\n', 'USER\n', 'A2\n');
            (0, expect_1.expect)(r.text).equal('A2\n');
            (0, expect_1.expect)(r.files.written).equal(['/out/a.txt']);
            (0, expect_1.expect)(r.files.preserved.length).equal(1);
            (0, expect_1.expect)(r.actions).equal(['preserve', 'write']);
            (0, expect_1.expect)(r.vol).equal(['/out/a.old.txt', '/out/a.txt']);
        });
    });
    // `build` and `exclude` follow the same precedence as every other option:
    // per-call, else global, else the default. OptionsShape used to declare
    // both as literal defaults, which shape injected into every per-call
    // object, so a global `build: false` or `exclude: true` was ignored.
    (0, node_test_1.describe)('global-build-and-exclude', () => {
        const root = () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A'));
            (0, __1.File)({ name: 'b.txt' }, () => (0, __1.Content)('B'));
        });
        (0, node_test_1.test)('global-build-false-writes-nothing', async () => {
            const j = (0, __1.Jostraca)({ mem: true, folder: '/out', build: false, now: () => START_TIME });
            const res = await j.generate({}, root);
            (0, expect_1.expect)(Object.keys(res.vol().toJSON())).equal([]);
            (0, expect_1.expect)(res.files.written).equal([]);
        });
        (0, node_test_1.test)('per-call-build-true-overrides-global-false', async () => {
            const j = (0, __1.Jostraca)({ mem: true, folder: '/out', build: false, now: () => START_TIME });
            const res = await j.generate({ build: true }, root);
            (0, expect_1.expect)(res.files.written).equal(['/out/a.txt', '/out/b.txt']);
        });
        // A REAL FILESYSTEM, because the exclude window compares a file's mtime
        // with the previous build's `last`. The clock is pinned and the mtimes
        // are set explicitly, one on each side of `last`.
        const excludeRun = async (gopts, opts) => {
            const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-exclude-'));
            try {
                const j = (0, __1.Jostraca)({ folder: dir, now: () => START_TIME, ...gopts });
                await j.generate({ exclude: false }, root);
                Fs.writeFileSync(Path.join(dir, 'a.txt'), 'USER');
                const sec = (ms) => ms / 1000;
                Fs.utimesSync(Path.join(dir, 'a.txt'), sec(START_TIME + 60000), sec(START_TIME + 60000));
                Fs.utimesSync(Path.join(dir, 'b.txt'), sec(START_TIME - 60000), sec(START_TIME - 60000));
                const res = await j.generate(opts, () => (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A2'));
                    (0, __1.File)({ name: 'b.txt' }, () => (0, __1.Content)('B2'));
                }));
                return {
                    written: res.files.written.map((p) => Path.basename(p)),
                    a: Fs.readFileSync(Path.join(dir, 'a.txt'), 'utf8'),
                    b: Fs.readFileSync(Path.join(dir, 'b.txt'), 'utf8'),
                };
            }
            finally {
                Fs.rmSync(dir, { recursive: true, force: true });
            }
        };
        (0, node_test_1.test)('global-exclude-skips-a-user-edited-file', async () => {
            (0, expect_1.expect)(await excludeRun({ exclude: true }, {}))
                .equal({ written: ['b.txt'], a: 'USER', b: 'B2' });
        });
        (0, node_test_1.test)('per-call-exclude-false-overrides-global', async () => {
            (0, expect_1.expect)(await excludeRun({ exclude: true }, { exclude: false }))
                .equal({ written: ['a.txt', 'b.txt'], a: 'A2', b: 'B2' });
        });
        (0, node_test_1.test)('no-exclude-overwrites-a-user-edited-file', async () => {
            (0, expect_1.expect)(await excludeRun({}, {}))
                .equal({ written: ['a.txt', 'b.txt'], a: 'A2', b: 'B2' });
        });
    });
});
//# sourceMappingURL=control.test.js.map