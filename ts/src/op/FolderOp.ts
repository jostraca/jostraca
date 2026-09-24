
import Path from 'node:path'

import type { Node, BuildContext } from '../jostraca'

import { canonPath, validName } from '../build/FileHandler'


const ON = 'FolderOp:'

const FolderOp = {

  before(node: Node, _ctx$: any, buildctx: BuildContext) {
    const cfolder = buildctx.current.folder = (buildctx.current.folder || {})

    validName(node.name, 'Folder', ON + 'before:')

    cfolder.node = node
    cfolder.path = (0 < cfolder.path.length ? cfolder.path : [buildctx.current.folder.parent])
    cfolder.path.push(node.name as string)

    let fullpath = cfolder.path.join('/')

    if ('' !== fullpath) {
      // Canonical, as FileOp's paths are: a backslash in a name is a
      // separator, so `x\y` must not also leave a literal `x\y` folder.
      buildctx.fh.ensureFolder(canonPath(fullpath))
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
