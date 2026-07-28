
import { test, describe } from 'node:test'
import { expect } from './expect'


import {
  template,
} from '../'



describe('utility-template', () => {

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

    // Missing refs are not replaced.
    expect(template('Name $$Name$$', {}, { replace: { Name: () => 'Foo' } }))
      .equal('Foo $$Name$$')

    // Escape format: $$"(.+)"$$
    expect(template('Name $$"Name"$$', {}, { replace: { Name: () => 'Foo' } }))
      .equal('Foo Name')
  })


  test('eject', () => {
    let src0 = `
A
  START  
Q$$a$$
  END  
B
`
    let m0 = { a: 1 }

    expect(template(src0, m0, { eject: ['START', 'END'] })).equal('Q1\n')
    expect(template(src0, m0, { eject: [/START/, /END/] })).equal('  \nQ1\n  ')
  })


  test('eject-inverted', () => {
    // End marker resolving before the start marker: there is no region
    // between them, so the source is left alone — the same thing that
    // happens when neither marker is found.
    //
    // This used to reach `substring`, which SWAPS its arguments when
    // start > end, handing back the reversed region as an accident of
    // the JS built-in. Go guarded the case and returned '' instead, so
    // the two stacks silently disagreed. Neither was designed.
    const src = 'a\nEND\nmiddle\nSTART\nb\n'
    expect(template(src, {}, { eject: ['START', 'END'] })).equal(src)
    expect(template('ENDSTART\n', {}, { eject: ['START', 'END'] }))
      .equal('ENDSTART\n')
  })


  test('jsonify-sorts-keys', () => {
    // Go maps have no insertion order, so `json.Marshal` sorts and TS
    // has to sort too or the same model emits different bytes on each
    // stack. Found by the cross-stack template corpus.
    expect(template('$$a$$', { a: { z: 1, a: 2, m: 3 } }))
      .equal('{"a":2,"m":3,"z":1}')

    // All the way down, and arrays keep their own (meaningful) order.
    expect(template('$$a$$', { a: { b: [{ y: 1, x: 2 }, { n: 3 }] } }))
      .equal('{"b":[{"x":2,"y":1},{"n":3}]}')

    // Same object, different insertion order, same output.
    const one: any = {}
    one.z = 1; one.a = 2
    const two: any = {}
    two.a = 2; two.z = 1
    expect(template('$$v$$', { v: one })).equal(template('$$v$$', { v: two }))
  })


  test('jsonify-edge-values', () => {
    // toJSON is honoured, so Date and friends serialize as they always
    // did rather than collapsing to `{}` once sorting was introduced.
    expect(template('$$d$$', { d: new Date(0) }))
      .equal('"1970-01-01T00:00:00.000Z"')

    // A repeated (non-cyclic) reference is fine, as it is for
    // JSON.stringify.
    const shared = { s: 1 }
    expect(template('$$v$$', { v: { a: shared, b: shared } }))
      .equal('{"a":{"s":1},"b":{"s":1}}')

    // A cycle is rejected, not recursed until the stack blows.
    const cyclic: any = { a: 1 }
    cyclic.self = cyclic
    expect(() => template('$$v$$', { v: cyclic })).throws(/circular/)

    expect(template('$$v$$', { v: [] })).equal('[]')
    expect(template('$$v$$', { v: {} })).equal('{}')
  })

})

