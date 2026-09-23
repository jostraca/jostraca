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

})
