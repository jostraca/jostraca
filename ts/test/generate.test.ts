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

})
