/* Copyright (c) 2026 Richard Rodger, MIT License */

// THE CHECK GENERATION MODE (src/check.ts).
//
// `Jostraca().check(opts, root)` generates into memory, compares with
// the folder on disk, and answers with the difference as data. This is
// the engine's own suite; `cmptree-gen.test.ts` is the command-line
// front end's, and asserts exit codes and stderr rather than behaviour.
//
// MOSTLY IN MEMORY, which is the point. The folder a check runs against
// is read through `opts.fs`, so a test can hold one in-memory tree
// against another and never touch disk. The two cases that need a real
// filesystem say why they do.

import { test, describe } from 'node:test'
import * as Assert from 'node:assert'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'

import { memfs } from '../dist/util/memfs'

import {
  Jostraca,
  Project,
  Folder,
  File,
  Content,
  Fragment,
  cmpTree,
} from '../'


// Permission bits are a POSIX idea; the mode cases are skipped where
// the filesystem cannot express them.
const WINDOWS = 'win32' === process.platform


// Check a generator against a committed tree, both in memory.
const check = async (committed: any, root: Function, opts?: any) => {
  const { fs, vol } = memfs(committed)
  const res = await Jostraca().check(
    { folder: '/app', fs: () => fs, ...opts }, root)
  return { res, vol }
}


// The drift, flattened to something an assertion can read at a glance.
const shape = (res: any) => res.drift.map((d: any) => ({
  path: d.path,
  kind: d.kind,
  generated: d.generated?.toString('utf8'),
  existing: d.existing?.toString('utf8'),
}))


describe('check', () => {

  // A FOLDER THAT MATCHES IS CLEAN, and `checked` says what was
  // compared so a caller can report the count without counting drift.
  test('a-matching-folder-is-clean', async () => {
    const { res } = await check({
      '/app/a.txt': 'A\n',
      '/app/sub/b.txt': 'B\n',
    }, () => {
      File({ name: 'a.txt' }, () => Content('A\n'))
      Folder({ name: 'sub' }, () => {
        File({ name: 'b.txt' }, () => Content('B\n'))
      })
    })

    Assert.deepEqual(res.drift, [])
    Assert.deepEqual(res.checked, ['a.txt', 'sub/b.txt'])
    Assert.equal(res.folder, '/app')
  })


  // THE DIFFERENCE COMES BACK AS DATA, which is the half a command line
  // cannot give a caller: the bytes of both sides, per path, so a test
  // asserts on them and a CLI renders them.
  test('drift-is-data-with-both-sides', async () => {
    const { res } = await check({
      '/app/same.txt': 'S\n',
      '/app/edited.txt': 'EDITED\n',
    }, () => {
      File({ name: 'same.txt' }, () => Content('S\n'))
      File({ name: 'edited.txt' }, () => Content('GENERATED\n'))
      File({ name: 'absent.txt' }, () => Content('NEW\n'))
    })

    Assert.deepEqual(shape(res), [
      {
        path: 'absent.txt', kind: 'missing',
        generated: 'NEW\n', existing: undefined,
      },
      {
        path: 'edited.txt', kind: 'content',
        generated: 'GENERATED\n', existing: 'EDITED\n',
      },
    ])

    // Sorted by path, and the file that matched is not in it.
    Assert.deepEqual(res.checked, ['absent.txt', 'edited.txt', 'same.txt'])
  })


  // A FILE THE GENERATORS DO NOT CLAIM IS LEFT ALONE. One generator of
  // nine writes a handful of files into a whole application, so a check
  // that called every unclaimed file drift would report the other eight
  // generators' output as a failure. The cost is that a file which
  // stops being generated lingers unreported.
  test('an-unclaimed-file-is-left-alone', async () => {
    const { res } = await check({
      '/app/a.txt': 'A\n',
      '/app/hand-written.txt': 'not mine\n',
      '/app/sub/also-not-mine.txt': 'nor this\n',
    }, () => File({ name: 'a.txt' }, () => Content('A\n')))

    Assert.deepEqual(res.drift, [])
    Assert.deepEqual(res.checked, ['a.txt'])
  })


  // THE COMMITTED TREE CANNOT CHANGE WHAT THE GENERATORS PRODUCE, which
  // is what the shadow is for. `exclude` is the sharpest demonstration:
  // on a real generate it means "leave this file alone if it already
  // exists", so the file is never written and never compared. Under a
  // check the folder is not visible to the run, so the file is
  // generated and held to what is committed like any other.
  //
  // Without the shadow a generator could quietly exempt its own output
  // from the gate meant to hold it.
  test('the-committed-tree-cannot-influence-the-run', async () => {
    const gen = () => {
      File({ name: 'a.txt', exclude: true }, () => Content('GENERATED\n'))
    }

    const { res } = await check({ '/app/a.txt': 'STALE\n' }, gen)

    Assert.deepEqual(shape(res), [{
      path: 'a.txt', kind: 'content',
      generated: 'GENERATED\n', existing: 'STALE\n',
    }])

    // ... and the control: a plain generate DOES leave it alone, which
    // is the behaviour the shadow is stepping around.
    const { fs, vol } = memfs({ '/app/a.txt': 'STALE\n' })
    await Jostraca().generate({ folder: '/app', fs: () => fs }, gen)
    Assert.equal((vol.toJSON() as any)['/app/a.txt'], 'STALE\n')
  })


  // READS OUTSIDE THE FOLDER FALL THROUGH, so a check stays a faithful
  // dry run of a real generate: `Fragment` and `CopyFiles` read their
  // sources exactly as they would.
  test('a-source-outside-the-folder-is-read', async () => {
    const { res } = await check({
      '/src/frag.txt': 'HEADER\n<[SLOT]>\nFOOTER\n',
      '/app/f.txt': 'HEADER\nBODY\n\nFOOTER\n',
    }, () => {
      File({ name: 'f.txt' }, () => {
        Fragment({ from: '/src/frag.txt' }, () => Content('BODY\n'))
      })
    })

    Assert.deepEqual(res.drift, [])
    Assert.deepEqual(res.checked, ['f.txt'])
  })


  // AN EMPTY Folder OR Project IS NOT A FILE. Both make directories,
  // and reading one as a file throws EISDIR, which turned a clean check
  // into an I/O error.
  test('an-empty-folder-is-not-read-as-a-file', async () => {
    const { res } = await check({
      '/app/a.txt': 'A\n',
      '/app/empty': null,
    }, () => {
      Folder({ name: 'empty' }, () => undefined)
      File({ name: 'a.txt' }, () => Content('A\n'))
    })

    Assert.deepEqual(res.drift, [])
    Assert.deepEqual(res.checked, ['a.txt'])
  })


  // jostraca's OWN BOOKKEEPING is not output. The meta log carries
  // timestamps, so it can never be byte-stable and is no part of what a
  // generator claims to produce.
  test('the-meta-folder-is-not-compared', async () => {
    const { res } = await check({ '/app/a.txt': 'A\n' },
      () => File({ name: 'a.txt' }, () => Content('A\n')))

    Assert.deepEqual(res.checked, ['a.txt'])
    Assert.equal(
      res.checked.some((p: string) => p.startsWith('.jostraca')), false)
  })


  // A TREE GIVEN AS DATA reaches the same gate, which is the case aontu
  // needs and the reason the mode exists at all.
  test('a-component-tree-as-data-is-checked', async () => {
    const tree = [{
      cmp: 'File',
      props: { name: 'build.sh' },
      children: [{ cmp: 'Content', props: { src: 'echo $$VER$$\n' } }],
    }]

    // `raw`, so the `$$` is bytes rather than a model lookup.
    const { res } = await check({ '/app/build.sh': 'echo $$VER$$\n' },
      cmpTree(tree, { raw: true }))
    Assert.deepEqual(res.drift, [])

    // ... and the control uses the form that substitutes with NO MODEL
    // AT ALL. `$$VER$$` would not do: an unresolved model path is left
    // in place, so that tree checks clean either way and would prove
    // nothing. `$$"quoted"$$` renders its own literal whatever the
    // model holds, which is the half `model: {}` never guarded.
    const literal = [{
      cmp: 'File',
      props: { name: 'build.sh' },
      children: [{ cmp: 'Content', props: { src: 'echo $$"VER"$$\n' } }],
    }]
    const committed = { '/app/build.sh': 'echo $$"VER"$$\n' }

    const { res: raw } = await check(committed, cmpTree(literal, { raw: true }))
    Assert.deepEqual(raw.drift, [])

    const { res: templated } = await check(committed, cmpTree(literal))
    Assert.deepEqual(shape(templated), [{
      path: 'build.sh', kind: 'content',
      generated: 'echo VER\n', existing: 'echo $$"VER"$$\n',
    }])
  })


  // BINARY CONTENT IS COMPARED AS BYTES and carried as bytes, so a
  // caller can tell there is drift without being handed mojibake.
  test('binary-content-is-compared-as-bytes', async () => {
    const { fs } = memfs({})
    fs.mkdirSync('/app', { recursive: true })
    fs.writeFileSync('/app/x.bin', Buffer.from([0x00, 0x01, 0x02, 0x03]))

    const res = await Jostraca().check(
      { folder: '/app', fs: () => fs },
      () => File({ name: 'x.bin' }, () => Content('plain text\n')))

    Assert.equal(res.drift.length, 1)
    Assert.equal(res.drift[0].kind, 'content')

    // Both sides are BYTES, so a caller can tell there is drift without
    // being handed mojibake. A NUL does not survive a utf8 round trip,
    // which is why the comparison never decodes.
    Assert.ok(Buffer.isBuffer(res.drift[0].existing))
    Assert.ok(Buffer.isBuffer(res.drift[0].generated))
    Assert.deepEqual([...(res.drift[0].existing as Buffer)], [0, 1, 2, 3])
  })


  // A PROJECT FOLDER composes into the checked path like any other
  // nesting, so a generator that wraps its output in one is held to the
  // same tree.
  test('a-project-folder-composes-into-the-checked-path', async () => {
    const { res } = await check({ '/app/sdk/a.txt': 'A\n' },
      () => Project({ folder: 'sdk' }, () => {
        File({ name: 'a.txt' }, () => Content('A\n'))
      }))

    Assert.deepEqual(res.drift, [])
    Assert.deepEqual(res.checked, ['sdk/a.txt'])
  })


  // EVERY SPELLING OF THE FOLDER FINDS THE SAME DRIFT. `.` is the
  // default and the one a contributor types, and every other case here
  // passes an absolute `/app` -- so this is the shape the suite never
  // held. The Go twin checked NOTHING under `.` and answered clean on
  // a drifted tree; this port was already right, and this keeps it so.
  //
  // A REAL FILESYSTEM, because a relative folder means nothing without
  // a working directory to be relative to.
  test('every-folder-spelling-finds-the-same-drift', async () => {
    for (const spelling of ['ABS', 'out', '.', './out']) {
      const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-check-'))
      const out = Path.join(dir, 'out')
      const prev = process.cwd()
      try {
        Fs.mkdirSync(out, { recursive: true })
        Fs.writeFileSync(Path.join(out, 'a.txt'), 'STALE\n')

        const folder = 'ABS' === spelling ? out : spelling
        process.chdir('.' === spelling ? out : dir)

        const res = await Jostraca().check({ folder }, () =>
          File({ name: 'a.txt' }, () => Content('FRESH\n')))

        Assert.deepEqual(res.checked, ['a.txt'], spelling)
        Assert.equal(res.drift.length, 1, spelling)
        Assert.equal(res.drift[0].kind, 'content', spelling)
      }
      finally {
        process.chdir(prev)
        Fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  })


  // A MODE IS OUTPUT TOO, where the tree stated one. The bytes match
  // and the bits do not, which no byte comparison can see: a real
  // generate would chmod the file and the gate would have said clean.
  //
  // A REAL FILESYSTEM, because the mode is read back with `statSync`
  // and the point is the bits a checkout actually has.
  test('a-declared-mode-is-compared', { skip: WINDOWS }, async () => {
    const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-check-'))
    const out = Path.join(dir, 'app')
    try {
      const src = '#!/bin/sh\necho hi\n'
      Fs.mkdirSync(out, { recursive: true })
      Fs.writeFileSync(Path.join(out, 'run.sh'), src)
      Fs.chmodSync(Path.join(out, 'run.sh'), 0o644)

      const gen = (mode?: number) => () =>
        File({ name: 'run.sh', mode }, () => Content(src))

      const drifted = await Jostraca().check({ folder: out }, gen(0o755))
      Assert.equal(drifted.drift.length, 1)
      Assert.equal(drifted.drift[0].kind, 'mode')
      Assert.equal(drifted.drift[0].mode, 0o755)
      Assert.equal(drifted.drift[0].existingMode, 0o644)

      // Clean once the bits match.
      Fs.chmodSync(Path.join(out, 'run.sh'), 0o755)
      const clean = await Jostraca().check({ folder: out }, gen(0o755))
      Assert.deepEqual(clean.drift, [])

      // A TREE THAT SAYS NOTHING ABOUT MODE holds the file to nothing,
      // because a run would leave the bits it found. Without this the
      // default mode the memory volume gives every file would report
      // drift on every file with a mode of its own.
      Fs.chmodSync(Path.join(out, 'run.sh'), 0o600)
      const silent = await Jostraca().check({ folder: out }, gen(undefined))
      Assert.deepEqual(silent.drift, [])
    }
    finally {
      Fs.rmSync(dir, { recursive: true, force: true })
    }
  })


  // A GLOBAL DRYRUN DOES NOT BLANK A CHECK. The check forces dryrun off
  // for its own run and keeps every other global control key.
  test('a-global-dryrun-does-not-blank-a-check', async () => {
    const { fs } = memfs({ '/app/a.txt': 'STALE\n' })
    const res = await Jostraca({ control: { dryrun: true } }).check(
      { folder: '/app', fs: () => fs },
      () => {
        File({ name: 'a.txt' }, () => Content('A\n'))
        File({ name: 'b.txt' }, () => Content('B\n'))
      })

    Assert.deepEqual(res.checked, ['a.txt', 'b.txt'])
    Assert.deepEqual(shape(res).map((d: any) => d.path + ':' + d.kind),
      ['a.txt:content', 'b.txt:missing'])
  })


  // A CHECK ALWAYS BUILDS. `build: false`, per call or global, would
  // never reach the file handler and report every folder clean.
  test('build-false-cannot-blank-a-check', async () => {
    const root = () => File({ name: 'a.txt' }, () => Content('A\n'))
    const runs = [
      [{}, { build: false }],
      [{ build: false }, {}],
    ]
    for (const [gopts, opts] of runs) {
      for (const [committed, want] of [
        [{}, 'a.txt:missing'],
        [{ '/app/a.txt': 'STALE\n' }, 'a.txt:content'],
      ] as [any, string][]) {
        const { fs } = memfs(committed)
        const res = await Jostraca(gopts).check(
          { folder: '/app', fs: () => fs, ...opts }, root)
        const what = JSON.stringify([gopts, opts, committed])
        Assert.deepEqual(res.checked, ['a.txt'], what)
        Assert.deepEqual(shape(res).map((d: any) => d.path + ':' + d.kind),
          [want], what)
        Assert.deepEqual(res.files.written, ['/app/a.txt'], what)
      }
    }
  })


  // THE FOLDER AND FILESYSTEM RESOLVE AS GENERATE RESOLVES THEM: the
  // per-call value, else the one given to Jostraca(), else the default.
  //
  // A REAL FILESYSTEM for the folder case, because the global folder is
  // read through node:fs when no provider is given.
  test('a-global-folder-is-checked', async () => {
    const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-check-'))
    const out = Path.join(dir, 'out')
    try {
      Fs.mkdirSync(out, { recursive: true })
      Fs.writeFileSync(Path.join(out, 'a.txt'), 'A\n')

      const res = await Jostraca({ folder: out }).check({}, () =>
        File({ name: 'a.txt' }, () => Content('A\n')))

      Assert.equal(res.folder, out)
      Assert.deepEqual(res.checked, ['a.txt'])
      Assert.deepEqual(res.drift, [])
    }
    finally {
      Fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a-global-fs-holds-the-committed-tree', async () => {
    const { fs } = memfs({ '/out/a.txt': 'A\n' })
    const res = await Jostraca({ fs: () => fs }).check({ folder: '/out' }, () =>
      File({ name: 'a.txt' }, () => Content('A\n')))

    Assert.equal(res.folder, '/out')
    Assert.deepEqual(res.checked, ['a.txt'])
    Assert.deepEqual(res.drift, [])
  })


  // A CHECK WRITES NOTHING, ANYWHERE -- including the run that reports
  // drift, and including the meta folder a generate would leave. A
  // command that only asks a question must not be able to answer it by
  // changing something.
  //
  // A REAL FILESYSTEM, because "nothing was written" is a claim about
  // the disk the caller pointed at.
  test('a-check-writes-nothing', async () => {
    const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-check-'))
    const out = Path.join(dir, 'app')
    try {
      Fs.mkdirSync(out, { recursive: true })
      Fs.writeFileSync(Path.join(out, 'a.txt'), 'STALE\n')

      const listing = () => Fs.readdirSync(out).sort()
      const before = listing()

      const res = await Jostraca().check({ folder: out },
        () => {
          File({ name: 'a.txt' }, () => Content('GENERATED\n'))
          File({ name: 'b.txt' }, () => Content('ALSO NEW\n'))
        })

      Assert.equal(res.drift.length, 2)
      Assert.deepEqual(listing(), before,
        'a check left something behind: ' + listing().join(', '))
      Assert.equal(Fs.readFileSync(Path.join(out, 'a.txt'), 'utf8'), 'STALE\n')
    }
    finally {
      Fs.rmSync(dir, { recursive: true, force: true })
    }
  })

})
