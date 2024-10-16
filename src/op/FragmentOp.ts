
import Path from 'node:path'

import type { Node } from '../jostraca'


const FragmentOp = {

  before(node: Node, _ctx$: any, buildctx: any) {
  },


  after(node: Node, ctx$: any, buildctx: any) {
    const { fs } = buildctx
    let frompath = node.from as string

    // TODO: this is relative to the output - but that is just one case - provide more control?
    if (!Path.isAbsolute(frompath)) {
      // console.log('FRAG REL', node.folder, node.path, frompath, '|') // , process.cwd(), buildctx)
      frompath = Path.join(buildctx.folder, ...node.path, frompath)
      // console.log('FRAG RESOLVED', frompath)
    }

    let src = fs.readFileSync(frompath, 'utf8')

    if ('string' === typeof node.indent) {
      src = src.replace(/([^\n]+\n)/g, node.indent + '$1')
    }

    buildctx.current.file.content.push(src)
  },

}


export {
  FragmentOp
}
