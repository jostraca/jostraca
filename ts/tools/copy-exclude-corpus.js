/* Copyright (c) 2024 Richard Rodger, MIT License */

// Cross-stack differential corpus for the COPY EXCLUDE surface.
//
// Why this is its own corpus and not another axis of scenario-corpus.js:
// Copy needs a SOURCE TREE on disk to copy from, and the interesting
// values are about WHICH PATH the exclude is matched against — not about
// the output folder / existing-mode / on-disk-state axes the option
// corpus already crosses. Crossing exclude into the 840 would multiply it
// by ~19 for no new discrimination (exclusion is decided before any
// FileHandler call, so the existing-file modes cannot change WHICH files
// are excluded). See the notes on each axis below for what each value is
// FOR.
//
// Same mechanism as the other corpora — TS's exact output is recorded and
// go/copy_exclude_corpus_test.go replays it and asserts byte equality. If
// it fails, the two stacks have drifted on how a Copy exclude is matched.
// Do not regenerate the corpus to make it pass.

const { memfs } = require('memfs')

const {
  Jostraca,
  Project,
  Folder,
  File,
  Content,
  Copy,
} = require('../dist/jostraca')


const FROZEN_NOW = 1735689600000


// --- The source tree ------------------------------------------------------
//
// Shape is chosen so the exclude axis can DISCRIMINATE:
//
//  - `a.txt` exists at the root AND at `sub/a.txt`, so matching on the
//    BASENAME and matching on the SOURCE-RELATIVE PATH give different
//    answers (this is exactly defect U5: Go matched the basename).
//  - `sub/` is a directory whose relative path a user can name, so
//    "does naming a directory PRUNE its subtree" is observable — and
//    `sub/deep/` makes it observable one level further down, where a
//    prune and a per-file match differ again.
//  - `sub/deep/c.txt` is two levels down, so a suffix-match
//    implementation (`deep/c.txt`) is distinguishable from a full
//    relative match (`sub/deep/c.txt`).
//  - the `~` and `-jostraca-off` entries pin the BUILT-IN ignore rules,
//    which are matched on the NAME, alongside the exclude rules, which
//    are matched on the PATH — the two must not drift into each other.
//    `bak~/x.txt` puts an ignored DIRECTORY in the tree, so the built-in
//    rules are pinned to prune as well.
//
// Every path is ABSOLUTE, so it is independent of the cwd: a relative
// Copy `from` resolves against process.cwd() under memfs and against
// nothing under Go's MemFS, which is a guaranteed mismatch that says
// nothing about excludes. Every directory holds at least one file: memfs
// reports an EMPTY directory as a null entry in vol.toJSON(), which Go's
// MemFS (files only) can never produce, so an empty directory anywhere
// would be a false mismatch too. Symlinks cannot be expressed in this
// corpus at all — memfs's JSON seed has no way to spell one.
const SOURCE = {
  '/src/a.txt': 'ROOT-A $$v$$\n',
  '/src/keep.txt': 'KEEP\n',
  '/src/sub/a.txt': 'SUB-A\n',
  '/src/sub/b.txt': 'SUB-B\n',
  '/src/sub/deep/c.txt': 'DEEP-C\n',
  '/src/bak~/x.txt': 'IN-IGNORED-DIR\n',
  '/src/note.txt~': 'BACKUP\n',
  '/src/off.txt-jostraca-off': 'OFF\n',
}

// Source-relative paths of the files a full (unexcluded) tree copy emits.
const COPIED = ['a.txt', 'keep.txt', 'sub/a.txt', 'sub/b.txt', 'sub/deep/c.txt']


// --- The axes -------------------------------------------------------------

// Where the Copy sits in the OUTPUT tree. Defect V2 turned on exactly
// this: the exclude base used to be the Copy's node path, so the same
// option needed a different spelling depending on whether the Copy sat
// under a Folder (`inner/sub/a.txt`) or at the top (`sub/a.txt`) — an
// artifact of which prop each enclosing component happens to use, since
// Folder contributes a path segment and Project does not. All four
// placements must read the exclude against the SOURCE tree, not the
// output tree, so the SAME spelling has to work in all four.
const PLACEMENTS = [
  { key: 'top', place: 'top' },        // Copy directly under Project
  { key: 'nested', place: 'nested' },  // Copy one Folder deep  <- V2
  { key: 'to', place: 'to' },          // Copy with a `to` subfolder
  { key: 'file', place: 'file' },      // Copy of a single FILE, not a tree
]

// Exclude values. `enc` is the wire form the Go runner decodes:
//   {"bool":b} | {"s":"..."} | {"re":"..."} | {"list":[...]}
//
// The SCALAR spellings (`str-*`, `re-scalar`) are here because a scalar
// String or RegExp is now legal in both stacks: CopyShape used to declare
// `exclude: Optional(One(Boolean, [One(String, RegExp)]))`, which made TS
// reject at define time what Go's `shouldIgnoreCopyPath` honoured, and
// made the scalar arm of `state.excludes` in CopyOp dead code. The
// DIRECTORY entries (`dir-*`, `re-dir`) are here because naming a
// directory now PRUNES its subtree in TS as it always did in Go, instead
// of being the silent no-op it was when the test lived inside
// `excludeFile()` — which only the two FILE branches call.
const EXCLUDES = [
  // control: everything copies
  { key: 'none', enc: null },

  // root basename that ALSO exists one level down: matching the basename
  // drops both, matching the relative path drops only the root one
  { key: 'root-name', enc: { list: [{ s: 'a.txt' }] } },

  // nested relative path: matching the basename drops nothing
  { key: 'nested-path', enc: { list: [{ s: 'sub/a.txt' }] } },

  // a DIRECTORY's relative path: the whole subtree goes, including the
  // level below it (a per-file check would keep sub/deep/c.txt)
  { key: 'dir-name', enc: { list: [{ s: 'sub' }] } },

  // a directory one level down: prunes only c.txt's parent
  { key: 'dir-deep', enc: { list: [{ s: 'sub/deep' }] } },

  // more than one entry, at two depths
  { key: 'multi', enc: { list: [{ s: 'a.txt' }, { s: 'sub/b.txt' }] } },

  // regex against a path PREFIX (whole subtree, matched entry by entry)
  { key: 're-prefix', enc: { list: [{ re: '^sub/' }] } },

  // regex against a path SUFFIX: matches at both depths
  { key: 're-suffix', enc: { list: [{ re: 'a\\.txt$' }] } },

  // regex that matches the DIRECTORY's relative path exactly, so it
  // prunes rather than matching any file
  { key: 're-dir', enc: { list: [{ re: '^sub$' }] } },

  // SCALAR string, the shape used to reject: same answer as the
  // one-element list above
  { key: 'str-root-name', enc: { s: 'a.txt' } },

  // SCALAR string naming a directory: scalar spelling AND prune at once
  { key: 'str-dir', enc: { s: 'sub' } },

  // SCALAR RegExp, which used to fall through and match nothing
  { key: 're-scalar', enc: { re: 'a\\.txt$' } },

  // a glob: excludes are literal or RegExp, never globbed, so this
  // matches NOTHING. Pinned so a future "helpful" glob layer is a
  // deliberate, cross-stack change.
  { key: 'glob', enc: { list: [{ s: '*.txt' }] } },

  // a relative path missing its leading segment: matches nothing unless
  // the implementation is doing a suffix match
  { key: 'partial-path', enc: { list: [{ s: 'deep/c.txt' }] } },

  // the same path spelled ABSOLUTELY: the source-relative path carries no
  // leading slash, so this matches nothing
  { key: 'abs-path', enc: { list: [{ s: '/sub/a.txt' }] } },

  // matches nothing at all
  { key: 'nomatch', enc: { list: [{ s: 'nomatch.txt' }] } },

  // degenerate values: a boolean exclude is not a path matcher (and
  // `false` must not become "exclude everything" either), and an empty
  // list must not become "exclude everything"
  { key: 'bool-true', enc: { bool: true } },
  { key: 'bool-false', enc: { bool: false } },
  { key: 'empty', enc: { list: [] } },
]

// On-disk state at the copy targets, crossed only with the `top`
// placement (see buildCases). An EXCLUDED file that already exists must
// be left byte-identical — no write, no `.old` backup, no diff
// annotation — which is what makes a prune observable in the output tree
// rather than only in what is absent from it.
const STATES = [
  { key: 'fresh', seed: null, existing: null },
  { key: 'seed+preserve', seed: 'USER EDITED\n', existing: { txt: { preserve: true } } },
]


// Decode the wire form into real JS values. The Go runner mirrors this.
function decodeExclude(enc) {
  if (null == enc) return undefined
  if (null != enc.bool) return enc.bool
  if (null != enc.s) return enc.s
  if (null != enc.re) return new RegExp(enc.re)
  if (null != enc.list) return enc.list.map(decodeExclude)
  return undefined
}


// Build the component tree for a placement. The Go runner mirrors this
// EXACTLY — the `place` key is the whole naming contract between the
// two sides.
function treeFor(place, exclude) {
  const props = () => {
    const p = { from: 'file' === place ? '/src/a.txt' : '/src' }
    if ('to' === place) p.to = 'dst'
    if (undefined !== exclude) p.exclude = exclude
    return p
  }
  return () => Project({ folder: 'app' }, () => {
    File({ name: 'marker.txt' }, () => Content('MARKER\n'))
    if ('nested' === place) {
      Folder({ name: 'inner' }, () => Copy(props()))
    }
    else {
      Copy(props())
    }
  })
}


// Where a seeded existing file lands for a given placement, keyed by the
// source-relative path of the copied file.
function targetPrefix(place) {
  if ('nested' === place) return '/out/app/inner'
  if ('to' === place) return '/out/app/dst'
  return '/out/app'
}


async function runCase(spec) {
  const seedFiles = {}
  if (null != spec.seed) {
    const prefix = targetPrefix(spec.place)
    const rels = 'file' === spec.place ? ['a.txt'] : COPIED
    for (const rel of rels) {
      seedFiles[prefix + '/' + rel] = spec.seed
    }
    seedFiles['/out/app/marker.txt'] = spec.seed
  }

  const files = Object.assign({}, SOURCE, seedFiles)
  const { fs, vol } = memfs(files)

  const opts = {
    fs: () => fs,
    folder: '/out',
    now: () => FROZEN_NOW,
    model: { v: 'V' },
  }
  if (null != spec.existing) {
    opts.existing = spec.existing
  }

  const jostraca = Jostraca({})

  let error = false
  try {
    await jostraca.generate(opts, treeFor(spec.place, decodeExclude(spec.exclude)))
  }
  catch (err) {
    error = true
  }

  const out = {}
  for (const [k, v] of Object.entries(vol.toJSON())) {
    // A null value is an EMPTY DIRECTORY. Go's MemFS.Vol() returns files
    // only and can never report one, so recording it (as anything at all)
    // guarantees a mismatch that says nothing about excludes. Fail here,
    // where the source tree can still be fixed, rather than there.
    if (null == v) {
      throw new Error('copy-exclude-corpus: empty directory in output: ' + k +
        ' (case ' + spec.name + ') — every directory must hold a file')
    }
    out[k] = '' + v
  }

  return { out, error, source: files }
}


function buildCases() {
  const cases = []

  for (const p of PLACEMENTS) {
    for (const e of EXCLUDES) {
      for (const st of STATES) {
        // The state axis crosses only the `top` placement: exclusion is
        // decided before any FileHandler call, so the on-disk state
        // cannot change WHICH files are excluded — it only pins that an
        // excluded target is left alone. One placement is enough for
        // that, and the option corpus already crosses the modes.
        if ('fresh' !== st.key && 'top' !== p.key) continue
        cases.push({
          name: [p.key, e.key, st.key].join('/'),
          place: p.place,
          exclude: e.enc,
          seed: st.seed,
          existing: st.existing,
        })
      }
    }
  }

  return cases
}


async function buildCorpus() {
  const cases = buildCases()
  const out = []

  for (const spec of cases) {
    const res = await runCase(spec)
    out.push({
      name: spec.name,
      place: spec.place,
      exclude: spec.exclude,
      seed: spec.seed,
      existing: spec.existing,
      prepopulate: res.source,
      vol: res.out,
      error: res.error,
    })
  }

  return out
}


module.exports = { buildCorpus, buildCases }
