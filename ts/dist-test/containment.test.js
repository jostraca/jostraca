"use strict";
// Regression tests for output-path containment and backup-file naming.
//
// These three defects share a theme: a generated path escaping where the
// caller expected it to land, or two files colliding on one backup path.
// All are data-integrity issues, so each keeps an explicit test.
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const expect_1 = require("./expect");
const memfs_1 = require("../dist/util/memfs");
const __1 = require("../");
// 2025-01-01T00:00:00.000Z
const START_TIME = 1735689600000;
const outkeys = (vol) => Object.keys(vol.toJSON()).filter((k) => !k.includes('.jostraca')).sort();
(0, node_test_1.describe)('containment', () => {
    // A File with no enclosing Project used to join onto an empty folder
    // path, producing '/<name>' — an absolute path at the filesystem root,
    // ignoring the configured output folder entirely.
    (0, node_test_1.test)('file-without-project-stays-in-output-folder', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)({ now: () => START_TIME, fs: () => fs });
        await jostraca.generate({ folder: '/out' }, () => {
            (0, __1.File)({ name: 'x.txt' }, () => (0, __1.Content)('hi\n'));
        });
        (0, expect_1.expect)(outkeys(vol)).equal(['/out/x.txt']);
    });
    (0, node_test_1.test)('folder-without-project-stays-in-output-folder', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)({ now: () => START_TIME, fs: () => fs });
        await jostraca.generate({ folder: '/out' }, () => {
            (0, __1.Folder)({ name: 'sub' }, () => {
                (0, __1.File)({ name: 'y.txt' }, () => (0, __1.Content)('hi\n'));
            });
        });
        (0, expect_1.expect)(outkeys(vol)).equal(['/out/sub/y.txt']);
    });
    // Names compose straight into output paths and models are routinely
    // third-party data, so a `..` segment is an arbitrary-file-write.
    (0, node_test_1.test)('file-name-rejects-traversal', async () => {
        const { fs } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)({ now: () => START_TIME, fs: () => fs });
        await (0, expect_1.expect)(async () => await jostraca.generate({ folder: '/out' }, () => (0, __1.Project)({ folder: 'p' }, () => (0, __1.File)({ name: '../../../../etc/pwned.txt' }, () => (0, __1.Content)('OWNED\n')))))
            .rejects(/must not contain a "\.\." path segment/);
    });
    (0, node_test_1.test)('folder-name-rejects-traversal', async () => {
        const { fs } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)({ now: () => START_TIME, fs: () => fs });
        await (0, expect_1.expect)(async () => await jostraca.generate({ folder: '/out' }, () => (0, __1.Project)({ folder: 'p' }, () => (0, __1.Folder)({ name: '../..' }, () => (0, __1.File)({ name: 'e.txt' }, () => (0, __1.Content)('X\n'))))))
            .rejects(/must not contain a "\.\." path segment/);
    });
    // A leading `/` in a Folder name is a supported feature (it composes
    // with the Project folder) and must keep working — see the
    // `absolute_paths` parity scenario.
    (0, node_test_1.test)('absolute-folder-name-still-composes', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)({ now: () => START_TIME, fs: () => fs });
        await jostraca.generate({ folder: '/top' }, () => {
            (0, __1.Project)({ folder: '/top/sdk' }, () => {
                (0, __1.Folder)({ name: '/code/js' }, () => {
                    (0, __1.File)({ name: 'foo.js' }, () => (0, __1.Content)('// foo\n'));
                });
            });
        });
        (0, expect_1.expect)(outkeys(vol)).equal(['/top/sdk/code/js/foo.js']);
    });
    // Node's Path.extname('.env') is '', so the old regex-strip removed the
    // whole name: every dotfile in a folder collapsed onto the same `.old`
    // backup and the second one destroyed the first one's copy.
    (0, node_test_1.test)('preserve-backs-up-dotfiles-distinctly', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        fs.mkdirSync('/out/p', { recursive: true });
        fs.writeFileSync('/out/p/.env', 'OLD-ENV\n');
        fs.writeFileSync('/out/p/.npmrc', 'OLD-NPMRC\n');
        const jostraca = (0, __1.Jostraca)({ now: () => START_TIME, fs: () => fs });
        await jostraca.generate({ folder: '/out', existing: { txt: { preserve: true } } }, () => (0, __1.Project)({ folder: 'p' }, () => {
            (0, __1.File)({ name: '.env' }, () => (0, __1.Content)('NEW-ENV\n'));
            (0, __1.File)({ name: '.npmrc' }, () => (0, __1.Content)('NEW-NPMRC\n'));
        }));
        const json = vol.toJSON();
        (0, expect_1.expect)(json['/out/p/.env.old']).equal('OLD-ENV\n');
        (0, expect_1.expect)(json['/out/p/.npmrc.old']).equal('OLD-NPMRC\n');
        (0, expect_1.expect)(json['/out/p/.env']).equal('NEW-ENV\n');
        (0, expect_1.expect)(json['/out/p/.npmrc']).equal('NEW-NPMRC\n');
    });
    // Backup naming for ordinary files must be unchanged by the dotfile fix.
    (0, node_test_1.test)('preserve-backup-naming-unchanged-for-normal-files', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        fs.mkdirSync('/out/p', { recursive: true });
        fs.writeFileSync('/out/p/a.txt', 'OLD\n');
        fs.writeFileSync('/out/p/b.min.js', 'OLDJS\n');
        const jostraca = (0, __1.Jostraca)({ now: () => START_TIME, fs: () => fs });
        await jostraca.generate({ folder: '/out', existing: { txt: { preserve: true } } }, () => (0, __1.Project)({ folder: 'p' }, () => {
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('NEW\n'));
            (0, __1.File)({ name: 'b.min.js' }, () => (0, __1.Content)('NEWJS\n'));
        }));
        const json = vol.toJSON();
        (0, expect_1.expect)(json['/out/p/a.old.txt']).equal('OLD\n');
        (0, expect_1.expect)(json['/out/p/b.min.old.js']).equal('OLDJS\n');
    });
});
//# sourceMappingURL=containment.test.js.map