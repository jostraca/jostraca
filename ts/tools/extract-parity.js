#!/usr/bin/env node
// Extracts TS scenario outputs into JSON files for the Go parity tests.
// Each scenario runs the same component tree the Go test will run, and we
// snapshot vol.toJSON() so the Go side has a byte-equal target.
//
// Usage: node tools/extract-parity.js <out-dir>
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const {
  Jostraca, Project, Folder, File, Content, Inject, Fragment, Slot, Copy, Line, List, cmp,
  each,
} = require('../dist/jostraca')

const { memfs } = require('../dist/util/memfs')

// Binary escape hatch: content values are plain strings when the bytes
// round-trip through UTF-8, and {"b64": "..."} when they do not.
const { enc, encMap, volOf } = require('./corpus-bytes.js')

// Default is relative to the repo root (this script is run from ts/).
const outDir = process.argv[2] || '../go/testdata/parity'

fs.mkdirSync(outDir, { recursive: true })

// Frozen clock for deterministic BuildMeta output.
const FROZEN_NOW = 1735689600000

// The message body both ports share: TS's `<ERROR:>?<Op>:<phase>: ` wrapper
// removed, CopyFiles' TS-only `(<model name>: <node path>): ` prefix and
// `[at <frame>]` suffix removed, and an embedded filesystem error cut to
// `(threw: <os>)`, since that text is the host's own.
function bodyOf(err) {
  return String(err.message)
    .replace(/^(ERROR:)?[A-Za-z]+:[a-z]+: /, '')
    .replace(/^CopyFiles: \([^)]*\): /, 'CopyFiles: ')
    .replace(/ \[at [^\]]*\]$/, '')
    .replace(/\(threw: .*$/s, '(threw: <os>)')
}

async function snapshot(name, opts, root, prepopulate) {
  const vol = {}
  const mfs = memfs(prepopulate || {})
  const j = Jostraca({})
  const fullOpts = Object.assign({
    fs: () => mfs.fs,
    folder: '/out',
    now: () => FROZEN_NOW,
  }, opts)
  // Guarded so a scenario where TS THROWS is recorded rather than crashing the
  // generator. Without this the whole class "one stack fails where the other
  // completes" was unrepresentable: the scenario corpus carries an `error`
  // field and Go asserts it bidirectionally, but nothing could ever produce a
  // true. See PARITY_PLAN.md 2.1. The volume is still captured, so a partial
  // write before the throw is compared too.
  let error = false
  let errorBody
  let res = null
  try {
    res = await j.generate(fullOpts, root)
  }
  catch (err) {
    error = true
    errorBody = bodyOf(err)
  }
  const result = volOf(mfs)
  fs.writeFileSync(
    path.join(outDir, name + '.json'),
    JSON.stringify({
      scenario: name,
      opts: opts || {},
      prepopulate: encMap(prepopulate),
      error,
      // Absent on a run that succeeded, so only the failing fixtures carry
      // it.
      errorBody,
      // The seven files lists, so a scenario pins what a run reports as
      // well as what it writes.
      files: null == res ? null : res.files,
      audit: null == res ? null : auditOf(res),
      vol: result,
    }, null, 2) + '\n',
  )
  console.log('wrote', name)
}


// Cross-stack differential corpus for the diff/merge engine.
//
// Every case records TS's exact output. go/diff_corpus_test.go replays the
// same inputs and asserts byte equality, which is what actually holds the
// two implementations together — the scenario corpus below only exercises
// merge through a handful of well-behaved end-to-end cases, and that is how
// the two stacks silently diverged before.
//
// All content is plain ASCII lines, so it round-trips through JSON exactly.
function diffCorpus() {
  const { DiffUtil } = require('../dist/jostraca')

  // Deterministic PRNG: the corpus is committed, and CI regenerates it and
  // fails on any diff, so it has to be stable.
  let seed = 20260725 >>> 0
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const mk = (n, vocab) => {
    const out = []
    for (let i = 0; i < n; i++) {
      out.push('L' + Math.floor(rnd() * vocab) + '\n')
    }
    return out.join('')
  }
  const trimNL = (s) => s.endsWith('\n') ? s.slice(0, -1) : s

  const labels = { generated: 'G', existing: 'E' }
  const spec = { labels }
  const cases = []

  const push3 = (generated, baseline, existing) => {
    const r = DiffUtil.merge(generated, baseline, existing, spec)
    cases.push({
      kind: 'merge', generated, baseline, existing,
      content: r.content, conflict: r.conflict, outcome: r.outcome,
    })
  }
  const push2 = (generated, existing) => {
    const r = DiffUtil.diff(generated, existing, spec)
    cases.push({
      kind: 'diff', generated, existing,
      content: r.content, conflict: r.conflict, outcome: r.outcome,
    })
  }

  // Hand-picked edge shapes.
  const edges = [
    ['', '', ''],
    ['a\n', '', ''],
    ['', 'a\n', ''],
    ['', '', 'a\n'],
    ['a\n', 'a\n', 'a\n'],
    ['NEW\n', 'OLD\n', 'OLD\n'],
    ['a\nNEW\nc\n', 'a\nORIG\nc\n', 'a\nUSER\nc\n'],
    ['keep\ndrop\n', 'keep\ndrop\n', 'keep\n'],
    ['keep\n', 'keep\ndrop\n', 'keep\ndrop\n'],
    ['X', '', 'Y'],
    ['a\nX', 'a\n', 'a\nY'],
    ['\n\n\n', '\n', '\n\n'],
    ['a\r\nb\r\n', 'a\r\n', 'a\r\nc\r\n'],
    ['x\ny\nz\n', 'y\n', 'w\ny\nv\n'],
    ['}\n}\n}\n', '}\n}\n', '}\n}\n}\n}\n'],

    // Input that already contains conflict-marker text. Found by the Go
    // fuzzer (go/fuzz_test.go); pinned here so BOTH stacks are held to the
    // same handling, not just the one that found it. The engine keeps such
    // text verbatim — it cannot rewrite a marker it never emitted — so
    // these are exactly the cases where "every marker starts its own line"
    // stops holding, and the two implementations must stop together.
    ['0', '0', '0<<<<<<< '],
    ['0=======', '', '0'],
    ['a\n<<<<<<< x\nb\n', 'a\n', 'a\nc\n'],
    ['a\n', 'a\n', 'a\n=======\nb\n'],
    ['>>>>>>> ', '', ''],
  ]
  for (const [g, b, e] of edges) {
    push3(g, b, e)
    push2(g, e)
  }

  // Randomised shapes, weighted towards small vocabularies where repeated
  // lines make tie-breaking observable.
  const shapes = [
    { n: 1, v: 1 }, { n: 2, v: 2 }, { n: 3, v: 2 }, { n: 4, v: 2 },
    { n: 5, v: 3 }, { n: 6, v: 2 }, { n: 8, v: 3 }, { n: 10, v: 4 },
    { n: 12, v: 3 }, { n: 16, v: 5 }, { n: 20, v: 6 }, { n: 24, v: 8 },
    { n: 32, v: 4 }, { n: 40, v: 12 },
  ]
  for (const s of shapes) {
    for (let i = 0; i < 20; i++) {
      const b = mk(s.n, s.v)
      const g = mk(s.n, s.v)
      const e = mk(s.n, s.v)
      push3(g, b, e)
      push2(g, e)
      // Same shapes without trailing newlines, to stress marker placement.
      push3(trimNL(g), trimNL(b), trimNL(e))
      push2(trimNL(g), trimNL(e))
    }
  }

  // Realistic shape: a mostly-unchanged file with a couple of edits.
  for (let i = 0; i < 20; i++) {
    const baseLines = []
    for (let k = 0; k < 30; k++) {
      baseLines.push('  key_' + k + ': value_' + k + '\n')
    }
    const genLines = baseLines.slice()
    const exiLines = baseLines.slice()
    genLines[Math.floor(rnd() * 30)] = '  key_gen: CHANGED\n'
    exiLines[Math.floor(rnd() * 30)] = '  key_user: EDITED\n'
    push3(genLines.join(''), baseLines.join(''), exiLines.join(''))
    push2(genLines.join(''), exiLines.join(''))
  }

  fs.writeFileSync(
    path.join(outDir, 'diff_corpus.json'),
    JSON.stringify({ scenario: 'diff_corpus', labels, cases }, null, 2) + '\n',
  )
  console.log('wrote diff_corpus (' + cases.length + ' cases)')
}

// Cross-stack differential corpus for the OPTION SURFACE — folder,
// existing-file mode, on-disk state and filename shape, crossed. See
// tools/scenario-corpus.js for why.
async function scenarioCorpus() {
  const { buildCorpus } = require('./scenario-corpus.js')
  const cases = await buildCorpus()
  fs.writeFileSync(
    path.join(outDir, 'scenario_corpus.json'),
    JSON.stringify({ scenario: 'scenario_corpus', cases }, null, 2) + '\n',
  )
  console.log('wrote scenario_corpus (' + cases.length + ' cases)')
}


// Cross-stack differential corpus for the COPY EXCLUDE surface — Copy
// placement, exclude value and on-disk state, crossed. See
// tools/copy-exclude-corpus.js for why.
async function copyExcludeCorpus() {
  const { buildCorpus } = require('./copy-exclude-corpus.js')
  const cases = await buildCorpus()
  fs.writeFileSync(
    path.join(outDir, 'copy_exclude_corpus.json'),
    JSON.stringify({ scenario: 'copy_exclude_corpus', cases }, null, 2) + '\n',
  )
  console.log('wrote copy_exclude_corpus (' + cases.length + ' cases)')
}


// Cross-stack differential corpus for the template engine. See
// tools/template-corpus.js for why it exists.
function templateCorpus() {
  const { buildCases } = require('./template-corpus.js')
  const cases = buildCases()
  fs.writeFileSync(
    path.join(outDir, 'template_corpus.json'),
    JSON.stringify({ scenario: 'template_corpus', cases }, null, 2) + '\n',
  )
  console.log('wrote template_corpus (' + cases.length + ' cases)')
}

async function main() {
  diffCorpus()
  templateCorpus()
  await scenarioCorpus()
  await copyExcludeCorpus()

  // Quickstart from the README.
  await snapshot('quickstart', {}, () => {
    Project({ folder: 'my-app' }, () => {
      Folder({ name: 'src' }, () => {
        File({ name: 'index.js' }, () => {
          Content('console.log("hello world")\n')
        })
      })
      File({ name: 'package.json' }, () => {
        Content('{ "name": "my-app" }\n')
      })
    })
  })

  // Template substitution.
  await snapshot('template_model',
    { model: { app: { name: 'Acme', version: '1.0.0' } } },
    () => {
      Project({ folder: 'app' }, () => {
        File({ name: 'config.txt' }, () => {
          Content('App: $$app.name$$ v$$app.version$$\n')
        })
      })
    },
  )

  // Fragment + named Slot.
  await snapshot('fragment_slot', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'index.html' }, () => {
        Fragment({ from: '/templates/page.html' }, () => {
          Slot({ name: 'head' }, () => Content('<title>X</title>'))
          Slot({ name: 'body' }, () => Content('<h1>Hello</h1>'))
        })
      })
    })
  }, {
    '/templates/page.html':
      '<html>\n<!-- <[SLOT:head]> -->\n<body>\n<!-- <[SLOT:body]> -->\n</body>\n</html>\n',
  })

  // Fragment `eject` trims the source to the region between the markers. Go
  // declared FragmentProps.Eject and read it nowhere, so it emitted the whole
  // file. See PARITY_PLAN.md 3.
  await snapshot('fragment_eject', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'part.txt' }, () => {
        Fragment({ from: '/templates/whole.txt', eject: ['START\n', 'END\n'] })
      })
    })
  }, {
    '/templates/whole.txt': 'PRE\nSTART\nKEEP\nEND\nPOST\n',
  })

  // A scenario that FAILS in both stacks, so the `error` field is exercised
  // rather than merely present. A Fragment whose source does not exist is
  // rejected at define time by both, through the same shape validation text:
  // TS in the Fragment component, Go in builder.go. Before the guard in
  // snapshot() above, adding this would have crashed the corpus generator
  // instead of recording anything. See PARITY_PLAN.md 2.1.
  await snapshot('fragment_missing_from_errors', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'index.html' }, () => {
        Fragment({ from: '/templates/does-not-exist.html' })
      })
    })
  })

  // Two more scenarios that FAIL in both stacks, added because one row is
  // not a gated class. Both were chosen by measuring candidates on both
  // sides first: these two agree on the error AND on the partial tree the
  // failed build leaves behind, which is the half the bulk runners used to
  // skip. See PARITY_PLAN.md 2.1.
  //
  // A Copy whose source does not exist: rejected by the shape Check on
  // `from` in TS, by CopyOp in Go. Neither writes anything.
  await snapshot('copy_missing_source_errors', {}, () => {
    Project({ folder: 'app' }, () => {
      Copy({ from: '/src/does-not-exist.txt', to: 'a.txt' })
    })
  })

  // An Inject whose target does not exist. Both fail in the AFTER hook,
  // which is later than the Copy case above -- late enough that the project
  // folder has already been made, so this row pins a NON-EMPTY partial tree
  // on an error path. That is the shape that would have gone unnoticed.
  await snapshot('inject_missing_target_errors', {}, () => {
    Project({ folder: 'app' }, () => {
      Inject({ name: 'does-not-exist.txt' }, () => Content('new content'))
    })
  })

  // A binary Copy onto a target that ALREADY holds exactly those bytes,
  // with bin.preserve on. Nothing should be backed up, because nothing
  // changed.
  //
  // This is issue #30, and it went unnoticed because no corpus case reached
  // it: `save` compared the incoming Buffer against the utf8 STRING loadFile
  // returns, and `string === Buffer` is false whatever the bytes are, so a
  // `.old.` backup of an identical file was written on every run. Go used
  // bytes.Equal and was right. Fixing TS changed no existing row, which is
  // exactly why this one is added. See PARITY_PLAN.md 3.
  await snapshot('binary_copy_identical_no_backup', {
    existing: { bin: { preserve: true } },
  }, () => {
    Project({ folder: 'app' }, () => {
      Copy({ from: '/src/mod.wasm', to: 'mod.wasm' })
    })
  }, {
    '/src/mod.wasm': Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x89]),
    '/out/app/mod.wasm': Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x89]),
  })

  // A USER COMPONENT as a direct Fragment child, with an unnamed <[SLOT]>
  // marker to receive it. Both stacks run its body exactly once -- during
  // the default-slot replay -- and splice its content at the marker.
  //
  // This row could not have existed before #29 was closed. Go used to run
  // the body once per replay pass and never route it through the Fragment
  // filter, because `j.Cmp` allocated no node for the filter to see. Now it
  // allocates a KindNone node, as TS's cmp() always has.
  const Counter = cmp(function Counter() {
    Content('H')
  })

  await snapshot('fragment_cmp_child_default_slot', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'a.txt' }, () => {
        Fragment({ from: '/tpl/f.txt' }, () => {
          Counter({})
          Slot({ name: 's0' }, () => Content('S0'))
        })
      })
    })
  }, {
    '/tpl/f.txt': 'A<[SLOT]>B<[SLOT:s0]>C\n',
  })

  // Inject between markers.
  await snapshot('inject_basic', {}, () => {
    Project({ folder: 'app' }, () => {
      Inject({ name: 'foo.txt' }, () => Content('new content'))
    })
  }, {
    '/out/app/foo.txt':
      'HEADER\n#--START--#\nold\n#--END--#\nFOOTER\n',
  })

  // Copy single file with template substitution.
  await snapshot('copy_file',
    { model: { name: 'World' } },
    () => {
      Project({ folder: 'app' }, () => {
        Copy({ from: '/tpl/hello.txt' })
      })
    },
    { '/tpl/hello.txt': 'Hello $$name$$' },
  )

  // A Copy nested INSIDE a File. No fixture covered this shape, which is how
  // #39 survived: TS's CopyOp.before displaced buildctx.current.file and never
  // put it back, so `AFTER` accumulated into the Copy's buffer and FileOp.after
  // wrote that buffer to the COPY's path. `/out/app/a.txt` was never written at
  // all and `BEFORE` was lost. Go was correct throughout. The copied text is
  // spliced into the enclosing file at the position the Copy sits in source
  // order, AND still written to its own destination.
  await snapshot('copy_in_file',
    { model: { name: 'World' } },
    () => {
      Project({ folder: 'app' }, () => {
        File({ name: 'a.txt' }, () => {
          Content('BEFORE\n')
          Copy({ from: '/tpl/hello.txt' })
          Content('AFTER\n')
        })
      })
    },
    { '/tpl/hello.txt': 'Hello $$name$$\n' },
  )

  // An Inject nested inside a File: the same displaced-current.file defect one
  // component along, and the more destructive of the two - the enclosing File
  // wrote its own content over the Inject's TARGET, a pre-existing file the
  // build was only supposed to edit a region of. Unlike Fragment and Slot, an
  // Inject contributes NO text to the file around it.
  await snapshot('inject_in_file', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'a.txt' }, () => {
        Content('BEFORE\n')
        Inject({ name: 'foo.txt' }, () => Content('new content'))
        Content('AFTER\n')
      })
    })
  }, {
    '/out/app/foo.txt':
      'HEADER\n#--START--#\nold\n#--END--#\nFOOTER\n',
  })

  // List iteration. TS each() default-wraps items in {val$, index$};
  // the body extracts via .val$ to access the raw value.
  await snapshot('list_basic', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'out.txt' }, () => {
        List({ item: ['a', 'b', 'c'] }, (props) => {
          Line(props.item.val$)
        })
      })
    })
  })

  // The `{item}` macro and `indent` a List hands its body. Go's ListP had
  // no props object at all, so a body interpolating {item.n} emitted the
  // macro verbatim and ListProps.Indent was declared and never read - the
  // single list_basic fixture used a plain body and so could not see it.
  // #40. Every quiet limit is exercised here: a bare {item}, a $-suffixed
  // key, an unresolved path, and a near-miss that is left in place.
  await snapshot('list_item_macro', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'out.txt' }, () => {
        List({ item: [{ n: 'p', d: { e: 'X' } }, { n: 'q', d: { e: 'Y' } }] },
          (props) => Content({
            src: 'n={item.n} deep={item.d.e} bare={item} ' +
              'dollar={item.index$} miss={item.zz} near={itemx}\n',
            replace: props.replace,
          }))
      })
      File({ name: 'indent.txt' }, () => {
        List({ item: [{ n: 'p' }, { n: 'q' }], indent: '>>', line: false },
          (props) => Content({
            src: 'n={item.n}\n', replace: props.replace, indent: props.indent,
          }))
      })
      // Value formatting: a function replacement now JSONifies objects and
      // arrays, as a plain replacement and `$$path$$` already did. It used
      // to emit "[object Object]" and "1,2", which Go cannot reproduce -
      // a ReplaceFunc returns a string, so there is no JS coercion to
      // inherit. TS was the side to move.
      File({ name: 'values.txt' }, () => {
        List({
          item: [{ v: 42 }, { v: 1.5 }, { v: true }, { v: null },
          { v: { a: 1 } }, { v: [1, 2] }],
          line: false,
        }, (props) => Content({ src: 'v={item.v}\n', replace: props.replace }))
      })
    })
  })

  // Directory-only state. An EMPTY Folder is materialised by TS's FolderOp
  // and was not by Go's folderBefore, and no gate could see the difference:
  // MemFS.Vol() returned map[string][]byte, files only, so a snapshot
  // recording TS's null entry had nothing on the Go side to compare with.
  // Zero null entries existed across the whole corpus before this one. #41.
  //
  // A directory appears in the snapshot only while it is EMPTY - otherwise
  // its children stand for it - so `full` is absent and `empty` is null.
  await snapshot('empty_folder', {}, () => {
    Project({ folder: 'app' }, () => {
      Folder({ name: 'empty' }, () => { })
      Folder({ name: 'full' }, () => {
        File({ name: 'a.txt' }, () => Content('A\n'))
      })
      // Nested, so the recursive half is pinned too: `outer` holds a child
      // and is absent, `outer/inner` is empty and is recorded.
      Folder({ name: 'outer' }, () => {
        Folder({ name: 'inner' }, () => { })
      })
    })
  })

  // A STRING child of List, which used to emit nothing at all: the wrapper
  // that renders one called Content with no `src`, so the string was
  // captured and dropped. #44.
  //
  // Go has no string-children concept, so its runner writes out the explicit
  // body the shorthand desugars to - which is exactly the point of pinning
  // it here. The two spellings have to produce the same bytes, or the
  // shorthand means something TS-only.
  await snapshot('list_string_child', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'out.txt' }, () => {
        List({ item: [{ n: 'p' }, { n: 'q' }], indent: '>>' }, 'n={item.n}\n')
      })
      // Two string children, to pin that children iterate INSIDE the item
      // loop: a=p,b=p,a=q,b=q rather than a=p,a=q,b=p,b=q.
      File({ name: 'two.txt' }, () => {
        List({ item: [{ n: 'p' }, { n: 'q' }], line: false },
          ['a={item.n}\n', 'b={item.n}\n'])
      })
    })
  })

  // Line component (auto-newline).
  await snapshot('line_basic', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'out.txt' }, () => {
        Line('hello')
      })
    })
  })

  // Multi-folder happy path - mirrors test/jostraca.test.ts:'happy'.
  await snapshot('happy_multifile', {}, () => {
    Project({ folder: 'sdk' }, () => {
      Folder({ name: 'js' }, () => {
        File({ name: 'foo.js' }, () => Content('// custom-foo\n'))
        File({ name: 'bar.js' }, () => Content('// custom-bar\n'))
      })
      Folder({ name: 'go' }, () => {
        File({ name: 'zed.go' }, () => Content('// custom-zed\n'))
      })
    })
  })

  // Empty Folder({}) wrapper - mirrors test/jostraca.test.ts:'content'.
  await snapshot('content_empty_folder', {}, () => {
    Folder({}, () => {
      File({ name: 'foo.txt' }, () => Content('A'))
    })
  })

  // Binary content. A file whose extension is absent from BINARY_EXT is
  // classified by sniffing its bytes, and must survive Copy untouched —
  // never templated, never re-encoded. This used to be expressible only as
  // hand-transcribed per-stack unit tests (ts/test/robustness.test.ts,
  // go/robustness_test.go), because content values here are JSON strings
  // and memfs decodes lossily: 0xFF arrives as U+FFFD, not as anything
  // recoverable. The {"b64": "..."} escape hatch (tools/corpus-bytes.js)
  // is what makes it a real differential scenario. The .txt sibling is
  // here so the same run still proves text IS templated.
  await snapshot('copy_binary_unlisted_ext',
    { model: { v: 'V' } },
    () => {
      Project({ folder: 'p' }, () => {
        Copy({ from: '/tm' })
      })
    },
    {
      // wasm magic, a NUL, bytes above 0x7F, and — deliberately — a byte
      // sequence that looks like a template marker. If either stack stops
      // sniffing this as binary the text path substitutes $$v$$ and the
      // bytes change, so the scenario has teeth rather than only recording
      // that nothing happened.
      '/tm/mod.wasm': Buffer.concat([
        Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
        Buffer.from('$$v$$', 'utf8'),
        Buffer.from([0xff, 0xfe, 0x80]),
      ]),
      '/tm/readme.txt': 'hello $$v$$\n',
    },
  )

  // Which of existing.txt / existing.bin governs, crossed with every way a
  // file reaches save. No corpus case set a `bin` mode before this one,
  // which is why the stacks could disagree about the whole question
  // (CODE_REVIEW.md §2.7) with every corpus still green:
  //
  //   logo.png    single-file Copy, listed ext, TEXT bytes  -> bin
  //   mod.wasm    single-file Copy, unlisted ext, BIN bytes -> bin (sniffed)
  //   icon.png    File component, listed ext, TEXT content  -> bin
  //   readme.txt  single-file Copy, text either way         -> txt
  //
  // The routes are the point: the tree walk already agreed across the
  // stacks, and the single-file copy and the File component are the two
  // that did not. All four already exist on disk, so the mode set actually
  // engages — `bin.preserve` makes an `.old.` copy of the first three
  // (leaving their bytes alone), and `txt.diff` renders conflict markers
  // into the fourth and must reach none of the others, since that is U3
  // exactly.
  await snapshot('existing_bin_classification',
    {
      model: { v: 'V' },
      existing: { txt: { diff: true }, bin: { preserve: true } },
    },
    () => {
      Project({ folder: 'p' }, () => {
        Copy({ from: '/tm/logo.png', to: 'logo.png' })
        Copy({ from: '/tm/mod.wasm', to: 'mod.wasm' })
        Copy({ from: '/tm/readme.txt', to: 'readme.txt' })
        File({ name: 'icon.png' }, () => Content('NEW-ICON\n'))
      })
    },
    {
      '/tm/logo.png': 'hello $$v$$\n',
      '/tm/mod.wasm': Buffer.concat([
        Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
        Buffer.from('$$v$$', 'utf8'),
        Buffer.from([0xff, 0xfe, 0x80]),
      ]),
      '/tm/readme.txt': 'hello $$v$$\n',

      '/out/p/logo.png': 'OLD-PNG\n',
      '/out/p/mod.wasm': Buffer.from([0x00, 0x01, 0x02]),
      '/out/p/readme.txt': 'OLD\n',
      '/out/p/icon.png': 'OLD-ICON\n',
    },
  )

  // A Fragment nested inside a Slot: content one level deeper than the
  // Slot's own children must still be emitted. The Go port collected only
  // direct children here and silently dropped it.
  await snapshot('fragment_nested_in_slot', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'out.txt' }, () => {
        Fragment({ from: '/f.txt' }, () => {
          Slot({ name: 's' }, () => {
            Fragment({ from: '/f2.txt' }, () => { })
            Content('DIRECT')
          })
        })
      })
    })
  }, {
    '/f.txt': 'A<[SLOT:s]>B\n',
    '/f2.txt': 'NESTED',
  })

  // A relative Fragment `from` resolves against the output folder. This
  // used to throw: the shape check stat'd the raw relative string against
  // the process CWD, so it failed regardless of where the file was.
  await snapshot('fragment_relative_from', {}, () => {
    Project({ folder: 'app' }, () => {
      Folder({ name: 'sub' }, () => {
        File({ name: 'out.txt' }, () => {
          Fragment({ from: 'frag.txt' })
        })
      })
    })
  }, {
    '/out/frag.txt': 'FRAG\n',
  })

  // Text-only half of the same behaviour: the ignore rules must apply to
  // text files, not just binaries.
  await snapshot('copy_ignore_text',
    { model: { v: 'V' } },
    () => {
      Project({ folder: 'app' }, () => {
        Copy({ from: '/tm' })
      })
    },
    {
      '/tm/readme.txt': 'hello $$v$$\n',
      '/tm/skip.txt-jostraca-off': 'SKIP\n',
      '/tm/backup.txt~': 'BACKUP\n',
    },
  )

  // Mode combinations. The existing-file modes are NOT mutually
  // exclusive: preserve runs independently of diff, so a `.old` backup and
  // an annotated diff must both appear.
  await snapshot('preserve_and_diff',
    { existing: { txt: { preserve: true, diff: true } }, now: () => FROZEN_NOW },
    () => {
      Project({ folder: 'app' }, () => {
        File({ name: 'a.txt' }, () => Content('NEW\n'))
      })
    },
    { '/out/app/a.txt': 'OLD\n' },
  )

  // A protected file is never written, but `present` still deposits the
  // .new sidecar so the user can see what would have been generated.
  await snapshot('protect_and_present',
    { existing: { txt: { write: false, present: true } } },
    () => {
      Project({ folder: 'app' }, () => {
        File({ name: 'a.txt' }, () => Content('NEW\n'))
      })
    },
    { '/out/app/a.txt': '# JOSTRACA_PROTECT\nkeep me\n' },
  )

  // Inject rewrites *every* marker pair in the target, and finds the end
  // marker after the start marker (a stray end marker earlier in the file
  // must not defeat it).
  await snapshot('inject_two_blocks', {}, () => {
    Project({ folder: 'app' }, () => {
      Inject({ name: 'foo.txt' }, () => Content('NEW'))
    })
  }, {
    '/out/app/foo.txt':
      'A\n#--START--#\nold1\n#--END--#\nB\n#--START--#\nold2\n#--END--#\nC\n',
  })

  await snapshot('inject_stray_end_marker', {}, () => {
    Project({ folder: 'app' }, () => {
      Inject({ name: 'foo.txt' }, () => Content('NEW'))
    })
  }, {
    '/out/app/foo.txt': '\n#--END--#\nA\n#--START--#\nold\n#--END--#\nZ\n',
  })

  // No marker pair: the file is left byte-identical (and a debug warning
  // is recorded, since a silent no-op is otherwise invisible).
  await snapshot('inject_no_markers', {}, () => {
    Project({ folder: 'app' }, () => {
      Inject({ name: 'foo.txt' }, () => Content('NEW'))
    })
  }, {
    '/out/app/foo.txt': 'no markers here\n',
  })

  // A File with no enclosing Project must resolve under the output
  // folder. This used to join onto an empty folder path and land at the
  // filesystem root.
  await snapshot('no_project_file', {}, () => {
    File({ name: 'x.txt' }, () => Content('hi\n'))
  })

  // Every dotfile in a folder needs its own backup path: `.env` must back
  // up to `.env.old`, not collapse onto a shared `.old`.
  await snapshot('dotfile_preserve',
    { existing: { txt: { preserve: true } } },
    () => {
      Project({ folder: 'app' }, () => {
        File({ name: '.env' }, () => Content('NEW-ENV\n'))
        File({ name: '.npmrc' }, () => Content('NEW-NPMRC\n'))
      })
    },
    {
      '/out/app/.env': 'OLD-ENV\n',
      '/out/app/.npmrc': 'OLD-NPMRC\n',
    },
  )

  // basic-copy: Copy with multiple files + ~ default ignore.
  await snapshot('basic_copy',
    { model: { x: { y: 'Y', z: 'Z' } } },
    () => {
      Project({ folder: 'sdk' }, () => {
        Folder({ name: 'js' }, () => {
          File({ name: 'foo.js' }, () => Content('// custom-foo\n'))
          Copy({ from: '/tm/bar.txt', to: 'bar.txt' })
          Copy({ from: '/tm/sub' })
        })
      })
    },
    {
      '/tm/bar.txt':       '// BAR $$x.z$$ TXT\n',
      '/tm/bar.txt~':      '// BAR TXT\n',  // ~ suffix → ignored by default
      '/tm/sub/a.txt':     '// SUB-A $$x.y$$ TXT\n',
      '/tm/sub/b.txt':     '// SUB-B $$x.y$$ TXT\n',
      '/tm/sub/c/d.txt':   '// SUB-C-D $$x.y$$ $$x.z$$ TXT\n',
    },
  )

  // Absolute paths inside Project/Folder. Mirrors test/merge.test.ts:'path'
  // structure (the tree shape, not the merge mode) - tests that:
  //   Project({ folder: '/top/sdk' }) - absolute project folder
  //   Folder({ name: '/code/js' }) - leading slash in folder name
  //   File({ name: 'foo.js' })
  // composes into '/top/sdk/code/js/foo.js' even though the global
  // folder option is '/top'. The double-slash gets collapsed by
  // path normalization.
  await snapshotAbsPath('absolute_paths')

  // Merge with no duplicate baseline. Existing file is left untouched;
  // the new generated content is seeded into the duplicate folder so a
  // future run can merge against it. Single-phase capture: pre-populate
  // an existing file but not the baseline, then generate with merge.
  await snapshotMergeNoBaseline('merge_no_baseline')

  // Multi-run merge retention. Mirrors test/merge.test.ts:'retain'.
  // Each phase takes a snapshot of /foo.txt. Sequence is:
  //   G-0 first gen (model.foo='aaa\n')
  //   G-1 same model, no change
  //   G-2 user appends 'bbb\n', re-gen → keep user's bbb
  //   G-3 same model, file stays 'aaa\nbbb\n'
  //   G-4 same again
  //   G-5 model.foo='aaa\nccc\n' → conflict between user's bbb and ccc
  //   G-6 user resolves conflict → 'aaa\nbbb\nccc\n'
  //   G-7 model.foo='aaa\nddd\n' → new conflict
  //   G-8 idempotent re-gen
  //   G-9 model.foo='aaa\neee\n' → conflict markers RETAIN ddd not eee
  await snapshotMergeRetain('merge_retain')

  // Fragment with replace callbacks that re-enter components.
  // Mirrors test/jostraca.test.ts:'fragment-subcmp' minus the
  // outer cmp(props => ...) wrapper.
  await snapshotFragmentSubcmp('fragment_subcmp')

  // Merge: 3-way reconciliation. Setup mirrors test/merge.test.ts:
  // initial generation, then a custom edit, then a re-generation that
  // triggers merge mode.
  await snapshotMerge('merge_basic')

  // Merge update: user appends content; new gen has unrelated changes.
  await snapshotMergeUpdate('merge_update')

  // Merge clean: same change on both sides → no conflict.
  await snapshotMergeClean('merge_clean')

  // Protect: existing file with JOSTRACA_PROTECT survives re-gen.
  await snapshot('protect',
    {},
    () => {
      Project({ folder: 'app' }, () => {
        File({ name: 'cfg.txt' }, () => Content('regenerated\n'))
      })
    },
    {
      '/out/app/cfg.txt': '# JOSTRACA_PROTECT\nuser-edit\n',
    },
  )

  // Unchanged: equal new+existing → Files.Unchanged populated, no write.
  await snapshot('unchanged',
    {},
    () => {
      Project({ folder: 'app' }, () => {
        File({ name: 'a.txt' }, () => Content('A'))
      })
    },
    {
      '/out/app/a.txt': 'A',
      '/out/.jostraca/generated/app/a.txt': 'A',
    },
  )

  // Preserve: backup as .old.<ext>, write new.
  await snapshot('preserve_mode',
    { existing: { txt: { preserve: true } } },
    () => {
      Project({ folder: 'app' }, () => {
        File({ name: 'a.txt' }, () => Content('NEW'))
      })
    },
    {
      '/out/app/a.txt': 'OLD',
    },
  )

  // Diff: existing user-edited file is annotated with conflict markers.
  await snapshot('diff_mode',
    { existing: { txt: { diff: true } }, now: () => FROZEN_NOW },
    () => {
      Project({ folder: 'app' }, () => {
        File({ name: 'a.txt' }, () => Content('NEW\n'))
      })
    },
    {
      '/out/app/a.txt': 'OLD\n',
    },
  )

  // Present: leave existing, write .new.<ext>.
  await snapshot('present_mode',
    { existing: { txt: { present: true } } },
    () => {
      Project({ folder: 'app' }, () => {
        File({ name: 'a.txt' }, () => Content('NEW'))
      })
    },
    {
      '/out/app/a.txt': 'OLD',
    },
  )

  // Inject exclude is JavaScript truthiness: any truthy value skips the
  // injection, whatever it names, and a skipped target gets no write, no
  // baseline and no meta entry.
  const injectSeed = { '/out/app/t.txt': 'a\n#--START--#\nold\n#--END--#\nz\n' }
  for (const [name, exclude] of [
    ['inject_exclude_string', 'other'],
    ['inject_exclude_emptyarray', []],
    ['inject_exclude_list', ['other']],
    ['inject_exclude_object', {}],
  ]) {
    await snapshot(name, {}, () => {
      Project({ folder: 'app' }, () => {
        Inject({ name: 't.txt', exclude }, () => Content('NEW'))
      })
    }, injectSeed)
  }

  // An Inject's children build the injected region as they would build a
  // File, so a Fragment and a single-file Copy contribute their text.
  const twoBlocks = {
    '/out/app/t.txt':
      'A\n#--START--#\nold1\n#--END--#\nB\n#--START--#\nold2\n#--END--#\nC\n',
  }
  await snapshot('inject_fragment_child', { model: { name: 'World' } }, () => {
    Project({ folder: 'app' }, () => {
      Inject({ name: 't.txt' }, () => {
        Content('c1;')
        Fragment({ from: '/tpl/model.txt' })
        Content('c2;')
      })
    })
  }, { ...twoBlocks, '/tpl/model.txt': 'M=$$name$$\n' })

  await snapshot('inject_copy_child', { model: { name: 'World' } }, () => {
    Project({ folder: 'app' }, () => {
      Inject({ name: 't.txt' }, () => {
        Content('pre;')
        Copy({ from: '/tpl/single.txt', to: 'copied.txt' })
        Content('post;')
      })
    })
  }, { ...twoBlocks, '/tpl/single.txt': 'single $$name$$ FOO\n' })

  // A Slot outside a Fragment is transparent: its children render in place.
  const Wrap = cmp(function Wrap(_props, children) {
    each(children, { call: true })
  })
  await snapshot('slot_outside_fragment', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 's.txt' }, () => {
        Content('a')
        Slot({ name: 'x' }, () => Content('S'))
        Content('b')
        Slot({}, () => Content('U'))
        Slot({ name: 'n' }, () => {
          Content('N')
          Slot({ name: 'm' }, () => Content('M'))
        })
        Wrap(() => { Slot({ name: 'w' }, () => Content('W')) })
      })
      Inject({ name: 't.txt' }, () => {
        Content('i')
        Slot({ name: 'x' }, () => Content('S'))
        Content('j')
      })
    })
  }, { '/out/app/t.txt': '<\n#--START--#\nold\n#--END--#\n>' })

  // A File exclude names the component path: the Project name, then the
  // Folder names, then the File name. The Project folder is not part of it,
  // and a RegExp entry matches nothing.
  await snapshot('file_exclude', {}, () => {
    Project({ name: 'pn' }, () => {
      File({ name: 'keep.txt', exclude: 'pn/keep.txt' }, () => Content('NEW'))
      Folder({ name: 'sub' }, () => {
        File({ name: 'keep2.txt', exclude: ['pn/sub/keep2.txt'] }, () => Content('NEW'))
      })
      File({ name: 'a.txt', exclude: 'a.txt' }, () => Content('NEW'))
      File({ name: 'b.txt', exclude: [/b/] }, () => Content('NEW'))
      File({ name: 'c.txt', exclude: true }, () => Content('NEW'))
    })
  }, {
    '/out/keep.txt': 'OLD',
    '/out/sub/keep2.txt': 'OLD',
    '/out/a.txt': 'OLD',
    '/out/b.txt': 'OLD',
    '/out/c.txt': 'OLD',
  })

  await snapshot('file_exclude_project_folder', {}, () => {
    Project({ folder: 'x' }, () => {
      File({ name: 'a.txt', exclude: 'x/a.txt' }, () => Content('NEW'))
      File({ name: 'b.txt', exclude: 'b.txt' }, () => Content('NEW'))
    })
  }, {
    '/out/x/a.txt': 'OLD',
    '/out/x/b.txt': 'OLD',
  })

  // A backslash in an output-path component is a separator: the folded
  // path is the directory, the target, the baseline and the meta key.
  await snapshot('backslash_names', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'a\\b.txt' }, () => Content('B'))
      Folder({ name: 'x\\y' }, () => File({ name: 'a.txt' }, () => Content('A')))
      Inject({ name: 'a\\t.txt' }, () => Content('NEW'))
    })
    Project({ folder: 'p\\q' }, () => File({ name: 'c.txt' }, () => Content('C')))
  }, { '/out/app/a/t.txt': '<\n#--START--#\nold\n#--END--#\n>' })

  // One path saved twice in a run: listed once per files kind, one meta
  // entry at its first position carrying the last save's values.
  const marked = 'a\n#--START--#\nold\n#--END--#\nz\n'
  await snapshot('inject_after_file', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 't.txt' }, () => Content(marked))
      Inject({ name: 't.txt' }, () => Content('NEW'))
    })
  })
  await snapshot('inject_twice_same_file', {}, () => {
    Project({ folder: 'app' }, () => {
      Inject({ name: 't.txt' }, () => Content('ONE'))
      Inject({ name: 't.txt' }, () => Content('TWO'))
    })
  }, { '/out/app/t.txt': marked })
  await snapshot('copy_then_file_same', {}, () => {
    Project({ folder: 'app' }, () => {
      Copy({ from: '/src/single.txt' })
      File({ name: 'single.txt' }, () => Content('F\n'))
    })
  }, { '/src/single.txt': 'S\n' })
  await snapshot('file_then_copy_same', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'single.txt' }, () => Content('F\n'))
      Copy({ from: '/src/single.txt' })
    })
  }, { '/src/single.txt': 'S\n' })
  await snapshot('file_g_h_inject_g', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'g.txt' }, () => Content(marked))
      File({ name: 'h.txt' }, () => Content('H'))
      Inject({ name: 'g.txt' }, () => Content('NEW'))
    })
  })

  // A Folder or a Project inside a File never becomes the current file,
  // so what it emits lands in the File in source order; a File or an
  // Inject in there writes its own target.
  await snapshot('folder_and_project_in_file', { model: { name: 'N' } }, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'f.txt' }, () => {
        Content('1'); Folder({ name: 'd' }, () => Content('x')); Content('2')
      })
      File({ name: 'g.txt' }, () => {
        Content('1'); Project({ folder: 'p' }, () => Content('y')); Content('2')
      })
      File({ name: 'h.txt' }, () => {
        Content('1')
        Folder({ name: 'e' }, () => Copy({ from: '/src/c.txt', to: 'c2.txt' }))
        Folder({ name: 'k' }, () => Fragment({ from: '/tm/f.txt' }, () => Content('S')))
        Content('2')
      })
      File({ name: 'j.txt' }, () => {
        Content('1')
        Folder({ name: 'm' }, () => {
          File({ name: 'inner.txt' }, () => Content('I'))
          Content('z')
        })
        Folder({ name: '.' }, () => Inject({ name: 'inj.txt' }, () => Content('NEW')))
        Content('2')
      })
    })
  }, {
    '/src/c.txt': 'C$$name$$\n',
    '/tm/f.txt': '[F<[SLOT]>]\n',
    '/out/app/inj.txt': 'h\n#--START--#\nold\n#--END--#\nt\n',
  })

  // A File nested in a File, directly or through a Folder, is written to
  // its own path, and the outer file keeps all of its own content.
  await snapshot('file_in_file', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'outer.txt' }, () => {
        Content('1')
        File({ name: 'inner.txt' }, () => Content('2'))
        Content('3')
      })
      File({ name: 'outer2.txt' }, () => {
        Content('1')
        Folder({ name: 'sub' }, () => File({ name: 'inner.txt' }, () => Content('2')))
        Content('3')
      })
      File({ name: 'next.txt' }, () => Content('next'))
    })
  })

  // A Project's folder applies to its own subtree only (#26).
  await snapshot('project_nested_in_folder', {}, () => {
    Project({ folder: '.' }, () => {
      Folder({ name: 'a' }, () => {
        Project({ folder: 'p2' }, () => File({ name: 'x.txt' }, () => Content('x')))
      })
      File({ name: 'y.txt' }, () => Content('y'))
    })
  })
  await snapshot('project_nested_two_folders', {}, () => {
    Project({ folder: '.' }, () => {
      Folder({ name: 'a' }, () => {
        Folder({ name: 'b' }, () => {
          Project({ folder: 'p2' }, () => File({ name: 'x.txt' }, () => Content('x')))
        })
        File({ name: 'z.txt' }, () => Content('z'))
      })
      File({ name: 'y.txt' }, () => Content('y'))
    })
  })
  await snapshot('project_then_sibling_file', {}, () => {
    Project({ folder: '.' }, () => {
      Project({ folder: 'p' }, () => File({ name: 'a.txt' }, () => Content('a')))
      File({ name: 'y.txt' }, () => Content('y'))
    })
  })
  await snapshot('two_sibling_projects', {}, () => {
    Project({ folder: 'a' }, () => File({ name: 'x.txt' }, () => Content('x')))
    Project({ folder: 'b' }, () => File({ name: 'y.txt' }, () => Content('y')))
  })

  // A Fragment is templated once, as Content is: a `$$x$$` arriving in a
  // model value, a replace value or a replace function's return is text.
  await snapshot('frag_double_template', { model: { a: '$$b$$', b: 'X', name: 'N' } }, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'double.txt' }, () => {
        Fragment({ from: '/tm/double.txt' })
        Content('content:$$a$$\n')
      })
      File({ name: 'r1.txt' }, () => Fragment({
        from: '/tm/replace.txt', replace: { FOO: '$$b$$', BAR: 'bar' }
      }))
      File({ name: 'r2.txt' }, () => Fragment({
        from: '/tm/replace.txt', replace: { FOO: '$$"q"$$', BAR: () => '$$name$$' }
      }))
    })
  }, { '/tm/double.txt': '[$$a$$]\n', '/tm/replace.txt': 'FOO and BAR $$name$$\n' })

  // A Fragment renders when it is called: a render error stops the run
  // before anything is written, the body runs in the define phase, a source
  // the run writes is read with its bytes from before the run, and what a
  // Slot or a replace function emits lands at the marker.
  const fragSrc = {
    '/tm/noslot.txt': 'no markers $$name$$\n',
    '/tm/model.txt': 'M=$$name$$\n',
    '/tm/twice.txt': '1 <[SLOT:a]>\n2 <[SLOT:a]>\n3 <[SLOT]>\n4 <[SLOT]>\n',
    '/tm/replace.txt': 'FOO and BAR $$name$$\n',
    '/tm/slot.txt': 'HEAD<[SLOT:s]>TAIL\n',
    '/tm/c.txt': 'copied $$name$$\n',
  }
  await snapshot('frag_nonslot_no_default_error', { model: { name: 'World' } }, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'ok.txt' }, () => Content('ok'))
      File({ name: 'n.txt' }, () => Fragment({ from: '/tm/noslot.txt' }, () => Content('lost')))
    })
  }, fragSrc)
  await snapshot('frag_template_error', { model: { name: 'World' } }, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'first.txt' }, () => Content('first'))
      File({ name: 'e.txt' }, () =>
        Fragment({ from: '/tm/model.txt', replace: { '/x*/': 'y' } }))
    })
  }, fragSrc)
  await snapshot('frag_slot_body_counter', {}, () => {
    let n = 0
    Project({ folder: 'app' }, () => {
      File({ name: 'c.txt' }, () => {
        Fragment({ from: '/tm/twice.txt' }, () => {
          n++
          Slot({ name: 'a' }, () => Content('a' + n))
          Content('d' + n)
        })
        Content('after=' + n + '\n')
      })
    })
  }, fragSrc)
  await snapshot('frag_reads_generated', { model: { name: 'World' } }, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'tpl.txt' }, () => Content('NEW $$name$$ <[SLOT]>\n'))
      File({ name: 'use.txt' }, () => Fragment({ from: 'app/tpl.txt' }, () => Content('S')))
    })
  }, { ...fragSrc, '/out/app/tpl.txt': 'OLD $$name$$ <[SLOT]>\n' })
  await snapshot('frag_slot_copy', { model: { name: 'World' } }, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'f.txt' }, () => {
        Fragment({ from: '/tm/slot.txt' }, () => {
          Slot({ name: 's' }, () => {
            Content('pre;')
            Copy({ from: '/tm/c.txt', to: 'c.txt' })
            Content('post;')
          })
        })
      })
    })
  }, fragSrc)
  const Around = cmp(function Around(_props, children) {
    Content('<')
    each(children, { call: true })
    Content('>')
  })
  await snapshot('frag_replace_fn_emits', { model: { name: 'World' } }, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'f.txt' }, () => {
        Fragment({
          from: '/tm/replace.txt', replace: {
            FOO: () => {
              List({ item: [{ n: 1 }, { n: 2 }], line: false },
                ({ replace }) => Content({ src: '[{item.n}]', replace }))
            },
            BAR: () => { Line('bar') },
          }
        })
        Fragment({
          from: '/tm/replace.txt', replace: {
            FOO: () => { Fragment({ from: '/tm/model.txt' }) },
            BAR: () => { Around(() => Content('w')) },
          }
        })
      })
    })
  }, fragSrc)

  // A wrongly typed Fragment or CopyFiles prop stops the run before
  // anything is written.
  await snapshot('copy_exclude_number', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'first.txt' }, () => Content('first'))
      Copy({ from: '/tm/tree', to: 'n', exclude: 5 })
    })
  }, { '/tm/tree/a.txt': 'A\n' })
  await snapshot('frag_indent_bool', { model: { name: 'World' } }, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'first.txt' }, () => Content('first'))
      File({ name: 'b.txt' }, () => Fragment({ from: '/tm/model.txt', indent: true }))
    })
  }, fragSrc)

  // A single-file Copy spliced into a File or an Inject carries its
  // `replace`, as the copy it writes does.
  await snapshot('copy_in_file_replace', { model: { name: 'World' } }, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'host.txt' }, () => {
        Content('pre\n')
        Copy({ from: '/tpl/single.txt', to: 'spliced.txt', replace: { FOO: 'bar' } })
        Content('post\n')
      })
      Inject({ name: 't.txt' }, () => {
        Content('pre;')
        Copy({ from: '/tpl/single.txt', to: 'spliced2.txt', replace: { FOO: 'bar' } })
        Content('post;')
      })
    })
  }, {
    '/tpl/single.txt': 'single $$name$$ FOO\n',
    '/out/app/t.txt': 'head\n#--START--#\nold\n#--END--#\ntail\n',
  })

  // A plain replace value formats as a replace function's return does, in
  // every component that takes a replace map.
  await snapshot('replace_values', { model: { name: 'N' } }, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'c.txt' }, () => {
        Content({ src: 'zero=FOO;', replace: { FOO: 0 } })
        Content({ src: 'false=FOO;', replace: { FOO: false } })
        Content({ src: 'null=FOO;', replace: { FOO: null } })
        Content({ src: 'empty=FOO;', replace: { FOO: '' } })
        Content({ src: 'arr=FOO;', replace: { FOO: [1, 'a'] } })
        Content({ src: 'obj=FOO;', replace: { FOO: { b: 1, a: [2, 'x'] } } })
        Content({ src: 'big=FOO;', replace: { FOO: 1e6 } })
        Content({ src: 'huge=FOO;', replace: { FOO: 1e21 } })
        Content({ src: 'tiny=FOO;', replace: { FOO: 1e-7 } })
        Content({ src: 'neg=FOO\n', replace: { FOO: -5 } })
        Line({ src: 'line=FOO', replace: { FOO: 123456789012 } })
      })
      File({ name: 'f.txt' }, () => {
        Fragment({ from: '/tpl/frag.txt', replace: { FOO: 5, BAR: { k: 1, a: [true] } } })
        Fragment({ from: '/tpl/frag.txt', replace: { FOO: false, BAR: 2.5e-8 } })
        Fragment({ from: '/tpl/frag.txt', replace: { FOO: () => 'fn', BAR: () => null } })
      })
      Copy({ from: '/tpl/copy.txt', replace: { FOO: 123456789012 } })
      Copy({ from: '/tpl/dir', to: 'r', replace: { '/C/': 'Z', 'World': { o: 1 } } })
    })
  }, {
    '/tpl/frag.txt': 'FOO and BAR\n',
    '/tpl/copy.txt': 'copy FOO\n',
    '/tpl/dir/c.txt': 'C World\n',
  })

  // A string indent is inserted literally, `$` sequences included, and a
  // negative count adds nothing rather than throwing.
  await snapshot('indent_edges', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'd.txt' }, () => {
        Content({ src: 'a\nb\n', indent: '$$ ' })
        Content({ src: 'c\n', indent: '$& ' })
        Content({ src: 'd\n', indent: '$1|' })
        Line({ src: 'e', indent: "$'" })
        Content({ src: 'f\n', indent: -1 })
        Content({ src: 'g\n', indent: 2.7 })
        Fragment({ from: '/tpl/frag.txt', indent: '$$' })
        Fragment({ from: '/tpl/frag.txt', indent: -3 })
      })
    })
  }, { '/tpl/frag.txt': 'x\ny\n' })

  // A directory Copy walks its source in JavaScript's string order, by
  // UTF-16 code unit, so a name starting with U+1F600 sorts before one
  // starting with U+FF5A.
  const order = ['10.txt', '9.txt', 'B.txt', 'Z.txt', '_x.txt', 'a.txt',
    'é.txt', '\u{1F600}.txt', 'ｚ.txt']
  await snapshot('copy_order', {}, () => {
    Project({ folder: 'app' }, () => Copy({ from: '/tpl/order' }))
  }, Object.fromEntries(order.map((n) => ['/tpl/order/' + n, n + '\n'])))

  // The meta log is JSON.stringify output: '&', '<', '>' and U+2028 in a
  // path are written raw.
  await snapshot('meta_log_raw_quotes', {}, () => {
    Project({ folder: 'app' }, () => {
      for (const n of ['a&b.txt', 'x<y>.txt', 'u v.txt']) {
        File({ name: n }, () => Content('A\n'))
      }
    })
  })

  // A clean merge over a file whose generated text contains the marker
  // sentinel is written: the engine decides, the handler never pre-empts.
  const sentinel = (v) => () => Project({ folder: 'app' }, () => {
    File({ name: 'doc.md' }, () => Content(
      'How a conflict looks:\n>>>>>>> EXISTING: 2020-01-01T00:00:00.000Z/merge\n' + v + '\n'))
  })
  const mergeOpts = { existing: { txt: { merge: true } } }
  await snapshotRuns('merge_marker_clean', [
    [mergeOpts, sentinel('v1')],
    [mergeOpts, sentinel('v2')],
    [mergeOpts, sentinel('v3')],
  ])

  // A file still holding an earlier merge's markers is left untouched and
  // reported merged and conflicted.
  const one = (body) => () => Project({ folder: 'app' }, () => {
    File({ name: 'a.txt' }, () => Content(body))
  })
  await snapshotRuns('merge_unresolved', [
    [{}, one('A\n')],
    (fs) => fs.writeFileSync('/out/app/a.txt', 'A\nuser\n'),
    [mergeOpts, one('A\ngen\n')],
    [mergeOpts, one('A\ngen2\n')],
  ])

  // The audit trail, pinned whole: the low-level calls with their whence
  // tags, and each save's decision record with its breadcrumbs.
  const auditTree = (a, b) => () => Project({ folder: 'app' }, () => {
    File({ name: 'a.txt' }, () => Content(a))
    Folder({ name: 'sub' }, () => File({ name: 'b.txt' }, () => Content(b)))
  })
  await snapshotRuns('audit_basic', [[{}, auditTree('A\n', 'B\n')]])
  await snapshotRuns('audit_rerun', [
    [{}, auditTree('L1\nL2\nL3\n', 'B\n')],
    (fs) => fs.writeFileSync('/out/app/a.txt', 'L1\nU\nL3\n'),
    [{ existing: { txt: { merge: true, preserve: true } } }, auditTree('L1\nG\nL3\n', 'B\n')],
    [{ existing: { txt: { write: false, present: true } } }, auditTree('L1\nG2\nL3\n', 'B\n')],
    [{ existing: { txt: { diff: true } } }, auditTree('L1\nG3\nL3\n', 'B\n')],
  ])
  await snapshotRuns('audit_nested', [
    (fs) => {
      fs.mkdirSync('/src/tree/deep', { recursive: true })
      fs.writeFileSync('/src/tree/t.txt', 'T $$v$$\n')
      fs.writeFileSync('/src/tree/deep/i.png', Buffer.from([0x89, 0x50, 0x00, 0xff]))
      fs.writeFileSync('/src/tree/deep/m.bin', Buffer.from([0x00, 0x01, 0x02]))
      fs.mkdirSync('/out/app', { recursive: true })
      fs.writeFileSync('/out/app/j.txt', '<\n#--START--#\nold\n#--END--#\n>')
    },
    [{ model: { v: 'V' } }, () => Project({ folder: 'app' }, () => {
      Folder({ name: 'x' }, () => Folder({ name: 'y' }, () => {
        File({ name: 'n.txt' }, () => Content('N'))
      }))
      Copy({ from: '/src/tree', to: 'c' })
      Copy({ from: '/src/tree/t.txt', to: 'one.txt' })
      Inject({ name: 'j.txt' }, () => Content('J'))
    })],
  ])

  console.log('done')
}

// A run's audit trail, with each err reduced to its message: the rest of
// an Error is host detail.
function auditOf(res) {
  return res.audit().map(([tag, data]) => [tag, Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, 'err' === k ? String(v?.message) : v]))])
}

// snapshotRuns records a scenario of several generates over one volume,
// with edits between them. Each step is either a function called with the
// fs (an edit), or [opts, root] (a generate). The files lists of every
// generate are recorded, and the final volume.
async function snapshotRuns(name, steps) {
  const mfs = memfs({})
  const runs = []
  for (const step of steps) {
    if ('function' === typeof step) {
      step(mfs.fs)
      continue
    }
    const [opts, root] = step
    const res = await Jostraca({}).generate(Object.assign({
      fs: () => mfs.fs, folder: '/out', now: () => FROZEN_NOW,
    }, opts), root)
    runs.push({ files: res.files, audit: auditOf(res) })
  }
  fs.writeFileSync(
    path.join(outDir, name + '.json'),
    JSON.stringify({ scenario: name, runs, vol: volOf(mfs) }, null, 2) + '\n',
  )
  console.log('wrote', name)
}

// snapshotMerge runs a two-phase scenario: a clean first generation,
// then an external edit, then a second generation with merge mode on.
// Captures the post-second-generate vol.toJSON().
async function snapshotMerge(name) {
  const j = Jostraca({})
  const root = (m) => () => Project({ folder: 'sdk' }, () => {
    File({ name: 'foo.txt' }, () => {
      Content(m.body)
    })
  })

  const mfs = memfs({})
  const fs = mfs.fs
  // Phase 1: initial gen with body=A.
  await j.generate({ fs: () => fs, folder: '/out', model: { body: 'AAA\n' }, now: () => FROZEN_NOW }, root({ body: 'AAA\n' }))
  // External user edit.
  fs.writeFileSync('/out/sdk/foo.txt', 'AAA\nuser-line\n')
  // Phase 2: re-gen with body=B and merge enabled.
  await j.generate({
    fs: () => fs,
    folder: '/out',
    model: { body: 'BBB\n' },
    now: () => FROZEN_NOW,
    existing: { txt: { merge: true } },
  }, root({ body: 'BBB\n' }))

  const vol = volOf(mfs)
  const realFs = require('fs')
  realFs.writeFileSync(
    require('path').join(outDir, name + '.json'),
    JSON.stringify({
      scenario: name,
      vol: vol,
    }, null, 2) + '\n',
  )
  console.log('wrote', name)
}

async function snapshotMergeRetain(name) {
  // Phases mirror test/merge.test.ts:'retain'. Each generation gets
  // an incrementing now() so conflict-marker timestamps are deterministic.
  const START = 1735689600000
  let nowI = 0
  const now = () => START + (++nowI * (60 * 1000))

  const j = Jostraca({ now })
  const root = (m) => () => Project({ folder: '.' }, () => {
    File({ name: 'foo.txt' }, () => Content(m.foo))
  })

  const model = { foo: 'aaa\n' }
  const mfs = memfs({})
  const fs = mfs.fs
  const opts = {
    fs: () => fs, folder: '/', model,
    existing: { txt: { merge: true } },
  }

  const phases = []
  const snap = (label) => phases.push({ label, foo: enc(fs.readFileSync('/foo.txt')) })

  await j.generate(opts, root(model)); snap('G-0')   // first write
  await j.generate(opts, root(model)); snap('G-1')   // unchanged
  fs.appendFileSync('/foo.txt', 'bbb\n', { encoding: 'utf8' })
  await j.generate(opts, root(model)); snap('G-2')   // merge keeps bbb
  await j.generate(opts, root(model)); snap('G-3')   // idempotent
  await j.generate(opts, root(model)); snap('G-4')   // idempotent
  model.foo = 'aaa\nccc\n'
  await j.generate(opts, root(model)); snap('G-5')   // conflict ccc vs bbb
  fs.writeFileSync('/foo.txt', 'aaa\nbbb\nccc\n', { encoding: 'utf8' })
  await j.generate(opts, root(model)); snap('G-6')   // user resolves
  model.foo = 'aaa\nddd\n'
  await j.generate(opts, root(model)); snap('G-7')   // new conflict ddd
  await j.generate(opts, root(model)); snap('G-8')   // idempotent
  model.foo = 'aaa\neee\n'
  await j.generate(opts, root(model)); snap('G-9')   // conflict RETAINS ddd

  require('fs').writeFileSync(
    require('path').join(outDir, name + '.json'),
    JSON.stringify({ scenario: name, phases }, null, 2) + '\n',
  )
  console.log('wrote', name)
}

async function snapshotAbsPath(name) {
  const j = Jostraca({ model: { a: 0 } })
  const mfs = memfs({})
  await j.generate(
    { fs: () => mfs.fs, folder: '/top', now: () => FROZEN_NOW },
    () => Project({ folder: '/top/sdk' }, () => {
      Folder({ name: '/code/js' }, () => {
        File({ name: 'foo.js' }, () => {
          Content('// foo:0\n')
        })
      })
    }),
  )
  const vol = volOf(mfs)
  require('fs').writeFileSync(
    require('path').join(outDir, name + '.json'),
    JSON.stringify({ scenario: name, vol }, null, 2) + '\n',
  )
  console.log('wrote', name)
}

async function snapshotFragmentSubcmp(name) {
  const Foo = require('../dist/jostraca').cmp(function Foo(props) {
    Content('FOO[')
    Content(props.arg)
    Content(']')
  })
  const j = Jostraca({ model: { a: 'A' } })
  const mfs = memfs({
    '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n',
  })
  await j.generate(
    { fs: () => mfs.fs, folder: '/out', now: () => FROZEN_NOW },
    () => {
      Project({}, () => {
        File({ name: 'foo.txt' }, () => {
          Content('ONE\n')
          Fragment({
            from: '/f01.txt',
            replace: {
              bar: 'BAR',
              zed: () => 'ZED',
              con: () => Content('CON'),
              foo: () => Foo({ arg: 'B' }),
            },
          }, () => {
            Content('S')
          })
          Content('THREE\n')
        })
      })
    },
  )
  const vol = volOf(mfs)
  require('fs').writeFileSync(
    require('path').join(outDir, name + '.json'),
    JSON.stringify({ scenario: name, vol }, null, 2) + '\n',
  )
  console.log('wrote', name)
}

async function snapshotMergeUpdate(name) {
  const j = Jostraca({})
  const root = (m) => () => Project({ folder: 'sdk' }, () => {
    File({ name: 'foo.txt' }, () => {
      Content('// header\n' + m.body)
    })
  })

  const mfs = memfs({})
  const fs = mfs.fs
  await j.generate({ fs: () => fs, folder: '/out', model: { body: 'AAA\n' }, now: () => FROZEN_NOW }, root({ body: 'AAA\n' }))
  // User appends a comment line.
  fs.writeFileSync('/out/sdk/foo.txt', '// header\nAAA\n// user-comment\n')
  await j.generate({
    fs: () => fs, folder: '/out',
    model: { body: 'BBB\n' }, now: () => FROZEN_NOW,
    existing: { txt: { merge: true } },
  }, root({ body: 'BBB\n' }))

  const vol = volOf(mfs)
  require('fs').writeFileSync(
    require('path').join(outDir, name + '.json'),
    JSON.stringify({ scenario: name, vol }, null, 2) + '\n',
  )
  console.log('wrote', name)
}

async function snapshotMergeNoBaseline(name) {
  // No baseline in /out/.jostraca/generated, but the target file already
  // exists (e.g. user authored it before adopting jostraca). Merge mode
  // on this state should leave the file untouched and seed the duplicate
  // folder with the new content.
  const j = Jostraca({})
  const root = () => Project({ folder: 'sdk' }, () => {
    File({ name: 'foo.txt' }, () => Content('GEN\n'))
  })

  const mfs = memfs({ '/out/sdk/foo.txt': 'USER\n' })
  const fs = mfs.fs
  await j.generate({
    fs: () => fs, folder: '/out',
    now: () => FROZEN_NOW,
    existing: { txt: { merge: true } },
  }, root)

  const vol = volOf(mfs)
  require('fs').writeFileSync(
    require('path').join(outDir, name + '.json'),
    JSON.stringify({ scenario: name, vol }, null, 2) + '\n',
  )
  console.log('wrote', name)
}

async function snapshotMergeClean(name) {
  const j = Jostraca({})
  const root = (m) => () => Project({ folder: 'sdk' }, () => {
    File({ name: 'foo.txt' }, () => {
      Content(m.body)
    })
  })

  const mfs = memfs({})
  const fs = mfs.fs
  await j.generate({ fs: () => fs, folder: '/out', model: { body: 'AAA\n' }, now: () => FROZEN_NOW }, root({ body: 'AAA\n' }))
  // No user edit - so existing == prev gen, regen with new content.
  await j.generate({
    fs: () => fs, folder: '/out',
    model: { body: 'CCC\n' }, now: () => FROZEN_NOW,
    existing: { txt: { merge: true } },
  }, root({ body: 'CCC\n' }))

  const vol = volOf(mfs)
  require('fs').writeFileSync(
    require('path').join(outDir, name + '.json'),
    JSON.stringify({ scenario: name, vol }, null, 2) + '\n',
  )
  console.log('wrote', name)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
