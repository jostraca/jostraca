
import { test, describe } from 'node:test'
import { expect } from '@hapi/code'

import { memfs } from 'memfs'


import {
  Jostraca,
  Project,
  Folder,
  File,
  Fragment,
  Content,
  Copy,
  Inject,
  Line,
  Slot,

  cmp,
  each,
} from '../'


const START_TIME = 1735689600000

describe('merge', () => {

  test('basic', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const jostraca = Jostraca({ now })

    const root = () => Project({ folder: 'sdk' }, (props: any) => {
      const m = props.ctx$.model

      Folder({ name: 'js' }, () => {

        File({ name: 'foo.js' }, () => {
          Content('// custom-foo:' + m.a + '\n// FOO\n')
        })

        File({ name: 'bar.js' }, () => {
          let extra = ''
          if (1 === m.a) {
            extra = '// EXTRA1'
          }
          Content('// custom-bar\n// BAR\n' + extra)
        })
      })

      Folder({ name: 'go' }, () => {

        File({ name: 'zed.go' }, () => {
          let extra = ''
          if (1 === m.a) {
            extra = '// EXTRA1'
          }
          Content('// custom-zed:' + m.a + '\n' + extra)
        })
      })

    })

    const mfs = memfs({})
    const fs: any = mfs.fs
    const vol: any = mfs.vol

    const m0 = { a: 0 }
    const res0 = await jostraca.generate({ fs: () => fs, folder: '/top', model: m0 }, root)
    console.log('res0', res0, vol.toJSON())

    fs.appendFileSync('/top/sdk/js/foo.js', '// added1\n', { encoding: 'utf8' })
    fs.appendFileSync('/top/sdk/js/bar.js', '// added1\n', { encoding: 'utf8' })

    console.log('ADD1', vol.toJSON())

    const m1 = { a: 1 }
    const res1 = await jostraca.generate({
      fs: () => fs, folder: '/top', model: m1,
      existing: { txt: { merge: true } }
    }, root)
    console.log('res1', res1, vol.toJSON())

  })


})

