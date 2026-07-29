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
  Copy,
  Inject,
} = require('../dist/jostraca')

// Binary escape hatch: a content value is a plain JSON string when the
// bytes round-trip through UTF-8, and {"b64": "..."} when they do not.
const { enc } = require('./corpus-bytes.js')


const FROZEN_NOW = 1735689600000

// Every case runs with the same model, so a `$$v$$` marker anywhere in the
// inputs resolves to `V`. The text half of the corpus has no marker in it,
// so this changes none of the pre-existing cases; the binary half puts a
// marker INSIDE the binary payload, where substituting it is the visible
// symptom of a misclassification. See BIN_NAMES.
const MODEL = { v: 'V' }


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


// --- The binary-classification axis ---------------------------------------
//
// Which of `existing.txt` / `existing.bin` governs a file is decided by the
// DESTINATION EXTENSION, with content sniffing able to PROMOTE an extension
// the list does not know about to binary, and never to demote a listed one.
// Nothing above reaches that decision: every name here is a text extension
// and every body arrives at `save` as a string, so all 840 cases above take
// `existing.txt` no matter which rule is in force.
//
// TEETH. A binary case with no marker in it is worth nothing: Go strings are
// byte-transparent, so a text path that templates, decodes and re-encodes
// arbitrary bytes is a NO-OP on them, and the case stays byte-identical even
// when the classification is wrong. That was measured when the first binary
// scenario was added. So each binary payload carries
//
//   - a `$$v$$` marker, which the TEXT path substitutes for `V`
//   - bytes that are not valid UTF-8, which the TEXT path collapses to U+FFFD
//   - a NUL, which is what the content sniff keys on
//
// and the two rules are then separately observable:
//
//   a.png   LISTED extension, reached through File+Content, so its body is a
//           STRING. Classifying by the VALUE TYPE (what TS did before #27)
//           sends it to `existing.txt`; classifying by the EXTENSION sends it
//           to `existing.bin`. This is the case that separates the two rules.
//   a.wasm  UNLISTED extension holding BINARY bytes, reached through Copy.
//           Only the content sniff can classify it, and it is the case the
//           extension rule alone gets wrong (U3/T5).
//   b.png   LISTED extension holding BINARY bytes, reached through Copy —
//           the control for a.wasm: no sniff needed, the extension decides.
//   a.txt   ordinary text control, so the same run still proves a `bin` mode
//           does not leak onto a text file.
//
// Measured: reverting #27 to value-type classification moves 126 of the 1197
// cases (the a.png rows), disabling the sniff moves 126 (the a.wasm rows),
// the two sets overlap only on `mix`, and ZERO of the 840 text cases move
// under either. The pre-existing corpus could not see this question at all.
//
// WHAT IS NOT HERE, and why. A Copy-routed file has no `same` state: see
// binStates(). The two stacks disagree about it today, and per §2.12 a
// differential corpus must not record an expectation for behaviour the
// stacks disagree about — that freezes whichever side ran the generator.

// `\0asm` magic (the NUL the sniff keys on), a template marker, then bytes
// that are not valid UTF-8.
const WASM_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
  Buffer.from('$$v$$', 'utf8'),
  Buffer.from([0xff, 0xfe, 0x80]),
])

// PNG magic, same marker, same invalid tail.
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('$$v$$', 'utf8'),
  Buffer.from([0x00, 0xff, 0xc0]),
])

// Pre-existing on-disk bytes for the `changed` state of a binary file —
// binary in its own right, and deliberately NOT valid UTF-8, so the corpus
// carries it through the b64 escape hatch too.
const OLD_BIN_BYTES = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x02])

// Where Copy sources live. Absolute, so it is outside every output folder on
// the FOLDERS axis and lands in the recorded tree unchanged.
const SRCDIR = '/src'

const TXT_BODY = 'GENERATED\n'

// A file spec is { name, kind, body }:
//   kind 'file'  File({name}) + Content(body)        — body is a string
//   kind 'copy'  Copy({from: SRCDIR/name, to: name}) — body is the SOURCE bytes
// A binary copy passes its bytes through untouched, so `body` is also the
// generated output.
const BIN_NAMES = [
  {
    key: 'png-file',
    files: [{ name: 'a.png', kind: 'file', body: TXT_BODY }],
  },
  {
    // Copy-free, so it keeps the `same` state that the copy rows below have
    // to give up — this is where a `bin` mode meeting an EQUAL-content file,
    // and its text sibling, are still checked.
    key: 'pngtxt-file',
    files: [
      { name: 'a.png', kind: 'file', body: TXT_BODY },
      { name: 'a.txt', kind: 'file', body: TXT_BODY },
    ],
  },
  {
    key: 'wasm-copy',
    files: [{ name: 'a.wasm', kind: 'copy', body: WASM_BYTES }],
  },
  {
    key: 'png-copy',
    files: [{ name: 'b.png', kind: 'copy', body: PNG_BYTES }],
  },
  {
    key: 'mix',
    files: [
      { name: 'a.png', kind: 'file', body: TXT_BODY },
      { name: 'a.wasm', kind: 'copy', body: WASM_BYTES },
      { name: 'a.txt', kind: 'file', body: TXT_BODY },
    ],
  },
]

// Existing-file modes for the binary axis. `bin` has NO diff and NO merge —
// both shape validators reject them (TS: 'the property "diff" is not
// allowed'; Go: ExistingBin has no such field), so none are generated.
//
// Each row pairs a `txt` mode with a DIFFERENT `bin` mode, so a file that
// lands on the wrong side of the classification is visible in the output
// tree rather than merely mislabelled.
const BIN_EXISTING = [
  { key: 'bin-write', existing: { bin: { write: true } } },
  { key: 'bin-preserve', existing: { bin: { preserve: true } } },
  { key: 'bin-present', existing: { bin: { write: false, present: true } } },
  { key: 'bin-nowrite', existing: { bin: { write: false } } },
  // U3 exactly: a misclassified binary gets textual conflict markers.
  {
    key: 'txtdiff+binpreserve',
    existing: { txt: { diff: true }, bin: { preserve: true } },
  },
  // `bin` has no merge, so a misclassified binary would be three-way merged.
  {
    key: 'txtmerge+binpresent',
    existing: { txt: { merge: true }, bin: { write: false, present: true } },
  },
  // The inverse of bin-preserve: only a file classified TEXT gets the .old.
  {
    key: 'txtpreserve+binwrite',
    existing: { txt: { preserve: true } },
  },
]

// Folder subset for the binary axis. Classification itself is
// folder-independent, so the full six-way cross would triple the corpus to
// buy nothing; these are the three DISTINCT branches of
// FileHandler.relative()/withinFolder(): the `.` special case, a relative
// prefix, and an absolute prefix. `dot` collapses onto `unset` (both give
// folder `.`), `dotrel` onto `rel` (`./out` normalises to `out`), and
// `nested` is another relative prefix. See the note in buildCases().
const BIN_FOLDERS = [
  { key: 'unset', folder: undefined },
  { key: 'rel', folder: 'out' },
  { key: 'abs', folder: '/abs' },
]

// On-disk state for the binary axis. Same four shapes as STATE, but the
// seed for a binary file has to be BYTES: `changed` seeds real binary that
// does not survive a UTF-8 round-trip, and `same` seeds each file with its
// own generated output so the content-equality paths engage.
const BIN_STATE = [
  { key: 'fresh', seed: null },
  { key: 'same', seed: 'same' },
  { key: 'changed', seed: 'changed' },
  { key: 'empty', seed: '' },
]


// The states that are generated for a given name row.
//
// A Copy-routed file loses `same`, and this is a REAL HOLE rather than a
// tidy-up, so it is stated here rather than buried in a filter.
//
// Content copied from a binary source reaches `FileHandler.save` as a
// Buffer. `save` then compares it for equality against what it loaded from
// disk — which `loadFile` hands back as a UTF-8 STRING — so the test is
// `string !== Buffer` and is true whatever the bytes are: TS treats a
// Copy-routed binary as CHANGED even when the target already holds exactly
// those bytes. Go compares with bytes.Equal and sees them as equal. The
// difference is visible whenever a mode keys off content equality: with
// `bin.preserve` TS writes a `.old` backup of a file it is about to rewrite
// identically, and with `bin.present` a `.new` sidecar identical to the
// target. Measured: exactly 36 of the 3 x 7 x 4 x 4 cross failed, all of
// them `same` x Copy-routed x a preserve/present mode.
//
// Recording TS's output for those would pin a Buffer-vs-string comparison
// artifact as canonical, which is precisely what CODE_REVIEW.md §2.12 says
// a differential corpus must not do. So `same` is dropped for the ROUTE,
// not for the four mode rows where it happens to show — dropping only the
// latter would be shaping the corpus to pass. `pngtxt-file` above keeps the
// `same` state on the copy-free side.
function binStates(names) {
  if (names.files.some((file) => 'copy' === file.kind)) {
    return BIN_STATE.filter((st) => 'same' !== st.key)
  }
  return BIN_STATE
}


// Resolve the on-disk seed for one file spec under one BIN_STATE row.
function binSeed(state, file) {
  if (null == state.seed) {
    return null
  }
  if ('same' === state.seed) {
    return file.body
  }
  if ('changed' === state.seed) {
    return Buffer.isBuffer(file.body) ? OLD_BIN_BYTES : 'USER EDITED\n'
  }
  return state.seed
}


// Build the component tree for a set of file specs. Names containing `/`
// get a Folder wrapper; an empty grouping Folder keeps them all under one
// root node (two BARE top-level siblings hit a separate, pre-existing bug).
function treeFor(files) {
  const emit = (file) => {
    const at = file.name.lastIndexOf('/')
    const base = at < 0 ? file.name : file.name.substring(at + 1)
    const one = () => {
      if ('copy' === file.kind) {
        Copy({ from: SRCDIR + '/' + base, to: base })
      }
      else {
        File({ name: base }, () => Content(file.body))
      }
    }
    if (at < 0) {
      one()
    }
    else {
      Folder({ name: file.name.substring(0, at) }, one)
    }
  }

  return () => Folder({}, () => {
    for (const file of files) {
      emit(file)
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

  const write = (full, content) => {
    fs.mkdirSync(full.substring(0, full.lastIndexOf('/')), { recursive: true })
    fs.writeFileSync(full, content)
  }

  // Copy sources sit OUTSIDE the output folder, at an absolute path, so
  // they are identical for every folder setting.
  for (const file of spec.files) {
    if ('copy' === file.kind) {
      const at = file.name.lastIndexOf('/')
      write(SRCDIR + '/' + (at < 0 ? file.name : file.name.substring(at + 1)),
        file.body)
    }
  }

  for (const file of spec.files) {
    if (null != file.seed) {
      write(prefix + '/' + file.name, file.seed)
    }
  }

  // A merge needs a baseline to take its real path rather than the
  // no-baseline fallback.
  if (spec.baseline) {
    for (const file of spec.files) {
      write(prefix + '/.jostraca/generated/' + file.name, spec.baseline)
    }
  }

  const opts = {
    fs: () => fs,
    now: () => FROZEN_NOW,
    model: MODEL,
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
    await jostraca.generate(opts, treeFor(spec.files))
  }
  catch (err) {
    error = true
  }

  // Whole output tree, with the machine-specific cwd prefix stripped so a
  // relative folder yields the same keys the Go MemFS produces. Values go
  // through `enc`, so bytes that do not survive a UTF-8 round-trip are
  // recorded as {"b64": "..."} rather than lossily decoded.
  const cwd = process.cwd() + '/'
  const out = {}
  for (const [k, v] of Object.entries(vol.toJSON())) {
    const key = k.startsWith(cwd) ? k.substring(cwd.length) : k
    out[key] = null == v ? '' : enc(fs.readFileSync(k))
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
            baseline: 'merge' === e.key ? 'BASELINE\n' : null,
            names: n.names,
            files: n.names.map((name) => ({
              name,
              kind: 'file',
              body: TXT_BODY,
              seed: st.seed,
            })),
          })
        }
      }
    }
  }

  // The binary-classification block. Deliberately NOT the full six-folder
  // cross — see BIN_FOLDERS. It is also not crossed with the seven text-only
  // EXISTING rows above, nor the five text NAMES rows: a `bin` mode cannot
  // reach a `.txt` file, and a `txt`-only mode cannot tell the two
  // classification rules apart, so those products record nothing the `mix`
  // row does not already prove. Copy-routed rows lose the `same` state; see
  // binStates(). 3 x 7 x (2 rows x 4 states + 3 rows x 3 states) = 357.
  for (const f of BIN_FOLDERS) {
    for (const e of BIN_EXISTING) {
      for (const n of BIN_NAMES) {
        for (const st of binStates(n)) {
          cases.push({
            name: [f.key, e.key, st.key, n.key].join('/'),
            folder: f.folder,
            existing: e.existing,
            seed: null,
            baseline: e.existing.txt && e.existing.txt.merge ? 'BASELINE\n' : null,
            names: n.files.map((file) => file.name),
            files: n.files.map((file) => ({
              ...file,
              seed: binSeed(st, file),
            })),
          })
        }
      }
    }
  }

  return cases
}


// A case only carries the extra binary fields when it needs them, so the
// text half of the corpus keeps the exact JSON it had before this axis
// existed and the regenerate-and-diff CI gate still produces legible diffs.
function encodeCase(spec, res) {
  const binary = spec.files.some((file) => 'copy' === file.kind)

  const out = {
    name: spec.name,
    folder: null == spec.folder ? null : spec.folder,
    existing: null == spec.existing ? null : spec.existing,
    seed: spec.seed,
    baseline: spec.baseline,
    names: spec.names,
    vol: res.out,
    error: res.error,
  }

  // Only the binary block needs per-file seeds/bodies/routes; the text
  // block is fully described by `names` + `seed` as it always was.
  if (binary || spec.files.some((file) => file.seed !== spec.seed)) {
    out.files = spec.files.map((file) => ({
      name: file.name,
      kind: file.kind,
      body: enc(file.body),
      seed: null == file.seed ? null : enc(file.seed),
    }))
    out.sources = {}
    for (const file of spec.files) {
      if ('copy' === file.kind) {
        const at = file.name.lastIndexOf('/')
        const base = at < 0 ? file.name : file.name.substring(at + 1)
        out.sources[SRCDIR + '/' + base] = enc(file.body)
      }
    }
  }

  return out
}


async function buildCorpus() {
  const cases = buildCases()
  const out = []

  for (const spec of cases) {
    const res = await runCase(spec)
    out.push(encodeCase(spec, res))
  }

  return out
}


module.exports = { buildCorpus, buildCases }
