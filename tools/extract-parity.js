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

const { memfs } = require('memfs')

const outDir = process.argv[2] || 'go/jostraca/testdata/parity'

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
  await j.generate(fullOpts, root)
  const result = mfs.vol.toJSON()
  fs.writeFileSync(
    path.join(outDir, name + '.json'),
    JSON.stringify({
      scenario: name,
      opts: opts || {},
      prepopulate: prepopulate || {},
      vol: result,
    }, null, 2) + '\n',
  )
  console.log('wrote', name)
}

async function main() {
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

  const vol = mfs.vol.toJSON()
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
  const vol = mfs.vol.toJSON()
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

  const vol = mfs.vol.toJSON()
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

  const vol = mfs.vol.toJSON()
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
