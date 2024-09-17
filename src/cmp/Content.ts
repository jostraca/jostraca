
import type { Node } from '../utility'


import { cmp } from '../jostraca'


const Content = cmp(function Content(props: any, _children: any) {
  const node: Node = props.ctx$.node
  node.kind = 'content'
  let src = props.arg
  node.content = src
})



export {
  Content
}
