
import Path from 'node:path'

import type { Node, BuildContext } from '../jostraca'

import { validName } from '../build/FileHandler'


const ON = 'FileOp:'

const FileOp = {

  before(node: Node, _ctx$: any, buildctx: BuildContext) {
    const cfile: any = buildctx.current.file = node
    const name = node.name as string

    validName(name, 'File', ON + 'before:')

    // folderPath() falls back to the base output folder when no Project or
    // Folder has seeded the path, so a top-level File stays inside the
    // output folder instead of resolving to '/<name>'.
    cfile.fullpath = buildctx.folderPath() + '/' + name
    cfile.content = []
  },


  after(node: Node, ctx$: any, buildctx: BuildContext) {
    const FN = 'after:'
    const { log } = buildctx
    const fs = ctx$.fs()

    // The node's own buffer, not buildctx.current.file. Every op that makes
    // itself current.file for the duration of its children puts the previous
    // one back, so by now the two are the same object - but reading `node`
    // says so directly, and keeps a File's output from following whatever a
    // descendant left behind. Copy and Inject each used to leave themselves
    // in place, and this line then wrote THIS file's content to THEIR path.
    // Go's fileAfter reads its own n throughout. See #39.
    const cfile: any = node
    const content = cfile.content?.join('')
    const rpath = cfile.path?.join('/') // NOT Path.sep - needs to be canonical

    const fullpath = cfile.fullpath as string
    const fileExists = fs.existsSync(fullpath)

    if (fileExists) {
      if (true === node.exclude) {
        return
      }

      // `'string' === node.exclude` compared the value against the literal
      // text "string", so a string exclude never matched anything.
      const excludes = 'string' === typeof node.exclude ? [node.exclude] :
        Array.isArray(node.exclude) ? node.exclude :
          []

      if (excludes.includes(rpath)) {
        return
      }

      // Global Options.exclude: leave alone any output file modified on
      // disk since the last successful build.
      //
      // This was unreachable: `exclude` had already been assigned a boolean
      // above, so the `null == exclude` guard it sat behind was never true.
      // The Go port implements it, so TS is the side that was wrong.
      if (true === ctx$.opts.exclude) {
        const last = buildctx.bmeta.prev.last
        const stat = fs.statSync(fullpath, { throwIfNoEntry: false })
        if (stat && 0 < last && stat.mtimeMs > last) {
          if (!log.exclude.includes(rpath)) {
            log.exclude.push(rpath)
          }
          return
        }
      }
    }

    buildctx.fh.save(fullpath, content, ON + FN, undefined, node.mode)
  },

}


export {
  FileOp
}
