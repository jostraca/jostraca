
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


  test('fragment', async () => {
    const { fs, vol } = memfs({
      '/tmp/foo.txt': 'FOO\n',
    })

    const jostraca = Jostraca()

    const info = await jostraca.generate(
      { fs, folder: '/top' },
      cmp((props: any) => {
        props.ctx$.model = {}

        Project({ folder: 'sdk' }, () => {

          File({ name: 'foo.js' }, () => {
            Content('// custom-foo\n')
            Fragment({ from: '/tmp/foo.txt' })
            Content('// END\n')
          })
        })
      })
    )

    const voljson: any = vol.toJSON()

    expect(voljson).equal({
      '/top/.jostraca/info.json': voljson['/top/.jostraca/info.json'],

      '/tmp/foo.txt': 'FOO\n',

      '/top/sdk/foo.js': '// custom-foo\nFOO\n// END\n',
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
    expect(getx(undefined, undefined as unknown as string)).equal(undefined)
    expect(getx(undefined, 'x')).equal(undefined)
    expect(getx({}, undefined as unknown as string)).equal(undefined)
    expect(getx(null, null as unknown as string)).equal(undefined)
    expect(getx(null, 'x')).equal(undefined)
    expect(getx({}, null as unknown as string)).equal(undefined)
    expect(getx({}, '')).equal(undefined)
    expect(getx({}, 'x')).equal(undefined)

    expect(getx({ a: 1 }, 'a')).equal(1)
    expect(getx({ a: 1 }, 'x')).equal(undefined)

    expect(getx({ a: { b: 1 } }, 'a b')).equal(1)
    expect(getx({ a: { b: 1 } }, 'a x')).equal(undefined)
    expect(getx({ a: { b: 1 } }, 'x b')).equal(undefined)
    expect(getx({ a: { b: 1 } }, 'a.b')).equal(1)
    expect(getx({ a: { b: 1 } }, 'a.x')).equal(undefined)
    expect(getx({ a: { b: 1 } }, 'x.b')).equal(undefined)

    expect(getx({ a: { b: { c: 1 } } }, 'a b c')).equal(1)
    expect(getx({ a: { b: { c: { d: 1 } } } }, 'a b c d')).equal(1)

    expect(getx({ a: { b: { c: 1 } } }, 'a.b.c')).equal(1)
    expect(getx({ a: { b: { c: { d: 1 } } } }, 'a.b.c.d')).equal(1)

    expect(getx({ a: { b: 1 } }, 'a:b')).equal({ a: { b: 1 } })
    expect(getx({ a: { x: 1 } }, 'a:b')).equal(undefined)

    expect(getx({ a: { b: { c: 1 } } }, 'a:b:c')).equal({ a: { b: { c: 1 } } })
    expect(getx({ a: { b: { x: 1 } } }, 'a:b:c')).equal(undefined)
    expect(getx({ a: { x: { c: 1 } } }, 'a:b:c')).equal(undefined)
    expect(getx({ x: { b: { c: 1 } } }, 'a:b:c')).equal(undefined)

    expect(getx({ a: { b: { c: { d: 1 } } } }, 'a:b:c:d')).equal({ a: { b: { c: { d: 1 } } } })

    expect(getx({ a: 1 }, 'a=1')).equal({ a: 1 })

    expect(getx({ a: { b: 1 } }, 'a:b=1')).equal({ a: { b: 1 } })
    expect(getx({ a: { b: { c: 1 } } }, 'a:b:c=1')).equal({ a: { b: { c: 1 } } })
    expect(getx({ a: { b: { c: 1 } } }, 'a b c=1')).equal({ c: 1 })
    expect(getx({ a: { b: { c: 1 } } }, 'a b:c=1')).equal({ b: { c: 1 } })
    expect(getx({ a: { b: { c: { d: 1 } } } }, 'a b:c:d=1')).equal({ b: { c: { d: 1 } } })

    expect(getx({ a: { b: { c: 1 } } }, 'a:b a')).equal({ b: { c: 1 } })
    expect(getx({ a: { b: { c: 1 } } }, 'a:b a b')).equal({ c: 1 })
    expect(getx({ a: { b: { c: 1 } } }, 'a:b a b c')).equal(1)

    expect(getx({ a: { b: { c: 1 } } }, 'a:b a b c=1')).equal({ c: 1 })

    expect(getx({ a: 1, b: 2 }, 'a=1 b')).equal(2)
    expect(getx({ a: { b: { c: 1 }, d: { c: 2 } } }, 'a?c=1')).equal({ b: { c: 1 } })
    expect(getx({ a: [{ c: 1 }, { c: 2 }] }, 'a?c=1')).equal([{ c: 1 }])
    expect(getx([{ c: 1 }, { c: 2 }], '?c=1')).equal([{ c: 1 }])

    expect(getx({ a: { b: { c: { e: 1 } }, d: { c: { e: 2 } } } }, 'a?c:e=1'))
      .equal({ b: { c: { e: 1 } } })

    // TODO: fix filter end detection
    // expect(getx({ a: { b: { c: { e: 1 } }, d: { c: { e: 2 } } } }, 'a?c.e=1'))
    //  .equal({ b: { c: { e: 1 } } })


    expect(getx({ x: [{ y: 1 }, { y: 2 }, { y: 2 }] }, 'x?y=2'))
      .equal([{ y: 2 }, { y: 2 }])

    expect(getx({ x: { y: 1 } }, 'x:y x')).equal({ y: 1 })
    expect(getx({ x: { y: 1 } }, 'x:y x y')).equal(1)

    expect(getx({ x: { y: 1 } }, 'x y=1 y')).equal(1)
    expect(getx({ x: { y: 1 } }, 'x y!=1')).equal(undefined)

    expect(getx({ x: 3 }, '')).equal(undefined)

    expect(getx({ x: 1 }, 'x=1 x')).equal(1)
    expect(getx({ x: 1 }, 'x!=1')).equal(undefined)

    expect(getx({ x: [{ y: 1 }, { y: 2 }, { y: 2 }] }, 'x?y=2'))
      .equal([{ y: 2 }, { y: 2 }])
    expect(getx({ x: [{ y: 1 }, { y: 2 }, { y: 2 }] }, 'x?y!=2'))
      .equal([{ y: 1 }])

    expect(getx({ x: { m: { y: 1 }, n: { y: 2 }, k: { y: 2 } } }, 'x?y=2'))
      .equal({ n: { y: 2 }, k: { y: 2 } })

    expect(getx({ m: { y: 1 }, n: { y: 2 }, k: { y: 2 } }, '?y=2'))
      .equal({ n: { y: 2 }, k: { y: 2 } })

    expect(getx([{ y: 1 }, { y: 2 }, { y: 2 }], '?y=2'))
      .equal([{ y: 2 }, { y: 2 }])


    expect(getx([11, 22, 33], '0')).equal(11)
    expect(getx([11, 22, 33], '1')).equal(22)
    expect(getx([11, 22, 33], '2')).equal(33)
    expect(getx({ a: [11, 22, 33] }, 'a 0')).equal(11)
    expect(getx([[11, 22, 33]], '0 1')).equal(22)
    expect(getx([[{ a: 11 }, { a: 22 }, { a: 33 }]], '0 1 a')).equal(22)
    expect(getx([[{ a: 11 }, { a: 22 }, { a: 33 }]], '0?a=11')).equal([{ a: 11 }])


    expect(getx([{ y: 1 }, { y: 2 }, { y: 2 }], '0'))
      .equal({ y: 1 })

    expect(getx([{ y: 1 }, { y: 2 }, { y: 2 }], '?y=2'))
      .equal([{ y: 2 }, { y: 2 }])

    expect(getx([{ y: 1 }, { y: 2 }, { y: 2 }], '?y=2 0'))
      .equal({ y: 2 })

  })
})

