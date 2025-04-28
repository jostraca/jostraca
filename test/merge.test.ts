
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
  '/top/.jostraca/generated/top/sdk/js/foo.js': '// custom-foo:0\n// FOO\n',
  '/top/.jostraca/generated/top/sdk/js/bar.js': '// custom-bar\n// BAR\n',
  '/top/.jostraca/generated/top/sdk/go/zed.go': '// custom-zed:0\n',
  '/top/.jostraca/jostraca.meta.log': '{\n' +
    '  "foldername": ".jostraca",\n' +
    '  "filename": "jostraca.meta.log",\n' +
    '  "last": 1735690140000,\n' +
    '  "hlast": 2025010100090000,\n' +
    '  "files": {\n' +
    '    "/top/sdk/js/foo.js": {\n' +
    '      "action": "write",\n' +
    '      "path": "/top/sdk/js/foo.js",\n' +
    '      "exists": false,\n' +
    '      "actions": [\n' +
    '        "write"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735689840000,\n' +
    '      "hwhen": 2025010100040000\n' +
    '    },\n' +
    '    "/top/sdk/js/bar.js": {\n' +
    '      "action": "write",\n' +
    '      "path": "/top/sdk/js/bar.js",\n' +
    '      "exists": false,\n' +
    '      "actions": [\n' +
    '        "write"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735689960000,\n' +
    '      "hwhen": 2025010100060000\n' +
    '    },\n' +
    '    "/top/sdk/go/zed.go": {\n' +
    '      "action": "write",\n' +
    '      "path": "/top/sdk/go/zed.go",\n' +
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
  '/top/.jostraca/generated/top/sdk/js/foo.js': '// custom-foo:1\n// FOO\n',
  '/top/.jostraca/generated/top/sdk/js/bar.js': '// custom-bar\n// BAR\n// gen-extra1\n',
  '/top/.jostraca/generated/top/sdk/go/zed.go': '// custom-zed:1\n// EXTRA1',
  '/top/.jostraca/jostraca.meta.log': '{\n' +
    '  "foldername": ".jostraca",\n' +
    '  "filename": "jostraca.meta.log",\n' +
    '  "last": 1735691460000,\n' +
    '  "hlast": 2025010100310000,\n' +
    '  "files": {\n' +
    '    "/top/sdk/js/foo.js": {\n' +
    '      "action": "merge",\n' +
    '      "path": "/top/sdk/js/foo.js",\n' +
    '      "exists": true,\n' +
    '      "actions": [\n' +
    '        "merge"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735690800000,\n' +
    '      "hwhen": 2025010100200000\n' +
    '    },\n' +
    '    "/top/sdk/js/bar.js": {\n' +
    '      "action": "merge",\n' +
    '      "path": "/top/sdk/js/bar.js",\n' +
    '      "exists": true,\n' +
    '      "actions": [\n' +
    '        "merge"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": true,\n' +
    '      "when": 1735691100000,\n' +
    '      "hwhen": 2025010100250000\n' +
    '    },\n' +
    '    "/top/sdk/go/zed.go": {\n' +
    '      "action": "merge",\n' +
    '      "path": "/top/sdk/go/zed.go",\n' +
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
  '/top/.jostraca/generated/top/sdk/js/foo.js': '// custom-foo:1\n// FOO\n',
  '/top/.jostraca/generated/top/sdk/js/bar.js': '// custom-bar\n// BAR\n// gen-extra1\n',
  '/top/.jostraca/generated/top/sdk/go/zed.go': '// custom-zed:1\n// EXTRA1',
  '/top/.jostraca/jostraca.meta.log': '{\n' +
    '  "foldername": ".jostraca",\n' +
    '  "filename": "jostraca.meta.log",\n' +
    '  "last": 1735692540000,\n' +
    '  "hlast": 2025010100490000,\n' +
    '  "files": {\n' +
    '    "/top/sdk/js/foo.js": {\n' +
    '      "action": "merge",\n' +
    '      "path": "/top/sdk/js/foo.js",\n' +
    '      "exists": true,\n' +
    '      "actions": [\n' +
    '        "merge"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735692120000,\n' +
    '      "hwhen": 2025010100420000\n' +
    '    },\n' +
    '    "/top/sdk/js/bar.js": {\n' +
    '      "action": "merge",\n' +
    '      "path": "/top/sdk/js/bar.js",\n' +
    '      "exists": true,\n' +
    '      "actions": [\n' +
    '        "merge"\n' +
    '      ],\n' +
    '      "protect": false,\n' +
    '      "conflict": false,\n' +
    '      "when": 1735692420000,\n' +
    '      "hwhen": 2025010100470000\n' +
    '    },\n' +
    '    "/top/sdk/go/zed.go": {\n' +
    '      "action": "init",\n' +
    '      "path": "/top/sdk/go/zed.go",\n' +
    '      "exists": true,\n' +
    '      "actions": [],\n' +
    '      "protect": false,\n' +
    '      "conflict": false\n' +
    '    }\n' +
    '  }\n' +
    '}'
}
