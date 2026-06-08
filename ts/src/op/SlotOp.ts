
import Path from 'node:path'

import type { Node, BuildContext } from '../jostraca'


const SlotOp = {

  before(node: Node, _ctx$: any, buildctx: BuildContext) {
    node.meta.fragment_file = buildctx.current.file

    const cfile: any = buildctx.current.file = node
    cfile.filepath = buildctx.current.folder.path.join('/') + '?slot=' + node.name
    cfile.content = []
  },


  after(node: Node, _ctx$: any, buildctx: BuildContext) {
    let src = node.content?.join('') || ''

    buildctx.current.file = node.meta.fragment_file
    buildctx.current.file.content.push(src)
  },

}


export {
  SlotOp
}
