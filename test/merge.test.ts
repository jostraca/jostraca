
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
    expect(res0).equal({
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
        '}'
    })

    m0.a = 1
    const res1 = await jostraca.generate({}, root)
    // console.log(res1)
    expect(res1).equal({
      when: 1735690080000,
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
        '  "last": 1735690620000,\n' +
        '  "hlast": 2025010100170000,\n' +
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
        '      "when": 1735690560000,\n' +
        '      "hwhen": 2025010100160000\n' +
        '    }\n' +
        '  }\n' +
        '}'
    })


    mfs.fs.unlinkSync('/top/.jostraca/generated/sdk/code/js/foo.js')

    const res2 = await jostraca.generate({}, root)
    // console.log(res2)
    expect(res2).equal({
      when: 1735690800000,
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
        '  "last": 1735691160000,\n' +
        '  "hlast": 2025010100260000,\n' +
        '  "files": {\n' +
        '    "sdk/code/js/foo.js": {\n' +
        '      "action": "init",\n' +
        '      "path": "sdk/code/js/foo.js",\n' +
        '      "exists": true,\n' +
        '      "actions": [],\n' +
        '      "protect": false,\n' +
        '      "conflict": false,\n' +
        '      "when": 1735691100000,\n' +
        '      "hwhen": 2025010100250000\n' +
        '    }\n' +
        '  }\n' +
        '}'
    })


    mfs.fs.writeFileSync('/top/sdk/code/js/foo.js', '// FOO:a\n', { encoding: 'utf8' })

    const res3 = await jostraca.generate({}, root)
    expect(res3).equal({
      when: 1735691340000,
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
        '  "last": 1735691880000,\n' +
        '  "hlast": 2025010100380000,\n' +
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
        '      "when": 1735691820000,\n' +
        '      "hwhen": 2025010100370000\n' +
        '    }\n' +
        '  }\n' +
        '}'
    })


    m0.a = 2
    const res4 = await jostraca.generate({}, root)
    expect(res4).equal({
      when: 1735692060000,
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
      '/top/sdk/code/js/foo.js': '<<<<<<< EXISTING: 2025-01-01T00:38:00.000Z\n' +
        '// FOO:a\n' +
        '=======\n' +
        '// foo:2\n' +
        '>>>>>>> GENERATED: 2025-01-01T00:41:00.000Z\n',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:2\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735692600000,\n' +
        '  "hlast": 2025010100500000,\n' +
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
        '      "when": 1735692540000,\n' +
        '      "hwhen": 2025010100490000\n' +
        '    }\n' +
        '  }\n' +
        '}'
    })


    mfs.fs.writeFileSync('/top/sdk/code/js/foo.js', '// FOO:2\n', { encoding: 'utf8' })

    const res5 = await jostraca.generate({}, root)
    expect(res5).equal({
      when: 1735692780000,
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
        '  "last": 1735693320000,\n' +
        '  "hlast": 2025010101020000,\n' +
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
        '      "when": 1735693260000,\n' +
        '      "hwhen": 2025010101010000\n' +
        '    }\n' +
        '  }\n' +
        '}'
    })


    const res6 = await jostraca.generate({}, root)
    expect(res6).equal({
      when: 1735693500000,
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
        '  "last": 1735694040000,\n' +
        '  "hlast": 2025010101140000,\n' +
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
        '      "when": 1735693980000,\n' +
        '      "hwhen": 2025010101130000\n' +
        '    }\n' +
        '  }\n' +
        '}'
    })


    m0.a = 3
    const res7 = await jostraca.generate({}, root)
    expect(res7).equal({
      when: 1735694220000,
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
      '/top/sdk/code/js/foo.js': '<<<<<<< EXISTING: 2025-01-01T01:14:00.000Z\n' +
        '// FOO:2\n' +
        '=======\n' +
        '// foo:3\n' +
        '>>>>>>> GENERATED: 2025-01-01T01:17:00.000Z\n',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:3\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735694760000,\n' +
        '  "hlast": 2025010101260000,\n' +
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
        '      "when": 1735694700000,\n' +
        '      "hwhen": 2025010101250000\n' +
        '    }\n' +
        '  }\n' +
        '}'
    })


    mfs.fs.writeFileSync('/top/sdk/code/js/foo.js', '// foo:3\n// BAR:b\n', { encoding: 'utf8' })

    const res8 = await jostraca.generate({}, root)
    expect(res8).equal({
      when: 1735694940000,
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
        '  "last": 1735695480000,\n' +
        '  "hlast": 2025010101380000,\n' +
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
        '      "when": 1735695420000,\n' +
        '      "hwhen": 2025010101370000\n' +
        '    }\n' +
        '  }\n' +
        '}'
    })

    m0.a = 4
    const res9 = await jostraca.generate({}, root)
    expect(res9).equal({
      when: 1735695660000,
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
      '/top/sdk/code/js/foo.js': '<<<<<<< EXISTING: 2025-01-01T01:38:00.000Z\n' +
        '// foo:3\n' +
        '// BAR:b\n' +
        '=======\n' +
        '// foo:4\n' +
        '>>>>>>> GENERATED: 2025-01-01T01:41:00.000Z\n',
      '/top/.jostraca/generated/sdk/code/js/foo.js': '// foo:4\n',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735696200000,\n' +
        '  "hlast": 2025010101500000,\n' +
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
        '      "when": 1735696140000,\n' +
        '      "hwhen": 2025010101490000\n' +
        '    }\n' +
        '  }\n' +
        '}'
    })


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
  when: 1735690320000,
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
  when: 1735691640000,
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
    '}'
}


const DATA_merge_basic_vol1 = {
  '/top/sdk/js/qaz.js': '// not-gen\n',
  '/top/sdk/js/foo.js': '// custom-foo:1\n// FOO\n// added1\n',
  '/top/sdk/js/bar.js': '// custom-bar\n' +
    '// BAR\n' +
    '<<<<<<< EXISTING: 2025-01-01T00:09:00.000Z\n' +
    '// added1\n' +
    '=======\n' +
    '// gen-extra1\n' +
    '>>>>>>> GENERATED: 2025-01-01T00:12:00.000Z\n',
  '/top/sdk/go/zed.go': '// custom-zed:1\n// EXTRA1',
  '/top/.jostraca/generated/sdk/js/foo.js': '// custom-foo:1\n// FOO\n',
  '/top/.jostraca/generated/sdk/js/bar.js': '// custom-bar\n// BAR\n// gen-extra1\n',
  '/top/.jostraca/generated/sdk/go/zed.go': '// custom-zed:1\n// EXTRA1',
  '/top/.jostraca/jostraca.meta.log': '{\n' +
    '  "foldername": ".jostraca",\n' +
    '  "filename": "jostraca.meta.log",\n' +
    '  "last": 1735691460000,\n' +
    '  "hlast": 2025010100310000,\n' +
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
    '      "when": 1735690800000,\n' +
    '      "hwhen": 2025010100200000\n' +
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
    '      "when": 1735691100000,\n' +
    '      "hwhen": 2025010100250000\n' +
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
    '      "when": 1735691400000,\n' +
    '      "hwhen": 2025010100300000\n' +
    '    }\n' +
    '  }\n' +
    '}'
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
    '  "last": 1735692600000,\n' +
    '  "hlast": 2025010100500000,\n' +
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
    '      "when": 1735692120000,\n' +
    '      "hwhen": 2025010100420000\n' +
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
    '      "when": 1735692420000,\n' +
    '      "hwhen": 2025010100470000\n' +
    '    },\n' +
    '    "sdk/go/zed.go": {\n' +
    '      "action": "init",\n' +
    '      "path": "sdk/go/zed.go",\n' +
    '      "exists": true,\n' +
    '      "actions": [],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735692540000,\n' +
    '      "hwhen": 2025010100490000\n' +
    '    }\n' +
    '  }\n' +
    '}'
}
