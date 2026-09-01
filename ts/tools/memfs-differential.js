/* Copyright (c) 2024 Richard Rodger, MIT License */

// Differential harness: src/util/memfs.ts against the `memfs` package it
// replaces. Same approach used when `jsonic` was inlined (b15f1fd) -- run
// both implementations through identical operation sequences and compare
// results, errors and the resulting volume byte for byte.
//
//   node tools/memfs-differential.js
//
// Exits non-zero on any divergence. Requires the `memfs` package to be
// installed; once it is gone from devDependencies this script is a manual
// tool, not part of `npm test`.

const Assert = require('node:assert')

// `memfs` is deliberately NOT a dependency any more -- it is the thing this
// replaced. Install it on the side to re-run the comparison:
//
//   npm i --no-save memfs && node tools/memfs-differential.js
//
// Without it there is nothing to compare against, so skip rather than fail:
// a tool that cannot run is worse than one that says why.
let refMemfs
try {
  refMemfs = require('memfs').memfs
}
catch (err) {
  console.log('memfs differential: SKIPPED -- the `memfs` package is not installed.')
  console.log('  npm i --no-save memfs && node tools/memfs-differential.js')
  process.exit(0)
}

const { memfs: ourMemfs } = require('../dist/util/memfs')

let pass = 0
const fails = []

// Normalise an outcome so the two implementations can be compared: either a
// value, or the error code (messages are compared separately and loosely,
// since only `.code` is branched on in src).
function run(fn) {
  try {
    const val = fn()
    return { ok: true, val: Buffer.isBuffer(val) ? 'Buffer:' + val.toString('hex') : val }
  }
  catch (err) {
    return { ok: false, code: err.code, msg: err.message }
  }
}

function differential(name, seed, ops) {
  const ref = refMemfs(seed)
  const our = ourMemfs(seed)

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    const a = run(() => op(ref.fs))
    const b = run(() => op(our.fs))

    if (a.ok !== b.ok || JSON.stringify(a.val) !== JSON.stringify(b.val) || a.code !== b.code) {
      fails.push({
        name, step: i,
        memfs: a, ours: b,
      })
      return
    }
  }

  // The volumes must agree too, not just the individual calls.
  const rj = ref.vol.toJSON()
  const oj = our.vol.toJSON()
  if (JSON.stringify(rj) !== JSON.stringify(oj)) {
    fails.push({ name, step: 'toJSON', memfs: rj, ours: oj })
    return
  }

  pass++
}


const W = (p, d, o) => (fs) => { fs.writeFileSync(p, d, o); return 'w' }
const MK = (p, o) => (fs) => { fs.mkdirSync(p, o); return 'm' }


// --- basic write / read round trips ------------------------------------
differential('write-read-utf8', {}, [
  MK('/a', { recursive: true }),
  W('/a/t.txt', 'hello'),
  (fs) => fs.readFileSync('/a/t.txt', 'utf8'),
  (fs) => fs.readFileSync('/a/t.txt'),
  (fs) => fs.readFileSync('/a/t.txt', { encoding: 'utf8' }),
  (fs) => fs.readFileSync('/a/t.txt', { encoding: null }),
])

differential('write-read-binary', {}, [
  MK('/b', { recursive: true }),
  W('/b/x.dat', Buffer.from([0x00, 0xFF, 0x41, 0x80])),
  (fs) => fs.readFileSync('/b/x.dat'),
  (fs) => fs.statSync('/b/x.dat').size,
])

differential('overwrite', {}, [
  MK('/o', { recursive: true }),
  W('/o/f.txt', 'one'),
  W('/o/f.txt', 'two'),
  (fs) => fs.readFileSync('/o/f.txt', 'utf8'),
])


// --- errors -------------------------------------------------------------
differential('read-missing', {}, [
  (fs) => fs.readFileSync('/nope'),
])

differential('read-dir-is-eisdir', {}, [
  MK('/d', { recursive: true }),
  (fs) => fs.readFileSync('/d'),
])

differential('write-no-parent', {}, [
  W('/missing/f.txt', 'x'),
])

differential('wx-flag', {}, [
  MK('/w', { recursive: true }),
  W('/w/f.txt', 'a', { flag: 'wx' }),
  W('/w/f.txt', 'b', { flag: 'wx' }),
])

differential('stat-missing', {}, [
  (fs) => fs.statSync('/nope'),
])

differential('stat-missing-nothrow', {}, [
  (fs) => fs.statSync('/nope', { throwIfNoEntry: false }),
])

differential('unlink-missing', {}, [
  (fs) => fs.unlinkSync('/nope'),
])

differential('rename-missing', {}, [
  (fs) => fs.renameSync('/nope', '/x'),
])

differential('readdir-missing', {}, [
  (fs) => fs.readdirSync('/nope'),
])

differential('readdir-on-file', {}, [
  MK('/r', { recursive: true }),
  W('/r/f.txt', 'x'),
  (fs) => fs.readdirSync('/r/f.txt'),
])

differential('mkdir-existing-plain', {}, [
  MK('/m', { recursive: true }),
  MK('/m'),
])

differential('mkdir-existing-recursive', {}, [
  MK('/m', { recursive: true }),
  MK('/m', { recursive: true }),
])


// --- directories --------------------------------------------------------
differential('mkdir-deep-and-list', {}, [
  MK('/x/y/z', { recursive: true }),
  W('/x/y/z/a.txt', 'A'),
  W('/x/y/b.txt', 'B'),
  (fs) => fs.readdirSync('/x/y').sort(),
  (fs) => fs.readdirSync('/x/y/z').sort(),
  (fs) => fs.existsSync('/x'),
  (fs) => fs.existsSync('/x/y/z'),
  (fs) => fs.statSync('/x/y').isDirectory(),
  (fs) => fs.statSync('/x/y/z/a.txt').isFile(),
])

differential('empty-dir-in-toJSON', {}, [
  MK('/empty', { recursive: true }),
  MK('/full', { recursive: true }),
  W('/full/f.txt', 'F'),
])


// --- seeding ------------------------------------------------------------
differential('seed-flat', { '/s/a.txt': 'A', '/s/sub/b.txt': 'B' }, [
  (fs) => fs.readFileSync('/s/a.txt', 'utf8'),
  (fs) => fs.readFileSync('/s/sub/b.txt', 'utf8'),
  (fs) => fs.existsSync('/s'),
  (fs) => fs.existsSync('/s/sub'),
  (fs) => fs.readdirSync('/s').sort(),
])

differential('seed-empty-object', {}, [
  (fs) => fs.existsSync('/'),
])


// --- rename / unlink ----------------------------------------------------
differential('rename-file', {}, [
  MK('/rn', { recursive: true }),
  W('/rn/src.txt', 'S'),
  (fs) => { fs.renameSync('/rn/src.txt', '/rn/dst.txt'); return 'r' },
  (fs) => fs.readFileSync('/rn/dst.txt', 'utf8'),
  (fs) => fs.existsSync('/rn/src.txt'),
])

differential('rename-over-existing', {}, [
  MK('/rn', { recursive: true }),
  W('/rn/src.txt', 'S'),
  W('/rn/dst.txt', 'D'),
  (fs) => { fs.renameSync('/rn/src.txt', '/rn/dst.txt'); return 'r' },
  (fs) => fs.readFileSync('/rn/dst.txt', 'utf8'),
  (fs) => fs.existsSync('/rn/src.txt'),
])

differential('unlink-file', {}, [
  MK('/u', { recursive: true }),
  W('/u/f.txt', 'F'),
  (fs) => { fs.unlinkSync('/u/f.txt'); return 'u' },
  (fs) => fs.existsSync('/u/f.txt'),
  (fs) => fs.existsSync('/u'),
])


// --- modes --------------------------------------------------------------
differential('mode-default-file', {}, [
  MK('/md', { recursive: true }),
  W('/md/f.txt', 'F'),
  (fs) => fs.statSync('/md/f.txt').mode & 0o7777,
])

differential('mode-on-write', {}, [
  MK('/md', { recursive: true }),
  W('/md/f.txt', 'F', { mode: 0o755 }),
  (fs) => fs.statSync('/md/f.txt').mode & 0o7777,
])

differential('chmod', {}, [
  MK('/md', { recursive: true }),
  W('/md/f.txt', 'F'),
  (fs) => { fs.chmodSync('/md/f.txt', 0o600); return 'c' },
  (fs) => fs.statSync('/md/f.txt').mode & 0o7777,
])

differential('mode-survives-rename', {}, [
  MK('/md', { recursive: true }),
  W('/md/a.txt', 'A', { mode: 0o700 }),
  (fs) => { fs.renameSync('/md/a.txt', '/md/b.txt'); return 'r' },
  (fs) => fs.statSync('/md/b.txt').mode & 0o7777,
])


// --- append -------------------------------------------------------------
differential('append-existing', {}, [
  MK('/ap', { recursive: true }),
  W('/ap/f.txt', 'A'),
  (fs) => { fs.appendFileSync('/ap/f.txt', 'B'); return 'a' },
  (fs) => fs.readFileSync('/ap/f.txt', 'utf8'),
])

differential('append-creates', {}, [
  MK('/ap', { recursive: true }),
  (fs) => { fs.appendFileSync('/ap/new.txt', 'N'); return 'a' },
  (fs) => fs.readFileSync('/ap/new.txt', 'utf8'),
])


// --- symlink ------------------------------------------------------------
differential('dangling-symlink', {}, [
  MK('/sl', { recursive: true }),
  W('/sl/keep.txt', 'K'),
  (fs) => { fs.symlinkSync('/sl/nonexistent', '/sl/broken'); return 's' },
  (fs) => fs.readdirSync('/sl').sort(),
  (fs) => fs.existsSync('/sl/broken'),
  (fs) => fs.statSync('/sl/broken'),
])


// --- path normalisation -------------------------------------------------
differential('dot-segments', {}, [
  MK('/p/q', { recursive: true }),
  W('/p/q/../f.txt', 'F'),
  (fs) => fs.readFileSync('/p/f.txt', 'utf8'),
  (fs) => fs.existsSync('/p/./f.txt'),
])

differential('trailing-slash', {}, [
  MK('/ts/', { recursive: true }),
  W('/ts/f.txt', 'F'),
  (fs) => fs.readdirSync('/ts/').sort(),
  (fs) => fs.existsSync('/ts'),
])


// --- toJSON ordering ----------------------------------------------------
// toJSON is a depth-first walk taking each directory's children in creation
// order, NOT a flat creation-order listing. These cases separate the two: a
// flat listing interleaves the subtrees, a tree walk keeps them contiguous.
// (The first version of the replacement passed every case above and still
// reordered 1583 lines of the parity corpus, which is what these pin.)
differential('toJSON-interleaved-subtrees', {}, [
  MK('/out/a', { recursive: true }),
  MK('/out/b', { recursive: true }),
  W('/out/a/1.txt', '1'),
  W('/out/b/1.txt', '1'),
  W('/out/a/2.txt', '2'),
  W('/out/b/2.txt', '2'),
])

differential('toJSON-late-file-under-early-dir', {}, [
  MK('/z/early', { recursive: true }),
  W('/z/early/first.txt', 'F'),
  MK('/z/later', { recursive: true }),
  W('/z/later/x.txt', 'X'),
  W('/z/early/second.txt', 'S'),
])

differential('toJSON-sibling-order-within-dir', {}, [
  MK('/s', { recursive: true }),
  W('/s/zebra.txt', 'z'),
  W('/s/apple.txt', 'a'),
  MK('/s/mango', { recursive: true }),
  W('/s/banana.txt', 'b'),
  W('/s/mango/inner.txt', 'i'),
  (fs) => fs.readdirSync('/s'),
])

differential('toJSON-nested-depth', {}, [
  MK('/n/a/b/c', { recursive: true }),
  W('/n/a/b/c/deep.txt', 'D'),
  W('/n/a/shallow.txt', 'S'),
  W('/n/top.txt', 'T'),
])


// Entry-position rules. FileHandler writes every file through
// temp-then-rename, so these decide where each generated file lands in
// toJSON -- and therefore in the parity corpus.
differential('order-rename-onto-existing', {}, [
  MK('/d', { recursive: true }),
  W('/d/a.txt', 'A'),
  W('/d/b.txt', 'B'),
  W('/d/tmp', 'T'),
  (fs) => { fs.renameSync('/d/tmp', '/d/a.txt'); return 'r' },
])

differential('order-rename-to-new-name', {}, [
  MK('/d', { recursive: true }),
  W('/d/a.txt', 'A'),
  W('/d/b.txt', 'B'),
  W('/d/tmp', 'T'),
  (fs) => { fs.renameSync('/d/tmp', '/d/c.txt'); return 'r' },
])

differential('order-unlink-then-recreate', {}, [
  MK('/d', { recursive: true }),
  W('/d/a.txt', 'A'),
  W('/d/b.txt', 'B'),
  (fs) => { fs.unlinkSync('/d/a.txt'); return 'u' },
  W('/d/a.txt', 'A2'),
])

differential('order-overwrite-in-place', {}, [
  MK('/d', { recursive: true }),
  W('/d/a.txt', 'A'),
  W('/d/b.txt', 'B'),
  W('/d/a.txt', 'A2'),
])


// --- report -------------------------------------------------------------
console.log(`memfs differential: ${pass} passed, ${fails.length} failed`)

if (0 < fails.length) {
  for (const f of fails) {
    console.log('\nFAIL:', f.name, 'at step', f.step)
    console.log('  memfs:', JSON.stringify(f.memfs))
    console.log('  ours :', JSON.stringify(f.ours))
  }
  process.exit(1)
}

Assert.ok(0 < pass)
console.log('all differential cases byte-identical')
