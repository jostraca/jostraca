
import type { Node } from '../jostraca'

import { cmp, template } from '../jostraca'


const Content = cmp(function Content(props: any, children: any) {
  const node: Node = props.ctx$.node
  node.kind = 'content'
  node.indent = props.indent

  let src = null != props.arg ? props.arg :
    null != props.src ? props.src :
      'string' === typeof children ? children : ''

  src = template(src, props.ctx$.model, {
    replace: props.replace
  })

  node.content = src
  node.name = props.name
})



export {
  Content
}

