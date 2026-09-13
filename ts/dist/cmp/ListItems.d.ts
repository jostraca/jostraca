/** The props `ListItems` reads. */
type ListItemsProps = {
    /**
     * Walked once per element, with each element bound as `item` for the
     * children. An array is walked in order; an object is walked by value,
     * each value carrying its own key.
     */
    item?: any[] | Record<string, any>;
    /**
     * `false` suppresses the blank line written after the last item.
     * Default true.
     */
    line?: boolean;
    /**
     * Set on the node and bound for the children, so a child can apply it
     * itself. A number is that many spaces, a string is a literal prefix.
     */
    indent?: string | number;
};
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
    item: any;
    /**
     * As given to the `ListItems`. Neither does anything on its own: both
     * are meant to be passed straight into the components in the body.
     */
    indent?: string | number;
    /** The per-item `{item.path}` substitution, built fresh for each item. */
    replace: Record<string, any>;
};
declare const ListItems: import("../types").Component<ListItemsProps, never, string>;
declare const List: import("../types").Component<ListItemsProps, never, string>;
/** @deprecated Use `ListItemsProps`. */
type ListProps = ListItemsProps;
export { ListItems, List, };
export type { ListItemsProps, ListItemProps, ListProps, };
