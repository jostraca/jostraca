/* Copyright (c) 2024 Richard Rodger, MIT License */

// Cross-stack differential corpus for the OPTION SURFACE.
//
// Why this exists: every defect found on this branch by review — and there
// have been thirteen — needed a DEFAULT, a DEGENERATE VALUE, or an OPTION
// COMBINATION to reach. Not unusual content. The list is worth reading:
//
//   `.` folder path strip     a test using the DEFAULT folder
//   copy visited unwind       a symlink that is not an ancestor loop
//   temp collision            a pre-existing file at the temp path
//   mode on unchanged         `mode` COMBINED with equal content
//   mode on diff/merge        `mode` COMBINED with an existing mode
//   dlog cursor               a FULL buffer
//   empty inject marker       a DEGENERATE marker value
//   fragment double-resolve   a RELATIVE non-`.` folder
//   leading-dot strip         a DOTFILE at the top level
//
// The diff and template corpora vary content exhaustively while holding
// options at typical values, so none of these were reachable from them.
// This corpus does the opposite: modest content, exhaustive options.
//
// Same mechanism as the others — TS's exact output is recorded here and
// go/scenario_corpus_test.go replays it and asserts byte equality. If it
// fails, the stacks have drifted; do not regenerate to make it pass.

const { memfs } = require('memfs')

const {
  Jostraca,
  Project,
  Folder,
  File,
  Content,
  Inject,
} = require('../dist/jostraca')


const FROZEN_NOW = 1735689600000


// --- The axes -------------------------------------------------------------

// Output folder. The default (unset) and `.` are the two that no test
// touched before this branch, and both turned out to be broken.
const FOLDERS = [
  { key: 'unset', folder: undefined },
  { key: 'dot', folder: '.' },
  { key: 'rel', folder: 'out' },
  { key: 'dotrel', folder: './out' },
  { key: 'abs', folder: '/abs' },
  { key: 'nested', folder: 'a/b' },
]

// Existing-file mode. `write` is the default; the rest are the documented
// alternatives, plus the two-mode combination that G7 was about.
const EXISTING = [
  { key: 'write', existing: undefined },
  { key: 'preserve', existing: { txt: { preserve: true } } },
  { key: 'diff', existing: { txt: { diff: true } } },
  { key: 'merge', existing: { txt: { merge: true } } },
  { key: 'present', existing: { txt: { write: false, present: true } } },
  { key: 'nowrite', existing: { txt: { write: false } } },
  { key: 'preserve+diff', existing: { txt: { preserve: true, diff: true } } },
]

// What is already on disk when the generate runs. `same` is the one that
// makes content-equality fast paths engage.
const STATE = [
  { key: 'fresh', seed: null },
  { key: 'same', seed: 'GENERATED\n' },
  { key: 'changed', seed: 'USER EDITED\n' },
  { key: 'empty', seed: '' },
]

// File-name shapes. The dotfile at top level is the one that collapsed
// onto its non-dot sibling.
const NAMES = [
  { key: 'plain', names: ['a.txt'] },
  { key: 'dotfile', names: ['.env'] },
  { key: 'dot-and-plain', names: ['.env', 'env'] },
  { key: 'nested', names: ['sub/a.txt'] },
  { key: 'two', names: ['a.txt', 'b.txt'] },
]


// Build the component tree for a set of names. Names containing `/` get a
// Folder wrapper; an empty grouping Folder keeps them all under one root
// node (two BARE top-level siblings hit a separate, pre-existing bug).
function treeFor(names, body) {
  return () => Folder({}, () => {
    for (const name of names) {
      const at = name.lastIndexOf('/')
      if (at < 0) {
        File({ name }, () => Content(body))
      }
      else {
        Folder({ name: name.substring(0, at) }, () => {
          File({ name: name.substring(at + 1) }, () => Content(body))
        })
      }
    }
  })
}


// Absolute prefix for a given folder setting, so seeded files land where
// the generate will look for them.
function seedPrefix(folder) {
  if (null == folder || '.' === folder) return '/work'
  if (folder.startsWith('/')) return folder
  return '/work/' + folder.replace(/^\.\//, '')
}


async function runCase(spec) {
  const { fs, vol } = memfs({})

  // A RELATIVE folder is passed through exactly as a caller would write
  // it, which is the whole point — `.` and `out` are the settings that hid
  // the two worst defects on this branch, and rooting them under an
  // absolute prefix would test something else entirely.
  //
  // memfs resolves a relative path against process.cwd(), so its volume
  // keys come back absolute and machine-specific. That is an artifact of
  // the FS layer, not of jostraca, so the cwd prefix is stripped from the
  // recorded keys below and Go replays against the same relative tree.
  const folder = spec.folder
  const relative = null == folder || !folder.startsWith('/')
  const prefix = relative ?
    process.cwd() + (null == folder || '.' === folder ? '' :
      '/' + folder.replace(/^\.\//, '')) :
    folder

  if (null != spec.seed) {
    for (const name of spec.names) {
      const full = prefix + '/' + name
      fs.mkdirSync(full.substring(0, full.lastIndexOf('/')), { recursive: true })
      fs.writeFileSync(full, spec.seed)
    }
  }

  // A merge needs a baseline to take its real path rather than the
  // no-baseline fallback.
  if (spec.baseline) {
    for (const name of spec.names) {
      const full = prefix + '/.jostraca/generated/' + name
      fs.mkdirSync(full.substring(0, full.lastIndexOf('/')), { recursive: true })
      fs.writeFileSync(full, spec.baseline)
    }
  }

  const opts = {
    fs: () => fs,
    now: () => FROZEN_NOW,
  }
  if (null != folder) {
    opts.folder = folder
  }
  if (null != spec.existing) {
    opts.existing = spec.existing
  }

  const jostraca = Jostraca({})

  let error = false
  try {
    await jostraca.generate(opts, treeFor(spec.names, 'GENERATED\n'))
  }
  catch (err) {
    error = true
  }

  // Whole output tree, with the machine-specific cwd prefix stripped so a
  // relative folder yields the same keys the Go MemFS produces.
  const cwd = process.cwd() + '/'
  const out = {}
  for (const [k, v] of Object.entries(vol.toJSON())) {
    const key = k.startsWith(cwd) ? k.substring(cwd.length) : k
    out[key] = null == v ? '' : '' + v
  }

  return { out, error }
}


function buildCases() {
  const cases = []

  for (const f of FOLDERS) {
    for (const e of EXISTING) {
      for (const st of STATE) {
        for (const n of NAMES) {
          cases.push({
            name: [f.key, e.key, st.key, n.key].join('/'),
            folder: f.folder,
            existing: e.existing,
            seed: st.seed,
            names: n.names,
            // merge only engages properly with a baseline present
            baseline: 'merge' === e.key ? 'BASELINE\n' : null,
          })
        }
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
      folder: null == spec.folder ? null : spec.folder,
      existing: null == spec.existing ? null : spec.existing,
      seed: spec.seed,
      baseline: spec.baseline,
      names: spec.names,
      vol: res.out,
      error: res.error,
    })
  }

  return out
}


module.exports = { buildCorpus, buildCases }
