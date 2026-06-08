
import type { Node } from '../jostraca'

import { indent } from '../jostraca'


const FragmentOp = {

  before(node: Node, _ctx$: any, buildctx: any) {
    node.meta.fragment_file = buildctx.current.file

    const cfile: any = buildctx.current.file = node
    cfile.fullpath = buildctx.current.folder.path.join('/') + '?fragment=' + node.name
    cfile.content = []
  },


  after(node: Node, _ctx$: any, buildctx: any) {
    let src = node.content?.join('') || ''

    if (null != node.indent) {
      src = indent(src, node.indent)
    }

    buildctx.current.file = node.meta.fragment_file
    buildctx.current.file.content.push(src)
  },

}


export {
  FragmentOp
}
