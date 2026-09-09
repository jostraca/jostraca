
import type { Node } from '../jostraca'

import { cmp, each, template, getx, Content, Line } from '../jostraca'


const ListItems = cmp(function ListItems(props: any, children: any) {
  const node: Node = props.ctx$.node
  node.kind = 'content'
  const indent = node.indent = props.indent

  const item = props.item

  // TODO: after cmp processing children should ALWAYS be an array
  children = Array.isArray(children) ? children : [children]

  // A STRING child is wrapped in a function that renders it, so it reaches
  // the same per-item `args` a function child does and can interpolate
  // `{item.path}` like one.
  //
  // `src` used to be missing from that Content call, so the string was
  // captured by the typeof test and then dropped on the floor: the wrapper
  // rendered an empty Content and a whole string child emitted nothing at
  // all. `ListItems({item: [...]}, 'n={item.n}\n')` produced just the trailing
  // newline. Nothing caught it because no fixture, test or doc example
  // passes a string child - the component reference documents only the
  // function form. See #44.
  children = children.map((child: any) =>
    'string' === typeof child ?
      ({ indent, replace }: any) => Content({ src: child, indent, replace }) :
      child)

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



// `List` is the name this component shipped under, kept as a
// DEPRECATED ALIAS for the reason CopyFiles keeps `Copy`. `ListItems`
// says what it does -- it renders its children once per element of
// `item` -- and matches the aontu function that drives it, where plain
// `list` was already taken by the list container kind.
const List = ListItems


export {
  ListItems,
  List,
}

