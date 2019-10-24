import Fs = require('fs')
const Mock = require('mock-fs')

import { expect, test } from '@oclif/test'

describe('generate', () => {
  /*
  var files: {[repo: string]: string[]} = {
    foo: [
      'aaa',
      'bbb',
      'fff',
      'ccc/ddd',
    ],
    bar: [
      'aaa',
      'bbb',
      'fff',
      'ccc/ddd',
    ],
    qaz: [
      'aaa',
      'bbb',
      'ccc/ddd',
    ]
  }

  var repos = ['foo', 'bar', 'qaz']


  function resolve_content() {
    var content: {[key:string]: any} = {}

    for (var repo of repos) {
      content[repo] = {}
      for (var file of files[repo]) {
        content[repo][file] = Fs.readFileSync(
          __dirname+'/../case-0/' + repo + '/' + file
        ).toString()
      }
    }

    return content
  }
  */

  test
    .command(['generate', '-c', __dirname + '/../case-0/system/jostraca'])
    .it('all', ctx => {
      expect(
        Fs.readFileSync(__dirname + '/../case-0/foo/aaa.txt').toString()
      ).equals('AAA foo\nX 1\n\n')
    })
})
