

import type { Node } from '../jostraca'

import { cmp, each } from '../jostraca'


/**
 * The props `Project` reads.
 *
 * Also bound for the children: a Project calls each of its children with
 * its own props, so `({folder}) => ...` inside one reads the same object
 * the Project was given.
 */
type ProjectProps = {

  /** Names the project, and joins the node path. No output of its own. */
  name?: string

  /**
   * Output folder, joined to the run's folder. A tree is refused an
   * absolute path or a `..` segment.
   */
  folder?: string
}


const Project = cmp<ProjectProps>(function Project(props, children) {
  const node: Node = props.ctx$.node

  node.kind = 'project'
  node.name = props.name
  node.folder = props.folder

  each(children, { call: true, args: props })
})



export {
  Project
}

export type {
  ProjectProps
}
