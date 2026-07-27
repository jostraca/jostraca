
import type { Node } from '../jostraca'

import { cmp, each } from '../jostraca'


const File = cmp(function File(props: any, children: any) {
  const node: Node = props.ctx$.node

  node.kind = 'file'
  node.name = props.name
  node.exclude = null == props.exclude ? node.exclude : props.exclude

  // e.g. File({ name: 'run.sh', mode: 0o755 })
  node.mode = props.mode

  each(children, { call: true })
})



export {
  File
}
