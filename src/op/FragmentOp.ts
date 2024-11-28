
import type { Node } from '../jostraca'


const FragmentOp = {

  before(node: Node, _ctx$: any, buildctx: any) {
    node.meta.fragment_file = buildctx.current.file

    const cfile: any = buildctx.current.file = node
    cfile.filepath = buildctx.current.folder.path.join('/') + '?fragment=' + node.name
    cfile.content = []
  },


  after(node: Node, _ctx$: any, buildctx: any) {
    let src = node.content?.join('') || ''

    if ('string' === typeof node.indent) {
      src = src.replace(/([^\n]+\n)/g, node.indent + '$1')
    }

    buildctx.current.file = node.meta.fragment_file
    buildctx.current.file.content.push(src)
  },

}


export {
  FragmentOp
}
