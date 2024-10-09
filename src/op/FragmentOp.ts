
import Path from 'node:path'

import type { Node } from '../jostraca'


const FragmentOp = {

  before(node: Node, _ctx$: any, buildctx: any) {
  },


  after(node: Node, _ctx$: any, buildctx: any) {
    const { fs } = buildctx
    const frompath = node.from as string
    let src = fs.readFileSync(frompath, 'utf8')

    if ('string' === typeof node.indent) {
      src = src.replace(/([^\n]+\n)/g, node.indent + '$1')
    }

    buildctx.current.file.content.push(src)
  },

}


export {
  FragmentOp
}
