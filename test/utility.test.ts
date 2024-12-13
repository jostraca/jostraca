
import { test, describe } from 'node:test'
import { expect } from '@hapi/code'


import {
  each,
  getx,
  template,
  indent,
  isbinext,
} from '../'



describe('util', () => {

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


  test('template', () => {

    expect(template('a$$b.c$$d', { b: { c: 'X' } })).equal('aXd')
    expect(template('a$$1$$d', [22, 222])).equal('a222d')
    expect(template('a$$b$$c$$b$$', { b: true })).equal('atruectrue')
    expect(template('$$b$$a$$b$$c', { b: false })).equal('falseafalsec')
    expect(template('$$a$$$$b$$$$c$$', { a: null, b: undefined, c: NaN }))
      .equal('$$a$$$$b$$$$c$$')
    expect(template('$$a$$', { a: { b: 1 } })).equal('{"b":1}')
    expect(template('$$a$$', { a: ['b', 'c'] })).equal('["b","c"]')
    expect(template('$$a$$', { a: () => 'A' })).equal('A')
    expect(template('$$__JOSTRACA_REPLACE__$$', {}))
      .equal('/(?<J_O>\\$\\$)(?<J_R>[^$]+)(?<J_C>\\$\\$)/')
    expect(template('$$a$$', { a: '$$b$$' })).equal('$$b$$') // NOPE - NOT A MACRO SYSTEM!
    expect(template('aQb', {}, { replace: { Q: 'Z' } })).equal('aZb')
    expect(template('aQQQb', {}, { replace: { '/Q+/': 'Z' } })).equal('aZb')
    expect(() => template('aQQQb', {}, { replace: { '/Q*/': 'Z' } })).throws(/empty/)
    expect(template('aQbWc$$__JOSTRACA_REPLACE__$$', {}, { replace: { Q: 'Z', W: 'Y' } }))
      .equal('aZbYc/(?<J_O>\\$\\$)(?<J_R>[^$]+)(?<J_C>' +
        '\\$\\$)|(?<J_K1_Q>Q)|(?<J_K2_W>W)/')
    expect(template('aQb', {}, { replace: { Q: () => 'X' } })).equal('aXb')


    const m: any = { q: 'Q', w: 'W' }
    expect(template('a[q]b[w]c<x>;y', {}, {
      replace: {
        'a': 'A',
        '/\\[(?<cap>\\w)\\]/': ({ cap }: any) => m[cap],
        '/c<(?<mx>.)>;(?<my>.)/': ({ mx, my }: any) =>
          mx.toUpperCase() + my.toUpperCase(),
        '/c<(?<nx>.)>;(?<ny>.)/': (_: any, match: any) =>
          match.groups.nx.toUpperCase() + match.groups.ny.toUpperCase(),
      }
    })).equal('AQbWXY')

    expect(template('ab', {}, {
      replace: { '/(?<x>a)|(?<x>b)/': ({ x }: any) => x.toUpperCase() }
    })).equal('AB')

    // Tags
    expect(template(
      '{\n//#Wax\n  //  #SeeSaw\n  // #Red-Bar\nAAA\n    //\t#GreenBlue-Zed \n}', {}, {
      replace: {
        '#Wax': (g: any) =>
          g.indent + '-Wax:' + g.TAG.toUpperCase() + '-' + JSON.stringify(g['$&']) + '\n',
        '#SeeSaw': (g: any) =>
          g.indent + '-SeeSaw:' + g.TAG.toUpperCase() + '-' + JSON.stringify(g['$&']) + '\n',
        '#Foo-Bar': (g: any) =>
          g.indent + g.Bar.toUpperCase() + '-' + g.TAG + '-' + JSON.stringify(g['$&']) + '\n',
        '#QazDin-Zed': (g: any) =>
          g.indent + g.name.toUpperCase() + '-' + g.TAG + '-' + JSON.stringify(g['$&']) + '\n',

      }
    })).equal(
      '{\n-Wax:WAX-"//#Wax\\n"\n  -SeeSaw:SEESAW-"  //  #SeeSaw\\n"\n' +
      '  RED-Bar-"  // #Red-Bar\\n"\n' +
      'AAA\n    GREENBLUE-Zed-"    //\\t#GreenBlue-Zed \\n"\n}')

  })


  test('indent', () => {
    expect(indent('a', 2)).equal('  a')
    expect(indent('\na', 2)).equal('\n  a')
    expect(indent('\n a', 2)).equal('\n   a')
    expect(indent('\n  a', 2)).equal('\n    a')
    expect(indent('\n   a', 2)).equal('\n     a')
    expect(indent('\n    a', 2)).equal('\n      a')
    expect(indent('\n\ta', 2)).equal('\n  \ta')

    expect(indent('{\n  a\n}', 2)).equal('  {\n    a\n  }')

    expect(indent('a', '    ')).equal('    a')
    expect(indent('\na', '    ')).equal('\n    a')
    expect(indent('\n a', '    ')).equal('\n     a')
    expect(indent('\n  a', '    ')).equal('\n      a')
    expect(indent('\n   a', '    ')).equal('\n       a')
    expect(indent('\n\ta', '    ')).equal('\n    \ta')

    expect(indent('a\nb', 2)).equal('  a\n  b')
    expect(indent('a\nb\nc', 2)).equal('  a\n  b\n  c')
    expect(indent('a\nb\nc\n', 2)).equal('  a\n  b\n  c\n')

    expect(indent('\na\nb', 2)).equal('\n  a\n  b')
    expect(indent('\na\nb\nc', 2)).equal('\n  a\n  b\n  c')
    expect(indent('\na\nb\nc\n', 2)).equal('\n  a\n  b\n  c\n')

    expect(indent('a\n b', 2)).equal('  a\n   b')
    expect(indent('a\n b\n c', 2)).equal('  a\n   b\n   c')
    expect(indent(' a\n b\nc\n', 2)).equal('   a\n   b\n  c\n')
    expect(indent(' a\n b\n c\n', 2)).equal('   a\n   b\n   c\n')
  })


  test('isbinext', () => {
    expect(isbinext('/foo/bar.png')).equal(true)

  })
})

