
import Path from 'node:path'

import type { Node } from '../jostraca'


const InjectOp = {

  before(node: Node, _ctx$: any, buildctx: any) {
    const cfile: any = buildctx.current.file = node
    cfile.fullpath = buildctx.current.folder.path.join('/') + '/' + node.name
    cfile.content = []
  },


  after(node: Node, ctx$: any, buildctx: any) {
    const { info, current } = buildctx
    const fs = ctx$.fs()
    const cfile = current.file
    let content = cfile.content.join('')
    const rpath = cfile.path.join('/') // NOT Path.sep - needs to be canonical
    let exclude = node.exclude

    if (info && null == exclude) {
      exclude = info.exclude.includes(rpath)
      if (!exclude && true === ctx$.opts.exclude) {
        const stat = fs.statSync(cfile.fullpath, { throwIfNoEntry: false })
        if (stat) {
          let timedelta = stat.mtimeMs - info.last
          if ((timedelta > 0 && timedelta < stat.mtimeMs)) {
            exclude = true
          }
        }
      }
    }

    if (!exclude) {
      let src = fs.readFileSync(cfile.fullpath, 'utf8')

      content = node.meta.markers.join(content)
      let re = new RegExp(node.meta.markers.join('(.*?)'), 'sg')
      src = src.replace(re, content)
      fs.writeFileSync(cfile.fullpath, src, { flush: true })
    }
    else {
      if (!info.exclude.includes(rpath)) {
        info.exclude.push(rpath)
      }
    }
  },

}


export {
  InjectOp
}
