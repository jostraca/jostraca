
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
} from '../'



describe('jostraca', () => {

  test('happy', async () => {
    expect(Jostraca).exist()

    const jostraca = Jostraca()
    expect(jostraca).exist()

    const { fs, vol } = memfs({})

    const info = await jostraca.generate(
      { fs, folder: '/top' },
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
      { fs, folder: '/top' },
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

    const jostraca = Jostraca()

    const info = await jostraca.generate(
      { fs, folder: '/top' },
      cmp((props: any) => {
        props.ctx$.model = {
          x: { y: 'Y', z: 'Z' }
        }
        Project({ folder: 'sdk' }, () => {

          Folder({ name: 'js' }, () => {

            File({ name: 'foo.js' }, () => {
              Content('// custom-foo\n')
            })

            Copy({ from: '/tm/bar.txt', name: 'bar.txt' })
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
      { fs, folder: '/top' },
      cmp((props: any) => {
        props.ctx$.model = {}

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
      { fs, folder: '/top' },
      cmp((props: any) => {
        props.ctx$.model = {}

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
      { fs, folder: '/top' },
      cmp((props: any) => {
        props.ctx$.model = {}

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


    const jostraca = Jostraca()

    const info = await jostraca.generate(
      {
        fs, folder: '/top',
        // build: false
      },
      cmp((props: any) => {
        props.ctx$.model = {
          a: 'A'
        }

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



})

