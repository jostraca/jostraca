
import { test, describe } from 'node:test'
import { expect } from '@hapi/code'

import { memfs } from 'memfs'


import {
  Jostraca,
  Project,
  Folder,
  File,
  Content,
  Copy,

  cmp,
  each,
  getx,
} from '../'



describe('jostraca', () => {

  test('happy', async () => {
    expect(Jostraca).exist()

    const jostraca = Jostraca()
    expect(jostraca).exist()

    const { fs, vol } = memfs({})

    const info = await jostraca.generate(
      { fs, folder: '/top' },
      () => Project({ folder: 'sdk' }, () => {

        Folder({ name: 'js' }, () => {

          File({ name: 'foo.js' }, () => {
            Content('// custom-foo\n')
          })

          File({ name: 'bar.js' }, () => {
            Content('// custom-bar\n')
          })
        })

        Folder({ name: 'go' }, () => {

          File({ name: 'zed.go' }, () => {
            Content('// custom-zed\n')
          })
        })

      })
    )

    // console.log('INFO', info)
    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson['/top/.jostraca/info.json']).exclude).equal([])
    expect(voljson).equal({
      '/top/.jostraca/info.json': voljson['/top/.jostraca/info.json'],
      '/top/sdk/js/foo.js': '// custom-foo\n',
      '/top/sdk/js/bar.js': '// custom-bar\n',
      '/top/sdk/go/zed.go': '// custom-zed\n'
    })
  })


  test('copy', async () => {
    const { fs, vol } = memfs({
      '/tm/bar.txt': '// BAR $$x.z$$ TXT\n',
      '/tm/bar.txt~': '// BAR TXT\n',
      '/tm/sub/a.txt': '// SUB-A $$x.y$$ TXT\n',
      '/tm/sub/b.txt': '// SUB-B $$x.y$$ TXT\n',
      '/tm/sub/c/d.txt': '// SUB-C-D $$x.y$$ $$x.z$$ TXT\n',
    })

    const jostraca = Jostraca()

    const info = await jostraca.generate(
      { fs, folder: '/top' },
      cmp((props: any) => {
        props.ctx$.model = {
          x: { y: 'Y', z: 'Z' }
        }
        Project({ folder: 'sdk' }, () => {

          Folder({ name: 'js' }, () => {

            File({ name: 'foo.js' }, () => {
              Content('// custom-foo\n')
            })

            Copy({ from: '/tm/bar.txt', name: 'bar.txt' })
            Copy({ from: '/tm/sub' })
          })
        })
      })
    )

    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson['/top/.jostraca/info.json']).exclude).equal([])
    expect(voljson).equal({
      '/top/.jostraca/info.json': voljson['/top/.jostraca/info.json'],

      '/tm/bar.txt': '// BAR $$x.z$$ TXT\n',
      '/tm/bar.txt~': '// BAR TXT\n',
      '/tm/sub/a.txt': '// SUB-A $$x.y$$ TXT\n',
      '/tm/sub/b.txt': '// SUB-B $$x.y$$ TXT\n',
      '/tm/sub/c/d.txt': '// SUB-C-D $$x.y$$ $$x.z$$ TXT\n',

      '/top/sdk/js/foo.js': '// custom-foo\n',
      '/top/sdk/js/bar.txt': '// BAR Z TXT\n',
      '/top/sdk/js/a.txt': '// SUB-A Y TXT\n',
      '/top/sdk/js/b.txt': '// SUB-B Y TXT\n',
      '/top/sdk/js/c/d.txt': '// SUB-C-D Y Z TXT\n',
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


  test('getx', () => {
    expect(getx({ x: { y: 1 } }, 'x.y')).equal(1)
    expect(getx({ x: { y: { z: 1 } } }, 'x.y.z')).equal(1)
    expect(getx({ x: { y: { z: 1 } } }, 'x.y')).equal({ z: 1 })
    expect(getx({ x: { y: { z: 1 } } }, 'x.z')).equal(undefined)

    expect(getx({ x: { y: 1 } }, 'x y=1')).equal(1)
    expect(getx({ x: { y: 1 } }, 'x y!=1')).equal(undefined)

    expect(getx({ x: 3 }, '')).equal({ x: 3 })

    expect(getx({ x: { y: 3 } }, 'x=1')).equal({ y: 3 })
    expect(getx({ x: { y: 3 } }, 'x=2')).equal(undefined)
    expect(getx({ x: { y: 3, z: 4 } }, 'x=2')).equal({ y: 3, z: 4 })
    expect(getx({ x: { y: 3, z: 4 } }, 'x=1')).equal(undefined)

    expect(getx({ x: 3 }, '=1')).equal({ x: 3 })
    expect(getx({ x: 3, y: 4 }, '=1')).equal(undefined)
    expect(getx({ x: 3, y: 4 }, '=2')).equal({ x: 3, y: 4 })

    expect(getx({ x: 1 }, 'x=1')).equal(1)
    expect(getx({ x: 1 }, 'x!=1')).equal(undefined)

    expect(getx({ x: [{ y: 1 }, { y: 2 }, { y: 2 }] }, 'x?y=2'))
      .equal([{ y: 2 }, { y: 2 }])
    expect(getx({ x: [{ y: 1 }, { y: 2 }, { y: 2 }] }, 'x?y!=2'))
      .equal([{ y: 1 }])

    expect(getx({ x: { m: { y: 1 }, n: { y: 2 }, k: { y: 2 } } }, 'x?y=2'))
      .equal({ n: { y: 2 }, k: { y: 2 } })

    expect(getx({ x: [{ y: 11 }, { y: 22, z: 33 }] }, 'x?=1'))
      .equal([{ y: 11 }])

    expect(getx({ x: { m: { y: 1 }, n: { y: 2, z: 3 } } }, 'x?=1'))
      .equal({ m: { y: 1 } })

    /*
    expect(getx({ m: { y: 1 }, n: { y: 2 }, k: { y: 2 } }, 'y=2'))
      .equal({ n: { y: 2 }, k: { y: 2 } })

    expect(getx([{ y: 1 }, { y: 2 }, { y: 2 }], 'y=2'))
      .equal([{ y: 2 }, { y: 2 }])

    expect(getx([{ y: 1 }, { y: 2 }, { y: 2 }], '0'))
      .equal({ y: 1 })

    expect(getx([{ y: 1 }, { y: 2 }, { y: 2 }], 'y=2 0'))
      .equal({ y: 2 })
      */
  })
})

