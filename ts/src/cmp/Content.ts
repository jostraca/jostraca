
import type { Node } from '../jostraca'

import { cmp, template } from '../jostraca'


// JSDOC RATHER THAN THE HOUSE `//` STYLE, here and in every other props
// type. `tsc` carries a `/** */` comment into the emitted `.d.ts` and
// drops a `//` one, so a line comment on a published prop is a comment
// the consumer never sees -- not in the declaration file, not on hover.
// The reasoning notes below the type stay `//`: they are for a reader of
// this file.

/**
 * The props `Content` reads.
 *
 * Text comes from one of three places, in this order: `arg`, where the
 * positional form `Content('text')` lands; then `src`; then a string
 * child, `Content({indent: 2}, 'text')`. The first one present wins, and
 * a `Content` with none of them writes nothing.
 */
type ContentProps = {

  /**
   * Source text, as the positional form leaves it. Outranks `src`.
   *
   * Declared `string` because text is what this is for. The runtime is
   * wider -- it stringifies whatever it is handed -- and a caller who
   * means to write a number should say so at the call site.
   */
  arg?: string

  /** Source text. Read when `arg` is absent. */
  src?: string

  /** Names the span, and joins the node path. No effect on output. */
  name?: string

  /** A number is that many spaces, a string is a literal prefix. */
  indent?: string | number

  /** Merged over the generate model, for this span only. */
  extra?: Record<string, any>

  /** Extra substitutions, keyed by a literal, a `/regexp/` or a `#Tag`. */
  replace?: Record<string, any>

  /**
   * Hand the bytes through untouched: no model substitution, and so
   * neither `extra` nor `replace`. Default false: templating is what
   * `Content` is for, and `raw` is for a caller holding final bytes from
   * somewhere else. See the note in the body for why an empty model is
   * not the same guard.
   */
  raw?: boolean
}


const Content = cmp<ContentProps, string, string>(function Content(props, children) {
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

export type {
  ContentProps
}
