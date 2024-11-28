
import type { Node } from '../jostraca'

import { cmp } from '../jostraca'


const Copy = cmp(function Copy(props: any, _children: any) {
  const node: Node = props.ctx$.node
  node.kind = 'copy'
  node.name = props.name
  node.from = props.from
  node.exclude = null == props.exclude ? node.exclude : props.exclude
})


export {
  Copy
}

