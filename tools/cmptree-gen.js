// Generate files from a component tree given as JSON -- SPIKE
// (docs/design/AONTU.0.md).
//
//   aontu model.aon | node tools/cmptree-gen.js --at out --folder ./build
//   node tools/cmptree-gen.js --folder ./build tree.json
//
// This is the whole aontu integration: aontu evaluates a model to a
// component tree (its Folder/File/Content primitives), prints it as
// JSON, and this reads that JSON and hands it to jostraca's own
// components through `cmpTree` (ts/src/tree.ts). Neither project
// depends on the other; the contract is the JSON shape.
//
//   --folder <dir>   output folder (default: .)
//   --at <key>       take the tree from this top-level key of the JSON
//                    (aontu prints the whole document, and the tree is
//                    usually one field of it)
//   --dryrun         report what would be written, write nothing
//
// A file argument reads that file; with none, the tree is read from
// stdin.

const Fs = require('node:fs')

const { Jostraca, cmpTree } = require('../ts/dist/jostraca')


function usage(msg) {
  if (msg) {
    process.stderr.write('cmptree-gen: ' + msg + '\n')
  }
  process.stderr.write(
    'Usage: cmptree-gen [--folder <dir>] [--at <key>] [--dryrun] [file]\n')
  process.exit(msg ? 1 : 0)
}


function parseArgs(argv) {
  const opts = { folder: '.', at: null, dryrun: false, file: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if ('--help' === a || '-h' === a) {
      usage()
    }
    else if ('--folder' === a) {
      opts.folder = argv[++i]
      if (null == opts.folder) usage('--folder needs a directory')
    }
    else if ('--at' === a) {
      opts.at = argv[++i]
      if (null == opts.at) usage('--at needs a key')
    }
    else if ('--dryrun' === a) {
      opts.dryrun = true
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
  return opts
}


async function main() {
  const opts = parseArgs(process.argv.slice(2))

  const text = null == opts.file ?
    Fs.readFileSync(0, 'utf8') : Fs.readFileSync(opts.file, 'utf8')

  let doc
  try {
    doc = JSON.parse(text)
  }
  catch (err) {
    usage('input is not JSON: ' + err.message)
  }

  let tree = doc
  if (null != opts.at) {
    tree = doc[opts.at]
    if (null == tree) {
      usage('no value at key: ' + opts.at)
    }
  }

  const res = await Jostraca().generate(
    {
      folder: opts.folder,
      // The tree is already final text; jostraca's own `$$name$$`
      // interpolation has nothing to add and could only surprise.
      model: {},
      control: { dryrun: opts.dryrun },
    },
    cmpTree(tree))

  for (const path of res.files.written) {
    process.stdout.write((opts.dryrun ? 'would write ' : 'wrote ') + path + '\n')
  }
}


main().catch((err) => {
  process.stderr.write('cmptree-gen: ' + (err && err.message || err) + '\n')
  process.exit(1)
})
