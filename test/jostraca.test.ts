
import { test, describe } from 'node:test'
import { expect } from '@hapi/code'

import { memfs } from 'memfs'


import {
  Jostraca
} from '../'



describe('jostraca', () => {

  test('happy', async () => {
    expect(Jostraca).exist()

    const jostraca = Jostraca()
    expect(jostraca).exist()

    const { Project, Folder, File, Code } = jostraca

    // console.log('QQQ', Project, jostraca)

    const { fs, vol } = memfs({})

    // console.log('MEMFS', fs, vol)
    // return;

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
      '/top/js/foo.js': '// FILE START: foo.js\n// custom-foo\n// FILE END: foo.js\n',
      '/top/js/bar.js': '// FILE START: bar.js\n// custom-bar\n// FILE END: bar.js\n',
      '/top/go/zed.go': '// FILE START: zed.go\n// custom-zed\n// FILE END: zed.go\n'
    })
  })

})

