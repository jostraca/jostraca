/* Copyright (c) 2026 Richard Rodger, MIT License */

// generate() itself: when it refuses, what it reports, and to whom.
//
// Each case here has a Go twin, named in the comment above it, and each
// began as a measured difference between the two ports.

import { test, describe } from 'node:test'
import * as Assert from 'node:assert'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'

import { memfs } from '../dist/util/memfs'

import {
  Jostraca,
  Project,
  File,
  Content,
  Fragment,
  CopyFiles,
  Inject,
} from '../'


const START_TIME = 1735689600000


const tmpdir = () => Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-generate-'))


describe('generate', () => {

  // A Fragment or CopyFiles `from` that does not exist is refused in the
  // DEFINE phase, against the filesystem the run will use, whether that
  // filesystem was supplied or defaulted. Nothing is written: no earlier
  // sibling file, no folder, no .jostraca baseline.
  //
  // A REAL FILESYSTEM with no `fs` option, because the default is the
  // point. Go twins: TestFragmentMissingFromDefaultFSWritesNothing and
  // TestCopyMissingFromDefaultFSWritesNothing.
  describe('define-time-from', () => {

    const refused = async (body: () => void) => {
      const dir = tmpdir()
      const out = Path.join(dir, 'out')
      try {
        await Assert.rejects(Jostraca({ now: () => START_TIME })
          .generate({ folder: out }, () => Project({}, () => {
            File({ name: 'ok.txt' }, () => Content('OK'))
            body()
          })))
        Assert.equal(Fs.existsSync(out), false,
          'the output folder was created before the refusal')
      }
      finally {
        Fs.rmSync(dir, { recursive: true, force: true })
      }
    }

    test('fragment-missing-from-writes-nothing', async () => {
      await refused(() => File({ name: 'b.txt' }, () => Fragment({ from: 'nope.txt' })))
    })

    test('copy-missing-from-writes-nothing', async () => {
      await refused(() => CopyFiles({ from: '/nonexistent-jostraca-define-time/x.txt' }))
    })

  })


  // The provider is chosen per call: the per-call fs, else the in-memory
  // fs when mem is on for this call, else the global fs, else node:fs.
  // vol() and fs() are present exactly when mem is on. Go twins in
  // go/mem_test.go.
  describe('provider-resolution', () => {

    const root = () => Project({}, () => File({ name: 'a.txt' }, () => Content('A')))

    // An explicit per-call `mem: false` used to write into the instance's
    // hidden global volume, which neither the disk nor vol() could reach.
    test('per-call-mem-false-writes-to-disk', async () => {
      const dir = tmpdir()
      try {
        const res: any = await Jostraca({ mem: true, now: () => START_TIME })
          .generate({ folder: dir, mem: false }, root)
        Assert.equal(Fs.readFileSync(Path.join(dir, 'a.txt'), 'utf8'), 'A')
        Assert.equal(res.vol, undefined)
        Assert.equal(res.fs, undefined)
      }
      finally {
        Fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    test('global-mem-beats-global-fs', async () => {
      const own = memfs({})
      const res: any = await Jostraca({ mem: true, fs: () => own.fs, now: () => START_TIME })
        .generate({ folder: '/out' }, root)
      Assert.deepEqual(own.vol.toJSON(), {})
      Assert.equal(res.vol().toJSON()['/out/a.txt'], 'A')
      Assert.notEqual(res.fs(), own.fs)
    })

    test('per-call-fs-beats-global-mem', async () => {
      const own = memfs({})
      const res: any = await Jostraca({ mem: true, now: () => START_TIME })
        .generate({ folder: '/out', fs: () => own.fs }, root)
      Assert.equal(own.vol.toJSON()['/out/a.txt'], 'A')
      Assert.equal(res.fs(), own.fs)
      Assert.deepEqual(res.vol().toJSON(), {})
    })

    test('a-supplied-provider-gets-no-accessors', async () => {
      const own = memfs({})
      const res: any = await Jostraca({ fs: () => own.fs, now: () => START_TIME })
        .generate({ folder: '/out' }, root)
      Assert.equal(own.vol.toJSON()['/out/a.txt'], 'A')
      Assert.equal(res.vol, undefined)
      Assert.equal(res.fs, undefined)
    })

    // Every files category is always a list, including on a run that
    // builds nothing.
    test('files-lists-are-always-lists', async () => {
      const EMPTY = {
        preserved: [], written: [], presented: [], diffed: [],
        merged: [], conflicted: [], unchanged: [],
      }
      const j = Jostraca({ mem: true, folder: '/out', now: () => START_TIME })
      Assert.deepEqual((await j.generate({ build: false }, root)).files, EMPTY)
      Assert.deepEqual((await j.generate({}, () => { })).files, EMPTY)
      Assert.deepEqual((await j.generate({}, root)).files,
        { ...EMPTY, written: ['/out/a.txt'] })
    })

  })



  // After a successful generate, each non-fatal warning raised during THAT
  // call is replayed to that call's `log.debug`, one call per warning. A
  // refused run replays nothing, and a concurrent call's warnings never
  // reach this call's logger. Go twins in go/warning_replay_test.go.
  describe('warnings', () => {

    const capture = () => {
      const calls: any[][] = []
      const log: any = {}
      for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
        log[level] = (...args: any[]) => calls.push([level, ...args])
      }
      return { log, calls }
    }

    // [kind, text...] of each replayed warning: the dlog entry is
    // [tag, file, when, ...args, stack], and only the args are portable.
    const warned = (calls: any[][]) => calls.map(([level, payload]) => {
      Assert.equal(level, 'debug')
      Assert.equal(payload.point, 'jostraca-warning')
      Assert.equal(payload.dlogentry[0], 'jostraca')
      Assert.equal('string', typeof payload.note)
      return payload.dlogentry.slice(3, -1)
    })

    const gen = async (vol: any, root: () => void, log: any) =>
      Jostraca({ mem: true, vol, folder: '/out', now: () => START_TIME, log })
        .generate({}, root)

    test('inject-into-an-unmarked-file-warns-once', async () => {
      const { log, calls } = capture()
      await gen({ '/out/t.txt': 'no markers here\n' },
        () => Project({}, () => Inject({ name: 't.txt' }, () => Content('X'))), log)
      Assert.deepEqual(warned(calls), [[
        'inject',
        'markers not found, nothing injected: path=/out/t.txt ' +
        'markers=["#--START--#\\n","\\n#--END--#"]',
      ]])
    })

    test('an-unreadable-meta-log-warns-once', async () => {
      const { log, calls } = capture()
      await gen({ '/out/.jostraca/jostraca.meta.log': '{not json' },
        () => Project({}, () => File({ name: 'a.txt' }, () => Content('A'))), log)
      const w = warned(calls)
      Assert.equal(w.length, 1)
      Assert.equal(w[0][0], 'meta')
      // The parser's own message after the last err= is the runtime's.
      Assert.ok(w[0][1].startsWith('unreadable meta log, continuing with empty state: ' +
        '/out/.jostraca/jostraca.meta.log err=FileHandler:loadJSON: ' +
        'path=/out/.jostraca/jostraca.meta.log err='), w[0][1])
    })

    test('a-second-save-of-one-path-warns', async () => {
      const { log, calls } = capture()
      await gen({}, () => Project({}, () => {
        File({ name: 't.txt' }, () => Content('a\n#--START--#\nold\n#--END--#\nz\n'))
        Inject({ name: 't.txt' }, () => Content('NEW'))
      }), log)
      Assert.deepEqual(warned(calls), [
        ['save', 'duplicate save, later content wins: /out/t.txt'],
        ['filelog', 'written', 'duplicate: /out/t.txt'],
      ])
    })

    test('a-failed-chmod-of-an-unchanged-file-warns', async () => {
      const { fs } = memfs({})
      let fail = false
      const provider: any = {
        ...fs,
        chmodSync: (p: string, mode: number) => {
          if (fail) {
            throw new Error('EPERM')
          }
          return fs.chmodSync(p, mode)
        },
      }
      const j = Jostraca({ fs: () => provider, folder: '/out', now: () => START_TIME })
      const root = (mode: number) => () =>
        Project({}, () => File({ name: 'a.sh', mode }, () => Content('X')))

      await j.generate({}, root(0o755))
      fail = true
      const { log, calls } = capture()
      const res = await j.generate({ log }, root(0o700))
      Assert.deepEqual(res.files.unchanged, ['/out/a.sh'])
      Assert.deepEqual(warned(calls), [
        ['save', 'chmod of unchanged file failed: /out/a.sh'],
      ])
    })

    test('a-refused-run-replays-nothing', async () => {
      const { log, calls } = capture()
      await Assert.rejects(gen({ '/out/t.txt': 'no markers here\n' },
        () => Project({}, () => {
          Inject({ name: 't.txt' }, () => Content('X'))
          Inject({ name: 'missing.txt' }, () => Content('X'))
        }), log))
      Assert.deepEqual(calls, [])
    })

    test('a-concurrent-call-keeps-its-own-warnings', async () => {
      const one = capture()
      const two = capture()
      const j = Jostraca({
        mem: true, vol: { '/one/t.txt': 'no markers\n' }, now: () => START_TIME
      })
      await Promise.all([
        j.generate({ folder: '/one', log: one.log }, () => Project({}, () => {
          File({ name: 'x.txt' }, () => Content('x'))
          Inject({ name: 't.txt' }, () => Content('X'))
        })),
        j.generate({ folder: '/two', log: two.log }, () => Project({}, () => {
          for (let i = 0; i < 5; i++) {
            File({ name: 'f' + i + '.txt' }, () => Content('y'))
          }
        })),
      ])
      Assert.equal(warned(one.calls).length, 1)
      Assert.deepEqual(two.calls, [])
    })

  })



  // An empty folder is refused, global or per call, and nothing is
  // written. Go's typed Options cannot tell "" from unset and falls back
  // instead (TestEmptyFolderMeansUnset); its map form refuses it as here.
  describe('empty-folder', () => {

    const MSG = 'Jostraca Options: Validation failed for property "folder" ' +
      'with string "" because an empty string is not allowed.'

    test('a-global-empty-folder-throws', () => {
      Assert.throws(() => Jostraca({ folder: '' }), { message: MSG })
    })

    test('a-per-call-empty-folder-rejects-and-writes-nothing', async () => {
      const dir = tmpdir()
      const prev = process.cwd()
      try {
        process.chdir(dir)
        await Assert.rejects(Jostraca({ now: () => START_TIME }).generate({ folder: '' },
          () => Project({}, () => File({ name: 'a.txt' }, () => Content('A')))),
          { message: MSG })
        Assert.deepEqual(Fs.readdirSync(dir), [])
      }
      finally {
        process.chdir(prev)
        Fs.rmSync(dir, { recursive: true, force: true })
      }
    })

  })

})
