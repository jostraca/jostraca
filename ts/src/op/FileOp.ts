
import Path from 'node:path'

import type { Node, BuildContext } from '../jostraca'

import { canonPath, validName } from '../build/FileHandler'


const ON = 'FileOp:'

const FileOp = {

  before(node: Node, _ctx$: any, buildctx: BuildContext) {
    // Save the enclosing file and put it back in after(), as Copy, Inject,
    // Fragment and Slot do. A File nested in a File (directly or through a
    // Folder) otherwise left itself current, and the outer file's content
    // after it went into the inner buffer, already written, and was lost.
    // Go's fileAfter collects from the tree and always kept it.
    node.meta.file_prev = buildctx.current.file

    const cfile: any = buildctx.current.file = node
    const name = node.name as string

    validName(name, 'File', ON + 'before:')

    // folderPath() falls back to the base output folder when no Project or
    // Folder has seeded the path, so a top-level File stays inside the
    // output folder instead of resolving to '/<name>'.
    //
    // CANONICALISED HERE, not left for `save` to do. `a.txt` and
    // `./a.txt` are one file, and claiming them as two meant the
    // duplicate guard below passed while `save` normalised both to the
    // same path and let the second overwrite the first. Go's
    // `fileBefore` cleans before it claims, and this is TypeScript
    // catching up to it.
    cfile.fullpath = canonPath(buildctx.folderPath() + '/' + name)
    cfile.content = []

    // Two Files at one path is a mistake, and the second used to win in
    // silence. See BuildContext.claimFile for why the guard lives at
    // the build phase rather than where a data tree asked for it.
    //
    // FILE NODES ONLY, and the test is needed because `CopyOp.before`
    // CALLS THIS FUNCTION to compute a single-file copy's path. A copy
    // to a path a File already claimed is the same mistake, but the
    // guard would then cover a one-file copy and not a directory copy,
    // which walks the tree itself and never arrives here -- a guard
    // that holds for one arm of a component and not the other is worse
    // than one whose edge is stated. `FileHandler.savedPaths` still
    // logs the collision. The Go port's `copyBefore` computes its own
    // path and never reaches `fileBefore`, so this keeps the two in
    // step as well.
    if ('file' === node.kind) {
      buildctx.claimFile(cfile.fullpath, node.path.join('/'), ON + 'before:')
    }
  },


  after(node: Node, ctx$: any, buildctx: BuildContext) {
    const FN = 'after:'
    const { log } = buildctx
    const fs = ctx$.fs()

    buildctx.current.file = node.meta.file_prev

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
        // WHOLE milliseconds, as `last` is. A fractional compare took a
        // write in the same millisecond as the previous build's stamp --
        // the build's own last write, routinely -- for a user edit and
        // skipped it on the next run. Go truncates mtimes to milliseconds.
        if (stat && 0 < last && Math.floor(stat.mtimeMs) > last) {
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
