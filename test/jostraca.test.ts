
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
  Inject,
  Line,
  Slot,

  cmp,
  each,
} from '../'


const META_FOLDER = '.jostraca'
const META_FILE = 'jostraca.meta.log'

const TOP_META = '/top/' + META_FOLDER + '/' + META_FILE


// 2025-01-01T00:00:00.000Z
const START_TIME = 1735689600000


describe('jostraca', () => {

  test('happy', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))
    expect(Jostraca).exist()

    const jostraca = Jostraca({ now })
    expect(jostraca).exist()

    const { fs, vol } = memfs({})

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
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

    expect(info).include({
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
    })

    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson[TOP_META]).last > START_TIME).true()

    expect(voljson).includes({
      [TOP_META]:
        voljson[TOP_META],
      '/top/sdk/js/foo.js': '// custom-foo\n',
      '/top/sdk/js/bar.js': '// custom-bar\n',
      '/top/sdk/go/zed.go': '// custom-zed\n'
    })
  })


  test('content', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({})

    const jostraca = Jostraca({ now })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      () => {
        Folder({}, () => {
          File({ name: 'foo.txt' }, () => {
            Content('A')
          })
        })
      }
    )

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/foo.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson[TOP_META]).last > 0).true()
    expect(voljson).include({
      '/top/foo.txt': 'A',
      '/top/.jostraca/generated/foo.txt': 'A',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735689900000,\n' +
        '  "hlast": 2025010100050000,\n' +
        '  "files": {\n' +
        '    "foo.txt": {\n' +
        '      "action": "write",\n' +
        '      "path": "foo.txt",\n' +
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
  })



  test('basic-copy', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/tm/bar.txt': '// BAR $$x.z$$ TXT\n',
      '/tm/bar.txt~': '// BAR TXT\n',
      '/tm/sub/a.txt': '// SUB-A $$x.y$$ TXT\n',
      '/tm/sub/b.txt': '// SUB-B $$x.y$$ TXT\n',
      '/tm/sub/c/d.txt': '// SUB-C-D $$x.y$$ $$x.z$$ TXT\n',
    })

    const jostraca = Jostraca({
      now,
      model: { x: { y: 'Y', z: 'Z' } }
    })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((_props: any) => {
        Project({ folder: 'sdk' }, () => {

          Folder({ name: 'js' }, () => {

            File({ name: 'foo.js' }, () => {
              Content('// custom-foo\n')
            })

            Copy({ from: '/tm/bar.txt', to: 'bar.txt' })
            Copy({ from: '/tm/sub' })
          })
        })
      })
    )

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: [
          '/top/sdk/js/foo.js',
          '/top/sdk/js/bar.txt',
          '/top/sdk/js/a.txt',
          '/top/sdk/js/b.txt',
          '/top/sdk/js/c/d.txt'
        ],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson[TOP_META]).last > 0).true()
    expect(voljson).includes({
      [TOP_META]: voljson[TOP_META],

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


  test('fragment-basic', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/tmp/foo.txt': 'FOO\n',
      '/tmp/bar.txt': 'BAR\n',
      '/tmp/zed.txt': 'ZED+<[SLOT]> \n',
      '/tmp/qaz.txt':
        'QAZ+<!--<[SLOT]>-->+// <[SLOT:alice]>+/* <[SLOT:bob]> */+ # <[SLOT:bob]>\n',
    })

    const jostraca = Jostraca({ now })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((props: any) => {
        Project({ folder: 'sdk' }, () => {

          File({ name: 'foo.js' }, () => {
            Content('// custom-foo\n')
            Fragment({ from: '/tmp/foo.txt' })
            Fragment({ from: '/tmp/bar.txt', indent: '  ' })
            Content('// END\n')
          })

          File({ name: 'bar.js' }, () => {
            Fragment({ from: '/tmp/zed.txt' }, () => {
              Content('red')
            })
          })

          File({ name: 'qaz.js' }, () => {
            Fragment({ from: '/tmp/qaz.txt' }, () => {
              Content('A')

              Slot({ name: 'bob' }, () => {
                Content('B')
                Content('OB')
              })

              Content('B')

              Slot({ name: 'alice' }, () => {
                Content('ALICE')
              })

              Content('C')
            })
          })

        })
      })
    )

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/sdk/foo.js', '/top/sdk/bar.js', '/top/sdk/qaz.js'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(voljson).includes({
      '/tmp/foo.txt': 'FOO\n',
      '/tmp/bar.txt': 'BAR\n',
      '/tmp/zed.txt': 'ZED+<[SLOT]> \n',
      '/tmp/qaz.txt':
        'QAZ+<!--<[SLOT]>-->+// <[SLOT:alice]>+/* <[SLOT:bob]> */+ # <[SLOT:bob]>\n',

      '/top/sdk/bar.js': 'ZED+red\n',
      '/top/sdk/qaz.js': 'QAZ+ABC+ALICE+BOB+BOB\n',
      '/top/sdk/foo.js': '// custom-foo\nFOO\n  BAR\n// END\n',

      [TOP_META]: voljson[TOP_META],
    })
  })



  test('inject', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/top/foo.txt': 'FOO\n#--START--#\nBAR\n#--END--#\nZED',
    })

    const jostraca = Jostraca({ now })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((_props: any) => {
        Project({}, () => {
          Inject({ name: 'foo.txt' }, () => {
            Content('QAZ')
          })
        })
      })
    )

    const voljson: any = vol.toJSON()

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/foo.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    expect(voljson).includes({
      [TOP_META]: voljson[TOP_META],

      '/top/foo.txt': 'FOO\n#--START--#\nQAZ\n#--END--#\nZED',
    })
  })



  test('line', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
    })

    const jostraca = Jostraca({ now })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((_props: any) => {
        Project({}, () => {
          File({ name: 'foo.txt' }, () => {
            Content('ONE\n')
            Line('TWO')
            Content('THREE\n')
          })
        })
      })
    )

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/foo.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(voljson).includes({
      [TOP_META]: voljson[TOP_META],

      '/top/foo.txt': 'ONE\nTWO\nTHREE\n',
    })
  })


  test('fragment-subcmp', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n'
    })

    const Foo = cmp(function Foo(props: any) {
      Content('FOO[')
      Content(props.arg)
      Content(']')
    })


    const jostraca = Jostraca({
      now,
      model: { a: 'A' }
    })

    const info = await jostraca.generate(
      {
        fs: () => fs, folder: '/top',
        // build: false
      },
      cmp((_props: any) => {

        Project({}, () => {
          File({ name: 'foo.txt' }, () => {
            Content('ONE\n')
            Fragment({
              from: '/f01.txt', replace: {
                bar: 'BAR',
                zed: () => 'ZED',
                con: () => Content('CON'),
                foo: () => Foo('B')
              }
            }, () => {
              Content('S')
            })
            Content('THREE\n')
          })
        })
      })
    )

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/foo.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(voljson).includes({
      [TOP_META]: voljson[TOP_META],
      '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n',
      '/top/foo.txt': 'ONE\nTWO-A-BAR-ZED-CON-FOO[B]+S\nTHREE\n',
    })
  })



  test('custom-cmp', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const Foo = cmp(function Foo(props: any, children: any) {
      const { ctx$: { model } } = props
      Content(`FOO[$$a$$:${props.b}`)
      each(model.foo, (foo) => each(children, { call: true, args: foo }))
      Content(']')
    })


    const jostraca = Jostraca({
      now,
      model: {
        a: 'A', foo: {
          a: { x: 11 },
          b: { x: 22 }
        }
      },
      mem: true,
      vol: {
        '/f01.txt': '<foo>'
      }
    })

    const info = await jostraca.generate(
      { folder: '/' },
      cmp(() => {
        Project({}, () => {
          File({ name: 'foo.txt' }, () => {
            Content('{')
            Fragment({
              from: '/f01.txt',
              replace: {
                foo: () => Foo({ b: 'B' }, (foo: any) => {
                  Content(`:${foo.key$}=(`)
                  Content(`${foo.x}`)
                  Content(')')
                })
              }
            })
            Content('}')
          })
        })
      })
    )

    expect(info).includes({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/foo.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      },
    })

    const voljson: any = (info.vol as any)().toJSON()

    expect(voljson).includes({
      '/f01.txt': '<foo>',
      '/foo.txt': '{<FOO[A:B:a=(11):b=(22)]>}',
      ['/' + META_FOLDER + '/' + META_FILE]: voljson['/' + META_FOLDER + '/' + META_FILE],
    })
  })


  test('existing-file', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const jostraca = Jostraca({
      now,
      mem: true,
      vol: {
        '/f01.txt': 'a0',
        '/h01.txt': 'c0',
      }
    })

    const info0 = await jostraca.generate(
      { folder: '/', existing: { txt: { write: false } } },
      cmp(() => {
        Project({}, () => {
          File({ name: 'f01.txt' }, () => {
            Content('a1')
          })
          File({ name: 'g01.txt' }, () => {
            Content('b1')
          })
        })
      })
    )

    expect(info0).includes({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/g01.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      },
    })

    const voljson0: any = (info0.vol as any)().toJSON()

    expect(voljson0).includes({
      '/f01.txt': 'a0',
      '/g01.txt': 'b1',
      '/h01.txt': 'c0',
      ['/' + META_FOLDER + '/' + META_FILE]: voljson0['/' + META_FOLDER + '/' + META_FILE],
    })


    const info1 = await jostraca.generate(
      { folder: '/', existing: { txt: { preserve: true } } },
      cmp(() => {
        Project({}, () => {
          File({ name: 'f01.txt' }, () => {
            Content('a1')
          })
          File({ name: 'h01.txt' }, () => {
            Content('c0')
          })
        })
      })
    )

    expect(info1).includes({
      when: 1735690260000,
      files: {
        preserved: ['/f01.txt'],
        written: ['/f01.txt', '/h01.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      },
    })

    const voljson1: any = (info1.vol as any)().toJSON()

    expect(voljson1).includes({
      '/f01.txt': 'a1',
      '/f01.old.txt': 'a0',
      '/h01.txt': 'c0',
      ['/' + META_FOLDER + '/' + META_FILE]: voljson1['/' + META_FOLDER + '/' + META_FILE],
    })


    const info2 = await jostraca.generate(
      { folder: '/', existing: { txt: { write: false, present: true } } },
      cmp(() => {
        Project({}, () => {
          File({ name: 'f01.txt' }, () => {
            Content('a2')
          })
        })
      })
    )

    // console.dir(info2.audit(), { depth: null })

    expect(info2).includes({
      when: 1735691220000,
      files: {
        preserved: [],
        written: [],
        presented: ['/f01.txt'],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      },
    })

    const voljson2: any = (info2.vol as any)().toJSON()

    expect(voljson2).includes({
      '/f01.txt': 'a1',
      '/f01.new.txt': 'a2',
      '/h01.txt': 'c0',
      ['/' + META_FOLDER + '/' + META_FILE]: voljson2['/' + META_FOLDER + '/' + META_FILE],
    })


  })


  test('existing-copy', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/top/tm0/foo.txt': 'F0\nF1\nF2\n',
      '/top/tm0/bar.txt': 'B0\nB1\nB2\n',
      '/top/tm1/zed.txt': 'Z0\nZ1\nZ2\n',
      '/top/tm2/qaz.bin': Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]),
      '/top/tm2/haz.bin': Buffer.from([0x05, 0x06, 0x07, 0x08, 0x09]),
      '/top/p0/bar.txt': 'B0\nB8\nB9\n',
      '/top/p0/zed.txt': 'Z0\nZ7\nZ8\nZ9',
      '/top/p0/haz.bin': Buffer.from([0x09, 0x08, 0x07, 0x06, 0x05]),
    })

    const jostraca = Jostraca({ now })

    const info = await jostraca.generate(
      {
        fs: () => fs, folder: '/top',
        existing: { txt: { diff: true }, bin: { preserve: true } },
      },
      cmp(() => {
        Project({ folder: 'p0' }, () => {
          Folder({}, () => {
            Copy({ from: '/top/tm0' })
            Copy({ from: '/top/tm1/zed.txt' })
            Copy({ from: '/top/tm2' })
          })
        })
      })
    )

    expect(info.files).include({
      preserved: ['/top/p0/haz.bin'],
      written: ['/top/p0/foo.txt', '/top/p0/haz.bin', '/top/p0/qaz.bin'],
      presented: [],
      diffed: ['/top/p0/bar.txt', '/top/p0/zed.txt'],
      merged: [],
      conflicted: ['/top/p0/bar.txt', '/top/p0/zed.txt'],
      unchanged: []
    })

    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson[TOP_META]).last > 0).true()
    expect(voljson).includes({
      [TOP_META]: voljson[TOP_META],

      '/top/tm0/foo.txt': 'F0\nF1\nF2\n',
      '/top/tm0/bar.txt': 'B0\nB1\nB2\n',
      '/top/tm1/zed.txt': 'Z0\nZ1\nZ2\n',
      '/top/tm2/haz.bin': '\x05\x06\x07\b\t',
      '/top/tm2/qaz.bin': '\x00\x01\x02\x03\x04',

      '/top/p0/bar.txt': 'B0\n' +
        '<<<<<<< EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
        'B8\n' +
        'B9\n' +
        '>>>>>>> EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
        '<<<<<<< GENERATED: 2025-01-01T00:01:00.000Z/diff\n' +
        'B1\n' +
        'B2\n' +
        '>>>>>>> GENERATED: 2025-01-01T00:01:00.000Z/diff\n',
      '/top/p0/zed.txt': 'Z0\n' +
        '<<<<<<< EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
        'Z7\n' +
        'Z8\n' +
        'Z9>>>>>>> EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
        '<<<<<<< GENERATED: 2025-01-01T00:01:00.000Z/diff\n' +
        'Z1\n' +
        'Z2\n' +
        '>>>>>>> GENERATED: 2025-01-01T00:01:00.000Z/diff\n',
      '/top/p0/haz.bin': '\x05\x06\x07\b\t',
      '/top/p0/foo.txt': 'F0\nF1\nF2\n',
      '/top/p0/haz.old.bin': '\t\b\x07\x06\x05',
      '/top/p0/qaz.bin': '\x00\x01\x02\x03\x04',

      '/top/.jostraca/generated/p0/foo.txt': 'F0\nF1\nF2\n',
      '/top/.jostraca/generated/p0/bar.txt': 'B0\nB1\nB2\n',
      '/top/.jostraca/generated/p0/zed.txt': 'Z0\nZ1\nZ2\n',
      '/top/.jostraca/generated/p0/haz.bin': '\x05\x06\x07\b\t',
      '/top/.jostraca/generated/p0/qaz.bin': '\x00\x01\x02\x03\x04',
    })
  })


  test('protect', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/top/t0/p0/foo.txt': 'FOO new',
      '/top/t0/p0/bar.txt': 'BAR new',
      '/top/t0/p1/z0.txt': 'z0 new',
      '/top/t0/p1/z1.txt': 'z1 new',

      '/top/s0/p0/foo.txt': 'foo old # JOSTRACA_PROTECT',
      '/top/s0/p0/bar.txt': 'bar old',
      '/top/s0/p1/z0.txt': 'z0 old',
      '/top/s0/p1/z1.txt': 'z1 old # JOSTRACA_PROTECT',
    })

    const debugs: any[] = []

    const log = {
      info: (...args: any[]) => { },
      debug: (...args: any[]) => {
        debugs.push(args)
      },
    }
    const jostraca = Jostraca({ now, log })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((_props: any) => {
        Project({ folder: 's0' }, () => {

          Folder({ name: 'p0' }, () => {

            File({ name: 'foo.txt' }, () => {
              Content('FOO new')
            })

            File({ name: 'bar.txt' }, () => {
              Content('BAR new')
            })
          })

          Copy({ from: '/top/t0' })
        })
      })
    )

    // NOTE: this is a deliberate duplicate file write due to the Copy
    expect(debugs[0][0].point).equal('jostraca-warning')

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/s0/p0/bar.txt', '/top/s0/p1/z0.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson[TOP_META]).last > 0).true()
    expect(voljson).includes({
      [TOP_META]:
        voljson[TOP_META],

      '/top/t0/p0/foo.txt': 'FOO new',
      '/top/t0/p0/bar.txt': 'BAR new',
      '/top/t0/p1/z0.txt': 'z0 new',
      '/top/t0/p1/z1.txt': 'z1 new',

      '/top/s0/p0/foo.txt': 'foo old # JOSTRACA_PROTECT',
      '/top/s0/p0/bar.txt': 'BAR new',
      '/top/s0/p1/z0.txt': 'z0 new',
      '/top/s0/p1/z1.txt': 'z1 old # JOSTRACA_PROTECT'

    })
  })

})

