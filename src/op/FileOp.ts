
import Path from 'node:path'

import type { Node, BuildContext } from '../jostraca'


const FileOp = {

  before(node: Node, _ctx$: any, buildctx: BuildContext) {
    // TODO: error if not inside a folder

    const cfile: any = buildctx.current.file = node
    const name = node.name as string
    cfile.fullpath = Path.join(buildctx.current.folder.path.join(Path.sep), name)
    cfile.content = []
  },


  after(node: Node, ctx$: any, buildctx: BuildContext) {
    const { log, current } = buildctx
    const fs = ctx$.fs()
    const cfile = current.file
    const content = cfile.content?.join('')
    const rpath = cfile.path?.join('/') // NOT Path.sep - needs to be canonical

    const fileExists = fs.existsSync(cfile.fullpath)

    let exclude = true === node.exclude

    if (fileExists) {
      if (true === exclude) {
        return
      }

      const excludes = 'string' === node.exclude ? [node.exclude] :
        Array.isArray(node.exclude) ? node.exclude :
          []

      if (excludes.includes(rpath)) {
        return
      }
    }
    else {
      exclude = false
    }


    if (log && null == exclude) {
      exclude = log.exclude.includes(rpath)
      if (!exclude && true === ctx$.opts.exclude) {
        const stat = fs.statSync(cfile.fullpath, { throwIfNoEntry: false })
        if (stat) {
          let timedelta = stat.mtimeMs - log.last
          if ((timedelta > 0 && timedelta < stat.mtimeMs)) {
            exclude = true
          }
        }
      }
    }

    const fullpath = cfile.fullpath as string

    if (!exclude) {
      // buildctx.util.save(fullpath, content)
      buildctx.fh.save(fullpath, content)
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
