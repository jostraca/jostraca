

import type { Node } from '../utility'

import { cmp, each } from '../jostraca'


const Folder = cmp(function Folder(props: any, children: any) {
  const node: Node = props.ctx$.node

  node.kind = 'folder'
  node.name = props.name

  each(children)
})



export {
  Folder
}
