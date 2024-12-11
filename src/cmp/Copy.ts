
import type { Node } from '../jostraca'

import { cmp } from '../jostraca'

import { Gubu, One, Optional, Check } from 'gubu'


const From = (from: any, _: any, s: any) => s.ctx.fs.statSync(from)

const CopyShape = Gubu({
  ctx$: Object,
  name: Optional(String) as unknown as string,
  from: Check(From).String() as unknown as string,
  to: Optional(String) as unknown as string,
  exclude: Optional(One(Boolean, [One(String, RegExp)])) as unknown as any
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

