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

  console.log('done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
