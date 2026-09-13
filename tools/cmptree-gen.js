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
// A COMMAND-LINE FRONT END AND NOTHING MORE. `--check` is
// `Jostraca().check(opts, root)`, a generation mode in the package
// beside `generate` -- what it compares, what it refuses to let
// influence it, and what it writes (nothing) are documented there and
// in docs/reference-options.md. Everything below is argument parsing,
// rendering and an exit code.
//
// The engine lived HERE first, which was a mistake worth naming: every
// generator wants this gate, not only one that arrives as a tree, and
// putting it in a script made a general capability look like one
// consumer's integration detail and left it outside the published
// package. A test that spawns a CLI is the right way to pin an exit
// code; it is not a reason to put an engine behind one.
//
// RAW IS THE DEFAULT HERE, AND IS NOT THE LIBRARY DEFAULT. `Content`
// and `Line` template what they are handed, so a `$$...$$` sequence in
// a shell script, a makefile, a doc comment or a regular expression is
// substituted from the generate model -- wrong output, exit 0, no
// diagnostic. That is right for a generator written at the call site,
// which wrote the `$$` deliberately, and wrong for this tool, whose
// input is final text somebody else evaluated. So
// `cmpTree(tree, {raw: true})`, and `--template` for the caller who
// does want the model in scope.
//
// This used to be `model: {}` instead, which is NOT the same guard:
// `$$"quoted"$$` renders its own literal and `$$__JOSTRACA_REPLACE__$$`
// renders the matcher, both with no model at all.

const Fs = require('node:fs')

const { Jostraca, cmpTree, DiffUtil } = require('../ts/dist/jostraca')

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


// --- rendering ------------------------------------------------------

function oct(mode) {
  return '0o' + mode.toString(8).padStart(3, '0')
}


// How one file drifted, as a few lines of the difference. `-` is what
// the folder holds, `+` is what the generators produce, which is the
// way round every other diff a reviewer reads is written.
function hunkLines(want, have) {
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


// One drift entry as the lines a CI log should carry.
function report(drift, folder) {
  if ('missing' === drift.kind) {
    return [drift.path + ' is missing from ' + folder]
  }

  if ('mode' === drift.kind) {
    return [drift.path + ' has mode ' + oct(drift.existingMode) +
      ', generated as ' + oct(drift.mode)]
  }

  const out = [drift.path + ' differs from the generated tree']

  // A binary file has no lines to show, and printing its bytes as text
  // helps nobody.
  if (!drift.generated.includes(0) && !drift.existing.includes(0)) {
    out.push(...hunkLines(
      drift.generated.toString('utf8'), drift.existing.toString('utf8')))
  }

  return out
}


// --- the run --------------------------------------------------------

async function check(opts, tree) {
  const dir = opts.check

  if (!Fs.existsSync(dir)) {
    process.stderr.write('cmptree-gen: no such directory: ' + dir + '\n')
    return EXIT_USAGE
  }

  let res
  try {
    res = await Jostraca().check(
      { folder: dir, model: {} },
      cmpTree(tree, { raw: !opts.template }))
  }
  catch (err) {
    // The shadow's one visible edge, named rather than left as a bare
    // ENOENT: a component reading a file INSIDE <dir> cannot see it,
    // because the whole point is that the committed tree does not reach
    // the run. `Inject` is the component this always means.
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

  for (const drift of res.drift) {
    for (const line of report(drift, dir)) {
      process.stderr.write(
        line.startsWith(' ') ? line + '\n' : 'cmptree-gen: ' + line + '\n')
    }
  }

  process.stdout.write(
    'checked ' + res.checked.length + ' file(s) against ' + dir + ', ' +
    res.drift.length + ' drifted\n')

  return 0 < res.drift.length ? EXIT_DRIFT : EXIT_OK
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
