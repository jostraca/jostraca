
import Path from 'node:path'

import type { Node } from '../jostraca'

import { cmp, template, each, escre, Content } from '../jostraca'

import { Gubu, One, Optional, Check } from 'gubu'


const From = (from: any, _: any, s: any) => s.ctx.fs().statSync(from)

const FragmentShape = Gubu({
  ctx$: Object,
  from: Check(From).String() as unknown as string,
  exclude: Optional(One(Boolean, [String])) as unknown as boolean | string[],
  indent: Optional(One(String, Number)),
  replace: {} as any,
}, { name: 'Fragment' })


type FragmentProps = ReturnType<typeof FragmentShape>


const Fragment = cmp(function Fragment(props: FragmentProps, children: any) {
  props = FragmentShape(props, { fs: props.ctx$.fs })

  const node: Node = props.ctx$.node

  node.kind = 'fragment'
  node.from = props.from
  node.indent = props.indent

  const replace = props.replace || {}


  const { folder, model } = props.ctx$
  const fs = props.ctx$.fs()
  let frompath = node.from as string

  // TODO: this is relative to the output - but that is just one case - provide more control?
  if (!Path.isAbsolute(frompath)) {
    frompath = Path.join(folder, ...node.path, frompath)
  }

  let src = fs.readFileSync(frompath, 'utf8')


  const slotnames: Record<string, boolean> = {}

  node.filter = (({ props, component }) =>
    (('Slot' === component.name ? slotnames[props.name] = true : null), false))
  each(children, { call: true })
  node.filter = undefined

  replace['/[ \\t]*[-<!/#*]*[ \\t]*<\\[SLOT]>[ \\t]*[->/#*]*[ \\t]*/'] =
    () => {
      node.filter = (({ component }) => 'Slot' !== component.name)
      each(children, { call: true })
      node.filter = undefined
    }

  each(slotnames, (slot: any) => {
    replace[
      '/[ \\t]*[-<!/#*]*[ \\t]*<\\[SLOT:' +
      escre(slot.key$) +
      ']>[ \\t]*[->/#*]*[ \\t]*/'
    ] = () => {
      node.filter = (({ props, component }) =>
        'Slot' === component.name && slot.key$ === props.name)
      each(children, { call: true })
      node.filter = undefined
    }
  })

  template(src, model, {
    replace,
    handle: (s?: string) => null == s ? null : Content(s)
  })
})


export {
  Fragment
}

