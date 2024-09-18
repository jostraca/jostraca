
import Path from 'node:path'

import type { Node } from '../jostraca'


const ProjectOp = {

  before(node: Node, ctx$: any, buildctx: any) {
    node.folder = (node.folder ||
      ctx$.folder + '/__project__' || // Fake current folder, so Folder cmp will work
      '.') as string

    buildctx.current.project = { node }
    buildctx.current.folder = {
      node,
      path: Path.dirname(node.folder).split(Path.sep),
    }
  },

  after(_node: Node, _ctx$: any, _buildctx: any) { },

}


export {
  ProjectOp
}
