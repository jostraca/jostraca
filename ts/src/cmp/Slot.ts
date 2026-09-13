
import type { Node } from '../jostraca'

import { cmp, each } from '../jostraca'


/** The props `Slot` reads. */
type SlotProps = {

  /**
   * Matches the `<[SLOT:name]>` marker in the enclosing Fragment. Absent
   * means the unnamed `<[SLOT]>` marker.
   */
  name?: string
}


const Slot = cmp<SlotProps>(function Slot(props, children) {
  const node: Node = props.ctx$.node
  node.kind = 'slot'
  node.name = props.name

  each(children, { call: true })
})


export {
  Slot
}

export type {
  SlotProps
}
