
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

    expect(JSON.parse(voljson['/top/.jostraca/jostraca.json.log']).exclude).equal([])
    expect(voljson).equal({
      '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
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

    expect(JSON.parse(voljson['/top/.jostraca/jostraca.json.log']).exclude).equal([])
    expect(voljson).equal({
      '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],

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
      '/tmp/bar.txt': 'BAR\n',
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
            Fragment({ from: '/tmp/bar.txt', indent: '  ' })
            Content('// END\n')
          })
        })
      })
    )

    const voljson: any = vol.toJSON()

    expect(voljson).equal({
      '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],

      '/tmp/foo.txt': 'FOO\n',
      '/tmp/bar.txt': 'BAR\n',

      '/top/sdk/foo.js': '// custom-foo\nFOO\n  BAR\n// END\n',
    })
  })


  test('each', () => {
    expect(each()).equal([])
    expect(each((null as any))).equal([])
    expect(each(1)).equal([])

    expect(each([11])).equal([{ val$: 11, index$: 0 }])
    expect(each([11], { oval: false })).equal([11])

    expect(each([11, 22])).equal([{ val$: 11, index$: 0 }, { val$: 22, index$: 1 }])
    expect(each([11, 22], { oval: false })).equal([11, 22])


    expect(each(['b', 'a'], { oval: false, sort: true })).equal(['a', 'b'])
    expect(each(['b', 'a'], { sort: true }))
      .equal([{ val$: 'a', index$: 0 }, { val$: 'b', index$: 1 }])

    expect(each([1], { oval: false }, (x: any) => 2 * x)).equal([2])
    expect(each([1], (x: any) => 2 * x.val$)).equal([2])

    expect(each({})).equal([])
    expect(each({ a: 1 })).equal([{ 'key$': 'a', 'val$': 1 }])

    expect(each({ b: 22, c: 11, a: 33 }, { sort: true })).equal([
      { 'key$': 'a', 'val$': 33 },
      { 'key$': 'b', 'val$': 22 },
      { 'key$': 'c', 'val$': 11 },
    ])

    expect(each({ b: 22, c: 11, a: 33 }, (v: any, n: string, i: number) =>
      n + '-' + i + '-' + JSON.stringify(v)))
      .equal([
        'b-0-{"key$":"b","val$":22}',
        'c-1-{"key$":"c","val$":11}',
        'a-2-{"key$":"a","val$":33}',
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

