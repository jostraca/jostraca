
import Path from 'node:path'

import type { Node } from '../jostraca'

import { cmp, template, each, escre, Content } from '../jostraca'


const Fragment = cmp(function Fragment(props: any, children: any) {
  const node: Node = props.ctx$.node

  node.kind = 'fragment'
  node.from = props.from
  node.indent = props.indent

  const replace = props.replace || {}


  const { fs, folder, model } = props.ctx$
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

