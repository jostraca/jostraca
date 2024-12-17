
import type { Node } from '../jostraca'

import { cmp } from '../jostraca'

import { Gubu, One, Optional, Check } from 'gubu'


const From = (from: any, _: any, s: any) => s.ctx.fs().statSync(from)

const CopyShape = Gubu({
  ctx$: Object,

  // The From path is independent of the project folder.
  from: Check(From).String() as unknown as string,

  // output folder is current folder, this is an optional subfolder,
  // or if copying a file, the output filename, if different.
  to: Optional(String) as unknown as string,

  replace: {} as any,

  exclude: Optional(One(Boolean, [One(String, RegExp)])) as unknown as any
}, { name: 'Copy' })


type CopyProps = ReturnType<typeof CopyShape>

const Copy = cmp(function Copy(props: CopyProps, _children: any) {
  props = CopyShape(props, { fs: props.ctx$.fs })

  const node: Node = props.ctx$.node

  node.kind = 'copy'
  node.from = props.from

  // NOTE: props.to is used as the Node name 
  node.name = props.to

  node.exclude = null == props.exclude ? node.exclude : props.exclude

  node.replace = props.replace
})


export {
  Copy
}

