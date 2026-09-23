
// File-handler behaviour pinned across both stacks. Each test here has a
// Go twin; the names match the regression rows recorded for the port.

import { test, describe } from 'node:test'
import { expect } from './expect'

import { memfs } from '../dist/util/memfs'

import {
  Jostraca,
  Project,
  Folder,
  File,
  Content,
  Copy,
  Inject,
  cmpTree,
} from '../'


const NOW = 1735689600000

const META = '/out/.jostraca/jostraca.meta.log'

const quiet = {
  trace: () => { }, debug: () => { }, info: () => { },
  warn: () => { }, error: () => { }, fatal: () => { },
}


function metaOf(fs: any, path = META) {
  return JSON.parse(fs.readFileSync(path, 'utf8'))
}


describe('filehandler', () => {

  // A JOSTRACA_PROTECT marker protects a target whatever its
  // classification: text, binary by extension, or binary by content.
  test('binary-protect', async () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff])

    const runs: [string, any, () => void][] = [
      ['file', {}, () => Project({}, () => {
        File({ name: 'a.png' }, () => Content('P2'))
      })],
      ['copy-one', {}, () => Project({}, () => {
        Copy({ from: '/src/one/a.png', to: 'a.png' })
      })],
      ['copy-tree', {}, () => Project({}, () => {
        Copy({ from: '/src/tree' })
      })],
      ['file-preserve', { existing: { bin: { preserve: true } } },
        () => Project({}, () => {
          File({ name: 'a.png' }, () => Content('P2'))
        })],
      ['copy-preserve', { existing: { bin: { preserve: true } } },
        () => Project({}, () => {
          Copy({ from: '/src/one/a.png', to: 'a.png' })
        })],
    ]

    for (const [name, opts, root] of runs) {
      const { fs } = memfs({
        '/src/one/a.png': PNG,
        '/src/tree/a.png': PNG,
        '/out/a.png': 'JOSTRACA_PROTECT',
      })
      const res = await Jostraca({ now: () => NOW, log: quiet })
        .generate({ fs: () => fs, folder: '/out', ...opts }, root)

      expect(fs.readFileSync('/out/a.png', 'utf8')).equal('JOSTRACA_PROTECT')
      expect(res.files.written).equal([])
      expect(res.files.preserved).equal([])
      expect(fs.existsSync('/out/a.old.png')).equal(false)

      const entry = metaOf(fs).files['a.png']
      expect({ name, action: entry.action, protect: entry.protect })
        .equal({ name, action: 'skip', protect: true })
    }
  })


  // Inject exclude is coerced with `!!props.exclude`: any truthy value
  // skips the injection, whatever it names.
  test('inject-exclude-truthy', async () => {
    const seed = 'a\n#--START--#\nold\n#--END--#\nz\n'
    const injected = 'a\n#--START--#\nNEW\n#--END--#\nz\n'

    const typed = (ex: any) => () => Project({}, () => {
      Inject({ name: 't.txt', exclude: ex }, () => Content('NEW'))
    })
    const tree = (ex: any) => cmpTree({
      cmp: 'Project', props: {},
      children: [{
        cmp: 'Inject', props: { name: 't.txt', exclude: ex },
        children: [{ cmp: 'Content', props: { src: 'NEW' } }],
      }],
    })

    const run = async (root: any) => {
      const { fs } = memfs({ '/out/t.txt': seed })
      const res = await Jostraca({ now: () => NOW, log: quiet })
        .generate({ fs: () => fs, folder: '/out' }, root)
      return { res, fs }
    }

    for (const ex of [true, 'other', [], ['other'], {}, 1, -1]) {
      for (const root of [typed(ex), tree(ex)]) {
        const { res, fs } = await run(root)
        expect({ ex, t: fs.readFileSync('/out/t.txt', 'utf8') })
          .equal({ ex, t: seed })
        expect(res.files.written).equal([])
        expect(fs.existsSync('/out/.jostraca/generated/t.txt')).equal(false)
        if (fs.existsSync(META)) {
          expect(metaOf(fs).files['t.txt']).equal(undefined)
        }
      }
    }

    for (const ex of [false, '', 0]) {
      for (const root of [typed(ex), tree(ex)]) {
        const { fs } = await run(root)
        expect({ ex, t: fs.readFileSync('/out/t.txt', 'utf8') })
          .equal({ ex, t: injected })
      }
    }
  })

})
