
import { test, describe } from 'node:test'
import { expect } from '@hapi/code'


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

})

