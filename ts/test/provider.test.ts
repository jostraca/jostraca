/* Copyright (c) 2024 Richard Rodger, MIT License */

// Same scenarios, both filesystem providers.
//
// Why this suite exists: T0. `Jostraca()` with no `fs` and no `mem` could
// not write to the real filesystem at all — the library's primary
// documented use case, broken, in a suite that was green. It survived
// because EVERY test injected a memfs provider explicitly, so nothing ever
// exercised the production path the double stood in for.
//
// A test double used universally hides defects in exactly the code it
// replaces. The fix is not "one real-filesystem smoke test", it is running
// the same scenarios through both providers and asserting they agree. The
// comparison is differential — no expected output is transcribed here — so
// adding a scenario costs nothing and covers both paths by construction.

import { test, describe } from 'node:test'
import { expect, POSIX_MODES } from './expect'

import Fs from 'node:fs'
import Os from 'node:os'
import Path from 'node:path'

import { memfs } from '../dist/util/memfs'

import {
  Jostraca,
  Project,
  Folder,
  File,
  Content,
  Copy,
  Inject,
} from '../'


const START_TIME = 1735689600000

// Files whose content is provider-dependent by design, not by defect.
const META_FOLDER = '.jostraca'


type Harness = {
  name: string
  folder: string
  // Options for `generate`, merged with whatever the scenario needs.
  opts: (extra?: any) => any
  // Seed a file before generating, as an existing user file would be.
  put: (rel: string, text: string) => void
  // Whole output tree, relative path -> content.
  tree: () => Record<string, string>
  cleanup: () => void
}


function memHarness(): Harness {
  const { fs, vol } = memfs({})
  const folder = '/out'

  return {
    name: 'memfs',
    folder,
    opts: (extra: any = {}) => ({ fs: () => fs, folder, ...extra }),
    put: (rel, text) => {
      fs.mkdirSync(Path.posix.dirname(folder + '/' + rel), { recursive: true })
      fs.writeFileSync(folder + '/' + rel, text)
    },
    tree: () => {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(vol.toJSON())) {
        if (!k.startsWith(folder + '/')) continue
        out[k.substring(folder.length + 1)] = null == v ? '' : '' + v
      }
      return out
    },
    cleanup: () => { },
  }
}


function nodeHarness(): Harness {
  const folder = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-prov-'))

  const walk = (dir: string, prefix: string, out: Record<string, string>) => {
    for (const entry of Fs.readdirSync(dir, { withFileTypes: true })) {
      const full = Path.join(dir, entry.name)
      const rel = prefix ? prefix + '/' + entry.name : entry.name
      if (entry.isDirectory()) {
        walk(full, rel, out)
      }
      else {
        out[rel] = Fs.readFileSync(full, 'utf8')
      }
    }
  }

  return {
    name: 'node:fs',
    folder,
    // No `fs` and no `mem`: this is the README quick-start path.
    opts: (extra: any = {}) => ({ folder, ...extra }),
    put: (rel, text) => {
      const full = Path.join(folder, ...rel.split('/'))
      Fs.mkdirSync(Path.dirname(full), { recursive: true })
      Fs.writeFileSync(full, text)
    },
    tree: () => {
      const out: Record<string, string> = {}
      walk(folder, '', out)
      return out
    },
    cleanup: () => Fs.rmSync(folder, { recursive: true, force: true }),
  }
}


// The meta log records absolute paths, which differ by provider by
// construction. Everything else must match byte for byte.
function normalise(tree: Record<string, string>, folder: string) {
  const out: Record<string, string> = {}
  for (const [path, text] of Object.entries(tree)) {
    out[path] = path.includes(META_FOLDER) ?
      text.split(folder).join('<FOLDER>') : text
  }
  return out
}


type Scenario = {
  name: string
  run: (h: Harness) => Promise<void>
  // Files the scenario must have produced, so a scenario that silently
  // does nothing cannot pass by producing nothing on both sides.
  produces: string[]
}


const SCENARIOS: Scenario[] = [

  {
    name: 'fresh-generate',
    produces: ['app/src/index.js', 'app/package.json'],
    run: async (h) => {
      const jostraca = Jostraca({ now: () => START_TIME })
      await jostraca.generate(h.opts(), () =>
        Project({ folder: 'app' }, () => {
          Folder({ name: 'src' }, () => {
            File({ name: 'index.js' }, () => Content('console.log(1)\n'))
          })
          File({ name: 'package.json' }, () => Content('{"name":"app"}\n'))
        }))
    },
  },

  {
    name: 'regenerate-changed-content',
    produces: ['app/a.txt'],
    run: async (h) => {
      const gen = async (body: string) => {
        const jostraca = Jostraca({ now: () => START_TIME })
        await jostraca.generate(h.opts(), () =>
          Project({ folder: 'app' }, () =>
            File({ name: 'a.txt' }, () => Content(body))))
      }
      await gen('ONE\n')
      await gen('TWO\n')
    },
  },

  {
    name: 'preserve-user-edit',
    produces: ['app/a.txt'],
    run: async (h) => {
      h.put('app/a.txt', 'USER WROTE THIS\n')
      const jostraca = Jostraca({ now: () => START_TIME })
      await jostraca.generate(
        h.opts({ existing: { txt: { preserve: true } } }),
        () => Project({ folder: 'app' }, () =>
          File({ name: 'a.txt' }, () => Content('GENERATED\n'))))
    },
  },

  {
    name: 'merge-user-edit',
    produces: ['app/a.txt'],
    run: async (h) => {
      const gen = async (body: string, extra: any = {}) => {
        const jostraca = Jostraca({ now: () => START_TIME })
        await jostraca.generate(h.opts(extra), () =>
          Project({ folder: 'app' }, () =>
            File({ name: 'a.txt' }, () => Content(body))))
      }

      // First pass lays down the baseline the merge needs.
      await gen('line1\nline2\nline3\n')
      h.put('app/a.txt', 'line1\nline2\nUSER LINE\nline3\n')
      await gen('line1\nCHANGED\nline3\n', { existing: { txt: { merge: true } } })
    },
  },

  {
    name: 'diff-annotates',
    produces: ['app/a.txt'],
    run: async (h) => {
      h.put('app/a.txt', 'OLD\n')
      const jostraca = Jostraca({ now: () => START_TIME })
      await jostraca.generate(
        h.opts({ existing: { txt: { diff: true } } }),
        () => Project({ folder: 'app' }, () =>
          File({ name: 'a.txt' }, () => Content('NEW\n'))))
    },
  },

  {
    name: 'inject-into-existing',
    produces: ['app/a.txt'],
    run: async (h) => {
      h.put('app/a.txt',
        'head\n#--START--#\nstale\n#--END--#\ntail\n')
      const jostraca = Jostraca({ now: () => START_TIME })
      await jostraca.generate(h.opts(), () =>
        Project({ folder: 'app' }, () =>
          Inject({ name: 'a.txt' }, () => Content('injected\n'))))
    },
  },

  {
    name: 'copy-tree',
    produces: ['app/lib/one.txt', 'app/lib/deep/two.txt'],
    run: async (h) => {
      h.put('src/one.txt', 'ONE\n')
      h.put('src/deep/two.txt', 'TWO\n')
      const jostraca = Jostraca({ now: () => START_TIME })
      await jostraca.generate(h.opts(), () =>
        Project({ folder: 'app' }, () =>
          Copy({ from: h.folder + '/src', to: 'lib' })))
    },
  },

  {
    name: 'nested-folders',
    produces: ['app/a/b/c/deep.txt'],
    run: async (h) => {
      const jostraca = Jostraca({ now: () => START_TIME })
      await jostraca.generate(h.opts(), () =>
        Project({ folder: 'app' }, () =>
          Folder({ name: 'a' }, () =>
            Folder({ name: 'b' }, () =>
              Folder({ name: 'c' }, () =>
                File({ name: 'deep.txt' }, () => Content('DEEP\n')))))))
    },
  },
]


describe('provider-parity', () => {

  for (const scenario of SCENARIOS) {

    test(scenario.name, async () => {
      const harnesses = [memHarness(), nodeHarness()]
      const trees: Record<string, Record<string, string>> = {}

      try {
        for (const h of harnesses) {
          await scenario.run(h)
          trees[h.name] = normalise(h.tree(), h.folder)
        }
      }
      finally {
        for (const h of harnesses) {
          h.cleanup()
        }
      }

      const [first, second] = harnesses.map(h => h.name)

      // Vacuity guard: a scenario that produces nothing would otherwise
      // "agree" on both providers.
      for (const name of [first, second]) {
        for (const rel of scenario.produces) {
          expect(null != trees[name][rel]).true()
        }
      }

      // The real assertion: same paths, same bytes, either provider.
      expect(Object.keys(trees[first]).sort())
        .equal(Object.keys(trees[second]).sort())

      for (const rel of Object.keys(trees[first])) {
        expect(trees[first][rel]).equal(trees[second][rel])
      }
    })
  }


  // Mode bits only exist on the real filesystem, so this one cannot be a
  // differential — but it is the same lesson, and it is the reason the
  // atomic write has to chmod after rename.
  test('file-mode-survives-regeneration', async () => {
    const h = nodeHarness()
    try {
      const gen = async (body: string) => {
        const jostraca = Jostraca({ now: () => START_TIME })
        await jostraca.generate(h.opts(), () =>
          Project({ folder: 'app' }, () =>
            File({ name: 'run.sh', mode: 0o755 }, () => Content(body))))
      }

      const target = Path.join(h.folder, 'app', 'run.sh')

      // The mode half is skipped on Windows, which has no execute bit
      // (see POSIX_MODES); the rename half below is checked everywhere.
      await gen('#!/bin/sh\necho one\n')
      if (POSIX_MODES) {
        expect(0 !== (Fs.statSync(target).mode & 0o111)).true()
      }
      expect(Fs.readFileSync(target, 'utf8')).equal('#!/bin/sh\necho one\n')

      await gen('#!/bin/sh\necho two\n')
      if (POSIX_MODES) {
        expect(0 !== (Fs.statSync(target).mode & 0o111)).true()
      }
      expect(Fs.readFileSync(target, 'utf8')).equal('#!/bin/sh\necho two\n')

      // Rename swaps the inode; a leftover temp file means the swap did
      // not complete cleanly.
      const stray = Fs.readdirSync(Path.join(h.folder, 'app'))
        .filter(n => n !== 'run.sh')
      expect(stray).equal([])
    }
    finally {
      h.cleanup()
    }
  })

})
