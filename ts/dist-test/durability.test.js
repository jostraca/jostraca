"use strict";
// Durability tests: atomic write-then-rename, and that a failed write
// leaves the user's existing file intact. Mirrors go/durability_test.go.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const expect_1 = require("./expect");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const memfs_1 = require("memfs");
const __1 = require("../");
const START_TIME = 1735689600000;
const TMP_SUFFIX = '.jostraca-tmp';
// Wrap an fs provider so writes to paths containing `failOn` throw.
function failWrites(base, failOn, message) {
    return new Proxy(base, {
        get(target, prop) {
            if ('writeFileSync' === prop) {
                return (path, ...rest) => {
                    if (String(path).includes(failOn)) {
                        throw new Error(message);
                    }
                    return target.writeFileSync(path, ...rest);
                };
            }
            const value = target[prop];
            return 'function' === typeof value ? value.bind(target) : value;
        },
    });
}
(0, node_test_1.describe)('durability', () => {
    (0, node_test_1.test)('atomic-write-leaves-no-temp-files', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        fs.mkdirSync('/out/p', { recursive: true });
        fs.writeFileSync('/out/p/a.txt', 'OLD\n');
        const jostraca = (0, __1.Jostraca)({ now: () => START_TIME, fs: () => fs });
        await jostraca.generate({ folder: '/out' }, () => (0, __1.Project)({ folder: 'p' }, () => {
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('NEW\n'));
            (0, __1.File)({ name: 'b.txt' }, () => (0, __1.Content)('B\n'));
        }));
        const stray = Object.keys(vol.toJSON()).filter(k => k.includes(TMP_SUFFIX));
        (0, expect_1.expect)(stray).equal([]);
        (0, expect_1.expect)(vol.toJSON()['/out/p/a.txt']).equal('NEW\n');
    });
    // The point of temp-then-rename: a failure mid-write must not truncate
    // or destroy what the user already had on disk.
    (0, node_test_1.test)('failed-write-leaves-existing-file-intact', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        fs.mkdirSync('/out/p', { recursive: true });
        fs.writeFileSync('/out/p/a.txt', 'USER-EDITED\n');
        const failing = failWrites(fs, '/out/p/a.txt', 'simulated ENOSPC');
        const jostraca = (0, __1.Jostraca)({ now: () => START_TIME, fs: () => failing });
        await (0, expect_1.expect)(async () => await jostraca.generate({ folder: '/out' }, () => (0, __1.Project)({ folder: 'p' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('GENERATED\n')))))
            .rejects(/simulated ENOSPC/);
        (0, expect_1.expect)(vol.toJSON()['/out/p/a.txt']).equal('USER-EDITED\n');
    });
    // The merge baseline under .jostraca/generated is what makes
    // edit-preserving merges possible; a failure writing it must surface.
    (0, node_test_1.test)('baseline-write-error-surfaces', async () => {
        const { fs } = (0, memfs_1.memfs)({});
        const failing = failWrites(fs, '/.jostraca/generated/', 'simulated ENOSPC');
        const jostraca = (0, __1.Jostraca)({ now: () => START_TIME, fs: () => failing });
        await (0, expect_1.expect)(async () => await jostraca.generate({ folder: '/out' }, () => (0, __1.Project)({ folder: 'p' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('GEN\n')))))
            .rejects(/simulated ENOSPC/);
    });
    // Dryrun must not touch the tree at all — including creating the
    // destination folder, which copyFile used to do unconditionally.
    (0, node_test_1.test)('dryrun-writes-nothing', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)({ now: () => START_TIME, fs: () => fs });
        await jostraca.generate({ folder: '/out', control: { dryrun: true } }, () => (0, __1.Project)({ folder: 'p' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('NEW\n'))));
        (0, expect_1.expect)(Object.keys(vol.toJSON())).equal([]);
    });
    // A provider without renameSync must still work, via a direct write.
    (0, node_test_1.test)('provider-without-rename-falls-back', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        const noRename = new Proxy(fs, {
            get(target, prop) {
                if ('renameSync' === prop) {
                    return undefined;
                }
                const value = target[prop];
                return 'function' === typeof value ? value.bind(target) : value;
            },
        });
        const jostraca = (0, __1.Jostraca)({ now: () => START_TIME, fs: () => noRename });
        await jostraca.generate({ folder: '/out' }, () => (0, __1.Project)({ folder: 'p' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('NEW\n'))));
        (0, expect_1.expect)(vol.toJSON()['/out/p/a.txt']).equal('NEW\n');
    });
    // Rename swaps the inode, so without an explicit chmod an existing
    // executable would silently lose +x on regeneration.
    (0, node_test_1.test)('atomic-write-preserves-mode', async () => {
        const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'jostraca-dur-'));
        try {
            const target = node_path_1.default.join(dir, 'p', 'run.sh');
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(target), { recursive: true });
            node_fs_1.default.writeFileSync(target, '#!/bin/sh\necho old\n', { mode: 0o755 });
            node_fs_1.default.chmodSync(target, 0o755);
            const jostraca = (0, __1.Jostraca)({ now: () => START_TIME });
            await jostraca.generate({ folder: dir }, () => (0, __1.Project)({ folder: 'p' }, () => (0, __1.File)({ name: 'run.sh' }, () => (0, __1.Content)('#!/bin/sh\necho new\n'))));
            const stat = node_fs_1.default.statSync(target);
            (0, expect_1.expect)(0 !== (stat.mode & 0o111)).true();
            (0, expect_1.expect)(node_fs_1.default.readFileSync(target, 'utf8')).equal('#!/bin/sh\necho new\n');
            const stray = node_fs_1.default.readdirSync(node_path_1.default.dirname(target))
                .filter(n => n.includes(TMP_SUFFIX));
            (0, expect_1.expect)(stray).equal([]);
        }
        finally {
            node_fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
});
// This block lives here because it is the only suite that exercises the
// real filesystem rather than an injected memfs.
(0, node_test_1.describe)('fs-provider', () => {
    // The README quick start passes neither `fs` nor `mem`. That path used
    // to resolve to `undefined` — the global provider was set to a function
    // that returns the memfs handle (or undefined when memfs is off), and
    // being a function it short-circuited the `node:fs` fallback. Every
    // other test injects memfs explicitly, so nothing caught it.
    (0, node_test_1.test)('defaults-to-node-fs-when-no-provider-given', async () => {
        const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'jostraca-fsp-'));
        try {
            const jostraca = (0, __1.Jostraca)();
            await jostraca.generate({ folder: dir }, () => (0, __1.Project)({ folder: 'my-app' }, () => (0, __1.File)({ name: 'index.js' }, () => (0, __1.Content)('console.log("hi")\n'))));
            (0, expect_1.expect)(node_fs_1.default.readFileSync(node_path_1.default.join(dir, 'my-app', 'index.js'), 'utf8'))
                .equal('console.log("hi")\n');
        }
        finally {
            node_fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
    // Global `mem: true` must still route to memfs, not the real fs.
    (0, node_test_1.test)('global-mem-option-still-uses-memfs', async () => {
        const jostraca = (0, __1.Jostraca)({ mem: true });
        const res = await jostraca.generate({ folder: '/out' }, () => (0, __1.Project)({ folder: 'p' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A\n'))));
        (0, expect_1.expect)(res.vol().toJSON()['/out/p/a.txt']).equal('A\n');
    });
});
//# sourceMappingURL=durability.test.js.map