
import type { Node } from '../jostraca'

import { cmp } from '../jostraca'

import { Gubu, One, Optional, Check } from 'gubu'


const From = (from: any, _: any, s: any) => s.ctx.meta.fs().statSync(from)

const CopyShape = Gubu({
  ctx$: Object,

  // The From path is independent of the project folder.
  from: Check(From).String() as unknown as string,
  //from: String,

  // output folder is current folder, this is an optional subfolder,
  // or if copying a file, the output filename, if different.
  to: Optional(String) as unknown as string,

  replace: {} as any,

  exclude: Optional(One(Boolean, [One(String, RegExp)])) as unknown as any
}, { name: 'Copy' })


type CopyProps = ReturnType<typeof CopyShape>

const Copy = cmp(function Copy(props: CopyProps, _children: any) {
  const ctx = props.ctx$
  const node: Node = ctx.node

  props = CopyShape(props, {
    prefix: `(${ctx.model.name}: ${node.path.join('/')})`,
    meta: { fs: props.ctx$.fs },

    // TODO: expand this to support a file extract and/or source mapping back to ts
    suffix: () => {
      const errstk: any = new Error()
      const lines = errstk.stack.split('\n')
        .filter((n: string) => !n.includes('/gubu/'))
        .filter((n: string) => !n.includes('/jostraca/'))
      return '[' + (lines[1] || '').trim() + ']'
    }
  })

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

