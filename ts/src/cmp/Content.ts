
import type { Node } from '../jostraca'

import { cmp, template } from '../jostraca'


const Content = cmp(function Content(props: any, children: any) {
  const node: Node = props.ctx$.node
  node.kind = 'content'
  node.indent = props.indent

  let src = null != props.arg ? props.arg :
    null != props.src ? props.src :
      'string' === typeof children ? children : ''

  // RAW HANDS THE BYTES THROUGH UNTOUCHED. Without it `template` runs
  // unconditionally, so a `$$...$$` sequence in content jostraca did
  // not author is substituted from the generate model -- wrong output,
  // exit 0, no diagnostic. A shell script, a makefile, a doc comment or
  // a regex carrying `$$` is corrupted in silence.
  //
  // AN EMPTY MODEL IS NOT THE SAME GUARD, which is the part that is
  // easy to get wrong: `$$"quoted"$$` renders its own literal and
  // `$$__JOSTRACA_REPLACE__$$` renders the matcher, both with no model
  // at all. Only skipping the render is skipping the render.
  //
  // TEMPLATING STAYS THE DEFAULT. Every generator that writes its
  // content at the call site wants the model in scope -- that is what
  // Content is for -- so `raw` is opt-in, for the caller who holds
  // final bytes and wants them delivered as they are.
  //
  // `replace` and `extra` go with it: they are inputs to the render
  // that is not happening. `indent` does NOT -- it is placement, not
  // substitution, and is applied to raw content exactly as to rendered.
  if (true === props.raw) {
    src = null == src ? '' : '' + src
  }
  else {
    let model = {
      ...props.ctx$.model,
      ...(props.extra || {})
    }

    src = template(src, model, {
      replace: props.replace
    })
  }

  node.content = src
  node.name = props.name
})



export {
  Content
}
