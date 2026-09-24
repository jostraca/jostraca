
import Path from 'node:path'

import type { Node, BuildContext } from '../jostraca'

import { escre } from '../jostraca'

import { getdlog } from '../util/basic'

import { canonPath, validName } from '../build/FileHandler'

import { encodeText } from '../util/bytes'

const ON = 'InjectOp:'

// Log non-fatal weirdness.
const dlog = getdlog('jostraca', __filename)

const InjectOp = {

  before(node: Node, _ctx$: any, buildctx: BuildContext) {
    // Save the enclosing file. An Inject makes itself current.file so its
    // children accumulate into the injected region rather than into the
    // file around it, and it has to put that back in after() - the same
    // save/restore FragmentOp and SlotOp do. Without it every later sibling
    // of the Inject accumulated into the Inject's buffer, and the enclosing
    // File then wrote that buffer over the Inject's TARGET, destroying a
    // file the build was only supposed to edit a region of. Same defect as
    // the nested Copy in #39, one component along.
    node.meta.inject_file = buildctx.current.file

    const cfile: any = buildctx.current.file = node

    validName(node.name, 'Inject', ON + 'before:')

    // Canonical, as FileOp's is: the target is read and written at one
    // path, never the raw one read and the folded one written.
    cfile.fullpath = canonPath(buildctx.folderPath() + '/' + node.name)
    cfile.content = []
  },


  after(node: Node, ctx$: any, buildctx: BuildContext) {
    const fs = ctx$.fs()

    // Read the node's own buffer rather than current.file, and put the
    // enclosing file back before anything below can throw.
    //
    // Nothing is pushed into it, unlike FragmentOp and SlotOp: an Inject
    // writes to its own target and contributes no text to the file that
    // contains it. Matches Go, whose fileAfter splices its KindInject
    // children and finds no Content because injectAfter never sets any.
    const cfile: any = node
    buildctx.current.file = node.meta.inject_file

    let content = cfile.content.join('')
    // const rpath = cfile.path.join('/') // NOT Path.sep - needs to be canonical
    let exclude = node.exclude

    /* buildctx.info ? 
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
    */

    if (!exclude) {
      const FN = 'after:'
      const fullpath = cfile.fullpath as string
      const markers = node.meta.markers

      // Inject rewrites a region of an existing file. A missing target is a
      // user error worth naming: previously this surfaced as a bare ENOENT
      // from readFileSync, with no indication of which component caused it.
      if (!fs.existsSync(fullpath)) {
        throw new Error(ON + FN + ' inject target does not exist, path=' + fullpath +
          ' (Inject rewrites an existing file; use File to create one)')
      }

      // Spliced as BYTES, as Go splices it: the target, the markers and the
      // region are each held one char per byte (latin1), so the target's
      // bytes outside the region survive exactly, valid UTF-8 or not.
      // Decoding the target as UTF-8 wrote U+FFFD over every byte of a
      // Latin-1 file the Inject was only meant to edit a region of.
      const bytes = (s: string) => Buffer.from(s, 'utf8').toString('latin1')
      const region = (node.meta.escaped ? encodeText(content) :
        Buffer.from(content, 'utf8')).toString('latin1')
      const bmarkers = markers.map(bytes)

      const raw = fs.readFileSync(fullpath)
      let src = (Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8')).toString('latin1')

      content = bmarkers.join(region)
      // Escape markers so regex metacharacters in custom markers are matched
      // literally, and use a replacement function so `$`-sequences in the
      // injected content (e.g. `$1`, `$&`, shell/PHP/JS variables) are not
      // interpreted as special replacement patterns.
      let re = new RegExp(bmarkers.map(escre).join('(.*?)'), 'sg')

      let matched = false
      src = src.replace(re, () => (matched = true, content))

      // No marker pair in the target means the injection silently did
      // nothing. Not fatal — the file may legitimately not be marked up yet
      // — but it should not be invisible.
      if (!matched) {
        dlog('inject', 'markers not found, nothing injected: path=' + fullpath +
          ' markers=' + JSON.stringify(markers))
      }

      buildctx.fh.save(fullpath, Buffer.from(src, 'latin1'))
    }

    /*
    else {
      if (!info.exclude.includes(rpath)) {
        info.exclude.push(rpath)
      }
      }
      */
  },

}


export {
  InjectOp
}
