
import type { Node, BuildContext } from '../jostraca'


const FileOp = {

  before(node: Node, _ctx$: any, buildctx: BuildContext) {
    // TODO: error if not inside a folder

    const cfile: any = buildctx.current.file = node
    cfile.fullpath = buildctx.current.folder.path.join('/') + '/' + node.name
    cfile.content = []
  },


  after(node: Node, ctx$: any, buildctx: BuildContext) {
    const { log, current } = buildctx
    const fs = ctx$.fs()
    const cfile = current.file
    const content = cfile.content?.join('')
    const rpath = cfile.path?.join('/') // NOT Path.sep - needs to be canonical

    const fileExists = fs.existsSync(cfile.fullpath)

    let exclude = node.exclude

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
            // console.log('FILEOP-STAT', rpath, timedelta, exclude, stat?.mtimeMs, log.last)
          }
        }
      }
    }

    // console.log('FILE-a write', rpath, exclude) // , content.substring(0, 111))

    if (!exclude) {
      fs.writeFileSync(cfile.fullpath, content, { flush: true })
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
