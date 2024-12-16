
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


describe('jostraca', () => {

  test('happy', async () => {
    expect(Jostraca).exist()

    const jostraca = Jostraca()
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


  test('content', async () => {
    const { fs, vol } = memfs({})

    const jostraca = Jostraca()

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

    // console.log('INFO', info)
    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson['/top/.jostraca/jostraca.json.log']).exclude).equal([])
    expect(voljson).equal({
      '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
      '/top/foo.txt': 'A',
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

    const jostraca = Jostraca({
      model: { x: { y: 'Y', z: 'Z' } }
    })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((props: any) => {
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


  test('fragment-basic', async () => {
    const { fs, vol } = memfs({
      '/tmp/foo.txt': 'FOO\n',
      '/tmp/bar.txt': 'BAR\n',
      '/tmp/zed.txt': 'ZED+<[SLOT]> \n',
      '/tmp/qaz.txt':
        'QAZ+<!--<[SLOT]>-->+// <[SLOT:alice]>+/* <[SLOT:bob]> */+ # <[SLOT:bob]>\n',
    })

    const jostraca = Jostraca()

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

    // console.dir(info.root, { depth: null })

    const voljson: any = vol.toJSON()

    expect(voljson).equal({
      '/tmp/foo.txt': 'FOO\n',
      '/tmp/bar.txt': 'BAR\n',
      '/tmp/zed.txt': 'ZED+<[SLOT]> \n',
      '/tmp/qaz.txt':
        'QAZ+<!--<[SLOT]>-->+// <[SLOT:alice]>+/* <[SLOT:bob]> */+ # <[SLOT:bob]>\n',

      '/top/sdk/bar.js': 'ZED+red\n',
      '/top/sdk/qaz.js': 'QAZ+ABC+ALICE+BOB+BOB\n',
      '/top/sdk/foo.js': '// custom-foo\nFOO\n  BAR\n// END\n',

      '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
    })
  })



  test('inject', async () => {
    const { fs, vol } = memfs({
      '/top/foo.txt': 'FOO\n#--START--#\nBAR\n#--END--#\nZED',
    })

    const jostraca = Jostraca()

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((props: any) => {
        Project({}, () => {
          Inject({ name: 'foo.txt' }, () => {
            Content('QAZ')
          })
        })
      })
    )

    const voljson: any = vol.toJSON()

    expect(voljson).equal({
      '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],

      '/top/foo.txt': 'FOO\n#--START--#\nQAZ\n#--END--#\nZED',
    })
  })



  test('line', async () => {
    const { fs, vol } = memfs({
    })

    const jostraca = Jostraca()

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((props: any) => {
        Project({}, () => {
          File({ name: 'foo.txt' }, () => {
            Content('ONE\n')
            Line('TWO')
            Content('THREE\n')
          })
        })
      })
    )

    const voljson: any = vol.toJSON()

    expect(voljson).equal({
      '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],

      '/top/foo.txt': 'ONE\nTWO\nTHREE\n',
    })
  })


  test('fragment-subcmp', async () => {
    const { fs, vol } = memfs({
      '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n'
    })

    const Foo = cmp(function Foo(props: any) {
      Content('FOO[')
      Content(props.arg)
      Content(']')
    })


    const jostraca = Jostraca({
      model: { a: 'A' }
    })

    const info = await jostraca.generate(
      {
        fs: () => fs, folder: '/top',
        // build: false
      },
      cmp((props: any) => {

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

    // console.dir(info.root, { depth: null })

    const voljson: any = vol.toJSON()

    expect(voljson).equal({
      '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
      '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n',
      '/top/foo.txt': 'ONE\nTWO-A-BAR-ZED-CON-FOO[B]+S\nTHREE\n',
    })
  })



  test('custom-cmp', async () => {
    const Foo = cmp(function Foo(props: any, children: any) {
      const { ctx$: { model } } = props
      Content(`FOO[$$a$$:${props.b}`)
      each(model.foo, (foo) => each(children, { call: true, args: foo }))
      Content(']')
    })


    const jostraca = Jostraca({
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

    // console.dir(info.root, { depth: null })

    const voljson: any = info.vol.toJSON()

    expect(voljson).equal({
      '/f01.txt': '<foo>',
      '/foo.txt': '{<FOO[A:B:a=(11):b=(22)]>}',
      '/.jostraca/jostraca.json.log': voljson['/.jostraca/jostraca.json.log'],
    })
  })


  test('existing-file', async () => {
    const jostraca = Jostraca({
      mem: true,
      vol: {
        '/f01.txt': 'a0',
        '/h01.txt': 'c0',
      }
    })

    const info0 = await jostraca.generate(
      { folder: '/', existing: { write: false } },
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

    const voljson0: any = info0.vol.toJSON()

    expect(voljson0).equal({
      '/f01.txt': 'a0',
      '/g01.txt': 'b1',
      '/h01.txt': 'c0',
      '/.jostraca/jostraca.json.log': voljson0['/.jostraca/jostraca.json.log'],
    })


    const info1 = await jostraca.generate(
      { folder: '/', existing: { preserve: true } },
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

    const voljson1: any = info1.vol.toJSON()

    expect(voljson1).equal({
      '/f01.txt': 'a1',
      '/f01.old.txt': 'a0',
      '/h01.txt': 'c0',
      '/.jostraca/jostraca.json.log': voljson1['/.jostraca/jostraca.json.log'],
    })



    const info2 = await jostraca.generate(
      { folder: '/', existing: { write: false, present: true } },
      cmp(() => {
        Project({}, () => {
          File({ name: 'f01.txt' }, () => {
            Content('a1')
          })
        })
      })
    )

    const voljson2: any = info2.vol.toJSON()

    expect(voljson2).equal({
      '/f01.txt': 'a0',
      '/f01.new.txt': 'a1',
      '/h01.txt': 'c0',
      '/.jostraca/jostraca.json.log': voljson2['/.jostraca/jostraca.json.log'],
    })


  })


  test('existing-copy', async () => {
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

    const jostraca = Jostraca()

    const info = await jostraca.generate(
      {
        fs: () => fs, folder: '/top',
        existing: { merge: true },
        existingBinary: { preserve: true },
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

    // console.dir(info.file, { depth: null })

    expect(info.file).equal({
      write: [
        { path: '/top/p0/foo.txt', action: 'write' },
        { path: '/top/p0/haz.bin', action: 'write' },
        { path: '/top/p0/qaz.bin', action: 'write' }
      ],
      preserve: [{ path: '/top/p0/haz.bin', action: 'preserve' }],
      present: [],
      merge: [
        { path: '/top/p0/bar.txt', action: 'merge' },
        { path: '/top/p0/zed.txt', action: 'merge' }
      ]
    })

    const isowhen = new Date(info.when).toISOString()
    const voljson: any = vol.toJSON()
    // console.dir(voljson, { depth: null })


    expect(JSON.parse(voljson['/top/.jostraca/jostraca.json.log']).exclude).equal([])
    expect(voljson).equal({
      '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],
      '/top/tm0/foo.txt': 'F0\nF1\nF2\n',
      '/top/tm0/bar.txt': 'B0\nB1\nB2\n',
      '/top/tm1/zed.txt': 'Z0\nZ1\nZ2\n',
      '/top/tm2/qaz.bin': '\x00\x01\x02\x03\x04',
      '/top/tm2/haz.bin': '\x05\x06\x07\b\t',
      '/top/p0/bar.txt': 'B0\n' +
        '<<<<<< EXISTING: ' + isowhen + '\n' +
        'B8\n' +
        'B9\n' +
        '>>>>>> EXISTING: ' + isowhen + '\n' +
        '<<<<<< GENERATED: ' + isowhen + '\n' +
        'B1\n' +
        'B2\n' +
        '>>>>>> GENERATED: ' + isowhen + '\n',
      '/top/p0/zed.txt': 'Z0\n' +
        '<<<<<< EXISTING: ' + isowhen + '\n' +
        'Z7\n' +
        'Z8\n' +
        'Z9>>>>>> EXISTING: ' + isowhen + '\n' +
        '<<<<<< GENERATED: ' + isowhen + '\n' +
        'Z1\n' +
        'Z2\n' +
        '>>>>>> GENERATED: ' + isowhen + '\n',
      '/top/p0/foo.txt': 'F0\nF1\nF2\n',
      '/top/p0/qaz.bin': '\x00\x01\x02\x03\x04',
      '/top/p0/haz.bin': '\x05\x06\x07\b\t',
      '/top/p0/haz.old.bin': '\t\b\x07\x06\x05',
    })
  })


  test('protect', async () => {
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

    const jostraca = Jostraca()

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((props: any) => {
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

    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson['/top/.jostraca/jostraca.json.log']).exclude).equal([])
    expect(voljson).equal({
      '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],

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

