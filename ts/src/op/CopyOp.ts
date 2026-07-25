
import Path from 'node:path'

import type { Node, BuildContext } from '../jostraca'

import { isbinext, template } from '../jostraca'

import { isbincontent, getdlog } from '../util/basic'

// Log non-fatal weirdness.
const dlog = getdlog('jostraca', __filename)

import { validName } from '../build/FileHandler'

import { FileOp } from './FileOp'


const ON = 'Copy:'

const IGNORED_RE = /(~|-jostraca-off)$/

const CopyOp = {

  before(node: Node, ctx$: any, buildctx: BuildContext) {
    const fs = ctx$.fs()

    // TODO: do these need null checks here?
    let name = node.name as string
    const from = node.from as string

    const fromStat = fs.statSync(from)

    if (fromStat.isFile()) {
      if (null == node.name || '' === node.name) {
        name = node.name = Path.basename(from)
      }

      FileOp.before(node, ctx$, buildctx)
      const topath = buildctx.current.file.path
      const state = {
        fileCount: 0,
        folderCount: 0,
        tmCount: 0,
        ctx$,
        buildctx,
      }
      const spec = { name, frompath: from, topath: topath.join('/') }

      let content = processTemplate(state, fs.readFileSync(from), spec)

      buildctx.current.file.content.push(content)
      node.after = node.after || {}
      node.after.kind = 'file'
    }

    else if (fromStat.isDirectory()) {
      if (null != from && '' != from) {
        node.after = node.after || {}
        node.after.kind = 'copy'
      }
    }

    else {
      throw new Error('Unable to process file: ' + from)
    }
  },


  after(node: Node, ctx$: any, buildctx: BuildContext) {
    const fs = ctx$.fs()
    const kind = node.after.kind

    const frompath = node.from as string
    let topath = buildctx.folderPath()

    const state = {
      fileCount: 0,
      folderCount: 0,
      tmCount: 0,
      ctx$,
      buildctx,
      node,
      // Real directory paths already entered, for symlink-cycle detection.
      visited: new Set<string>(),
      excludes: 'string' === node.exclude ? [node.exclude] :
        Array.isArray(node.exclude) ? node.exclude :
          []
    }

    // node.name carries the Copy `to` prop.
    validName(node.name, 'Copy(to)', ON + 'after:')
    topath = null == node.name ? topath : topath + '/' + node.name

    if ('file' === kind) {
      copyFile(frompath, topath, state, buildctx, fs)
      // FileOp.after(node, ctx$, buildctx)
    }
    else if ('copy' === kind) {
      walk(fs, state, node.path, frompath, topath)
    }
    else {
      // TODO: need Standrd JostracaError
      throw new Error('Unknown kind=' + kind + ' for file: ' + frompath)
    }
  },

}


const MAX_COPY_DEPTH = 64

function walk(fs: any, state: any, nodepath: string[], from: string, to: string) {
  const FN = 'walk:'
  const buildctx = state.buildctx as BuildContext

  // statSync follows symlinks, so a link pointing at one of its own
  // ancestors used to recurse until the stack blew. Track the real paths
  // already entered on this branch, and cap depth as a backstop for
  // filesystems where realpath cannot resolve.
  const realfrom = realpath(fs, from)
  if (state.visited.has(realfrom)) {
    dlog('copy', 'symlink cycle, not descending: ' + from + ' -> ' + realfrom)
    return
  }
  if (MAX_COPY_DEPTH < nodepath.length) {
    throw new Error(ON + FN + ' copy tree too deep (>' + MAX_COPY_DEPTH +
      '), possible symlink cycle, path=' + from)
  }
  state.visited.add(realfrom)

  const entries = fs.readdirSync(from).sort()

  for (let name of entries) {
    const frompath = from + '/' + name
    const topath = to + '/' + name
    const stat = fs.statSync(frompath)

    const isDirectory = stat.isDirectory()
    const isTemplateFile = isTemplate(name)
    const isIgnored = ignored(state, nodepath, name, topath)

    // The ignore rule (`~` backups, `-jostraca-off`) has to be checked
    // before the template/binary split. It used to sit only on the binary
    // branch, so it never applied to text files — i.e. to almost
    // everything, and `-jostraca-off` did nothing at all.
    if (isIgnored) {
      continue
    }

    if (isDirectory) {
      state.folderCount++
      walk(fs, state, nodepath.concat(name), frompath, topath)
    }
    else if (isTemplateFile) {
      const excluded = excludeFile(fs, state, nodepath, name, topath)
      if (excluded) { continue }

      copyFile(frompath, topath, state, buildctx, fs)

      state.fileCount++
      state.tmCount++
    }
    else {
      const excluded = excludeFile(fs, state, nodepath, name, topath)

      if (excluded) { continue }

      buildctx.fh.copy(frompath, topath, ON + FN)

      state.fileCount++
    }
  }
}


function copyFile(frompath: string, topath: string, state: any, buildctx: any, fs: any) {
  const FN = 'copyFile:'

  // Read bytes, not utf8. The extension list that routed us here cannot be
  // exhaustive (.wasm, .zst, .sqlite, extensionless binaries), and decoding
  // a binary as utf8 then re-encoding it replaces every invalid sequence
  // with U+FFFD — corrupting the copy. Sniff the content and pass bytes
  // through untouched when it does not look like text.
  const raw = fs.readFileSync(frompath)

  if (isbincontent(raw)) {
    buildctx.fh.save(topath, raw, ON + FN)
    return
  }

  const src = raw.toString('utf8')
  const out = template(src, state.ctx$.model, { replace: state.node.replace })
  buildctx.fh.save(topath, out, ON + FN)
}



// TODO: needs an option
function ignored(state: any, nodepath: string[], name: string, topath: string) {
  return IGNORED_RE.test(name)
}


// Resolve a directory to its canonical path so a symlink and its target
// compare equal. Providers without realpathSync (or a path that cannot be
// resolved) fall back to the path as given — the depth cap still applies.
function realpath(fs: any, p: string): string {
  if ('function' !== typeof fs.realpathSync) {
    return p
  }
  try {
    return fs.realpathSync(p)
  }
  catch (err: any) {
    return p
  }
}


function excludeFile(fs: any, state: any, nodepath: string[], name: string, topath: string) {
  const { opts } = state.ctx$
  const { log } = state.buildctx
  let exclude = false

  for (let ignoreRE of opts.cmp.Copy.ignore) {
    if (ignoreRE.test(name)) {
      return true
    }
  }

  // NOT Path.sep - needs to be canonical
  const rpath = nodepath.concat(name).join('/')

  // TOOD: use exclude only for actual excludes, refactor logic to ignore if exists,
  // use a different prop for that
  // const fileExists = fs.existsSync(topath)

  if (excluded(rpath, state.excludes)) {
    return true
  }

  if (true !== opts.exclude) {
    return false
  }

  if (log) {
    exclude = log.exclude.includes(rpath)
    let stat, timedelta
    if (!exclude) {
      stat = fs.statSync(topath, { throwIfNoEntry: false })
      if (stat) {
        timedelta = stat.mtimeMs - log.last
        if (stat && (timedelta > 0 && timedelta < stat.mtimeMs)) {
          exclude = true
        }
      }
    }

  }

  if (exclude && log && !log.exclude.includes(rpath)) {
    // NOT Path.sep - has to be canonical
    log.exclude.push(rpath)
  }

  return exclude
}


function excluded(path: string, excludes: (string | RegExp)[]) {
  for (const exc of excludes) {
    if ('string' === typeof exc) {
      if (exc === path) return true
    }
    else if (exc instanceof RegExp) {
      if (exc.test(path)) return true
    }
  }
  return false
}


function processTemplate(
  state: any,
  raw: any,
  spec: { name: string, frompath: string, topath: string }) {

  // Same reasoning as copyFile: the extension check alone is not enough to
  // know a file is safe to decode and re-encode as utf8.
  if (isTemplate(spec.name) && !isbincontent(raw)) {
    return template(raw.toString('utf8'), state.ctx$.model, {
      replace: {
        ...(state.node?.replace || {}),
      }
    })
  }
  return raw
}


function isTemplate(name: string) {
  return !isbinext(name)
}


/*
// NOTE: $$foo.bar$$ format used as explicit start and end markers mean regex can be used
// unambiguously ($fooa would not match `foo`)
function genTemplate(
  state: any,
  src: any,
  spec: { name: string, frompath: string, topath: string }) {

  let model = state.ctx$.model // { foo: 'FOO', bar: 'BAR' }
  let out = ''
  let remain = src
  let nextm = true
  while (nextm) {
    let m = remain.match(/\$\$([^$]+)\$\$/)
    if (m) {
      let ref = m[1]
      out += remain.substring(0, m.index)
      let insert = getx(model, ref)
      if (null == insert) {
        out += '$$' + ref + '$$'
        remain = remain.substring(m.index + 4 + ref.length)
      }
      else {
        out += insert
        remain = remain.substring(m.index + 4 + ref.length)
      }
    }
    else {
      out += remain
      nextm = false
    }
  }
  return out
}
*/


export {
  CopyOp
}
