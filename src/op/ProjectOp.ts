
import Path from 'node:path'

import type { Node } from '../jostraca'


const ProjectOp = {

  before(node: Node, ctx$: any, buildctx: any) {
    // console.log('PROJECT-B', node.folder, ctx$.folder)

    node.folder = null == node.folder || '' === node.folder ? '.' : node.folder
    node.folder = Path.isAbsolute(node.folder) ? node.folder : Path.join(ctx$.folder, node.folder)

    // console.log('PROJECT-B folder', node.folder)

    buildctx.current.project = { node }
    buildctx.current.folder = {
      node,
      path: node.folder.split(Path.sep),
    }

    buildctx.fs.mkdirSync(node.folder, { recursive: true })
  },

  after(_node: Node, _ctx$: any, _buildctx: any) { },

}


export {
  ProjectOp
}
