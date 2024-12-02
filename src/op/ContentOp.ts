
import type { Node } from '../jostraca'

import { indent } from '../jostraca'


const ContentOp = {
  before(node: Node, _ctx$: any, buildctx: any) {
    const content = buildctx.current.content = node

    let src = content.content as unknown as string
    if (null != node.indent) {
      src = indent(src, node.indent)
    }

    buildctx.current.file.content.push(src)
  },

  after(_node: Node, _ctx$: any, _buildctx: any) {
  },
}


export {
  ContentOp
}

