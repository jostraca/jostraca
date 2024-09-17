
import type { Node } from '../utility'

import { cmp, each } from '../jostraca'


const File = cmp(function File(props: any, children: any) {
  const node: Node = props.ctx$.node

  node.kind = 'file'
  node.name = props.name

  each(children)
})



export {
  File
}
