
import type { Node } from '../jostraca'

import { cmp, each } from '../jostraca'


const File = cmp(function File(props: any, children: any) {
  const node: Node = props.ctx$.node

  node.kind = 'file'
  node.name = props.name
  node.exclude = null == props.exclude ? node.exclude : !!props.exclude

  each(children, { call: true })
})



export {
  File
}
