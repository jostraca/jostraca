
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

  })

})
