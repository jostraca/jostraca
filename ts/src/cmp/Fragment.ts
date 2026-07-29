
import Path from 'node:path'

import type { Node } from '../jostraca'

import { cmp, template, each, escre, Content } from '../jostraca'

import { Shape, One, Optional, Check, Empty } from 'shape'


const From = (from: any, _: any, s: any) => s.ctx.fs().statSync(from)

const FragmentShape = Shape({
  ctx$: Object,
  from: Check(From).String() as unknown as string,
  exclude: Optional(One(Boolean, [String])) as unknown as boolean | string[],
  indent: Optional(One(Empty(String), Number)),
  replace: {} as any,
  eject: Optional([One(String, RegExp)]) as unknown as any[]
}, { name: 'Fragment' })


type FragmentProps = ReturnType<typeof FragmentShape>


const Fragment = cmp(function Fragment(props: FragmentProps, children: any) {
  // Resolve a relative `from` BEFORE validating.
  //
  // The `from` check stats the path, and it used to stat the raw relative
  // string — so it resolved against the process CWD and a relative `from`
  // threw a validation error no matter where the file actually was. The
  // resolution further down (which joined `node.path`, and so looked under
  // the *enclosing file's name* as though it were a directory) was
  // unreachable.
  //
  // Relative paths now resolve against the output folder, which is
  // predictable and matches the Go port.
  if ('string' === typeof (props as any).from && !Path.isAbsolute((props as any).from)) {
    props = { ...props, from: Path.join((props as any).ctx$.folder, (props as any).from) } as any
  }

  props = FragmentShape(props, { fs: props.ctx$.fs })

  const node: Node = props.ctx$.node

  node.kind = 'fragment'
  node.from = props.from
  node.indent = props.indent

  const replace = props.replace || {}


  const { model } = props.ctx$
  const fs = props.ctx$.fs()

  // Already absolute by here: resolved above, before validation.
  const frompath = node.from as string

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
    eject: props?.eject,
    handle: (s?: string) => null == s ? null : Content(s)
  })
})


export {
  Fragment
}

