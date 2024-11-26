
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


  test('fragment', async () => {
    const { fs, vol } = memfs({
      '/tmp/foo.txt': 'FOO\n',
      '/tmp/bar.txt': 'BAR\n',
      '/tmp/zed.txt': 'ZED <[SLOT]> \n',
      '/tmp/qaz.txt': 'QAZ <[SLOT:alice]> - <[SLOT:bob]> \n',
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
              Content({ name: 'bob' }, 'B')
              Content({ name: 'alice' }, 'ALICE')
              Content({ name: 'bob' }, 'OB')
            })
          })

        })
      })
    )

    const voljson: any = vol.toJSON()

    expect(voljson).equal({
      '/top/.jostraca/jostraca.json.log': voljson['/top/.jostraca/jostraca.json.log'],

      '/tmp/foo.txt': 'FOO\n',
      '/tmp/bar.txt': 'BAR\n',

      '/tmp/zed.txt': 'ZED <[SLOT]> \n',
      '/top/sdk/bar.js': 'ZED red \n',

      '/tmp/qaz.txt': 'QAZ <[SLOT:alice]> - <[SLOT:bob]> \n',
      '/top/sdk/qaz.js': 'QAZ ALICE - BOB \n',

      '/top/sdk/foo.js': '// custom-foo\nFOO\n  BAR\n// END\n',
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


})

