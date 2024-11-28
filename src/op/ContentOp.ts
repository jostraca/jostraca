

import type { Node } from '../jostraca'


const ContentOp = {
  before(node: Node, _ctx$: any, buildctx: any) {
    const content = buildctx.current.content = node
    buildctx.current.file.content.push(content.content)
  },

  after(_node: Node, _ctx$: any, buildctx: any) { },
}


export {
  ContentOp
}
