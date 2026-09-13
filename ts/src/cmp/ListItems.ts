
import type { Node } from '../jostraca'

import { cmp, each, getx, Content, Line } from '../jostraca'


/** The props `ListItems` reads. */
type ListItemsProps = {

  /**
   * Walked once per element, with each element bound as `item` for the
   * children. An array is walked in order; an object is walked by value,
   * each value carrying its own key.
   */
  item?: any[] | Record<string, any>

  /**
   * `false` suppresses the blank line written after the last item.
   * Default true.
   */
  line?: boolean

  /**
   * Set on the node and bound for the children, so a child can apply it
   * itself. A number is that many spaces, a string is a literal prefix.
   */
  indent?: string | number
}


/**
 * What one child of a `ListItems` is called with.
 *
 * A child's argument, not its props: the parent binds these for one
 * invocation, and the child takes them as its parameter and passes on
 * whichever it wants.
 *
 * ```
 * ListItems({ item: entities, indent: 2 }, ({ item, indent, replace }) =>
 *   Line({ src: '{item.name}: {item.kind}', indent, replace }))
 * ```
 *
 * The Go port hands the same three to a `ListItems` body, as
 * `ListItemProps`.
 */
type ListItemProps = {

  /**
   * The element this invocation is for, wrapped by `each`: a scalar
   * element arrives as `{val$, index$}`, so the argument -- rather than
   * the `{item}` macro -- is the route to a scalar's value.
   */
  item: any

  /**
   * As given to the `ListItems`. Neither does anything on its own: both
   * are meant to be passed straight into the components in the body.
   */
  indent?: string | number

  /** The per-item `{item.path}` substitution, built fresh for each item. */
  replace: Record<string, any>
}


const ListItems = cmp<ListItemsProps, never, string>(function ListItems(props, children) {
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
      ({ indent, replace }: ListItemProps) =>
        Content({ src: child, indent, replace }) :
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

/** @deprecated Use `ListItemsProps`. */
type ListProps = ListItemsProps


export {
  ListItems,
  List,
}

export type {
  ListItemsProps,
  ListItemProps,
  ListProps,
}
