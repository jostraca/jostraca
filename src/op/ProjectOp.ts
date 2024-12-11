
import Path from 'node:path'

import type { Node, BuildContext } from '../jostraca'


const ProjectOp = {

  before(node: Node, ctx$: any, buildctx: BuildContext) {
    node.folder = null == node.folder || '' === node.folder ? '.' : node.folder
    node.folder = Path.isAbsolute(node.folder) ? node.folder : Path.join(ctx$.folder, node.folder)

    buildctx.current.project = { node }
    buildctx.current.folder.node = node
    buildctx.current.folder.path = node.folder.split(Path.sep)

    ctx$.fs().mkdirSync(node.folder, { recursive: true })
  },

  after(_node: Node, _ctx$: any, _buildctx: any) { },
}


export {
  ProjectOp
}
