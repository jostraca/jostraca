
import type { Node } from '../utility'

import { cmp } from '../jostraca'


const Copy = cmp(function Copy(props: any, _children: any) {
  const node: Node = props.ctx$.node

  node.kind = 'copy'
  node.name = props.name
  node.from = props.from
})



export {
  Copy
}

