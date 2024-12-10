
import type { Node } from '../jostraca'

import { cmp } from '../jostraca'

import { Gubu, One, Optional, Check } from 'gubu'


const From = (from: any, _: any, s: any) => s.ctx.fs.statSync(from)

const CopyShape = Gubu({
  ctx$: Object,
  name: Optional(String),
  from: Check(From).String(),
  exclude: Optional(One(Boolean, [String]))
}, { name: 'Copy' })


type CopyProps = ReturnType<typeof CopyShape>

const Copy = cmp(function Copy(props: CopyProps, _children: any) {
  props = CopyShape(props, { fs: props.ctx$.fs })

  const node: Node = props.ctx$.node

  node.kind = 'copy'
  node.name = props.name
  node.from = props.from
  node.exclude = null == props.exclude ? node.exclude : props.exclude
})


export {
  Copy
}

