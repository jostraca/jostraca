
import type { Node } from '../jostraca'

import { cmp, each } from '../jostraca'


const Slot = cmp(function Slot(props: any, children: any) {
  const node: Node = props.ctx$.node
  node.kind = 'slot'
  node.name = props.name

  each(children, { call: true })
})


export {
  Slot
}

