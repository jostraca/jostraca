
import type { Node } from '../jostraca'

import { cmp } from '../jostraca'


const Fragment = cmp(function Fragment(props: any, _children: any) {
  const node: Node = props.ctx$.node

  node.kind = 'fragment'
  node.from = props.from
  node.indent = props.indent
})


export {
  Fragment
}

