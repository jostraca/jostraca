
import { test, describe } from 'node:test'
import { expect } from '@hapi/code'

import { memfs } from 'memfs'


import {
  Jostraca,
  Project,
  Folder,
  File,
  Content,
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
            extra = '// gen-extra1\n'
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

    const mfs = memfs({
      '/top/sdk/js/qaz.js': '// not-gen\n'
    })
    const fs: any = mfs.fs
    const vol: any = mfs.vol

    const m0 = { a: 0 }
    const res0 = await jostraca.generate({ fs: () => fs, folder: '/top', model: m0 }, root)
    expect(res0).includes(DATA_merge_basic_res0)

    expect(vol.toJSON()).equal(DATA_merge_basic_vol0)

    fs.appendFileSync('/top/sdk/js/foo.js', '// added1\n', { encoding: 'utf8' })
    fs.appendFileSync('/top/sdk/js/bar.js', '// added1\n', { encoding: 'utf8' })


    const m1 = { a: 1 }
    const res1 = await jostraca.generate({
      fs: () => fs, folder: '/top', model: m1,
      existing: { txt: { merge: true } }
    }, root)
    expect(res1).includes(DATA_merge_basic_res1)

    expect(vol.toJSON()).equal(DATA_merge_basic_vol1)

    fs.writeFileSync('/top/sdk/js/bar.js', '// custom-bar\n// BAR\n// added1-resolve\n',
      { encoding: 'utf8' })

    const m12 = { a: 1 }
    const res2 = await jostraca.generate({
      fs: () => fs, folder: '/top', model: m12,
      existing: { txt: { merge: true } }
    }, root)
    expect(res2).includes(DATA_merge_basic_res2)

    expect(vol.toJSON()).equal(DATA_merge_basic_vol2)
  })


  test('update', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const jostraca = Jostraca({ now, mem: true, existing: { txt: { merge: true } } })

    const root = () => Project({}, (props: any) => {
      const m = props.ctx$.model
      File({ name: 'aaa.txt' }, () => {
        Content('A=' + m.a + '\n\n')
      })
    })

    const m0 = { a: 0 }
    const res0: any = await jostraca.generate({ folder: '/', model: m0 }, root)
    // console.log(res0, res0.vol().toJSON())
    expect(res0.files.written).equal(['/aaa.txt'])
    expect(res0.vol().toJSON()['/aaa.txt']).equal('A=0\n\n')


    m0.a = 1
    const res1: any = await jostraca.generate({ folder: '/', model: m0 }, root)
    // console.log(res1, res1.vol().toJSON())
    expect(res1.files.merged).equal(['/aaa.txt'])
    expect(res1.vol().toJSON()['/aaa.txt']).equal('A=1\n\n')


    const fs = res1.fs()
    fs.appendFileSync('/aaa.txt', 'Z\n', { encoding: 'utf8' })
    // console.log(res1.vol().toJSON())

    const res2: any = await jostraca.generate({ folder: '/', model: m0 }, root)
    // console.log(res2, res2.vol().toJSON())
    expect(res2.files.merged).equal(['/aaa.txt'])
    expect(res2.vol().toJSON()['/aaa.txt']).equal('A=1\n\nZ\n')


    m0.a = 2
    const res3: any = await jostraca.generate({ folder: '/', model: m0 }, root)
    // console.log(res3, res2.vol().toJSON())
    expect(res3.files.merged).equal(['/aaa.txt'])
    expect(res3.vol().toJSON()['/aaa.txt']).equal('A=2\n\nZ\n')
  })



  test('path', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const mfs = memfs({})
    const vol: any = mfs.vol

    const m0 = { a: 0 }

    const jostraca = Jostraca({
      now,
      model: m0,
      fs: () => mfs.fs,
      folder: '/top',
      existing: { txt: { merge: true } }
    })

    const root = () => Project({ folder: '/top/sdk' }, (props: any) => {
      const m = props.ctx$.model

      Folder({ name: '/code/js' }, () => {
        File({ name: 'foo.js' }, () => {
          Content('// foo:' + m.a + '\n')
        })
      })

    })



    const res0 = await jostraca.generate({}, root)
    // console.log(res0)
    expect(res0).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/sdk/code/js/foo.js'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })
    // console.log(vol.toJSON())
    expect(vol.toJSON()).equal({
      '/top/sdk/code/js/foo.js': '// foo:0\n',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:0\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735689900000,\n' +
        '  "hlast": 2025010100050000,\n' +
        '  "files": {\n' +
        '    "sdk/code/js/foo.js": {\n' +
        '      "action": "write",\n' +
        '      "path": "sdk/code/js/foo.js",\n' +
        '      "exists": false,\n' +
        '      "actions": [\n' +
        '        "write"\n' +
        '      ],\n' +
        '      "protect": false,\n' +
        '      "conflict": false,\n' +
        '      "when": 1735689840000,\n' +
        '      "hwhen": 2025010100040000\n' +
        '    }\n' +
        '  }\n' +
        '}',
      '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
    })

    m0.a = 1
    const res1 = await jostraca.generate({}, root)
    // console.log(res1)
    expect(res1).include({
      when: 1735690140000,
      files: {
        preserved: [],
        written: [],
        presented: [],
        diffed: [],
        merged: ['/top/sdk/code/js/foo.js'],
        conflicted: [],
        unchanged: []
      }
    })
    // console.log(vol.toJSON())
    expect(vol.toJSON()).equal({
      '/top/sdk/code/js/foo.js': '// foo:1\n',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:1\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735690680000,\n' +
        '  "hlast": 2025010100180000,\n' +
        '  "files": {\n' +
        '    "sdk/code/js/foo.js": {\n' +
        '      "action": "merge",\n' +
        '      "path": "sdk/code/js/foo.js",\n' +
        '      "exists": true,\n' +
        '      "actions": [\n' +
        '        "merge"\n' +
        '      ],\n' +
        '      "protect": false,\n' +
        '      "conflict": false,\n' +
        '      "when": 1735690620000,\n' +
        '      "hwhen": 2025010100170000\n' +
        '    }\n' +
        '  }\n' +
        '}',
      '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
    })


    mfs.fs.unlinkSync('/top/.jostraca/generated/sdk/code/js/foo.js')

    const res2 = await jostraca.generate({}, root)
    // console.log(res2)
    expect(res2).include({
      when: 1735690920000,
      files: {
        preserved: [],
        written: [],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: ['/top/sdk/code/js/foo.js']
      }
    })
    // console.log(vol.toJSON())
    expect(vol.toJSON()).equal({
      '/top/sdk/code/js/foo.js': '// foo:1\n',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:1\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735691280000,\n' +
        '  "hlast": 2025010100280000,\n' +
        '  "files": {\n' +
        '    "sdk/code/js/foo.js": {\n' +
        '      "action": "skip",\n' +
        '      "path": "sdk/code/js/foo.js",\n' +
        '      "exists": true,\n' +
        '      "actions": [\n' +
        '        "skip"\n' +
        '      ],\n' +
        '      "protect": false,\n' +
        '      "conflict": false,\n' +
        '      "when": 1735691220000,\n' +
        '      "hwhen": 2025010100270000\n' +
        '    }\n' +
        '  }\n' +
        '}',
      '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
    })


    mfs.fs.writeFileSync('/top/sdk/code/js/foo.js', '// FOO:a\n', { encoding: 'utf8' })

    const res3 = await jostraca.generate({}, root)
    expect(res3).include({
      when: 1735691520000,
      files: {
        preserved: [],
        written: [],
        presented: [],
        diffed: [],
        merged: ['/top/sdk/code/js/foo.js'],
        conflicted: [],
        unchanged: []
      }
    })
    expect(vol.toJSON()).equal({
      '/top/sdk/code/js/foo.js': '// FOO:a\n',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:1\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735692060000,\n' +
        '  "hlast": 2025010100410000,\n' +
        '  "files": {\n' +
        '    "sdk/code/js/foo.js": {\n' +
        '      "action": "merge",\n' +
        '      "path": "sdk/code/js/foo.js",\n' +
        '      "exists": true,\n' +
        '      "actions": [\n' +
        '        "merge"\n' +
        '      ],\n' +
        '      "protect": false,\n' +
        '      "conflict": false,\n' +
        '      "when": 1735692000000,\n' +
        '      "hwhen": 2025010100400000\n' +
        '    }\n' +
        '  }\n' +
        '}',
      '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
    })


    m0.a = 2
    const res4 = await jostraca.generate({}, root)
    expect(res4).include({
      when: 1735692300000,
      files: {
        preserved: [],
        written: [],
        presented: [],
        diffed: [],
        merged: ['/top/sdk/code/js/foo.js'],
        conflicted: ['/top/sdk/code/js/foo.js'],
        unchanged: []
      }
    })
    expect(vol.toJSON()).equal({
      '/top/sdk/code/js/foo.js':
        '<<<<<<< GENERATED: 2025-01-01T00:45:00.000Z/merge\n' +
        '// foo:2\n' +
        '=======\n' +
        '// FOO:a\n' +
        '>>>>>>> EXISTING: 2025-01-01T00:41:00.000Z/merge\n' +
        '',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:2\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735692840000,\n' +
        '  "hlast": 2025010100540000,\n' +
        '  "files": {\n' +
        '    "sdk/code/js/foo.js": {\n' +
        '      "action": "merge",\n' +
        '      "path": "sdk/code/js/foo.js",\n' +
        '      "exists": true,\n' +
        '      "actions": [\n' +
        '        "merge"\n' +
        '      ],\n' +
        '      "protect": false,\n' +
        '      "conflict": true,\n' +
        '      "when": 1735692780000,\n' +
        '      "hwhen": 2025010100530000\n' +
        '    }\n' +
        '  }\n' +
        '}',
      '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
    })


    mfs.fs.writeFileSync('/top/sdk/code/js/foo.js', '// FOO:2\n', { encoding: 'utf8' })

    const res5 = await jostraca.generate({}, root)
    expect(res5).include({
      when: 1735693080000,
      files: {
        preserved: [],
        written: [],
        presented: [],
        diffed: [],
        merged: ['/top/sdk/code/js/foo.js'],
        conflicted: [],
        unchanged: []
      }
    })
    expect(vol.toJSON()).equal({
      '/top/sdk/code/js/foo.js': '// FOO:2\n',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:2\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735693620000,\n' +
        '  "hlast": 2025010101070000,\n' +
        '  "files": {\n' +
        '    "sdk/code/js/foo.js": {\n' +
        '      "action": "merge",\n' +
        '      "path": "sdk/code/js/foo.js",\n' +
        '      "exists": true,\n' +
        '      "actions": [\n' +
        '        "merge"\n' +
        '      ],\n' +
        '      "protect": false,\n' +
        '      "conflict": false,\n' +
        '      "when": 1735693560000,\n' +
        '      "hwhen": 2025010101060000\n' +
        '    }\n' +
        '  }\n' +
        '}',
      '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
    })


    const res6 = await jostraca.generate({}, root)
    expect(res6).include({
      when: 1735693860000,
      files: {
        preserved: [],
        written: [],
        presented: [],
        diffed: [],
        merged: ['/top/sdk/code/js/foo.js'],
        conflicted: [],
        unchanged: []
      }
    })
    expect(vol.toJSON()).equal({
      '/top/sdk/code/js/foo.js': '// FOO:2\n',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:2\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735694400000,\n' +
        '  "hlast": 2025010101200000,\n' +
        '  "files": {\n' +
        '    "sdk/code/js/foo.js": {\n' +
        '      "action": "merge",\n' +
        '      "path": "sdk/code/js/foo.js",\n' +
        '      "exists": true,\n' +
        '      "actions": [\n' +
        '        "merge"\n' +
        '      ],\n' +
        '      "protect": false,\n' +
        '      "conflict": false,\n' +
        '      "when": 1735694340000,\n' +
        '      "hwhen": 2025010101190000\n' +
        '    }\n' +
        '  }\n' +
        '}',
      '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
    })


    m0.a = 3
    const res7 = await jostraca.generate({}, root)
    expect(res7).include({
      when: 1735694640000,
      files: {
        preserved: [],
        written: [],
        presented: [],
        diffed: [],
        merged: ['/top/sdk/code/js/foo.js'],
        conflicted: ['/top/sdk/code/js/foo.js'],
        unchanged: []
      }
    })
    expect(vol.toJSON()).equal({
      '/top/sdk/code/js/foo.js':
        '<<<<<<< GENERATED: 2025-01-01T01:24:00.000Z/merge\n' +
        '// foo:3\n' +
        '=======\n' +
        '// FOO:2\n' +
        '>>>>>>> EXISTING: 2025-01-01T01:20:00.000Z/merge\n' +
        '',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:3\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735695180000,\n' +
        '  "hlast": 2025010101330000,\n' +
        '  "files": {\n' +
        '    "sdk/code/js/foo.js": {\n' +
        '      "action": "merge",\n' +
        '      "path": "sdk/code/js/foo.js",\n' +
        '      "exists": true,\n' +
        '      "actions": [\n' +
        '        "merge"\n' +
        '      ],\n' +
        '      "protect": false,\n' +
        '      "conflict": true,\n' +
        '      "when": 1735695120000,\n' +
        '      "hwhen": 2025010101320000\n' +
        '    }\n' +
        '  }\n' +
        '}',
      '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
    })


    mfs.fs.writeFileSync('/top/sdk/code/js/foo.js', '// foo:3\n// BAR:b\n', { encoding: 'utf8' })

    const res8 = await jostraca.generate({}, root)
    expect(res8).include({
      when: 1735695420000,
      files: {
        preserved: [],
        written: [],
        presented: [],
        diffed: [],
        merged: ['/top/sdk/code/js/foo.js'],
        conflicted: [],
        unchanged: []
      }
    })
    expect(vol.toJSON()).equal({
      '/top/sdk/code/js/foo.js': '// foo:3\n// BAR:b\n',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:3\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735695960000,\n' +
        '  "hlast": 2025010101460000,\n' +
        '  "files": {\n' +
        '    "sdk/code/js/foo.js": {\n' +
        '      "action": "merge",\n' +
        '      "path": "sdk/code/js/foo.js",\n' +
        '      "exists": true,\n' +
        '      "actions": [\n' +
        '        "merge"\n' +
        '      ],\n' +
        '      "protect": false,\n' +
        '      "conflict": false,\n' +
        '      "when": 1735695900000,\n' +
        '      "hwhen": 2025010101450000\n' +
        '    }\n' +
        '  }\n' +
        '}',
      '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
    })

    m0.a = 4
    const res9 = await jostraca.generate({}, root)
    expect(res9).include({
      when: 1735696200000,
      files: {
        preserved: [],
        written: [],
        presented: [],
        diffed: [],
        merged: ['/top/sdk/code/js/foo.js'],
        conflicted: ['/top/sdk/code/js/foo.js'],
        unchanged: []
      }
    })
    expect(vol.toJSON()).equal({
      '/top/sdk/code/js/foo.js':
        '<<<<<<< GENERATED: 2025-01-01T01:50:00.000Z/merge\n' +
        '// foo:4\n' +
        '=======\n' +
        '// foo:3\n' +
        '// BAR:b\n' +
        '>>>>>>> EXISTING: 2025-01-01T01:46:00.000Z/merge\n' +
        '',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:4\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735696740000,\n' +
        '  "hlast": 2025010101590000,\n' +
        '  "files": {\n' +
        '    "sdk/code/js/foo.js": {\n' +
        '      "action": "merge",\n' +
        '      "path": "sdk/code/js/foo.js",\n' +
        '      "exists": true,\n' +
        '      "actions": [\n' +
        '        "merge"\n' +
        '      ],\n' +
        '      "protect": false,\n' +
        '      "conflict": true,\n' +
        '      "when": 1735696680000,\n' +
        '      "hwhen": 2025010101580000\n' +
        '    }\n' +
        '  }\n' +
        '}',
      '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
    })
  })


  test('retain', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const jostraca = Jostraca({ now })

    const root = () => Project({ folder: '.' }, (props: any) => {
      const model = props.ctx$.model
      File({ name: 'foo.txt' }, () => {
        Content(model.foo)
      })
    })

    const model = { foo: 'aaa\n' }
    const mfs = memfs({})
    const fs: any = mfs.fs
    const vol: any = mfs.vol

    const jopts = {
      fs: () => fs, folder: '/', model,
      existing: { txt: { merge: true } }
    }


    // console.log('%%% G-0 %%%')
    let res = await jostraca.generate(jopts, root)
    // console.log(res)
    // console.log(vol.toJSON())
    expect(vol.toJSON()['/foo.txt']).equal('aaa\n')


    // console.log('%%% G-1 %%%')
    res = await jostraca.generate(jopts, root)
    // console.log(res)
    // console.log(vol.toJSON())
    expect(vol.toJSON()['/foo.txt']).equal('aaa\n')


    // console.log('%%% G-2 %%%')
    fs.appendFileSync('/foo.txt', 'bbb\n', { encoding: 'utf8' })
    res = await jostraca.generate(jopts, root)
    // console.log(res)
    // console.log(vol.toJSON())
    expect(vol.toJSON()['/foo.txt']).equal('aaa\nbbb\n')


    // console.log('%%% G-3 %%%')
    res = await jostraca.generate(jopts, root)
    // console.log(res)
    // console.log(vol.toJSON())
    expect(vol.toJSON()['/foo.txt']).equal('aaa\nbbb\n')


    // console.log('%%% G-4 %%%')
    res = await jostraca.generate(jopts, root)
    // console.log(res)
    // console.log(vol.toJSON())
    expect(vol.toJSON()['/foo.txt']).equal('aaa\nbbb\n')


    // console.log('%%% G-5 %%%')
    model.foo = 'aaa\nccc\n'
    res = await jostraca.generate(jopts, root)
    // console.log(res)
    // console.log(vol.toJSON())
    expect(vol.toJSON()['/foo.txt']).equal(`aaa
<<<<<<< GENERATED: 2025-01-01T00:58:00.000Z/merge
ccc
=======
bbb
>>>>>>> EXISTING: 2025-01-01T00:54:00.000Z/merge
`)


    // console.log('%%% G-6 %%%')
    fs.writeFileSync('/foo.txt', 'aaa\nbbb\nccc\n', { encoding: 'utf8' })
    res = await jostraca.generate(jopts, root)
    // console.log(res)
    // console.log(vol.toJSON())
    expect(vol.toJSON()['/foo.txt']).equal('aaa\nbbb\nccc\n')


    // console.log('%%% G-7 %%%')
    model.foo = 'aaa\nddd\n'
    res = await jostraca.generate(jopts, root)
    // console.log(res)
    // console.log(vol.toJSON())
    expect(vol.toJSON()['/foo.txt']).equal(`aaa
<<<<<<< GENERATED: 2025-01-01T01:24:00.000Z/merge
ddd
=======
bbb
ccc
>>>>>>> EXISTING: 2025-01-01T01:20:00.000Z/merge
`)


    // console.log('%%% G-8 %%%')
    res = await jostraca.generate(jopts, root)
    // console.log(res)
    // console.log(vol.toJSON())
    expect(vol.toJSON()['/foo.txt']).equal(`aaa
<<<<<<< GENERATED: 2025-01-01T01:24:00.000Z/merge
ddd
=======
bbb
ccc
>>>>>>> EXISTING: 2025-01-01T01:20:00.000Z/merge
`)


    // console.log('%%% G-9 %%%')
    model.foo = 'aaa\neee\n'
    res = await jostraca.generate(jopts, root)
    // console.log(res)
    // console.log(vol.toJSON())
    expect(vol.toJSON()['/foo.txt']).equal(`aaa
<<<<<<< GENERATED: 2025-01-01T01:24:00.000Z/merge
ddd
=======
bbb
ccc
>>>>>>> EXISTING: 2025-01-01T01:20:00.000Z/merge
`)
  })


})


const DATA_merge_basic_res0 = {
  when: 1735689660000,
  files: {
    preserved: [],
    written: [
      '/top/sdk/js/foo.js',
      '/top/sdk/js/bar.js',
      '/top/sdk/go/zed.go'
    ],
    presented: [],
    diffed: [],
    merged: [],
    conflicted: [],
    unchanged: []
  }
}


const DATA_merge_basic_res1 = {
  when: 1735690380000,
  files: {
    preserved: [],
    written: [],
    presented: [],
    diffed: [],
    merged: [
      '/top/sdk/js/foo.js',
      '/top/sdk/js/bar.js',
      '/top/sdk/go/zed.go'
    ],
    conflicted: ['/top/sdk/js/bar.js'],
    unchanged: []
  }
}

const DATA_merge_basic_res2 = {
  when: 1735691760000,
  files: {
    preserved: [],
    written: [],
    presented: [],
    diffed: [],
    merged: ['/top/sdk/js/foo.js', '/top/sdk/js/bar.js'],
    conflicted: [],
    unchanged: ['/top/sdk/go/zed.go']
  }
}


const DATA_merge_basic_vol0 = {
  '/top/sdk/js/qaz.js': '// not-gen\n',
  '/top/sdk/js/foo.js': '// custom-foo:0\n// FOO\n',
  '/top/sdk/js/bar.js': '// custom-bar\n// BAR\n',
  '/top/sdk/go/zed.go': '// custom-zed:0\n',
  '/top/.jostraca/generated/sdk/js/foo.js': '// custom-foo:0\n// FOO\n',
  '/top/.jostraca/generated/sdk/js/bar.js': '// custom-bar\n// BAR\n',
  '/top/.jostraca/generated/sdk/go/zed.go': '// custom-zed:0\n',
  '/top/.jostraca/jostraca.meta.log': '{\n' +
    '  "foldername": ".jostraca",\n' +
    '  "filename": "jostraca.meta.log",\n' +
    '  "last": 1735690140000,\n' +
    '  "hlast": 2025010100090000,\n' +
    '  "files": {\n' +
    '    "sdk/js/foo.js": {\n' +
    '      "action": "write",\n' +
    '      "path": "sdk/js/foo.js",\n' +
    '      "exists": false,\n' +
    '      "actions": [\n' +
    '        "write"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735689840000,\n' +
    '      "hwhen": 2025010100040000\n' +
    '    },\n' +
    '    "sdk/js/bar.js": {\n' +
    '      "action": "write",\n' +
    '      "path": "sdk/js/bar.js",\n' +
    '      "exists": false,\n' +
    '      "actions": [\n' +
    '        "write"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735689960000,\n' +
    '      "hwhen": 2025010100060000\n' +
    '    },\n' +
    '    "sdk/go/zed.go": {\n' +
    '      "action": "write",\n' +
    '      "path": "sdk/go/zed.go",\n' +
    '      "exists": false,\n' +
    '      "actions": [\n' +
    '        "write"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735690080000,\n' +
    '      "hwhen": 2025010100080000\n' +
    '    }\n' +
    '  }\n' +
    '}',
  '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
}


const DATA_merge_basic_vol1 = {
  '/top/sdk/js/qaz.js': '// not-gen\n',
  '/top/sdk/js/foo.js': '// custom-foo:1\n// FOO\n// added1\n',
  '/top/sdk/js/bar.js': '// custom-bar\n' +
    '// BAR\n' +
    '<<<<<<< GENERATED: 2025-01-01T00:13:00.000Z/merge\n' +
    '// gen-extra1\n' +
    '=======\n' +
    '// added1\n' +
    '>>>>>>> EXISTING: 2025-01-01T00:09:00.000Z/merge\n',
  '/top/sdk/go/zed.go': '// custom-zed:1\n// EXTRA1',
  '/top/.jostraca/generated/sdk/js/foo.js': '// custom-foo:1\n// FOO\n',
  '/top/.jostraca/generated/sdk/js/bar.js': '// custom-bar\n// BAR\n// gen-extra1\n',
  '/top/.jostraca/generated/sdk/go/zed.go': '// custom-zed:1\n// EXTRA1',
  '/top/.jostraca/jostraca.meta.log': '{\n' +
    '  "foldername": ".jostraca",\n' +
    '  "filename": "jostraca.meta.log",\n' +
    '  "last": 1735691520000,\n' +
    '  "hlast": 2025010100320000,\n' +
    '  "files": {\n' +
    '    "sdk/js/foo.js": {\n' +
    '      "action": "merge",\n' +
    '      "path": "sdk/js/foo.js",\n' +
    '      "exists": true,\n' +
    '      "actions": [\n' +
    '        "merge"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735690860000,\n' +
    '      "hwhen": 2025010100210000\n' +
    '    },\n' +
    '    "sdk/js/bar.js": {\n' +
    '      "action": "merge",\n' +
    '      "path": "sdk/js/bar.js",\n' +
    '      "exists": true,\n' +
    '      "actions": [\n' +
    '        "merge"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": true,\n' +
    '      "when": 1735691160000,\n' +
    '      "hwhen": 2025010100260000\n' +
    '    },\n' +
    '    "sdk/go/zed.go": {\n' +
    '      "action": "merge",\n' +
    '      "path": "sdk/go/zed.go",\n' +
    '      "exists": true,\n' +
    '      "actions": [\n' +
    '        "merge"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735691460000,\n' +
    '      "hwhen": 2025010100310000\n' +
    '    }\n' +
    '  }\n' +
    '}',
  '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
}


const DATA_merge_basic_vol2 = {
  '/top/sdk/js/qaz.js': '// not-gen\n',
  '/top/sdk/js/foo.js': '// custom-foo:1\n// FOO\n// added1\n',
  '/top/sdk/js/bar.js': '// custom-bar\n// BAR\n// added1-resolve\n',
  '/top/sdk/go/zed.go': '// custom-zed:1\n// EXTRA1',
  '/top/.jostraca/generated/sdk/js/foo.js': '// custom-foo:1\n// FOO\n',
  '/top/.jostraca/generated/sdk/js/bar.js': '// custom-bar\n// BAR\n// gen-extra1\n',
  '/top/.jostraca/generated/sdk/go/zed.go': '// custom-zed:1\n// EXTRA1',
  '/top/.jostraca/jostraca.meta.log': '{\n' +
    '  "foldername": ".jostraca",\n' +
    '  "filename": "jostraca.meta.log",\n' +
    '  "last": 1735692720000,\n' +
    '  "hlast": 2025010100520000,\n' +
    '  "files": {\n' +
    '    "sdk/js/foo.js": {\n' +
    '      "action": "merge",\n' +
    '      "path": "sdk/js/foo.js",\n' +
    '      "exists": true,\n' +
    '      "actions": [\n' +
    '        "merge"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735692240000,\n' +
    '      "hwhen": 2025010100440000\n' +
    '    },\n' +
    '    "sdk/js/bar.js": {\n' +
    '      "action": "merge",\n' +
    '      "path": "sdk/js/bar.js",\n' +
    '      "exists": true,\n' +
    '      "actions": [\n' +
    '        "merge"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735692540000,\n' +
    '      "hwhen": 2025010100490000\n' +
    '    },\n' +
    '    "sdk/go/zed.go": {\n' +
    '      "action": "skip",\n' +
    '      "path": "sdk/go/zed.go",\n' +
    '      "exists": true,\n' +
    '      "actions": [\n' +
    '        "skip"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735692660000,\n' +
    '      "hwhen": 2025010100510000\n' +
    '    }\n' +
    '  }\n' +
    '}',
  '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
}
