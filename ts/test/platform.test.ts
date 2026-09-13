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

import { test, describe } from 'node:test'
import { expect } from './expect'

import Path from 'node:path'

import { memfs, memClean } from '../dist/util/memfs'


// Must stay identical to absBoundaryCases in go/platform_test.go.
const ABS_BOUNDARY: [string, boolean, boolean][] = [
  // path, posix, win32
  ['', false, false],
  ['/x', true, true],
  ['\\x', false, true],
  ['C:/x', false, true],
  ['c:\\x', false, true],
  ['C:x', false, false],           // drive-RELATIVE, not absolute
  ['C:', false, false],            // too short to be drive-absolute
  ['C:/', false, true],            // bare drive root IS absolute
  ['x', false, false],
  ['./x', false, false],
  ['../x', false, false],
  ['//server/s', true, true],
  ['\\\\server\\s', false, true],  // UNC
  ['1:/x', false, false],          // digit is not a drive letter
  [':/x', false, false],           // empty drive letter
]


describe('platform', () => {

  // Compared as whole tables rather than case by case: a mismatch then
  // names the offending path in the diff, which a bare `false !== true`
  // would not.
  test('isabsolute-boundary', async () => {
    const actual = ABS_BOUNDARY.map(([path]) =>
      [path, Path.posix.isAbsolute(path), Path.win32.isAbsolute(path)])

    expect(actual).equal(ABS_BOUNDARY.map(([path, posix, win32]) =>
      [path, posix, win32]))
  })


  // The dispatched entry point the source actually calls must agree with
  // whichever leg of the table matches the host, so the table can not be
  // right while `Path.isAbsolute` resolves to something else.
  test('isabsolute-dispatch', async () => {
    const windows = 'win32' === process.platform

    const actual = ABS_BOUNDARY.map(([path]) => [path, Path.isAbsolute(path)])

    expect(actual).equal(ABS_BOUNDARY.map(([path, posix, win32]) =>
      [path, windows ? win32 : posix]))
  })


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
  test('memfs-accepts-a-windows-drive-path', async () => {
    const { fs, vol } = memfs({})

    const base = 'C:/Users/RUNNER~1/AppData/Local/Temp/j'
    const dir = base + '/app/models'

    // memClean is the form every lookup arrives in, and is what the
    // stored directory keys have to match.
    expect(memClean(dir)).equal(dir)
    expect(memClean('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\j/app/models'))
      .equal(dir)

    fs.mkdirSync(dir, { recursive: true })

    // The pair that disagreed.
    expect(fs.existsSync(dir)).true()
    expect(fs.statSync(dir).isDirectory()).true()

    // The drive root is a directory too, because parentOf('C:/Users')
    // answers `C:` and a write there would fail on a missing parent.
    expect(vol.dirs.has('C:')).true()
    expect([...vol.dirs.keys()].filter((k: string) => k.startsWith('/C:')))
      .equal([])

    // ... and a write through it round-trips.
    fs.writeFileSync(dir + '/planet.rb', 'class Planet\nend\n')
    expect(fs.readFileSync(dir + '/planet.rb', 'utf8'))
      .equal('class Planet\nend\n')
    expect(fs.readdirSync(base + '/app')).equal(['models'])
    expect(fs.readdirSync(dir)).equal(['planet.rb'])

    // A POSIX volume is untouched: no drive, no prefix, same keys as
    // before.
    const posix = memfs({})
    posix.fs.mkdirSync('/top/a/b', { recursive: true })
    expect([...posix.vol.dirs.keys()]).equal(['/', '/top', '/top/a', '/top/a/b'])
  })

})
