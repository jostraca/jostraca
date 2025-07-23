
import { test, describe } from 'node:test'
import { expect } from '@hapi/code'

import { memfs } from 'memfs'


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

})
