"use strict";
/* Copyright (c) 2024 Richard Rodger, MIT License */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Same scenarios, both filesystem providers.
//
// Why this suite exists: T0. `Jostraca()` with no `fs` and no `mem` could
// not write to the real filesystem at all — the library's primary
// documented use case, broken, in a suite that was green. It survived
// because EVERY test injected a memfs provider explicitly, so nothing ever
// exercised the production path the double stood in for.
//
// A test double used universally hides defects in exactly the code it
// replaces. The fix is not "one real-filesystem smoke test", it is running
// the same scenarios through both providers and asserting they agree. The
// comparison is differential — no expected output is transcribed here — so
// adding a scenario costs nothing and covers both paths by construction.
const node_test_1 = require("node:test");
const expect_1 = require("./expect");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const memfs_1 = require("memfs");
const __1 = require("../");
const START_TIME = 1735689600000;
// Files whose content is provider-dependent by design, not by defect.
const META_FOLDER = '.jostraca';
function memHarness() {
    const { fs, vol } = (0, memfs_1.memfs)({});
    const folder = '/out';
    return {
        name: 'memfs',
        folder,
        opts: (extra = {}) => ({ fs: () => fs, folder, ...extra }),
        put: (rel, text) => {
            fs.mkdirSync(node_path_1.default.posix.dirname(folder + '/' + rel), { recursive: true });
            fs.writeFileSync(folder + '/' + rel, text);
        },
        tree: () => {
            const out = {};
            for (const [k, v] of Object.entries(vol.toJSON())) {
                if (!k.startsWith(folder + '/'))
                    continue;
                out[k.substring(folder.length + 1)] = null == v ? '' : '' + v;
            }
            return out;
        },
        cleanup: () => { },
    };
}
function nodeHarness() {
    const folder = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'jostraca-prov-'));
    const walk = (dir, prefix, out) => {
        for (const entry of node_fs_1.default.readdirSync(dir, { withFileTypes: true })) {
            const full = node_path_1.default.join(dir, entry.name);
            const rel = prefix ? prefix + '/' + entry.name : entry.name;
            if (entry.isDirectory()) {
                walk(full, rel, out);
            }
            else {
                out[rel] = node_fs_1.default.readFileSync(full, 'utf8');
            }
        }
    };
    return {
        name: 'node:fs',
        folder,
        // No `fs` and no `mem`: this is the README quick-start path.
        opts: (extra = {}) => ({ folder, ...extra }),
        put: (rel, text) => {
            const full = node_path_1.default.join(folder, ...rel.split('/'));
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(full), { recursive: true });
            node_fs_1.default.writeFileSync(full, text);
        },
        tree: () => {
            const out = {};
            walk(folder, '', out);
            return out;
        },
        cleanup: () => node_fs_1.default.rmSync(folder, { recursive: true, force: true }),
    };
}
// The meta log records absolute paths, which differ by provider by
// construction. Everything else must match byte for byte.
function normalise(tree, folder) {
    const out = {};
    for (const [path, text] of Object.entries(tree)) {
        out[path] = path.includes(META_FOLDER) ?
            text.split(folder).join('<FOLDER>') : text;
    }
    return out;
}
const SCENARIOS = [
    {
        name: 'fresh-generate',
        produces: ['app/src/index.js', 'app/package.json'],
        run: async (h) => {
            const jostraca = (0, __1.Jostraca)({ now: () => START_TIME });
            await jostraca.generate(h.opts(), () => (0, __1.Project)({ folder: 'app' }, () => {
                (0, __1.Folder)({ name: 'src' }, () => {
                    (0, __1.File)({ name: 'index.js' }, () => (0, __1.Content)('console.log(1)\n'));
                });
                (0, __1.File)({ name: 'package.json' }, () => (0, __1.Content)('{"name":"app"}\n'));
            }));
        },
    },
    {
        name: 'regenerate-changed-content',
        produces: ['app/a.txt'],
        run: async (h) => {
            const gen = async (body) => {
                const jostraca = (0, __1.Jostraca)({ now: () => START_TIME });
                await jostraca.generate(h.opts(), () => (0, __1.Project)({ folder: 'app' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)(body))));
            };
            await gen('ONE\n');
            await gen('TWO\n');
        },
    },
    {
        name: 'preserve-user-edit',
        produces: ['app/a.txt'],
        run: async (h) => {
            h.put('app/a.txt', 'USER WROTE THIS\n');
            const jostraca = (0, __1.Jostraca)({ now: () => START_TIME });
            await jostraca.generate(h.opts({ existing: { txt: { preserve: true } } }), () => (0, __1.Project)({ folder: 'app' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('GENERATED\n'))));
        },
    },
    {
        name: 'merge-user-edit',
        produces: ['app/a.txt'],
        run: async (h) => {
            const gen = async (body, extra = {}) => {
                const jostraca = (0, __1.Jostraca)({ now: () => START_TIME });
                await jostraca.generate(h.opts(extra), () => (0, __1.Project)({ folder: 'app' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)(body))));
            };
            // First pass lays down the baseline the merge needs.
            await gen('line1\nline2\nline3\n');
            h.put('app/a.txt', 'line1\nline2\nUSER LINE\nline3\n');
            await gen('line1\nCHANGED\nline3\n', { existing: { txt: { merge: true } } });
        },
    },
    {
        name: 'diff-annotates',
        produces: ['app/a.txt'],
        run: async (h) => {
            h.put('app/a.txt', 'OLD\n');
            const jostraca = (0, __1.Jostraca)({ now: () => START_TIME });
            await jostraca.generate(h.opts({ existing: { txt: { diff: true } } }), () => (0, __1.Project)({ folder: 'app' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('NEW\n'))));
        },
    },
    {
        name: 'inject-into-existing',
        produces: ['app/a.txt'],
        run: async (h) => {
            h.put('app/a.txt', 'head\n#--START--#\nstale\n#--END--#\ntail\n');
            const jostraca = (0, __1.Jostraca)({ now: () => START_TIME });
            await jostraca.generate(h.opts(), () => (0, __1.Project)({ folder: 'app' }, () => (0, __1.Inject)({ name: 'a.txt' }, () => (0, __1.Content)('injected\n'))));
        },
    },
    {
        name: 'copy-tree',
        produces: ['app/lib/one.txt', 'app/lib/deep/two.txt'],
        run: async (h) => {
            h.put('src/one.txt', 'ONE\n');
            h.put('src/deep/two.txt', 'TWO\n');
            const jostraca = (0, __1.Jostraca)({ now: () => START_TIME });
            await jostraca.generate(h.opts(), () => (0, __1.Project)({ folder: 'app' }, () => (0, __1.Copy)({ from: h.folder + '/src', to: 'lib' })));
        },
    },
    {
        name: 'nested-folders',
        produces: ['app/a/b/c/deep.txt'],
        run: async (h) => {
            const jostraca = (0, __1.Jostraca)({ now: () => START_TIME });
            await jostraca.generate(h.opts(), () => (0, __1.Project)({ folder: 'app' }, () => (0, __1.Folder)({ name: 'a' }, () => (0, __1.Folder)({ name: 'b' }, () => (0, __1.Folder)({ name: 'c' }, () => (0, __1.File)({ name: 'deep.txt' }, () => (0, __1.Content)('DEEP\n')))))));
        },
    },
];
(0, node_test_1.describe)('provider-parity', () => {
    for (const scenario of SCENARIOS) {
        (0, node_test_1.test)(scenario.name, async () => {
            const harnesses = [memHarness(), nodeHarness()];
            const trees = {};
            try {
                for (const h of harnesses) {
                    await scenario.run(h);
                    trees[h.name] = normalise(h.tree(), h.folder);
                }
            }
            finally {
                for (const h of harnesses) {
                    h.cleanup();
                }
            }
            const [first, second] = harnesses.map(h => h.name);
            // Vacuity guard: a scenario that produces nothing would otherwise
            // "agree" on both providers.
            for (const name of [first, second]) {
                for (const rel of scenario.produces) {
                    (0, expect_1.expect)(null != trees[name][rel]).true();
                }
            }
            // The real assertion: same paths, same bytes, either provider.
            (0, expect_1.expect)(Object.keys(trees[first]).sort())
                .equal(Object.keys(trees[second]).sort());
            for (const rel of Object.keys(trees[first])) {
                (0, expect_1.expect)(trees[first][rel]).equal(trees[second][rel]);
            }
        });
    }
    // Mode bits only exist on the real filesystem, so this one cannot be a
    // differential — but it is the same lesson, and it is the reason the
    // atomic write has to chmod after rename.
    (0, node_test_1.test)('file-mode-survives-regeneration', async () => {
        const h = nodeHarness();
        try {
            const gen = async (body) => {
                const jostraca = (0, __1.Jostraca)({ now: () => START_TIME });
                await jostraca.generate(h.opts(), () => (0, __1.Project)({ folder: 'app' }, () => (0, __1.File)({ name: 'run.sh', mode: 0o755 }, () => (0, __1.Content)(body))));
            };
            const target = node_path_1.default.join(h.folder, 'app', 'run.sh');
            // The mode half is skipped on Windows, which has no execute bit
            // (see POSIX_MODES); the rename half below is checked everywhere.
            await gen('#!/bin/sh\necho one\n');
            if (expect_1.POSIX_MODES) {
                (0, expect_1.expect)(0 !== (node_fs_1.default.statSync(target).mode & 0o111)).true();
            }
            (0, expect_1.expect)(node_fs_1.default.readFileSync(target, 'utf8')).equal('#!/bin/sh\necho one\n');
            await gen('#!/bin/sh\necho two\n');
            if (expect_1.POSIX_MODES) {
                (0, expect_1.expect)(0 !== (node_fs_1.default.statSync(target).mode & 0o111)).true();
            }
            (0, expect_1.expect)(node_fs_1.default.readFileSync(target, 'utf8')).equal('#!/bin/sh\necho two\n');
            // Rename swaps the inode; a leftover temp file means the swap did
            // not complete cleanly.
            const stray = node_fs_1.default.readdirSync(node_path_1.default.join(h.folder, 'app'))
                .filter(n => n !== 'run.sh');
            (0, expect_1.expect)(stray).equal([]);
        }
        finally {
            h.cleanup();
        }
    });
});
//# sourceMappingURL=provider.test.js.map