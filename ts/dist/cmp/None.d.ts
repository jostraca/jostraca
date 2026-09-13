/**
 * `None` takes no props. It is the empty component: `cmp()` still makes
 * its node, so it is a place in the tree that produces nothing.
 */
type NoneProps = {};
declare const None: import("../types").Component<NoneProps, never, never>;
export { None };
export type { NoneProps };
