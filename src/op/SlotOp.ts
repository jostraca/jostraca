
import Path from 'node:path'

import type { Node } from '../jostraca'


const SlotOp = {

  before(node: Node, _ctx$: any, buildctx: any) {
    node.meta.fragment_file = buildctx.current.file

    const cfile: any = buildctx.current.file = node
    cfile.filepath = buildctx.current.folder.path.join('/') + '?slot=' + node.name
    cfile.content = []
  },


  after(node: Node, ctx$: any, buildctx: any) {
    let src = node.content?.join('') || ''

    buildctx.current.file = node.meta.fragment_file
    buildctx.current.file.content.push(src)
  },

}


export {
  SlotOp
}
