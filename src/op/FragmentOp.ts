
import Path from 'node:path'

import { each, template } from '../jostraca'

import type { Node } from '../jostraca'


const FragmentOp = {

  before(node: Node, _ctx$: any, buildctx: any) {
    node.meta.fragment_file = buildctx.current.file

    const cfile: any = buildctx.current.file = node
    cfile.filepath = buildctx.current.folder.path.join('/') + '#' + node.name
    cfile.content = []
  },


  after(node: Node, ctx$: any, buildctx: any) {
    const { fs } = buildctx
    let frompath = node.from as string

    // TODO: this is relative to the output - but that is just one case - provide more control?
    if (!Path.isAbsolute(frompath)) {
      frompath = Path.join(buildctx.folder, ...node.path, frompath)
    }

    let src = fs.readFileSync(frompath, 'utf8')

    let replace: any = {}
    let content = buildctx.current.file.content
    if (0 < content.length) {
      replace['<[SLOT]>'] = content.join('')
    }

    const contentMap = node.meta.content_map || {}
    each(contentMap, (content: any) => {
      replace['<[SLOT:' + content.key$ + ']>'] = content.join('')
    })

    // console.log('REPLACE', replace)

    src = template(src, ctx$.model, { replace })

    // console.log('SRC', src)

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
