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
});
//# sourceMappingURL=platform.test.js.map