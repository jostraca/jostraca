
import Path from 'node:path'

import type { Node, BuildContext } from '../jostraca'

import { canonPath } from '../build/FileHandler'


const ProjectOp = {

  before(node: Node, ctx$: any, buildctx: BuildContext) {
    node.folder = null == node.folder || '' === node.folder ? '.' : node.folder
    // Folded, then joined and normalised, as canonPath orders it. Joining
    // first kept a backslash `..` segment (`p\..\q` became `out/p/../q`),
    // so the folder created a stray `out/p` beside the files' `out/q`.
    node.folder = canonPath(
      Path.isAbsolute(node.folder) ? node.folder : ctx$.folder + '/' + node.folder)

    // A Project's folder applies to its own subtree only. The enclosing
    // folder state is put back in after(), so a later sibling -- or the
    // Folder around a nested Project, which pops one segment when it
    // closes -- sees the path it had before. Without this a File after a
    // sibling Project landed in that Project's folder (#26), and a Project
    // two Folders deep left a path that popped above the output folder.
    node.meta.project_prev = {
      project: buildctx.current.project,
      node: buildctx.current.folder.node,
      path: buildctx.current.folder.path.slice(),
    }

    buildctx.current.project = { node }
    buildctx.current.folder.node = node
    buildctx.current.folder.path = node.folder.replace(/\/+$/, '').split('/')

    // ctx$.fs().mkdirSync(node.folder, { recursive: true })
    buildctx.fh.ensureFolder(node.folder)
  },

  after(node: Node, _ctx$: any, buildctx: BuildContext) {
    const prev = node.meta.project_prev
    buildctx.current.project = prev.project
    buildctx.current.folder.node = prev.node
    buildctx.current.folder.path = prev.path
  },
}


export {
  ProjectOp
}
