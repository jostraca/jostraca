
import { test, describe } from 'node:test'
import { expect } from '@hapi/code'

import { memfs } from 'memfs'


import {
  Jostraca,
  Project,
  Folder,
  File,
  Code,
  Copy,
} from '../'



describe('jostraca', () => {

  test('happy', async () => {
    expect(Jostraca).exist()

    const jostraca = Jostraca()
    expect(jostraca).exist()

    const { fs, vol } = memfs({})

    jostraca.generate(
      { fs, folder: '/top' },
      () => Project({}, () => {

        Folder({ name: 'js' }, () => {

          File({ name: 'foo.js' }, () => {
            Code('// custom-foo\n')
          })

          File({ name: 'bar.js' }, () => {
            Code('// custom-bar\n')
          })
        })

        Folder({ name: 'go' }, () => {

          File({ name: 'zed.go' }, () => {
            Code('// custom-zed\n')
          })
        })

      })
    )

    // console.dir(vol.toJSON(), { depth: null })

    expect(vol.toJSON()).equal({
      '/top/js/foo.js': '// custom-foo\n',
      '/top/js/bar.js': '// custom-bar\n',
      '/top/go/zed.go': '// custom-zed\n'
    })
  })


  test('copy', async () => {
    const { fs, vol } = memfs({
      '/tm/bar.txt': '// BAR TXT\n'
    })

    const jostraca = Jostraca()

    jostraca.generate(
      { fs, folder: '/top' },
      () => Project({}, () => {

        Folder({ name: 'js' }, () => {

          File({ name: 'foo.js' }, () => {
            Code('// custom-foo\n')
          })

          Copy({ from: '/tm/bar.txt', name: 'bar.txt' })
        })
      })
    )

    // console.dir(vol.toJSON(), { depth: null })

    expect(vol.toJSON()).equal({
      '/tm/bar.txt': '// BAR TXT\n',
      '/top/js/foo.js': '// custom-foo\n',
      '/top/js/bar.txt': '// BAR TXT\n',
    })
  })

})

