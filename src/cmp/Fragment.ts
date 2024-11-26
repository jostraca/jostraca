
import type { Node } from '../jostraca'

import { cmp, each } from '../jostraca'


const Fragment = cmp(function Fragment(props: any, children: any) {
  const node: Node = props.ctx$.node

  node.kind = 'fragment'
  node.from = props.from
  node.indent = props.indent

  each(children, { call: true })
})


export {
  Fragment
}

