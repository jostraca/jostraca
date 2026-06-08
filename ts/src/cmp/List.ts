
import type { Node } from '../jostraca'

import { cmp, each, template, getx, Content, Line } from '../jostraca'


const List = cmp(function List(props: any, children: any) {
  const node: Node = props.ctx$.node
  node.kind = 'content'
  const indent = node.indent = props.indent

  const item = props.item

  // TODO: after cmp processing children should ALWAYS be an array
  children = Array.isArray(children) ? children : [children]

  children = children.map((child: any) =>
    'string' === typeof child ?
      ({ indent, replace }: any) => Content({ indent, replace }) : child)

  each(item, (item: any) => each(children, {
    call: true, args: {
      item,
      indent,

      // TODO: test!
      replace: {
        '/{item(\\.(?<path>[^}]+))?}/': ({ path }: any) => getx(item, path)
      }
    }
  }))

  if (false !== props.line) {
    Line('')
  }
})



export {
  List
}

