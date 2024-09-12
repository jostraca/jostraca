
import Path from 'node:path'

import type { Node } from '../jostraca'

import { getx } from '../jostraca'


const CopyOp = {

  before(node: Node, ctx$: any, buildctx: any) {
    const name = node.name
    const from = node.from

    // console.log('COPY START', node)
    if (from && name) {
      const state = {
        fileCount: 0,
        folderCount: 0,
        tmCount: 0,
        ctx$,
        buildctx,
      }
      walk(state, from, name)
      // console.log('COPY END', state)
    }
  },

  after(_node: Node, _ctx$: any, buildctx: any) {
  },

}


function walk(state: any, from: string, to: string) {
  const buildctx = state.buildctx
  const fs = buildctx.fs
  const entries = fs.readdirSync(from)

  for (let name of entries) {
    const frompath = Path.join(from, name)
    const topath = Path.join(to, name)
    const stat = fs.statSync(frompath)

    if (stat.isDirectory()) {
      state.folderCount++
      walk(state, frompath, topath)
    }
    else if (isTemplate(name)) {
      const src = fs.readFileSync(frompath, 'utf8')
      const out = genTemplate(state, src, { name, frompath, topath })
      // console.log('writeFileSync', frompath, topath)
      fs.mkdirSync(Path.dirname(topath), { recursive: true })
      fs.writeFileSync(topath, out, 'utf8')
      state.fileCount++
      state.tmCount++
    }
    else {
      // console.log('copyFileSync', frompath, topath)
      fs.mkdirSync(Path.dirname(topath), { recursive: true })
      fs.copyFileSync(frompath, topath)
      state.fileCount++
    }
  }
}


function isTemplate(name: string) {
  return name.match(/\.(ts|js|json|txt|xml|toml|yml|yaml|py|php|rb|go|java|c|cpp|cs|sh|bat)$/i)
}

// NOTE: $$foo.bar$$ format used as explicit start and end markers mean regex can be used
// unambiguously ($fooa would not match `foo`)
function genTemplate(
  state: any,
  src: any,
  spec: { name: string, frompath: string, topath: string }) {

  let model = state.ctx$.model // { foo: 'FOO', bar: 'BAR' }
  let out = ''
  let remain = src
  let nextm = true
  while (nextm) {
    let m = remain.match(/\$\$([^$]+)\$\$/)
    if (m) {
      let ref = m[1]
      out += remain.substring(0, m.index)
      let insert = getx(model, ref)
      if (null == insert) {
        out += '$$' + ref + '$$'
        remain = remain.substring(m.index + 4 + ref.length)
      }
      else {
        out += insert
        remain = remain.substring(m.index + 4 + ref.length)
      }
    }
    else {
      out += remain
      nextm = false
    }
  }
  return out
}

export {
  CopyOp
}
