
import Path from 'node:path'


import { getx } from '../jostraca'


const CopyOp = {

  before(node: Node, ctx: any) {
    const name = ctx.node.name
    const from = ctx.node.from


  },

  after(_node: Node, _ctx: any) {
  },

}


function walk(ctx: any, from: string, to: string) {
  const fs = ctx.fs
  const entries = fs.readdirSync(from)

  for (let name of entries) {
    const frompath = Path.join(from, name)
    const topath = Path.join(to, name)
    const stat = fs.statSync(frompath)

    if (stat.isDirectory()) {
      walk(ctx, frompath, topath)
    }
    else if (isTemplate(name)) {
      const src = fs.readFileSync(frompath, 'utf8')
      const out = genTemplate(ctx, src, { name, frompath, topath })
    }
    else {
      fs.copyFileSync(frompath, topath)
    }
  }
}


function isTemplate(name: string) {
  return name.match(/\.(ts|js|json|txt|xml|toml|yml|yaml|py|php|rb|go|java|c|cpp|cs|sh|bat)$/i)
}

// NOTE: $$foo.bar$$ format used as explicit start and end markers mean regex can be used
// unambiguously ($fooa would not match `foo`)
function genTemplate(
  ctx: any,
  src: any,
  spec: { name: string, frompath: string, topath: string }) {

  let model = { foo: 'FOO', bar: 'BAR' }
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
