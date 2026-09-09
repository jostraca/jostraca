
import type { Node } from '../jostraca'

import { cmp, template } from '../jostraca'


const Line = cmp(function Line(props: any, children: any) {
  const node: Node = props.ctx$.node
  node.kind = 'content'
  node.indent = props.indent

  let src = null != props.arg ? props.arg :
    null != props.src ? props.src :
      'string' === typeof children ? children : ''

  src += '\n'

  // THE SAME RENDER AS `Content`, and it was not: this passed the model
  // alone, so `props.replace` and `props.extra` were dropped on the
  // floor. A `Line` inside a `List` therefore emitted `{item.n}`
  // verbatim where a `Content` in the same position substituted, and
  // nothing said why -- the two components are a terminator apart and
  // nothing documented a second difference.
  //
  // THE GO PORT WAS ALREADY RIGHT: `LineP` delegates to `ContentP`,
  // which merges `Extra` and forwards `Replace`. So this is the case
  // AGENTS.md names -- the port pre-empting a latent TS bug -- and the
  // fix goes into TypeScript with Go left alone.
  const model = {
    ...props.ctx$.model,
    ...(props.extra || {}),
  }

  src = template(src, model, {
    replace: props.replace
  })
  node.content = src
  node.name = props.name
})



export {
  Line
}

