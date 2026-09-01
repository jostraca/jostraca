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
  Jostraca, Project, Folder, File, Content, Inject, Fragment, Slot, Copy, Line, List,
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
  try {
    await j.generate(fullOpts, root)
  }
  catch (err) {
    error = true
  }
  const result = volOf(mfs)
  fs.writeFileSync(
    path.join(outDir, name + '.json'),
    JSON.stringify({
      scenario: name,
      opts: opts || {},
      prepopulate: encMap(prepopulate),
      error,
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
  // rejected at define time by both: TS through the shape Check on `from`, Go
  // at builder.go ("Fragment: From file does not exist"). Before the guard in
  // snapshot() above, adding this would have crashed the corpus generator
  // instead of recording anything. See PARITY_PLAN.md 2.1.
  await snapshot('fragment_missing_from_errors', {}, () => {
    Project({ folder: 'app' }, () => {
      File({ name: 'index.html' }, () => {
        Fragment({ from: '/templates/does-not-exist.html' })
      })
    })
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

  console.log('done')
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
