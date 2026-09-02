
import { test, describe } from 'node:test'
import * as Assert from 'node:assert'
import { expect } from './expect'

import * as Package from '../'
import { memfs } from '../dist/util/memfs'


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
  deep,
  omap,
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

    // each now sorts map entries by key alphabetically for cross-stack
    // determinism (matches the Go port; previously TS preserved
    // insertion order).
    expect(each({ b: 22, c: 11, a: 33 }, (v: any, n: string, i: number) =>
      n + '-' + i + '-' + JSON.stringify(v)))
      .equal([
        'a-0-{"key$":"a","val$":33}',
        'b-1-{"key$":"b","val$":22}',
        'c-2-{"key$":"c","val$":11}',
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


    // Regression: the comparison operators `<`, `>`, `~` do not contain `=`
    // and were previously unreachable (the guard only matched operators
    // containing `=`), so they silently returned undefined and diverged from
    // the Go port. See getx() in src/util/basic.ts.
    expect(getx({ a: 5 }, 'a>3')).equal({ a: 5 })
    expect(getx({ a: 5 }, 'a>9')).equal(undefined)
    expect(getx({ a: 5 }, 'a<9')).equal({ a: 5 })
    expect(getx({ a: 5 }, 'a<3')).equal(undefined)
    expect(getx({ a: 5 }, 'a>=5')).equal({ a: 5 })
    expect(getx({ a: 5 }, 'a<=5')).equal({ a: 5 })
    expect(getx({ a: 'hello' }, 'a~ell')).equal({ a: 'hello' })
    expect(getx({ a: 'hello' }, 'a~xyz')).equal(undefined)
    expect(getx({ x: [{ n: 1 }, { n: 5 }, { n: 9 }] }, 'x?n>3'))
      .equal([{ n: 5 }, { n: 9 }])
    expect(getx({ x: [{ n: 1 }, { n: 5 }, { n: 9 }] }, 'x?n<5'))
      .equal([{ n: 1 }])

    // Ordering on string operands is lexicographic, mirroring JS `<`/`>`.
    // The Go port (getxCompare) is kept in parity with this.
    expect(getx({ a: 'm' }, 'a>d')).equal({ a: 'm' })
    expect(getx({ a: 'd' }, 'a>m')).equal(undefined)
    expect(getx({ a: 'foo' }, 'a<goo')).equal({ a: 'foo' })
    expect(getx({ a: 'foo' }, 'a>=foo')).equal({ a: 'foo' })
    expect(getx({ a: 'foo' }, 'a<=foo')).equal({ a: 'foo' })
    expect(getx({ x: [{ s: 'a' }, { s: 'm' }, { s: 'z' }] }, 'x?s>k'))
      .equal([{ s: 'm' }, { s: 'z' }])

    // Type-based, like JS: a string value compares lexicographically even when
    // it looks numeric ('10' < '9' is true), whereas a numeric value compares
    // numerically (10 < 9 is false).
    expect(getx({ a: '10' }, 'a<9')).equal({ a: '10' })
    expect(getx({ a: 10 }, 'a<9')).equal(undefined)
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

    // Single lowercase tokens between separators must stay separate.
    expect(partify('yes-as-a-service')).equal(['yes', 'as', 'a', 'service'])
    expect(partify('a-b-c')).equal(['a', 'b', 'c'])
    expect(partify('YesAsAService')).equal(['Yes', 'As', 'A', 'Service'])
    expect(kebabify('yes-as-a-service')).equal('yes-as-a-service')
    expect(kebabify(camelify('yes-as-a-service'))).equal('yes-as-a-service')
    expect(snakify('yes-as-a-service')).equal('yes_as_a_service')

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
    expect(snakify('foo bar')).equal('foo_bar')
    expect(snakify('FOO_BAR')).equal('foo_bar')
    expect(snakify('FOO_bar')).equal('foo_bar')
    expect(snakify('foo_BAR')).equal('foo_bar')
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


  // `deep` and `omap` used to be re-exports of `jsonic.util`. They are now
  // inlined in src/util/basic.ts; these lock the behaviour that was
  // inherited, so a future edit cannot quietly drift from it.
  test('deep', () => {
    expect(deep({}, { a: 1 })).equal({ a: 1 })
    expect(deep({ a: 1 }, { b: 2 })).equal({ a: 1, b: 2 })
    expect(deep({ a: 1 }, { a: 2 })).equal({ a: 2 })

    // Right-most wins, across more than two sources.
    expect(deep({}, { a: 1 }, { b: 2 }, { a: 3 })).equal({ a: 3, b: 2 })

    // Nested plain objects merge key-by-key rather than replacing.
    expect(deep({ a: { x: 1, y: 2 } }, { a: { y: 9, z: 8 } }))
      .equal({ a: { x: 1, y: 9, z: 8 } })

    // Arrays merge by index, and do not replace wholesale.
    expect(deep({ a: [1, 2, 3] }, { a: [9] })).equal({ a: [9, 2, 3] })

    // `undefined` never overwrites; `null` does. go/util.go reproduces
    // this split by position -- a nil argument is absent, a nil map value
    // or slice element wins -- because Go has no `undefined`.
    expect(deep({ a: 1 }, { a: undefined })).equal({ a: 1 })
    expect(deep({ a: 1 }, { a: null })).equal({ a: null })
    expect(deep({ a: 1 }, undefined)).equal({ a: 1 })
    expect(deep({ a: 1 }, undefined, { b: 2 })).equal({ a: 1, b: 2 })
    expect(deep({ a: { x: 1 } }, { a: null })).equal({ a: null })
    expect(deep({ a: null }, { a: 1 })).equal({ a: 1 })
    expect(deep({ a: [1, 2] }, { a: null })).equal({ a: null })
    expect(deep({ a: [1, 2] }, { a: [9, null] })).equal({ a: [9, null] })
    expect(deep([1, 2, 3], [9], [null, 8])).equal([null, 8, 3])

    // The SKIP sentinel leaves the base value untouched. Resolved from the
    // global registry, so it is the same symbol jsonic publishes.
    const SKIP = Symbol.for('tabnas.SKIP')
    expect(deep({ a: 1 }, { a: SKIP })).equal({ a: 1 })

    // Values with a custom constructor are taken by reference, not walked.
    const when = new Date(0)
    expect(deep({ a: 1 }, { a: when }).a).equal(when)

    // AND THAT HOLDS WHATEVER SITS UNDER THE SAME KEY IN `base`. It used to
    // hold only where the base value was a scalar: two objects sent the
    // merge down its WALK branch instead, which copies the enumerable
    // properties of one custom instance into the other. A Date and a RegExp
    // have none, so nothing was copied and `over` was silently discarded.
    //
    // `Copy`'s `cmp.Copy.ignore` is merged over a default of `[/~$/]`, so
    // this cost every caller the FIRST pattern of their ignore list.
    const later = new Date(1)
    expect(deep({ a: when }, { a: later }).a).equal(later)

    const re = /b/
    expect(deep({ a: /a/ }, { a: re }).a).equal(re)

    // Element-wise, which is the shape the ignore lists are merged in.
    expect(deep({ a: [/a/, /b/] }, { a: [/x/] }).a).equal([/x/, /b/])

    // A class instance replaces whole rather than merging field by field
    // into the instance already there, which produced a hybrid of the two
    // belonging to neither.
    class Holder {
      constructor(public x: number, public y?: number) { }
    }
    expect(deep({ a: new Holder(1, 2) }, { a: new Holder(9) }).a)
      .equal(new Holder(9))

    // Plain by any other name: a null-prototype object has no constructor
    // at all, and is a bag of keys like any other.
    const bare = Object.create(null)
    bare.y = 2
    expect(deep({ a: { x: 1 } }, { a: bare }).a).equal({ x: 1, y: 2 })

    // Mutates the first argument, as it always has.
    const base: any = { a: 1 }
    expect(deep(base, { b: 2 })).equal(base)
    expect(base).equal({ a: 1, b: 2 })
  })


  // Key order is the cross-stack contract. Go maps have no insertion order
  // to reproduce, so go/util.go `OMap` sorts and this must sort too --
  // the same convention `each`, `cmap`, `vmap` and `jsonify` follow.
  test('deep-key-order', () => {
    // Existing base keys hold their position; new keys append in the
    // order `over` enumerates them.
    expect(Object.keys(deep({ b: 1, a: 1 }, { a: 2, c: 3 })))
      .equal(['b', 'a', 'c'])
    expect(Object.keys(deep({ z: 1, m: 2, a: 3 }, { a: 9, zz: 10, b: 11 })))
      .equal(['z', 'm', 'a', 'zz', 'b'])
  })


  test('omap', () => {
    expect(omap({ a: 1, b: 2 })).equal({ a: 1, b: 2 })
    expect(omap(null)).equal({})
    expect(omap(undefined)).equal({})
    expect(omap({})).equal({})

    // The transform receives, and returns, a [key, value] pair.
    expect(omap({ a: 1, b: 2 }, ([k, v]: any) => [k, v * 2]))
      .equal({ a: 2, b: 4 })
    expect(omap({ a: 1, b: 2 }, ([k, v]: any) => [k.toUpperCase(), v]))
      .equal({ A: 1, B: 2 })

    // An undefined replacement key drops the entry.
    expect(omap({ a: 1, b: 2 }, ([k, v]: any) => 'a' === k ? [undefined] : [k, v]))
      .equal({ b: 2 })

    // Additional pairs set additional keys.
    expect(omap({ a: 1 }, ([k, v]: any) => [k, v, k + '2', v * 10]))
      .equal({ a: 1, a2: 10 })
  })


  test('omap-key-order', () => {
    // Sorted, not insertion order -- this is the deliberate divergence
    // from the jsonic original, and what makes go/util.go `OMap` agree.
    expect(Object.keys(omap({ z: 1, m: 2, a: 3 }))).equal(['a', 'm', 'z'])
    expect(Object.keys(omap({ b: 1, a: 2 }, ([k, v]: any) => [k, v])))
      .equal(['a', 'b'])

    // Renaming keys does not re-sort: entries are visited in sorted
    // *source* key order, and written in that visit order.
    expect(Object.keys(omap({ b: 1, a: 2 }, ([k, v]: any) => [k + 'x', v])))
      .equal(['ax', 'bx'])

    // Numeric-looking keys follow JS integer-key ordering once written to
    // the result object, regardless of visit order.
    expect(Object.keys(omap({ 10: 'a', 2: 'b', 1: 'c' }))).equal(['1', '2', '10'])
  })


  // THE PUBLIC SURFACE, CHECKED FROM OUTSIDE. Every suite here imports the
  // helpers it needs by name, and spec.test.ts reaches past the entry point
  // into '../dist/util/basic' -- so nothing asserted that the package's own
  // exports resolve. They did not: `get` was `undefined` on the built
  // package for as long as a commented-out `// select,` sat between `each,`
  // and `get,` in the export list. tsc emits each re-export as a one-line
  // getter body, the comment pushed `basic_1.get` onto its own line, and
  // automatic semicolon insertion terminated the bare `return`. Typechecking
  // could not see it -- the declaration file was correct -- and neither
  // could any test that imported the function directly.
  //
  // Hence a census rather than a spot check: name the surface, and require
  // every entry to resolve to the kind of thing it claims to be.
  test('package-exports-resolve', () => {
    const FUNCTIONS = [
      'Jostraca', 'BuildContext', 'cmp',
      'each', 'get', 'getx',
      'camelify', 'snakify', 'kebabify', 'partify', 'ucf', 'lcf', 'names',
      'cmap', 'vmap', 'deep', 'omap',
      'template', 'escre', 'indent', 'isbincontent', 'isbinext',
      'Project', 'Content', 'File', 'Inject', 'Fragment', 'Folder',
      'Copy', 'Line', 'Slot', 'List',
    ]
    const NAMESPACES = ['PointUtil', 'DiffUtil']

    const pkg = Package as any

    const missing = FUNCTIONS.filter((n) => 'function' !== typeof pkg[n])
    Assert.deepEqual(missing, [],
      'package exports that are not functions: ' + missing.join(', '))

    const badns = NAMESPACES.filter((n) => null == pkg[n] || 'object' !== typeof pkg[n])
    Assert.deepEqual(badns, [],
      'package namespace exports missing: ' + badns.join(', '))

    // And the one that regressed, exercised rather than merely typed.
    expect(pkg.get({ a: { b: { c: 1 } } }, 'a.b.c')).equal(1)
  })

})

// Caller-side state is recorded by no corpus: all four record OUTPUT only,
// never the model, the options object, or returned slices. So a helper that
// quietly mutates its input is invisible cross-stack, and one did -- getx's `?`
// filter left key$/index$ on every child the filter REJECTED, because the
// cleanup only ever reached the survivors. That pollution is observable in
// generated files, since Content shallow-copies the model and nested objects
// are shared for the whole run. Go rebuilds instead of stamping, so TS was the
// side that was wrong. See PARITY_PLAN.md 2.3.
describe('caller-state', () => {

  test('getx-filter-does-not-mutate-the-model', () => {
    const model: any = { a: { x: { v: 1 }, y: { v: 2 } } }
    const before = JSON.stringify(model)

    const out = getx(model, 'a?v=1')

    expect(out).equal({ x: { v: 1 } })
    expect(JSON.stringify(model)).equal(before)
  })

  test('getx-filter-does-not-mutate-an-array-model', () => {
    const model: any = { a: [{ v: 1 }, { v: 2 }] }
    const before = JSON.stringify(model)

    const out = getx(model, 'a?v=1')

    expect(out).equal([{ v: 1 }])
    expect(JSON.stringify(model)).equal(before)
  })

  test('getx-filter-leaves-no-stamp-on-rejected-children', () => {
    const rejected: any = { v: 2 }
    const model: any = { a: { x: { v: 1 }, y: rejected } }

    getx(model, 'a?v=1')

    // The specific leak: `y` was filtered out and kept its bookkeeping key.
    expect(undefined === rejected.key$).true()
    expect(undefined === rejected.index$).true()
  })


  // The third instance of the same class, and the one a user hits without
  // reaching for an internal: `OptionsShape` injects its defaults into the
  // object it is handed and returns that same object, so `generate` used to
  // write `build`, `cmp`, `control`, `exclude` and `name` into the caller's
  // own options -- and `bin` into an `existing` they passed. Reusing one
  // options object across two calls then passed something different the
  // second time. Go's Options is a value struct and never had it.
  test('generate-does-not-mutate-the-caller-options', async () => {
    const { fs } = memfs({})

    const model = { v: 'V' }
    const existing = { txt: { preserve: true } }
    const opts: any = { fs: () => fs, folder: '/out', model, existing }

    const before = JSON.stringify({
      keys: Object.keys(opts).sort(),
      existing,
    })

    await Package.Jostraca({ now: () => 1735689600000 }).generate(opts,
      Package.cmp(() => Package.Project({ folder: 'p' }, () => {
        Package.File({ name: 'a.txt' }, () => Package.Content('A'))
      })))

    expect(JSON.stringify({
      keys: Object.keys(opts).sort(),
      existing,
    })).equal(before)

    // The model is passed by reference on purpose -- it is the caller's
    // data, not option structure -- so this asserts identity, not a copy.
    expect(opts.model === model).true()
  })

})
