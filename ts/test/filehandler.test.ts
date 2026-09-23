
// File-handler behaviour pinned across both stacks. Each test here has a
// Go twin; the names match the regression rows recorded for the port.

import Fs from 'node:fs'
import Os from 'node:os'
import Path from 'node:path'

import { test, describe } from 'node:test'
import { expect } from './expect'

import { memfs, memClean } from '../dist/util/memfs'

import {
  Jostraca,
  Project,
  Folder,
  File,
  Content,
  Copy,
  Inject,
  Fragment,
  Slot,
  cmp,
  each,
  cmpTree,
} from '../'


const NOW = 1735689600000

const META = '/out/.jostraca/jostraca.meta.log'

const quiet = {
  trace: () => { }, debug: () => { }, info: () => { },
  warn: () => { }, error: () => { }, fatal: () => { },
}


function metaOf(fs: any, path = META) {
  return JSON.parse(fs.readFileSync(path, 'utf8'))
}


describe('filehandler', () => {

  // A JOSTRACA_PROTECT marker protects a target whatever its
  // classification: text, binary by extension, or binary by content.
  test('binary-protect', async () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff])

    const runs: [string, any, () => void][] = [
      ['file', {}, () => Project({}, () => {
        File({ name: 'a.png' }, () => Content('P2'))
      })],
      ['copy-one', {}, () => Project({}, () => {
        Copy({ from: '/src/one/a.png', to: 'a.png' })
      })],
      ['copy-tree', {}, () => Project({}, () => {
        Copy({ from: '/src/tree' })
      })],
      ['file-preserve', { existing: { bin: { preserve: true } } },
        () => Project({}, () => {
          File({ name: 'a.png' }, () => Content('P2'))
        })],
      ['copy-preserve', { existing: { bin: { preserve: true } } },
        () => Project({}, () => {
          Copy({ from: '/src/one/a.png', to: 'a.png' })
        })],
    ]

    for (const [name, opts, root] of runs) {
      const { fs } = memfs({
        '/src/one/a.png': PNG,
        '/src/tree/a.png': PNG,
        '/out/a.png': 'JOSTRACA_PROTECT',
      })
      const res = await Jostraca({ now: () => NOW, log: quiet })
        .generate({ fs: () => fs, folder: '/out', ...opts }, root)

      expect(fs.readFileSync('/out/a.png', 'utf8')).equal('JOSTRACA_PROTECT')
      expect(res.files.written).equal([])
      expect(res.files.preserved).equal([])
      expect(fs.existsSync('/out/a.old.png')).equal(false)

      const entry = metaOf(fs).files['a.png']
      expect({ name, action: entry.action, protect: entry.protect })
        .equal({ name, action: 'skip', protect: true })
    }
  })


  // Inject exclude is coerced with `!!props.exclude`: any truthy value
  // skips the injection, whatever it names.
  test('inject-exclude-truthy', async () => {
    const seed = 'a\n#--START--#\nold\n#--END--#\nz\n'
    const injected = 'a\n#--START--#\nNEW\n#--END--#\nz\n'

    const typed = (ex: any) => () => Project({}, () => {
      Inject({ name: 't.txt', exclude: ex }, () => Content('NEW'))
    })
    const tree = (ex: any) => cmpTree({
      cmp: 'Project', props: {},
      children: [{
        cmp: 'Inject', props: { name: 't.txt', exclude: ex },
        children: [{ cmp: 'Content', props: { src: 'NEW' } }],
      }],
    })

    const run = async (root: any) => {
      const { fs } = memfs({ '/out/t.txt': seed })
      const res = await Jostraca({ now: () => NOW, log: quiet })
        .generate({ fs: () => fs, folder: '/out' }, root)
      return { res, fs }
    }

    for (const ex of [true, 'other', [], ['other'], {}, 1, -1]) {
      for (const root of [typed(ex), tree(ex)]) {
        const { res, fs } = await run(root)
        expect({ ex, t: fs.readFileSync('/out/t.txt', 'utf8') })
          .equal({ ex, t: seed })
        expect(res.files.written).equal([])
        expect(fs.existsSync('/out/.jostraca/generated/t.txt')).equal(false)
        if (fs.existsSync(META)) {
          expect(metaOf(fs).files['t.txt']).equal(undefined)
        }
      }
    }

    for (const ex of [false, '', 0]) {
      for (const root of [typed(ex), tree(ex)]) {
        const { fs } = await run(root)
        expect({ ex, t: fs.readFileSync('/out/t.txt', 'utf8') })
          .equal({ ex, t: injected })
      }
    }
  })


  // An Inject's children build the injected region exactly as they would
  // build a File: Fragment output and a single-file Copy's spliced text
  // included, in source order.
  test('inject-fragment-and-copy-children', async () => {
    const marked = 'A\n#--START--#\nold1\n#--END--#\nB\n#--START--#\nold2\n#--END--#\nC\n'
    const block = (body: string) => 'A\n#--START--#\n' + body +
      '\n#--END--#\nB\n#--START--#\n' + body + '\n#--END--#\nC\n'

    const run = async (root: any) => {
      const { fs } = memfs({
        '/tpl/model.txt': 'M=$$name$$\n',
        '/tpl/single.txt': 'single $$name$$ FOO\n',
        '/out/t.txt': marked,
      })
      await Jostraca({ now: () => NOW, log: quiet, model: { name: 'World' } })
        .generate({ fs: () => fs, folder: '/out' }, root)
      return fs
    }

    const fs0 = await run(() => Project({}, () => {
      Inject({ name: 't.txt' }, () => {
        Content('c1;')
        Fragment({ from: '/tpl/model.txt' })
        Content('c2;')
      })
    }))
    expect(fs0.readFileSync('/out/t.txt', 'utf8')).equal(block('c1;M=World\nc2;'))

    const fs1 = await run(() => Project({}, () => {
      Inject({ name: 't.txt' }, () => {
        Content('pre;')
        Copy({ from: '/tpl/single.txt', to: 'copied.txt' })
        Content('post;')
      })
    }))
    expect(fs1.readFileSync('/out/t.txt', 'utf8'))
      .equal(block('pre;single World FOO\npost;'))
    expect(fs1.readFileSync('/out/copied.txt', 'utf8')).equal('single World FOO\n')
  })


  // A Slot outside a Fragment is transparent: its children render in
  // place in the enclosing File or Inject.
  test('slot-outside-fragment', async () => {
    const Wrap = cmp(function Wrap(_props: any, children: any) {
      each(children, { call: true })
    })

    const cases: [string, () => void, string][] = [
      ['named', () => {
        Content('a'); Slot({ name: 'x' }, () => Content('S')); Content('b')
      }, 'aSb'],
      ['unnamed', () => {
        Content('a'); Slot({}, () => Content('S')); Content('b')
      }, 'aSb'],
      ['nested', () => {
        Content('a')
        Slot({ name: 'x' }, () => {
          Content('S')
          Slot({ name: 'y' }, () => Content('T'))
        })
        Content('b')
      }, 'aSTb'],
      ['cmp-wrapped', () => {
        Content('a')
        Wrap(() => { Slot({ name: 'x' }, () => Content('S')) })
        Content('b')
      }, 'aSb'],
    ]

    for (const [name, body, want] of cases) {
      const { fs } = memfs({})
      await Jostraca({ now: () => NOW, log: quiet })
        .generate({ fs: () => fs, folder: '/out' },
          () => Project({}, () => File({ name: 's.txt' }, body)))
      expect({ name, s: fs.readFileSync('/out/s.txt', 'utf8') })
        .equal({ name, s: want })
    }

    const { fs } = memfs({ '/out/t.txt': '<\n#--START--#\nold\n#--END--#\n>' })
    await Jostraca({ now: () => NOW, log: quiet })
      .generate({ fs: () => fs, folder: '/out' }, () => Project({}, () => {
        Inject({ name: 't.txt' }, () => {
          Content('a'); Slot({ name: 'x' }, () => Content('S')); Content('b')
        })
      }))
    expect(fs.readFileSync('/out/t.txt', 'utf8'))
      .equal('<\n#--START--#\naSb\n#--END--#\n>')
  })


  // A File exclude applies only when the target exists. true skips it; a
  // string, or a list holding a string, skips it when equal to the
  // component path: the Project name, the Folder names, the File name.
  // Never the Project folder. A RegExp entry matches nothing.
  test('file-exclude-string-and-list', async () => {
    const file = (name: string, exclude: any) => ({
      cmp: 'File', props: { name, exclude },
      children: [{ cmp: 'Content', props: { src: 'NEW' } }],
    })
    const rows: [string, string, boolean, () => void, any][] = [
      ['string', '/out/keep.txt', true, () => Project({}, () => {
        File({ name: 'keep.txt', exclude: 'keep.txt' }, () => Content('NEW'))
      }), { cmp: 'Project', props: {}, children: [file('keep.txt', 'keep.txt')] }],
      ['list-in-folder', '/out/sub/keep2.txt', true, () => Project({}, () => {
        Folder({ name: 'sub' }, () => {
          File({ name: 'keep2.txt', exclude: ['sub/keep2.txt'] }, () => Content('NEW'))
        })
      }), {
        cmp: 'Project', props: {}, children: [{
          cmp: 'Folder', props: { name: 'sub' },
          children: [file('keep2.txt', ['sub/keep2.txt'])],
        }]
      }],
      ['named-project', '/out/a.txt', true, () => Project({ name: 'pn' }, () => {
        File({ name: 'a.txt', exclude: 'pn/a.txt' }, () => Content('NEW'))
      }), { cmp: 'Project', props: { name: 'pn' }, children: [file('a.txt', 'pn/a.txt')] }],
      ['project-folder-is-not-the-path', '/out/x/a.txt', false,
        () => Project({ folder: 'x' }, () => {
          File({ name: 'a.txt', exclude: 'x/a.txt' }, () => Content('NEW'))
        }), { cmp: 'Project', props: { folder: 'x' }, children: [file('a.txt', 'x/a.txt')] }],
      ['regexp-matches-nothing', '/out/a.txt', false, () => Project({}, () => {
        File({ name: 'a.txt', exclude: [/a/] }, () => Content('NEW'))
      }), null],
      ['other-values-do-not-exclude', '/out/a.txt', false, () => Project({}, () => {
        File({ name: 'a.txt', exclude: [] }, () => Content('NEW'))
      }), { cmp: 'Project', props: {}, children: [file('a.txt', [])] }],
    ]

    for (const [name, out, excluded, typed, tree] of rows) {
      for (const root of [typed, null == tree ? null : cmpTree(tree)]) {
        if (null == root) continue
        const { fs } = memfs({ [out]: 'OLD' })
        const res = await Jostraca({ now: () => NOW, log: quiet })
          .generate({ fs: () => fs, folder: '/out' }, root)
        const rel = out.substring('/out/'.length)
        const got = {
          name,
          content: fs.readFileSync(out, 'utf8'),
          written: res.files.written.length,
          baseline: fs.existsSync('/out/.jostraca/generated/' + rel),
          meta: null != metaOf(fs).files[rel],
        }
        expect(got).equal(excluded ?
          { name, content: 'OLD', written: 0, baseline: false, meta: false } :
          { name, content: 'NEW', written: 1, baseline: true, meta: true })
      }
    }
  })


  // New files and directories take 0666 and 0777 less the process umask.
  test('umask-default-modes', { skip: 'win32' === process.platform }, async () => {
    const old = process.umask(0o002)
    const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-umask-'))
    try {
      const out = Path.join(dir, 'out')
      await Jostraca({ now: () => NOW, log: quiet })
        .generate({ folder: out }, () => Project({}, () => {
          Folder({ name: 'sub' }, () => File({ name: 'a.txt' }, () => Content('A')))
        }))
      const want: Record<string, number> = {
        'sub/a.txt': 0o664,
        'sub': 0o775,
        '.jostraca/generated/sub/a.txt': 0o664,
        '.jostraca/generated/sub': 0o775,
        '.jostraca/jostraca.meta.log': 0o664,
        '.jostraca/.gitignore': 0o664,
        '.jostraca': 0o775,
      }
      const got: Record<string, number> = {}
      for (const rel of Object.keys(want)) {
        got[rel] = Fs.statSync(Path.join(out, rel)).mode & 0o777
      }
      expect(got).equal(want)
    }
    finally {
      process.umask(old)
      Fs.rmSync(dir, { recursive: true, force: true })
    }

    const { fs } = memfs({ '/d/a.txt': 'A' })
    expect(fs.statSync('/d/a.txt').mode & 0o777).equal(0o666)
    expect(fs.statSync('/d').mode & 0o777).equal(0o777)
  })


  // In-memory keys are canonical absolute paths: backslashes folded, `.`
  // and `..` resolved, a relative path resolved against the working
  // directory. A vol seeded with the cwd-absolute key and generated with a
  // relative folder addresses the same file.
  test('memfs-keys-resolve-against-cwd', async () => {
    const cwd = process.cwd().replace(/\\/g, '/')
    const parent = cwd.substring(0, cwd.lastIndexOf('/')) || '/'
    const join = (dir: string, rest: string) => ('/' === dir ? '' : dir) + '/' + rest
    const cases: [string, string][] = [
      ['a.txt', join(cwd, 'a.txt')],
      ['', cwd],
      ['.', cwd],
      ['./out/a.txt', join(cwd, 'out/a.txt')],
      ['a\\b.txt', join(cwd, 'a/b.txt')],
      ['../z', join(parent, 'z')],
      ['/', '/'],
      ['/x/../y', '/y'],
      ['/a\\b', '/a/b'],
      ['/out//a/./b', '/out/a/b'],
      ['C:\\x\\y', 'C:/x/y'],
      ['C:/x/../y', 'C:/y'],
    ]
    for (const [p, want] of cases) {
      expect({ p, got: memClean(p) }).equal({ p, got: want })
    }

    const abs = cwd + '/out/a.txt'
    const j = Jostraca({ mem: true, vol: { [abs]: 'OLD' }, now: () => NOW, log: quiet })
    const res: any = await j.generate({
      folder: 'out', existing: { txt: { write: false } },
    }, () => Project({}, () => File({ name: 'a.txt' }, () => Content('NEW'))))
    expect(res.files.written).equal([])
    const vol = res.vol().toJSON()
    const keys = Object.keys(vol).filter((k) =>
      k.endsWith('/a.txt') && !k.includes('.jostraca'))
    expect(keys).equal([abs])
    expect(vol[abs]).equal('OLD')
    for (const k of Object.keys(vol)) {
      expect({ k, under: k.startsWith(cwd + '/out/') }).equal({ k, under: true })
    }
  })


  // An output folder with a trailing slash behaves exactly like the same
  // folder without one: folder-relative meta keys, baselines written, and a
  // later merge that keeps the user's edit.
  test('folder-trailing-slash', async () => {
    const cwd = process.cwd().replace(/\\/g, '/')
    for (const [folder, base] of [
      ['out/', cwd + '/out'],
      ['./out/', cwd + '/out'],
      ['out//', cwd + '/out'],
      ['/abs/out/', '/abs/out'],
    ]) {
      const { fs } = memfs({})
      const j = Jostraca({ log: quiet })
      const root = (b: string) => () => Project({}, () => {
        File({ name: 'a.txt' }, () => Content(b))
        Folder({ name: 'sub' }, () => File({ name: 'b.txt' }, () => Content('B\n')))
      })

      await j.generate({ fs: () => fs, folder, now: () => NOW }, root('L1\nL2\nL3\n'))
      expect({ folder, a: fs.existsSync(base + '/.jostraca/generated/a.txt') })
        .equal({ folder, a: true })
      expect(fs.existsSync(base + '/.jostraca/generated/sub/b.txt')).equal(true)
      expect(Object.keys(metaOf(fs, base + '/.jostraca/jostraca.meta.log').files))
        .equal(['a.txt', 'sub/b.txt'])

      fs.writeFileSync(base + '/a.txt', 'L1\nU\nL3\n')
      const res = await j.generate({
        fs: () => fs, folder, now: () => NOW + 1, existing: { txt: { merge: true } },
      }, root('L1\nG\nL3\n'))
      expect({ folder, merged: res.files.merged.length, conflicted: res.files.conflicted.length })
        .equal({ folder, merged: 1, conflicted: 1 })
      expect(res.files.merged[0].endsWith('/a.txt')).equal(true)
      const text = fs.readFileSync(base + '/a.txt', 'utf8')
      expect(text.includes('U\n') && text.includes('G\n')).equal(true)
    }
  })


  // A backslash in an output-path component is a separator on every
  // platform: the folded path is used for the directory, the read, the
  // write, the baseline, the meta key and the files lists, and no literal
  // backslash directory is left behind.
  test('backslash-in-output-names', async () => {
    const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-bs-'))
    try {
      const out = Path.join(dir, 'out').replace(/\\/g, '/')
      Fs.mkdirSync(Path.join(dir, 'out', 'a'), { recursive: true })
      Fs.writeFileSync(Path.join(dir, 'out', 'a', 't.txt'), '<\n#--START--#\nold\n#--END--#\n>')

      const res = await Jostraca({ now: () => NOW, log: quiet })
        .generate({ folder: out }, () => {
          Project({}, () => {
            File({ name: 'a\\b.txt' }, () => Content('B'))
            Folder({ name: 'x\\y' }, () => File({ name: 'a.txt' }, () => Content('A')))
            Inject({ name: 'a\\t.txt' }, () => Content('NEW'))
          })
          Project({ folder: 'p\\q' }, () => File({ name: 'c.txt' }, () => Content('C')))
        })

      const got: string[] = []
      const walk = (d: string) => {
        for (const e of Fs.readdirSync(d, { withFileTypes: true })) {
          const p = Path.join(d, e.name)
          const rel = Path.relative(dir, p).replace(/\\/g, '/')
          got.push(rel + (e.isDirectory() ? '/' : ''))
          if (e.isDirectory()) walk(p)
        }
      }
      walk(dir)
      got.sort()
      expect(got).equal([
        'out/',
        'out/.jostraca/',
        'out/.jostraca/.gitignore',
        'out/.jostraca/generated/',
        'out/.jostraca/generated/a/',
        'out/.jostraca/generated/a/b.txt',
        'out/.jostraca/generated/a/t.txt',
        'out/.jostraca/generated/p/',
        'out/.jostraca/generated/p/q/',
        'out/.jostraca/generated/p/q/c.txt',
        'out/.jostraca/generated/x/',
        'out/.jostraca/generated/x/y/',
        'out/.jostraca/generated/x/y/a.txt',
        'out/.jostraca/jostraca.meta.log',
        'out/a/',
        'out/a/b.txt',
        'out/a/t.txt',
        'out/p/',
        'out/p/q/',
        'out/p/q/c.txt',
        'out/x/',
        'out/x/y/',
        'out/x/y/a.txt',
      ])

      expect(Fs.readFileSync(Path.join(dir, 'out', 'a', 't.txt'), 'utf8'))
        .equal('<\n#--START--#\nNEW\n#--END--#\n>')

      const meta = JSON.parse(Fs.readFileSync(out + '/.jostraca/jostraca.meta.log', 'utf8'))
      expect(Object.keys(meta.files).sort())
        .equal(['a/b.txt', 'a/t.txt', 'p/q/c.txt', 'x/y/a.txt'])
      expect(meta.files['a/t.txt'].exists).equal(true)
      for (const w of ['/a/b.txt', '/x/y/a.txt', '/a/t.txt', '/p/q/c.txt']) {
        expect({ w, has: res.files.written.includes(out + w) }).equal({ w, has: true })
      }
    }
    finally {
      Fs.rmSync(dir, { recursive: true, force: true })
    }
  })


  // A previous meta log's `last` is used only when it is a finite number a
  // Date can carry; anything else is treated as absent (-1), so a merge
  // labels EXISTING with the epoch minus one millisecond.
  test('meta-last-type', async () => {
    for (const last of ['"1735689600000"', 'true', '"2025-01-01"', '{}', '1e20', '[]', 'null']) {
      const { fs } = memfs({
        '/out/.jostraca/jostraca.meta.log': '{"last":' + last + ',"hlast":"x","files":[1]}',
        '/out/.jostraca/generated/a.txt': 'L1\nL2\n',
        '/out/a.txt': 'L1\nU\n',
      })
      const res = await Jostraca({ now: () => NOW, log: quiet }).generate({
        fs: () => fs, folder: '/out', existing: { txt: { merge: true } },
      }, () => Project({}, () => File({ name: 'a.txt' }, () => Content('L1\nG\n'))))
      expect({ last, merged: res.files.merged, conflicted: res.files.conflicted })
        .equal({ last, merged: ['/out/a.txt'], conflicted: ['/out/a.txt'] })
      const text = fs.readFileSync('/out/a.txt', 'utf8')
      expect({ last, label: text.includes('>>>>>>> EXISTING: 1969-12-31T23:59:59.999Z/merge') })
        .equal({ last, label: true })
    }
  })


  // Every meta entry carries when/hwhen, skip entries included, whether or
  // not a baseline copy is made.
  test('skip-entry-when', async () => {
    const nodup = { duplicate: false }
    const rows: [string, any, any, () => void, string][] = [
      ['write-off', { '/out/a.txt': 'OLD' },
        { existing: { txt: { write: false } }, control: nodup },
        () => Project({}, () => File({ name: 'a.txt' }, () => Content('NEW'))), 'a.txt'],
      ['protected', { '/out/a.txt': 'JOSTRACA_PROTECT' }, { control: nodup },
        () => Project({}, () => File({ name: 'a.txt' }, () => Content('NEW'))), 'a.txt'],
      ['unchanged-merge', { '/out/a.txt': 'SAME' },
        { existing: { txt: { merge: true } }, control: nodup },
        () => Project({}, () => File({ name: 'a.txt' }, () => Content('SAME'))), 'a.txt'],
      ['unchanged-diff', { '/out/a.txt': 'SAME' },
        { existing: { txt: { diff: true } }, control: nodup },
        () => Project({}, () => File({ name: 'a.txt' }, () => Content('SAME'))), 'a.txt'],
      ['outside-folder', { '/elsewhere/a.txt': 'OLD' },
        { existing: { txt: { write: false } } },
        () => Project({ folder: '/elsewhere' }, () => File({ name: 'a.txt' }, () => Content('NEW'))),
        '/elsewhere/a.txt'],
    ]
    for (const [name, seed, opts, root, key] of rows) {
      const { fs } = memfs(seed)
      await Jostraca({ now: () => NOW, log: quiet })
        .generate({ fs: () => fs, folder: '/out', ...opts }, root)
      const e = metaOf(fs).files[key]
      expect({ name, action: e.action, when: e.when, hwhen: e.hwhen })
        .equal({ name, action: 'skip', when: NOW, hwhen: 2025010100000000 })
    }
  })


  // A path saved twice in one run appears once per files kind, at its first
  // position, and has one meta entry, at its first key position, carrying
  // the LAST save's values.
  test('duplicate-save-bookkeeping', async () => {
    const M = 'a\n#--START--#\nold\n#--END--#\nz\n'
    const entry = (path: string, exists: boolean) => ({
      action: 'write', path, exists, actions: ['write'], protect: false,
      conflict: false, when: NOW, hwhen: 2025010100000000,
    })
    const log = (...entries: any[]) => JSON.stringify({
      foldername: '.jostraca', filename: 'jostraca.meta.log',
      last: NOW, hlast: 2025010100000000,
      files: Object.fromEntries(entries.map((e) => [e.path, e])),
    }, null, 2)

    const rows: [string, any, () => void, string[], string][] = [
      ['file-then-inject', {}, () => Project({}, () => {
        File({ name: 't.txt' }, () => Content(M))
        Inject({ name: 't.txt' }, () => Content('NEW'))
      }), ['/out/t.txt'], log(entry('t.txt', true))],
      ['inject-twice', { '/out/t.txt': M }, () => Project({}, () => {
        Inject({ name: 't.txt' }, () => Content('ONE'))
        Inject({ name: 't.txt' }, () => Content('TWO'))
      }), ['/out/t.txt'], log(entry('t.txt', true))],
      ['copy-then-file', { '/src/single.txt': 'S\n' }, () => Project({}, () => {
        Copy({ from: '/src/single.txt' })
        File({ name: 'single.txt' }, () => Content('F\n'))
      }), ['/out/single.txt'], log(entry('single.txt', true))],
      ['file-then-copy', { '/src/single.txt': 'S\n' }, () => Project({}, () => {
        File({ name: 'single.txt' }, () => Content('F\n'))
        Copy({ from: '/src/single.txt' })
      }), ['/out/single.txt'], log(entry('single.txt', true))],
      ['file-g-h-inject-g', {}, () => Project({}, () => {
        File({ name: 'g.txt' }, () => Content(M))
        File({ name: 'h.txt' }, () => Content('H'))
        Inject({ name: 'g.txt' }, () => Content('NEW'))
      }), ['/out/g.txt', '/out/h.txt'], log(entry('g.txt', true), entry('h.txt', false))],
    ]
    for (const [name, seed, root, written, meta] of rows) {
      const { fs } = memfs(seed)
      const res = await Jostraca({ now: () => NOW, log: quiet })
        .generate({ fs: () => fs, folder: '/out' }, root)
      expect({ name, written: res.files.written }).equal({ name, written })
      expect({ name, meta: fs.readFileSync(META, 'utf8') }).equal({ name, meta })
    }
  })


  // The merge engine decides the outcome. A clean merge over a file whose
  // generated text contains the marker sentinel is written; a file still
  // holding an earlier merge's markers is left byte-for-byte untouched, a
  // requested mode still applied, and reported merged AND conflicted.
  test('merge-marker-files', async () => {
    const merge = { txt: { merge: true } }

    // (1) clean over the sentinel.
    {
      const { fs } = memfs({})
      const gen = async (v: string) => {
        const res: any = await Jostraca({ now: () => NOW, log: quiet }).generate({
          fs: () => fs, folder: '/out', existing: merge,
        }, () => Project({}, () => File({ name: 'doc.md' }, () => Content(
          'How a conflict looks:\n>>>>>>> EXISTING: 2020-01-01T00:00:00.000Z/merge\n' + v + '\n'))))
        return res
      }
      await gen('v1')
      for (const v of ['v2', 'v3']) {
        const res = await gen(v)
        expect(fs.readFileSync('/out/doc.md', 'utf8').endsWith(v + '\n')).equal(true)
        expect(res.files.merged).equal(['/out/doc.md'])
        expect(res.files.conflicted).equal([])
        expect(metaOf(fs).files['doc.md'].action).equal('merge')
        const rec = res.audit().find((e: any) => 'FileHandler:save:merge' === e[0])
        expect(rec[1].why.includes('merge-clean-0')).equal(true)
      }
    }

    // (2)-(4) over an unresolved file, on the OS filesystem.
    const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-unres-'))
    try {
      for (const [name, opts, mode, actions] of [
        ['plain', { existing: merge }, undefined, ['merge']],
        ['mode', { existing: merge }, 0o755, ['merge']],
        ['preserve', { existing: { txt: { merge: true, preserve: true } } }, undefined,
          ['preserve', 'merge']],
      ] as [string, any, number | undefined, string[]][]) {
        const out = Path.join(dir, name)
        const a = Path.join(out, 'a.txt')
        const gen = (body: string, extra: any = {}, m?: number) =>
          Jostraca({ now: () => NOW, log: quiet }).generate({ folder: out, ...extra },
            () => Project({}, () => File({ name: 'a.txt', ...(null == m ? {} : { mode: m }) },
              () => Content(body))))
        await gen('A\n')
        Fs.writeFileSync(a, 'A\nuser\n')
        await gen('A\ngen\n', { existing: merge })
        const before = Fs.readFileSync(a)
        const ino = Fs.statSync(a).ino
        const res = await gen('A\ngen2\n', opts, mode)
        expect({ name, same: Fs.readFileSync(a).equals(before), ino: Fs.statSync(a).ino })
          .equal({ name, same: true, ino })
        expect(res.files.merged).equal([a.replace(/\\/g, '/')])
        expect(res.files.conflicted).equal([a.replace(/\\/g, '/')])
        const e = JSON.parse(Fs.readFileSync(Path.join(out, '.jostraca', 'jostraca.meta.log'), 'utf8'))
          .files['a.txt']
        expect({ name, action: e.action, actions: e.actions, conflict: e.conflict })
          .equal({ name, action: 'merge', actions, conflict: true })
        if (null != mode && 'win32' !== process.platform) {
          expect(Fs.statSync(a).mode & 0o777).equal(mode)
        }
        expect(Fs.readFileSync(Path.join(out, '.jostraca', 'generated', 'a.txt'), 'utf8'))
          .equal('A\ngen2\n')
      }

      // (5) diff-mode markers followed by a merge run.
      const out = Path.join(dir, 'diffthen')
      const a = Path.join(out, 'a.txt')
      const gen = (body: string, existing?: any) =>
        Jostraca({ now: () => NOW, log: quiet }).generate({ folder: out, existing },
          () => Project({}, () => File({ name: 'a.txt' }, () => Content(body))))
      await gen('A\nB\n', { txt: { diff: true } })
      Fs.writeFileSync(a, 'A\nU\n')
      await gen('A\nG\n', { txt: { diff: true } })
      const before = Fs.readFileSync(a)
      const res = await gen('A\nG2\n', merge)
      expect(Fs.readFileSync(a).equals(before)).equal(true)
      expect(res.files.merged).equal([a.replace(/\\/g, '/')])
      expect(res.files.conflicted).equal([a.replace(/\\/g, '/')])

      // (6) an unresolved file holding a non-UTF-8 byte keeps it.
      const out6 = Path.join(dir, 'latin1')
      const a6 = Path.join(out6, 'a.txt')
      const gen6 = (body: string, existing?: any) =>
        Jostraca({ now: () => NOW, log: quiet }).generate({ folder: out6, existing },
          () => Project({}, () => File({ name: 'a.txt' }, () => Content(body))))
      await gen6('A\n')
      Fs.writeFileSync(a6, 'A\nuser\n')
      await gen6('A\ngen\n', merge)
      const marked = Buffer.concat([Fs.readFileSync(a6), Buffer.from([0xe9, 0x0a])])
      Fs.writeFileSync(a6, marked)
      await gen6('A\ngen2\n', merge)
      expect(Fs.readFileSync(a6).equals(marked)).equal(true)
    }
    finally {
      Fs.rmSync(dir, { recursive: true, force: true })
    }
  })


  // The existing file is handled as bytes: bytes a user saved in Latin-1
  // survive merge and diff exactly, and a file holding 0xFF where the
  // generator emits U+FFFD counts as changed.
  test('utf8-lossy', async () => {
    const run = async (steps: any[]) => {
      const { fs } = memfs({})
      let res: any
      for (const st of steps) {
        if (Buffer.isBuffer(st)) {
          fs.writeFileSync('/out/a.txt', st)
          continue
        }
        const [body, existing] = st
        res = await Jostraca({ now: () => NOW, log: quiet }).generate({
          fs: () => fs, folder: '/out', existing,
        }, () => Project({}, () => File({ name: 'a.txt' }, () => Content(body))))
      }
      return { res, bytes: fs.readFileSync('/out/a.txt') as Buffer }
    }
    const latin1 = Buffer.from([0x41, 0x0a, 0xe9, 0x74, 0xe9, 0x0a, 0x42, 0x0a])

    // (1) merge keeps the user's Latin-1 bytes.
    const m = await run([['A\nB\n'], latin1, ['A\nB\nC\n', { txt: { merge: true } }]])
    expect(m.bytes.toString('hex'))
      .equal(Buffer.from([0x41, 0x0a, 0xe9, 0x74, 0xe9, 0x0a, 0x42, 0x0a, 0x43, 0x0a])
        .toString('hex'))

    // (2) diff keeps them in the EXISTING block.
    const d = await run([['A\nB\n'], latin1, ['A\nB\nC\n', { txt: { diff: true } }]])
    expect(d.bytes.includes(Buffer.from([0xe9, 0x74, 0xe9]))).equal(true)
    expect(d.res.files.conflicted).equal(['/out/a.txt'])

    // (3) 0xFF against a generated U+FFFD is a change, merged.
    const ff = Buffer.from([0x41, 0x0a, 0xff, 0x0a])
    const fm = await run([['A\n�\n'], ff, ['A\n�\n', { txt: { merge: true } }]])
    expect(fm.res.files.merged).equal(['/out/a.txt'])
    expect(fm.res.files.unchanged).equal([])
    expect(fm.bytes.toString('hex')).equal(ff.toString('hex'))

    // (4) and written, in write mode, as U+FFFD.
    const fw = await run([['A\n�\n'], ff, ['A\n�\n']])
    expect(fw.res.files.written).equal(['/out/a.txt'])
    expect(fw.bytes.toString('hex')).equal(Buffer.from('A\n�\n').toString('hex'))
  })

})
