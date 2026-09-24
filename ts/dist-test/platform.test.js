"use strict";
// The platform-dispatched absolute-path boundary, pinned against node.
//
// The Go port cannot call node's `Path.isAbsolute`, so it mirrors it by
// hand in `isAbsFromPath` (go/build.go). That mirror decides whether a
// `Project.folder` is used as-is or joined under the output folder, and
// whether a path counts as inside the default `.` output folder — so if it
// drifts from node, the two stacks write to different places on Windows.
//
// This suite is the canonical half of a pair. `go/platform_test.go` carries
// the IDENTICAL table and asserts the Go mirror against it for both
// platforms. This file asserts the same table against node's own `posix`
// and `win32` implementations. Between them, neither side can drift
// silently: a wrong table fails here, and a wrong mirror fails there.
//
// Keeping the expectations in two places is deliberate. The alternative —
// deriving Go's expectations from node at test time — would make the Go
// suite depend on a node process, which is exactly the coupling the
// generated parity corpora exist to avoid for behaviour that can be
// captured as data.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const expect_1 = require("./expect");
const node_path_1 = __importDefault(require("node:path"));
const memfs_1 = require("../dist/util/memfs");
const basic_1 = require("../dist/util/basic");
// Must stay identical to absBoundaryCases in go/platform_test.go.
const ABS_BOUNDARY = [
    // path, posix, win32
    ['', false, false],
    ['/x', true, true],
    ['\\x', false, true],
    ['C:/x', false, true],
    ['c:\\x', false, true],
    ['C:x', false, false], // drive-RELATIVE, not absolute
    ['C:', false, false], // too short to be drive-absolute
    ['C:/', false, true], // bare drive root IS absolute
    ['x', false, false],
    ['./x', false, false],
    ['../x', false, false],
    ['//server/s', true, true],
    ['\\\\server\\s', false, true], // UNC
    ['1:/x', false, false], // digit is not a drive letter
    [':/x', false, false], // empty drive letter
];
// Must stay identical to extBoundaryCases in go/platform_test.go: node's
// path.extname on both platforms, which isbinext follows.
const EXT_BOUNDARY = [
    // path, posix, win32
    ["a.png", ".png", ".png"],
    ["a.png/", ".png", ".png"],
    ["a.png//", ".png", ".png"],
    ["a/b.PNG/", ".PNG", ".PNG"],
    ["/a.png/", ".png", ".png"],
    ["x\\.png", ".png", ""],
    ["x\\a.png", ".png", ".png"],
    ["a.b\\c", ".b\\c", ""],
    [".gitignore", "", ""],
    ["..", "", ""],
    ["a.", ".", "."],
    ["C:a.png", ".png", ".png"],
    ["C:.png", ".png", ""],
    ["", "", ""],
    ["/", "", ""],
    ["a..png", ".png", ".png"],
    [".a.png", ".png", ".png"],
    ["a.png\\", ".png\\", ".png"],
    [".png/", "", ""],
    ["x/.png//", "", ""],
];
(0, node_test_1.describe)('platform', () => {
    // Compared as whole tables rather than case by case: a mismatch then
    // names the offending path in the diff, which a bare `false !== true`
    // would not.
    (0, node_test_1.test)('isabsolute-boundary', async () => {
        const actual = ABS_BOUNDARY.map(([path]) => [path, node_path_1.default.posix.isAbsolute(path), node_path_1.default.win32.isAbsolute(path)]);
        (0, expect_1.expect)(actual).equal(ABS_BOUNDARY.map(([path, posix, win32]) => [path, posix, win32]));
    });
    // The dispatched entry point the source actually calls must agree with
    // whichever leg of the table matches the host, so the table can not be
    // right while `Path.isAbsolute` resolves to something else.
    (0, node_test_1.test)('isabsolute-dispatch', async () => {
        const windows = 'win32' === process.platform;
        const actual = ABS_BOUNDARY.map(([path]) => [path, node_path_1.default.isAbsolute(path)]);
        (0, expect_1.expect)(actual).equal(ABS_BOUNDARY.map(([path, posix, win32]) => [path, windows ? win32 : posix]));
    });
    (0, node_test_1.test)('extname-boundary', async () => {
        const actual = EXT_BOUNDARY.map(([path]) => [path, node_path_1.default.posix.extname(path), node_path_1.default.win32.extname(path)]);
        (0, expect_1.expect)(actual).equal(EXT_BOUNDARY);
    });
    // isbinext follows the host's leg: a backslash is part of a POSIX name,
    // so 'x\\.png' is a PNG there and a hidden '.png' file on Windows.
    (0, node_test_1.test)('isbinext-dispatch', async () => {
        const windows = 'win32' === process.platform;
        (0, expect_1.expect)((0, basic_1.isbinext)('x\\.png')).equal(!windows);
        (0, expect_1.expect)((0, basic_1.isbinext)('a.png/')).equal(true);
    });
    // A WINDOWS DRIVE PATH IN THE MEMORY FILESYSTEM, and it is asserted on
    // every platform because the bug had nothing to do with the host: it
    // was one form disagreeing with another INSIDE src/util/memfs.ts.
    //
    // `memClean` keeps the drive outside the leading slash (`C:/Users/x`)
    // and `mkdirp` rebuilt every key from `''`, so it stored
    // `/C:/Users/x`. `mkdirSync` then reported success while `existsSync`
    // said false for the same path, and the next write failed ENOENT on a
    // parent that had just been created.
    //
    // Nothing reached it for as long as every suite here used POSIX keys
    // (`/top/...`). A caller putting real OS paths into a volume does, and
    // on a Windows runner that is every path it has.
    (0, node_test_1.test)('memfs-accepts-a-windows-drive-path', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        const base = 'C:/Users/RUNNER~1/AppData/Local/Temp/j';
        const dir = base + '/app/models';
        // memClean is the form every lookup arrives in, and is what the
        // stored directory keys have to match.
        (0, expect_1.expect)((0, memfs_1.memClean)(dir)).equal(dir);
        (0, expect_1.expect)((0, memfs_1.memClean)('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\j/app/models'))
            .equal(dir);
        fs.mkdirSync(dir, { recursive: true });
        // The pair that disagreed.
        (0, expect_1.expect)(fs.existsSync(dir)).true();
        (0, expect_1.expect)(fs.statSync(dir).isDirectory()).true();
        // The drive root is a directory too, because parentOf('C:/Users')
        // answers `C:` and a write there would fail on a missing parent.
        (0, expect_1.expect)(vol.dirs.has('C:')).true();
        (0, expect_1.expect)([...vol.dirs.keys()].filter((k) => k.startsWith('/C:')))
            .equal([]);
        // ... and a write through it round-trips.
        fs.writeFileSync(dir + '/planet.rb', 'class Planet\nend\n');
        (0, expect_1.expect)(fs.readFileSync(dir + '/planet.rb', 'utf8'))
            .equal('class Planet\nend\n');
        (0, expect_1.expect)(fs.readdirSync(base + '/app')).equal(['models']);
        (0, expect_1.expect)(fs.readdirSync(dir)).equal(['planet.rb']);
        // A POSIX volume is untouched: no drive, no prefix, same keys as
        // before.
        const posix = (0, memfs_1.memfs)({});
        posix.fs.mkdirSync('/top/a/b', { recursive: true });
        (0, expect_1.expect)([...posix.vol.dirs.keys()]).equal(['/', '/top', '/top/a', '/top/a/b']);
    });
    // A RELATIVE PATH UNDER A DRIVE-ROOTED WORKING DIRECTORY IS ITSELF
    // DRIVE-ROOTED, and `memClean` used to decide otherwise: it tested for
    // a drive BEFORE prepending the working directory, so `a.txt` under
    // `D:/w` came back `/D:/w/a.txt` while `D:/w/a.txt` came back as
    // itself. One volume then held two keys for one file, and a caller
    // mixing the two forms found neither.
    //
    // `cwd` is a parameter precisely so this can be asserted here: no
    // POSIX runner has a drive-rooted working directory, and only a
    // Windows one could otherwise reach the branch. The same reason
    // ABS_BOUNDARY above asserts both platforms' tables on one host.
    (0, node_test_1.test)('memclean-resolves-a-relative-path-against-a-drive-cwd', async () => {
        const win = 'D:/a/work';
        // The pair that disagreed: one file, two spellings, one key.
        (0, expect_1.expect)((0, memfs_1.memClean)('a.txt', win)).equal('D:/a/work/a.txt');
        (0, expect_1.expect)((0, memfs_1.memClean)('D:/a/work/a.txt', win)).equal('D:/a/work/a.txt');
        (0, expect_1.expect)((0, memfs_1.memClean)('sub/a.txt', win)).equal('D:/a/work/sub/a.txt');
        // Backslashes, `.` and `..` all resolve the same way they do
        // anywhere else, and the drive survives each.
        (0, expect_1.expect)((0, memfs_1.memClean)('sub\\a.txt', win)).equal('D:/a/work/sub/a.txt');
        (0, expect_1.expect)((0, memfs_1.memClean)('./a.txt', win)).equal('D:/a/work/a.txt');
        (0, expect_1.expect)((0, memfs_1.memClean)('sub/../a.txt', win)).equal('D:/a/work/a.txt');
        // A POSIX-absolute path is left alone even under a drive cwd, which
        // is what `Path.resolve` would NOT do -- it would answer `D:/app`.
        // The volume keys `/app`, so anything comparing against it must too.
        (0, expect_1.expect)((0, memfs_1.memClean)('/app/a.txt', win)).equal('/app/a.txt');
        // And a POSIX working directory is unchanged.
        (0, expect_1.expect)((0, memfs_1.memClean)('a.txt', '/w')).equal('/w/a.txt');
        (0, expect_1.expect)((0, memfs_1.memClean)('/abs/a.txt', '/w')).equal('/abs/a.txt');
    });
});
//# sourceMappingURL=platform.test.js.map