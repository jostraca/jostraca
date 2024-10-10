
import type { Node } from '../jostraca'

import { cmp, each } from '../jostraca'


const Inject = cmp(function Inject(props: any, children: any) {
  const node: Node = props.ctx$.node

  node.kind = 'inject'
  node.name = props.name
  node.meta.markers = props.markers || ['#--START--#\n', '\n#--END--#']
  node.exclude = null == props.exclude ? node.exclude : !!props.exclude

  each(children, { call: true })
})



export {
  Inject
}
