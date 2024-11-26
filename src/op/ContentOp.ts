

import type { Node } from '../jostraca'


const ContentOp = {
  before(node: Node, _ctx$: any, buildctx: any) {
    if (null == node.name) {
      const content = buildctx.current.content = node
      buildctx.current.file.content.push(content.content)
    }
    else {
      let contentMap =
        buildctx.current.file.meta.content_map = (buildctx.current.file.meta.content_map || {})
      contentMap[node.name] = (contentMap[node.name] || [])
      contentMap[node.name].push(node.content)
      // console.log('CN', node.name, contentMap)
    }
  },

  after(_node: Node, _ctx$: any, buildctx: any) { },
}


export {
  ContentOp
}
