
import { test, describe } from 'node:test'
import { expect } from './expect'

import {
  Jostraca,
  Project,
  Folder,
  File,
  Content,
} from '../'


const START_TIME = 1735689600000

describe('control', () => {

  test('dryrun', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const root = () => Project({}, (props: any) => {
      const m = props.ctx$.model

      Folder({ name: 'x' }, () => {

        File({ name: 'a' }, () => {
          Content('A' + m.a)
        })

        File({ name: 'b' }, () => {
          Content('B')
        })

        File({ name: 'c' }, () => {
          Content('C' + m.c)
        })

        File({ name: 'd' }, () => {
          Content('D' + m.d)
        })

        if (1 === m.a) {
          File({ name: 'e' }, () => {
            Content('E')
          })
        }
      })
    })

    const m0 = { a: 0, c: 10, d: 20 }
    const j0 = Jostraca({
      model: m0,
      now,
      mem: true,
      folder: '/',
      existing: { txt: { merge: true } }
    })

    const res0: any = await j0.generate({}, root)
    //console.log(res0)
    // console.log(res0.vol().toJSON())
    expect(res0).includes({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/x/a', '/x/b', '/x/c', '/x/d'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      },
    })

    res0.fs().writeFileSync('/x/c', 'C0' + '!')
    res0.fs().writeFileSync('/x/d', 'D30')
    m0.a = 1
    m0.d = 21
    const res1: any = await j0.generate({ control: { dryrun: true } }, root)
    // console.log(res1)
    // console.log(res1.vol().toJSON())
    expect(res1).includes({
      when: 1735690500000,
      files: {
        preserved: [],
        written: ['/x/e'],
        presented: [],
        diffed: [],
        merged: ['/x/a', '/x/c', '/x/d'],
        conflicted: ['/x/d'],
        unchanged: ['/x/b']
      },
    })

    expect({ ...res0.vol().toJSON() }).equal(res1.vol().toJSON())
  })


  // A GLOBAL `control` setting used to be discarded. OptionsShape declared
  // dryrun/duplicate/version as literal defaults, so shape injected them into
  // every per-call options object -- including an empty one -- and the merge
  // `deep({}, gOpts.control, opts.control)` then let the injected default beat
  // the global. A global `dryrun: true` therefore wrote the user's files, byte
  // for byte identical to no dry run at all. See docs/design/PARITY_PLAN.md 1.1.
  describe('global-control-precedence', () => {

    const root = () => Project({}, () => {
      File({ name: 'a.txt' }, () => Content('SECRET'))
    })

    const gen = async (gopts: any, opts: any) => {
      const j = Jostraca({ mem: true, now: () => START_TIME, ...gopts })
      const res: any = await j.generate({ folder: '/out', ...opts }, root)
      return Object.keys(res.vol().toJSON()).sort()
    }

    const ALL = [
      '/out/.jostraca/.gitignore',
      '/out/.jostraca/generated/a.txt',
      '/out/.jostraca/jostraca.meta.log',
      '/out/a.txt',
    ]

    test('global-dryrun-writes-nothing', async () => {
      expect(await gen({ control: { dryrun: true } }, {})).equal([])
    })

    test('per-call-dryrun-writes-nothing', async () => {
      expect(await gen({}, { control: { dryrun: true } })).equal([])
    })

    test('per-call-overrides-global', async () => {
      // Precedence is defaults < global < per-call, so an explicit per-call
      // `false` still wins over a global `true`.
      expect(await gen({ control: { dryrun: true } }, { control: { dryrun: false } }))
        .equal(ALL)
    })

    test('no-control-writes-everything', async () => {
      expect(await gen({}, {})).equal(ALL)
    })

    test('global-duplicate-false-skips-baseline', async () => {
      expect(await gen({ control: { duplicate: false } }, {}))
        .equal(ALL.filter((p) => !p.includes('/generated/')))
    })

    test('global-version-true-skips-gitignore', async () => {
      expect(await gen({ control: { version: true } }, {}))
        .equal(ALL.filter((p) => !p.endsWith('.gitignore')))
    })

    // Control merges PER KEY: a per-call control that sets one key leaves
    // every other global key in force.
    test('global-dryrun-survives-per-call-version', async () => {
      expect(await gen({ control: { dryrun: true } }, { control: { version: true } }))
        .equal([])
    })

    test('global-dryrun-survives-per-call-duplicate-false', async () => {
      expect(await gen({ control: { dryrun: true } }, { control: { duplicate: false } }))
        .equal([])
    })

    test('global-version-survives-per-call-duplicate-false', async () => {
      expect(await gen({ control: { version: true } }, { control: { duplicate: false } }))
        .equal(['/out/.jostraca/jostraca.meta.log', '/out/a.txt'])
    })

    test('global-duplicate-false-survives-per-call-version', async () => {
      expect(await gen({ control: { duplicate: false } }, { control: { version: true } }))
        .equal(['/out/.jostraca/jostraca.meta.log', '/out/a.txt'])
    })

  })


  // `existing.txt` and `existing.bin` deep-merge PER KEY over the global
  // values: every key a call omits inherits the global one. Each case is a
  // generate, a user edit, and a regenerate under a global and a per-call
  // `existing`.
  describe('global-existing-precedence', () => {

    const run = async (gexisting: any, cexisting: any,
      first: string, user: string, second: string) => {
      const j = Jostraca({
        mem: true, folder: '/out', now: () => START_TIME, existing: gexisting
      })
      const gen = (body: string) => () =>
        Project({}, () => File({ name: 'a.txt' }, () => Content(body)))

      const res0: any = await j.generate({}, gen(first))
      res0.fs().writeFileSync('/out/a.txt', user)

      const res: any = await j.generate({ existing: cexisting }, gen(second))
      const fs = res.fs()
      const meta = JSON.parse(fs.readFileSync('/out/.jostraca/jostraca.meta.log', 'utf8'))
      return {
        files: res.files,
        text: fs.readFileSync('/out/a.txt', 'utf8'),
        vol: Object.keys(res.vol().toJSON()).filter((p) => !p.includes('.jostraca')).sort(),
        actions: meta.files['a.txt'].actions,
      }
    }

    test('global-merge-with-per-call-preserve-merges', async () => {
      const r = await run({ txt: { merge: true } }, { txt: { preserve: true } },
        'L1\nL2\nL3\n', 'L1\nUSER\nL3\n', 'L1\nGEN\nL3\n')
      expect(r.text).equal('L1\n' +
        '<<<<<<< GENERATED: 2025-01-01T00:00:00.000Z/merge\n' +
        'GEN\n=======\nUSER\n' +
        '>>>>>>> EXISTING: 2025-01-01T00:00:00.000Z/merge\n' +
        'L3\n')
      expect(r.files.merged).equal(['/out/a.txt'])
      expect(r.files.conflicted).equal(['/out/a.txt'])
      expect(r.files.written).equal([])
      expect(r.files.preserved.length).equal(1)
      expect(r.actions).equal(['preserve', 'merge'])
      expect(r.vol).equal(['/out/a.old.txt', '/out/a.txt'])
    })

    test('global-merge-with-per-call-write-still-merges', async () => {
      const r = await run({ txt: { merge: true } }, { txt: { write: true } },
        'L1\nL2\nL3\n', 'L1\nUSER\nL3\n', 'L1\nL2\nL3\nL4\n')
      expect(r.text).equal('L1\nUSER\nL3\nL4\n')
      expect(r.files.merged).equal(['/out/a.txt'])
      expect(r.files.conflicted).equal([])
      expect(r.files.written).equal([])
      expect(r.actions).equal(['merge'])
    })

    test('global-txt-write-false-with-per-call-bin-skips', async () => {
      const r = await run({ txt: { write: false } }, { bin: { preserve: true } },
        'A1\n', 'USER\n', 'A2\n')
      expect(r.text).equal('USER\n')
      expect(r.files.written).equal([])
      expect(r.files.preserved).equal([])
      expect(r.actions).equal(['skip'])
      expect(r.vol).equal(['/out/a.txt'])
    })

    test('global-txt-preserve-with-per-call-bin-preserves', async () => {
      const r = await run({ txt: { preserve: true } }, { bin: { write: true } },
        'A1\n', 'USER\n', 'A2\n')
      expect(r.text).equal('A2\n')
      expect(r.files.written).equal(['/out/a.txt'])
      expect(r.files.preserved.length).equal(1)
      expect(r.actions).equal(['preserve', 'write'])
      expect(r.vol).equal(['/out/a.old.txt', '/out/a.txt'])
    })

  })

})
