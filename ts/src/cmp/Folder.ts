

import type { Node } from '../jostraca'

import { cmp, each } from '../jostraca'


/** The props `Folder` reads. */
type FolderProps = {

  /**
   * One or more path segments below the enclosing folder. A `..` segment
   * is refused. Absent adds no segment, which makes a Folder a plain
   * grouping of its children.
   */
  name?: string
}


const Folder = cmp<FolderProps>(function Folder(props, children) {
  const node: Node = props.ctx$.node

  node.kind = 'folder'
  node.name = props.name

  each(children, { call: true })
})



export {
  Folder
}

export type {
  FolderProps
}
