

import type { Node } from '../jostraca'


const FileOp = {

  before(node: Node, _ctx$: any, buildctx: any) {
    const cfile = buildctx.current.file = node
    cfile.path = buildctx.current.folder.path.join('/') + '/' + node.name
    cfile.content = []
  },

  after(_node: Node, _ctx$: any, buildctx: any) {
    const cfile = buildctx.current.file
    const content = cfile.content.join('')
    buildctx.fs.writeFileSync(cfile.path, content)
  },

}


export {
  FileOp
}
