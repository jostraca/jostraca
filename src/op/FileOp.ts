
import Path from 'node:path'

import type { Node } from '../jostraca'


const FileOp = {

  before(node: Node, _ctx$: any, buildctx: any) {
    const cfile: any = buildctx.current.file = node
    cfile.filepath = buildctx.current.folder.path.join('/') + '/' + node.name
    cfile.content = []
  },


  after(node: Node, ctx$: any, buildctx: any) {
    // console.log('FB-LOG', buildctx.log)

    const { fs, log, current } = buildctx
    const cfile = current.file
    const content = cfile.content.join('')
    const rpath = cfile.path.join('/') // NOT Path.sep - needs to be canonical
    let exclude = node.exclude

    // console.log('FILE-a exclude', rpath, exclude, !!log)

    if (log && null == exclude) {
      exclude = log.exclude.includes(rpath)
      if (!exclude && true === ctx$.opts.exclude) {
        const stat = fs.statSync(cfile.filepath, { throwIfNoEntry: false })
        if (stat) {
          let timedelta = stat.mtimeMs - log.last
          if ((timedelta > 0 && timedelta < stat.mtimeMs)) {
            exclude = true
            // console.log('FILEOP-STAT', rpath, timedelta, exclude, stat?.mtimeMs, log.last)
          }
        }
      }
    }

    // console.log('FILE-a write', rpath, exclude) // , content.substring(0, 111))

    if (!exclude) {
      fs.writeFileSync(cfile.filepath, content, { flush: true })
    }
    else {
      if (!log.exclude.includes(rpath)) {
        log.exclude.push(rpath)
      }
    }
  },

}


export {
  FileOp
}
