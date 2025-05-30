
import { test, describe } from 'node:test'
import { expect } from '@hapi/code'


import {
  each,
  getx,
  indent,
  isbinext,
  names,
  camelify,
  snakify,
  kebabify,
  partify,
  lcf,
  ucf,
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


    expect(getx({ a: { b: 1 } }, 'a "b"')).equal(1)
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


  test('name-formats', () => {
    expect(ucf('foo')).equal('Foo')
    expect(ucf('Foo')).equal('Foo')
    expect(ucf('f')).equal('F')
    expect(ucf('F')).equal('F')
    expect(ucf('')).equal('')
    expect(ucf(null as unknown as string)).equal('Null')

    expect(lcf('foo')).equal('foo')
    expect(lcf('Foo')).equal('foo')
    expect(lcf('f')).equal('f')
    expect(lcf('F')).equal('f')
    expect(lcf('')).equal('')
    expect(lcf(null as unknown as string)).equal('null')

    expect(partify(undefined as unknown as string)).equal(['undefined'])
    expect(partify(null as unknown as string)).equal(['null'])
    expect(partify('')).equal([])
    expect(partify('Foo')).equal(['Foo'])
    expect(partify('FooBar')).equal(['Foo', 'Bar'])
    expect(partify('foobar')).equal(['foobar'])
    expect(partify('foo-bar')).equal(['foo', 'bar'])
    expect(partify('foo_bar')).equal(['foo', 'bar'])
    expect(partify(['foo'])).equal(['foo'])
    expect(partify(['foo', 'bar'])).equal(['foo', 'bar'])
    expect(partify(true as unknown as string)).equal(['true'])
    expect(partify([true] as unknown as string[])).equal(['true'])

    expect(camelify(null as unknown as string)).equal('Null')
    expect(camelify(undefined as unknown as string)).equal('Undefined')
    expect(camelify('foo')).equal('Foo')
    expect(camelify('Foo')).equal('Foo')
    expect(camelify('FooBar')).equal('FooBar')
    expect(camelify('foo_bar')).equal('FooBar')
    expect(camelify('foo-bar')).equal('FooBar')
    expect(camelify('fooBar')).equal('FooBar')
    expect(camelify('')).equal('')
    expect(camelify(['foo'])).equal('Foo')
    expect(camelify(['foo', 'bar'])).equal('FooBar')
    expect(camelify('')).equal('')
    expect(camelify(true as unknown as string)).equal('True')
    expect(camelify([true] as unknown as string[])).equal('True')

    expect(snakify(null as unknown as string)).equal('null')
    expect(snakify(undefined as unknown as string)).equal('undefined')
    expect(snakify('foo')).equal('foo')
    expect(snakify('Foo')).equal('foo')
    expect(snakify('FooBar')).equal('foo_bar')
    expect(snakify('foo_bar')).equal('foo_bar')
    expect(snakify('foo-bar')).equal('foo_bar')
    expect(snakify('fooBar')).equal('foo_bar')
    expect(snakify('')).equal('')
    expect(snakify(['foo'])).equal('foo')
    expect(snakify(['foo', 'bar'])).equal('foo_bar')
    expect(snakify('')).equal('')
    expect(snakify(true as unknown as string)).equal('true')
    expect(snakify([true] as unknown as string[])).equal('true')

    expect(kebabify(null as unknown as string)).equal('null')
    expect(kebabify(undefined as unknown as string)).equal('undefined')
    expect(kebabify('foo')).equal('foo')
    expect(kebabify('Foo')).equal('foo')
    expect(kebabify('FooBar')).equal('foo-bar')
    expect(kebabify('foo_bar')).equal('foo-bar')
    expect(kebabify('foo-bar')).equal('foo-bar')
    expect(kebabify('fooBar')).equal('foo-bar')
    expect(kebabify('')).equal('')
    expect(kebabify(['foo'])).equal('foo')
    expect(kebabify(['foo', 'bar'])).equal('foo-bar')
    expect(kebabify('')).equal('')
    expect(kebabify(true as unknown as string)).equal('true')
    expect(kebabify([true] as unknown as string[])).equal('true')

    expect(names({}, 'Foo')).equal({
      name__orig: 'Foo',
      Name: 'Foo',
      name_: 'foo',
      'name-': 'foo',
      name: 'foo',
      NAME: 'FOO'
    })
    expect(names({}, 'FooBar')).equal({
      name__orig: 'FooBar',
      Name: 'FooBar',
      name_: 'foo_bar',
      'name-': 'foo-bar',
      name: 'foobar',
      NAME: 'FOOBAR'
    })


  })

})

