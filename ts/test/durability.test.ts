// Durability tests: atomic write-then-rename, and that a failed write
// leaves the user's existing file intact. Mirrors go/durability_test.go.

import { test, describe } from 'node:test'
import { expect, POSIX_MODES } from './expect'

import Fs from 'node:fs'
import Os from 'node:os'
import Path from 'node:path'

import { memfs } from 'memfs'

import {
  Jostraca,
  Project,
  File,
  Content,
} from '../'


const START_TIME = 1735689600000

const TMP_SUFFIX = '.jostraca-tmp'


// Wrap an fs provider so writes to paths containing `failOn` throw.
function failWrites(base: any, failOn: string, message: string) {
  return new Proxy(base, {
    get(target: any, prop: string) {
      if ('writeFileSync' === prop) {
        return (path: string, ...rest: any[]) => {
          if (String(path).includes(failOn)) {
            throw new Error(message)
          }
          return target.writeFileSync(path, ...rest)
        }
      }
      const value = target[prop]
      return 'function' === typeof value ? value.bind(target) : value
    },
  })
}


describe('durability', () => {

  test('atomic-write-leaves-no-temp-files', async () => {
    const { fs, vol } = memfs({})
    fs.mkdirSync('/out/p', { recursive: true })
    fs.writeFileSync('/out/p/a.txt', 'OLD\n')

    const jostraca = Jostraca({ now: () => START_TIME, fs: () => fs })
    await jostraca.generate({ folder: '/out' }, () =>
      Project({ folder: 'p' }, () => {
        File({ name: 'a.txt' }, () => Content('NEW\n'))
        File({ name: 'b.txt' }, () => Content('B\n'))
      }))

    const stray = Object.keys(vol.toJSON()).filter(k => k.includes(TMP_SUFFIX))
    expect(stray).equal([])
    expect((vol.toJSON() as any)['/out/p/a.txt']).equal('NEW\n')
  })


  // The point of temp-then-rename: a failure mid-write must not truncate
  // or destroy what the user already had on disk.
  test('failed-write-leaves-existing-file-intact', async () => {
    const { fs, vol } = memfs({})
    fs.mkdirSync('/out/p', { recursive: true })
    fs.writeFileSync('/out/p/a.txt', 'USER-EDITED\n')

    const failing = failWrites(fs, '/out/p/a.txt', 'simulated ENOSPC')
    const jostraca = Jostraca({ now: () => START_TIME, fs: () => failing })

    await expect(async () =>
      await jostraca.generate({ folder: '/out' }, () =>
        Project({ folder: 'p' }, () =>
          File({ name: 'a.txt' }, () => Content('GENERATED\n')))))
      .rejects(/simulated ENOSPC/)

    expect((vol.toJSON() as any)['/out/p/a.txt']).equal('USER-EDITED\n')
  })


  // The merge baseline under .jostraca/generated is what makes
  // edit-preserving merges possible; a failure writing it must surface.
  test('baseline-write-error-surfaces', async () => {
    const { fs } = memfs({})
    const failing = failWrites(fs, '/.jostraca/generated/', 'simulated ENOSPC')
    const jostraca = Jostraca({ now: () => START_TIME, fs: () => failing })

    await expect(async () =>
      await jostraca.generate({ folder: '/out' }, () =>
        Project({ folder: 'p' }, () =>
          File({ name: 'a.txt' }, () => Content('GEN\n')))))
      .rejects(/simulated ENOSPC/)
  })


  // Dryrun must not touch the tree at all — including creating the
  // destination folder, which copyFile used to do unconditionally.
  test('dryrun-writes-nothing', async () => {
    const { fs, vol } = memfs({})
    const jostraca = Jostraca({ now: () => START_TIME, fs: () => fs })

    await jostraca.generate(
      { folder: '/out', control: { dryrun: true } },
      () => Project({ folder: 'p' }, () =>
        File({ name: 'a.txt' }, () => Content('NEW\n'))))

    expect(Object.keys(vol.toJSON())).equal([])
  })


  // A provider without renameSync must still work, via a direct write.
  test('provider-without-rename-falls-back', async () => {
    const { fs, vol } = memfs({})
    const noRename = new Proxy(fs, {
      get(target: any, prop: string) {
        if ('renameSync' === prop) {
          return undefined
        }
        const value = target[prop]
        return 'function' === typeof value ? value.bind(target) : value
      },
    })

    const jostraca = Jostraca({ now: () => START_TIME, fs: () => noRename })
    await jostraca.generate({ folder: '/out' }, () =>
      Project({ folder: 'p' }, () =>
        File({ name: 'a.txt' }, () => Content('NEW\n'))))

    expect((vol.toJSON() as any)['/out/p/a.txt']).equal('NEW\n')
  })


  // Rename swaps the inode, so without an explicit chmod an existing
  // executable would silently lose +x on regeneration.
  test('atomic-write-preserves-mode', async () => {
    const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-dur-'))
    try {
      const target = Path.join(dir, 'p', 'run.sh')
      Fs.mkdirSync(Path.dirname(target), { recursive: true })
      Fs.writeFileSync(target, '#!/bin/sh\necho old\n', { mode: 0o755 })
      Fs.chmodSync(target, 0o755)

      const jostraca = Jostraca({ now: () => START_TIME })
      await jostraca.generate({ folder: dir }, () =>
        Project({ folder: 'p' }, () =>
          File({ name: 'run.sh' }, () => Content('#!/bin/sh\necho new\n'))))

      // Skipped on Windows, which has no execute bit — see POSIX_MODES.
      if (POSIX_MODES) {
        expect(0 !== (Fs.statSync(target).mode & 0o111)).true()
      }
      expect(Fs.readFileSync(target, 'utf8')).equal('#!/bin/sh\necho new\n')

      const stray = Fs.readdirSync(Path.dirname(target))
        .filter(n => n.includes(TMP_SUFFIX))
      expect(stray).equal([])
    }
    finally {
      Fs.rmSync(dir, { recursive: true, force: true })
    }
  })

})


// This block lives here because it is the only suite that exercises the
// real filesystem rather than an injected memfs.
describe('fs-provider', () => {

  // The README quick start passes neither `fs` nor `mem`. That path used
  // to resolve to `undefined` — the global provider was set to a function
  // that returns the memfs handle (or undefined when memfs is off), and
  // being a function it short-circuited the `node:fs` fallback. Every
  // other test injects memfs explicitly, so nothing caught it.
  test('defaults-to-node-fs-when-no-provider-given', async () => {
    const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-fsp-'))
    try {
      const jostraca = Jostraca()
      await jostraca.generate({ folder: dir }, () =>
        Project({ folder: 'my-app' }, () =>
          File({ name: 'index.js' }, () => Content('console.log("hi")\n'))))

      expect(Fs.readFileSync(Path.join(dir, 'my-app', 'index.js'), 'utf8'))
        .equal('console.log("hi")\n')
    }
    finally {
      Fs.rmSync(dir, { recursive: true, force: true })
    }
  })


  // Global `mem: true` must still route to memfs, not the real fs.
  test('global-mem-option-still-uses-memfs', async () => {
    const jostraca = Jostraca({ mem: true })
    const res: any = await jostraca.generate({ folder: '/out' }, () =>
      Project({ folder: 'p' }, () =>
        File({ name: 'a.txt' }, () => Content('A\n'))))

    expect((res.vol().toJSON() as any)['/out/p/a.txt']).equal('A\n')
  })

})
