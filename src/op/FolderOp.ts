
import Path from 'node:path'

import type { Node, BuildContext } from '../jostraca'


const FolderOp = {

  before(node: Node, _ctx$: any, buildctx: BuildContext) {
    const cfolder = buildctx.current.folder = (buildctx.current.folder || {})

    cfolder.node = node
    cfolder.path = (0 < cfolder.path.length ? cfolder.path : [buildctx.current.folder.parent])
    cfolder.path.push(node.name as string)

    let fullpath = cfolder.path.join(Path.sep)

    if ('' !== fullpath) {
      // ctx$.fs().mkdirSync(fullpath, { recursive: true )}
      buildctx.fh.ensureFolder(fullpath)
    }
  },


  after(_node: Node, _ctx$: any, buildctx: any) {
    const cfolder = buildctx.current.folder
    cfolder.path.length = cfolder.path.length - 1
  },

}


export {
  FolderOp
}
