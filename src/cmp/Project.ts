

import type { Node } from '../utility'

import { cmp, each } from '../jostraca'


const Project = cmp(function Project(props: any, children: any) {
  const node: Node = props.ctx$.node

  node.kind = 'project'
  node.name = props.name
  node.folder = props.folder

  each(children)
})



export {
  Project
}
