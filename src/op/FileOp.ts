
import Path from 'node:path'

import type { Node } from '../jostraca'


const FileOp = {

  before(node: Node, _ctx$: any, buildctx: any) {
    const cfile: any = buildctx.current.file = node
    cfile.filepath = buildctx.current.folder.path.join('/') + '/' + node.name
    cfile.content = []
  },

  after(node: Node, ctx$: any, buildctx: any) {
    const cfile = buildctx.current.file
    const content = cfile.content.join('')
    const rpath = cfile.path.join('/') // NOT Path.sep - needs to be canonical
    let exclude = node.exclude

    // console.log('FILE-a exclude', cfile.path, exclude)

    if (ctx$.info && null == exclude) {
      exclude = ctx$.info.exclude.includes(rpath)
      if (!exclude) {
        const stat = buildctx.fs.statSync(cfile.filepath, { throwIfNoEntry: false })
        if (stat && stat.mtimeMs > ctx$.info.last) {
          exclude = true
        }
        console.log('STAT', cfile.rpath, stat?.mtimeMs, ctx$.info.last, exclude)
      }
    }

    // console.log('FILE-a write', cfile.path, exclude) // , content.substring(0, 111))

    if (!exclude) {
      buildctx.fs.writeFileSync(cfile.filepath, content)
    }
    else {
      if (!ctx$.info.exclude.includes(Path.join(rpath))) {
        ctx$.info.exclude.push(Path.join(rpath))
      }
    }
  },

}


export {
  FileOp
}
