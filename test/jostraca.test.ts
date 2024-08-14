
import { test, describe } from 'node:test'
import { expect } from '@hapi/code'

import { memfs } from 'memfs'


import {
  Jostraca,
  Project,
  Folder,
  File,
  Code,
  Copy,

  each,
} from '../'



describe('jostraca', () => {

  test('happy', async () => {
    expect(Jostraca).exist()

    const jostraca = Jostraca()
    expect(jostraca).exist()

    const { fs, vol } = memfs({})

    jostraca.generate(
      { fs, folder: '/top' },
      () => Project({}, () => {

        Folder({ name: 'js' }, () => {

          File({ name: 'foo.js' }, () => {
            Code('// custom-foo\n')
          })

          File({ name: 'bar.js' }, () => {
            Code('// custom-bar\n')
          })
        })

        Folder({ name: 'go' }, () => {

          File({ name: 'zed.go' }, () => {
            Code('// custom-zed\n')
          })
        })

      })
    )

    // console.dir(vol.toJSON(), { depth: null })

    expect(vol.toJSON()).equal({
      '/top/js/foo.js': '// custom-foo\n',
      '/top/js/bar.js': '// custom-bar\n',
      '/top/go/zed.go': '// custom-zed\n'
    })
  })


  test('copy', async () => {
    const { fs, vol } = memfs({
      '/tm/bar.txt': '// BAR TXT\n'
    })

    const jostraca = Jostraca()

    jostraca.generate(
      { fs, folder: '/top' },
      () => Project({}, () => {

        Folder({ name: 'js' }, () => {

          File({ name: 'foo.js' }, () => {
            Code('// custom-foo\n')
          })

          Copy({ from: '/tm/bar.txt', name: 'bar.txt' })
        })
      })
    )

    // console.dir(vol.toJSON(), { depth: null })

    expect(vol.toJSON()).equal({
      '/tm/bar.txt': '// BAR TXT\n',
      '/top/js/foo.js': '// custom-foo\n',
      '/top/js/bar.txt': '// BAR TXT\n',
    })
  })


  test('each', () => {
    expect(each()).equal([])
    expect(each(null)).equal([])
    expect(each(1)).equal([])
    expect(each([1])).equal([1])
    expect(each(['b', 'a'])).equal(['a', 'b'])
    expect(each([1], (x: any) => 2 * x)).equal([2])

    expect(each({})).equal([])
    expect(each({ a: 1 })).equal([{ name: 'a', 'key$': 'a', 'val$': 1 }])
    expect(each({ b: 22, c: 11, a: 33 })).equal([
      { name: 'a', 'key$': 'a', 'val$': 33 },
      { name: 'b', 'key$': 'b', 'val$': 22 },
      { name: 'c', 'key$': 'c', 'val$': 11 },
    ])

    expect(each({ b: 22, c: 11, a: 33 }, (v: any, n: string, i: number) =>
      n + '-' + i + '-' + JSON.stringify(v)))
      .equal([
        'a-0-{"name":"a","key$":"a","val$":33}',
        'b-1-{"name":"b","key$":"b","val$":22}',
        'c-2-{"name":"c","key$":"c","val$":11}'
      ])

  })
})

