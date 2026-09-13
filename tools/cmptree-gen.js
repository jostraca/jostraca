// Generate files from a component tree given as JSON.
//
//   aontu model.aon | node tools/cmptree-gen.js --at out --folder ./build
//   aontu gen.aon   | node tools/cmptree-gen.js --at out --check ./app
//   node tools/cmptree-gen.js --folder ./build tree.json
//
// This is the whole aontu integration: aontu evaluates a model to a
// component tree (its Folder/File/Content primitives), prints it as
// JSON, and this reads that JSON and hands it to jostraca's own
// components through `cmpTree` (ts/src/tree.ts). Neither project
// depends on the other; the contract is the JSON shape.
//
//   --folder <dir>   output folder (default: .)
//   --check <dir>    generate into memory and compare with <dir>;
//                    write nothing, and exit 1 on drift
//   --at <key>       take the tree from this top-level key of the JSON
//                    (aontu prints the whole document, and the tree is
//                    usually one field of it)
//   --dryrun         report what would be written, write nothing
//   --template       render `$$...$$` from the generate model, which is
//                    OFF by default here (see RAW below)
//
// A file argument reads that file; with none, the tree is read from
// stdin.
//
// Exit: 0 clean, 1 drift under --check, 2 usage or I/O.
//
// RAW IS THE DEFAULT HERE, AND IS NOT THE LIBRARY DEFAULT. `Content`
// and `Line` template what they are handed, so a `$$...$$` sequence in
// a shell script, a makefile, a doc comment or a regex is substituted
// from the generate model -- wrong output, exit 0, no diagnostic. That
// is right for a generator written at the call site, which wrote the
// `$$` deliberately, and wrong for this tool, whose input is final text
// somebody else evaluated. So `cmpTree(tree, {raw: true})`, and
// `--template` for the caller who does want the model in scope.
//
// This used to be `model: {}` instead, which is NOT the same guard:
// `$$"quoted"$$` renders its own literal and `$$__JOSTRACA_REPLACE__$$`
// renders the matcher, both with no model at all.
//
// --check IS A PURE FUNCTION OF THE TREE. The output folder is shadowed
// by an in-memory filesystem, so nothing already on disk under <dir>
// can change what the generators produce: no existing-file mode fires,
// no `exclude` skips a comparison, and no file is written anywhere.
// Reads OUTSIDE <dir> fall through to the real filesystem, so the
// components that read a file -- `Fragment`, `CopyFiles` -- work as
// they do on a write run. The one that cannot is `Inject`, which
// rewrites a file that already exists: under --check the output tree is
// not visible to the run, so an Inject into a file the same run does
// not also create is refused rather than silently passed.

const Fs = require('node:fs')
const Path = require('node:path')

const { Jostraca, cmpTree, DiffUtil } = require('../ts/dist/jostraca')

// jostraca's own bookkeeping: a meta log and its .gitignore, under the
// output folder. Timestamped, so never byte-stable, and never part of
// what a generator claims to produce. --check does not compare it.
const META_FOLDER = '.jostraca'

// How much of a drifted file to print. A CI log is read by someone
// deciding whether to look, not instead of looking: enough to recognise
// the change, never the whole file.
const HUNK_LIMIT = 3
const HUNK_LINES = 3

const EXIT_OK = 0
const EXIT_DRIFT = 1
const EXIT_USAGE = 2


function usage(msg) {
  if (msg) {
    process.stderr.write('cmptree-gen: ' + msg + '\n')
  }
  process.stderr.write(
    'Usage: cmptree-gen [--folder <dir> | --check <dir>] [--at <key>]\n' +
    '                   [--dryrun] [--template] [file]\n')
  process.exit(msg ? EXIT_USAGE : EXIT_OK)
}


// The value of an option, refusing another option in its place.
// `--folder --dryrun` used to consume `--dryrun` as the directory: the
// command then wrote into a folder called `--dryrun` with dry-run off,
// which is the opposite of what was asked for.
function optValue(argv, i, opt, what) {
  const v = argv[i]
  if (null == v || ('-' === v[0] && 1 < v.length)) {
    usage(opt + ' needs ' + what)
  }
  return v
}


function parseArgs(argv) {
  const opts = {
    folder: null, check: null, at: null,
    dryrun: false, template: false, file: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if ('--help' === a || '-h' === a) {
      usage()
    }
    else if ('--folder' === a) {
      opts.folder = optValue(argv, ++i, '--folder', 'a directory')
    }
    else if ('--check' === a) {
      opts.check = optValue(argv, ++i, '--check', 'a directory')
    }
    else if ('--at' === a) {
      opts.at = optValue(argv, ++i, '--at', 'a key')
    }
    else if ('--dryrun' === a) {
      opts.dryrun = true
    }
    else if ('--template' === a) {
      opts.template = true
    }
    else if (a.startsWith('-')) {
      usage('unknown option: ' + a)
    }
    else if (null == opts.file) {
      opts.file = a
    }
    else {
      usage('only one file may be given')
    }
  }

  // --check answers a question; --folder and --dryrun perform a run.
  // Silently letting one win would make the exit code mean the other
  // thing, which is the failure a CI gate can least afford.
  if (null != opts.check) {
    if (null != opts.folder) {
      usage('--check and --folder are alternatives, not a pair')
    }
    if (opts.dryrun) {
      usage('--check already writes nothing; --dryrun adds nothing to it')
    }
  }

  opts.folder = null == opts.folder ? '.' : opts.folder

  return opts
}


// --- the filesystem a --check run sees ------------------------------

// Canonical absolute path: forward slashes, no trailing separator. The
// memory filesystem keys on the same form, so the two agree about what
// "the same file" means on every platform.
function canon(p) {
  const abs = Path.resolve(String(p)).replace(/\\/g, '/')
  return 1 < abs.length ? abs.replace(/\/+$/, '') : abs
}


// Is `p` at or below `root`? On a path BOUNDARY: `/out2/a` is not under
// `/out`, however much of the string it shares.
function under(p, root) {
  return p === root || p.startsWith('/' === root ? root : root + '/')
}


// Memory under the output folder, the real filesystem outside it.
//
// The shadow is what makes --check a pure function of the tree: every
// generated file takes the same path through FileHandler whatever is
// committed under <dir>, so the answer is "what do the generators
// produce", never "what does this checkout happen to hold".
//
// The fall-through is what keeps it a faithful dry run of --folder: a
// `Fragment` or `CopyFiles` source lives outside the output tree and is
// read from disk, exactly as on a write run.
//
// EVERY WRITE GOES TO MEMORY, including one aimed outside <dir>. A
// command that only asks a question must not be able to answer it by
// changing something.
function shadowFs(memfs, root) {
  const mem = memfs.fs

  // memfs reproduces node's refusal to write into a directory that does
  // not exist; FileHandler.ensureDir normally makes it first, and does
  // not when it can see one on disk through the fall-through. So the
  // shadow makes the parent itself.
  const parents = (p) => {
    const dir = Path.dirname(canon(p))
    if (!mem.existsSync(dir)) {
      mem.mkdirSync(dir, { recursive: true })
    }
  }

  const readThrough = (name) => (p, ...rest) =>
    (under(canon(p), root) || !Fs[name] ? mem : Fs)[name](p, ...rest)

  return {
    existsSync: readThrough('existsSync'),
    readFileSync: readThrough('readFileSync'),
    statSync: readThrough('statSync'),
    readdirSync: readThrough('readdirSync'),
    realpathSync: readThrough('realpathSync'),

    writeFileSync: (p, data, opts) => (parents(p), mem.writeFileSync(p, data, opts)),
    mkdirSync: (p, opts) => mem.mkdirSync(p, opts),
    renameSync: (from, to) => (parents(to), mem.renameSync(from, to)),
    chmodSync: (p, mode) => mem.chmodSync(p, mode),
    unlinkSync: (p) => mem.unlinkSync(p),
  }
}


// --- the comparison -------------------------------------------------

// What the generators produced, by path relative to the output folder.
// jostraca's own meta folder is bookkeeping rather than output, and is
// timestamped, so it is not part of the comparison.
function generated(res, root) {
  const fs = res.fs()
  const out = new Map()
  for (const abs of Object.keys(res.vol().toJSON())) {
    const key = canon(abs)
    if (!under(key, root) || key === root) {
      continue
    }
    const rel = key.substring(root.length + 1)
    if (rel === META_FOLDER || rel.startsWith(META_FOLDER + '/')) {
      continue
    }
    out.set(rel, fs.readFileSync(key))
  }
  return out
}


// How one file drifted, as a few lines of the difference. `-` is what
// <dir> holds, `+` is what the generators produce, which is the way
// round every other diff a reviewer reads is written.
function how(want, have) {
  const hunks = DiffUtil.hunks(DiffUtil.lines(want), DiffUtil.lines(have))
  const out = []

  // The line number is counted on the ON-DISK side, so it is a line
  // number in the file the reader is about to open.
  let at = 1
  let shown = 0
  let more = 0

  for (const hunk of hunks) {
    if (0 === hunk.kind) {          // HUNK_SAME
      at += hunk.generated.length
      continue
    }
    if (HUNK_LIMIT <= shown) {
      more++
      at += hunk.existing.length
      continue
    }
    shown++
    const show = (lines, sign) => {
      for (const line of lines.slice(0, HUNK_LINES)) {
        out.push('    ' + sign + line.replace(/\n$/, ''))
      }
      if (HUNK_LINES < lines.length) {
        out.push('    ' + sign + '... ' +
          (lines.length - HUNK_LINES) + ' more line(s)')
      }
    }
    out.push('  line ' + at + ':')
    show(hunk.existing, '-')
    show(hunk.generated, '+')
    at += hunk.existing.length
  }

  if (0 < more) {
    out.push('  ... and ' + more + ' more changed region(s)')
  }

  return out
}


// Hold the tree on disk to what the generators produce.
//
// EXTRA FILES ON DISK ARE IGNORED, and that is a decision rather than
// an omission. A generator owns the files it emits, not the directory
// it emits them into: one generator of nine writes a handful of files
// into a whole application, and a check that called every file it did
// not write "drift" would report the other eight generators' output,
// and the hand-written tree around it, as a failure. Only what the tree
// states is checked. A file that stops being generated therefore
// lingers on disk and is not reported; deleting it is the same review
// as adding it.
function compare(dir, files) {
  const drift = []

  for (const rel of [...files.keys()].sort()) {
    const want = files.get(rel)
    const path = Path.join(dir, rel)

    let have
    try {
      have = Fs.readFileSync(path)
    }
    catch {
      // Absent is drift: the generators claim a file the tree does not
      // hold.
      drift.push({ rel, why: 'is missing from ' + dir })
      continue
    }

    if (want.equals(have)) {
      continue
    }

    drift.push({
      rel,
      why: 'differs from the generated tree',
      // A binary file has no lines to show, and printing its bytes as
      // text helps nobody.
      detail: want.includes(0) || have.includes(0) ? [] :
        how(want.toString('utf8'), have.toString('utf8')),
    })
  }

  return drift
}


// --- the run --------------------------------------------------------

function readTree(opts) {
  const text = null == opts.file ?
    Fs.readFileSync(0, 'utf8') : Fs.readFileSync(opts.file, 'utf8')

  let doc
  try {
    doc = JSON.parse(text)
  }
  catch (err) {
    usage('input is not JSON: ' + err.message)
  }

  if (null == opts.at) {
    return doc
  }

  const tree = doc[opts.at]
  if (null == tree) {
    usage('no value at key: ' + opts.at)
  }
  return tree
}


async function check(opts, tree) {
  const dir = opts.check
  const root = canon(dir)

  if (!Fs.existsSync(dir)) {
    process.stderr.write('cmptree-gen: no such directory: ' + dir + '\n')
    return EXIT_USAGE
  }

  // Required at the top level, not lazily: `memfs` is the in-repo
  // filesystem (ts/src/util/memfs.ts), not a package.
  const { memfs } = require('../ts/dist/util/memfs')
  const vol = memfs({})

  let res
  try {
    res = await Jostraca().generate(
      {
        folder: dir,
        fs: () => shadowFs(vol, root),
        model: {},
        // The `.jostraca/generated` baseline is for a later merge
        // against hand edits. A check makes no next run to merge into.
        control: { duplicate: false },
      },
      cmpTree(tree, { raw: !opts.template }))
  }
  catch (err) {
    // The shadow's one visible edge, named rather than left as a bare
    // ENOENT: a component reading a file INSIDE <dir> cannot see it,
    // because the whole point of the shadow is that the committed tree
    // does not reach the run. `Inject` is the component this always
    // means; a `Fragment` or `CopyFiles` source under <dir> is the
    // other way to arrive here.
    const msg = String(err && err.message || err)
    process.stderr.write('cmptree-gen: ' + msg + '\n')
    if (msg.includes('ENOENT') || msg.includes('does not exist')) {
      process.stderr.write(
        'cmptree-gen: --check shadows ' + dir + ' so that the committed ' +
        'tree cannot change what the generators produce. A component ' +
        'that reads a file already there -- Inject, or a Fragment or ' +
        'CopyFiles source inside it -- has nothing to read under ' +
        '--check.\n')
    }
    return EXIT_USAGE
  }

  // `res.vol()`/`res.fs()` are only present under `mem: true`; this run
  // provides its own filesystem, so read the volume it was given.
  const drift = compare(dir, generated(
    { vol: () => vol.vol, fs: () => vol.fs }, root))

  for (const d of drift) {
    process.stderr.write('cmptree-gen: ' + d.rel + ' ' + d.why + '\n')
    for (const line of (d.detail || [])) {
      process.stderr.write(line + '\n')
    }
  }

  const n = res.files.written.length
  process.stdout.write(
    'checked ' + n + ' file(s) against ' + dir + ', ' +
    drift.length + ' drifted\n')

  return 0 < drift.length ? EXIT_DRIFT : EXIT_OK
}


async function write(opts, tree) {
  const res = await Jostraca().generate(
    {
      folder: opts.folder,
      model: {},
      control: { dryrun: opts.dryrun },
    },
    cmpTree(tree, { raw: !opts.template }))

  for (const path of res.files.written) {
    process.stdout.write((opts.dryrun ? 'would write ' : 'wrote ') + path + '\n')
  }

  return EXIT_OK
}


async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const tree = readTree(opts)
  return null == opts.check ? write(opts, tree) : check(opts, tree)
}


main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write('cmptree-gen: ' + (err && err.message || err) + '\n')
    process.exit(EXIT_USAGE)
  })
