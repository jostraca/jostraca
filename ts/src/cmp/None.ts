
import { cmp } from '../jostraca'


/**
 * `None` takes no props. It is the empty component: `cmp()` still makes
 * its node, so it is a place in the tree that produces nothing.
 */
type NoneProps = {}


const None = cmp<NoneProps>(function None(_props, _children) {
  // Does nothing.
})


export {
  None
}

export type {
  NoneProps
}
