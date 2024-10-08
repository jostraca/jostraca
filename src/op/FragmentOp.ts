
import Path from 'node:path'

import type { Node } from '../jostraca'


const FragmentOp = {

  before(node: Node, _ctx$: any, buildctx: any) {
  },


  after(node: Node, _ctx$: any, buildctx: any) {
    const { fs } = buildctx
    const frompath = node.from as string
    const src = fs.readFileSync(frompath, 'utf8')
    buildctx.current.file.content.push(src)
  },

}


export {
  FragmentOp
}
