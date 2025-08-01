
import Path from 'node:path'

import type { Node, BuildContext } from '../jostraca'

import { isbinext, template } from '../jostraca'

import { FileOp } from './FileOp'


const ON = 'Copy:'

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
      const spec = { name, frompath: from, topath: Path.join(...topath) }

      let content = processTemplate(state, fs.readFileSync(from).toString(), spec)

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
    let topath = buildctx.current.folder.path.join('/')

    const state = {
      fileCount: 0,
      folderCount: 0,
      tmCount: 0,
      ctx$,
      buildctx,
      node,
      excludes: 'string' === node.exclude ? [node.exclude] :
        Array.isArray(node.exclude) ? node.exclude :
          []
    }

    topath = null == node.name ? topath : Path.join(topath, node.name)

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


function walk(fs: any, state: any, nodepath: string[], from: string, to: string) {
  const FN = 'walk:'
  const buildctx = state.buildctx as BuildContext

  const entries = fs.readdirSync(from)

  for (let name of entries) {
    const frompath = Path.join(from, name)
    const topath = Path.join(to, name)
    const stat = fs.statSync(frompath)

    const isDirectory = stat.isDirectory()
    const isTemplateFile = isTemplate(name)
    const isIgnored = ignored(state, nodepath, name, topath)

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
    else if (!isIgnored) {
      const excluded = excludeFile(fs, state, nodepath, name, topath)

      if (excluded) { continue }

      buildctx.fh.copy(frompath, topath, ON + FN)

      state.fileCount++
    }
  }
}


function copyFile(frompath: string, topath: string, state: any, buildctx: any, fs: any) {
  const FN = 'copyFile:'
  const src = fs.readFileSync(frompath, 'utf8')
  const out = template(src, state.ctx$.model, { replace: state.node.replace })
  buildctx.fh.save(topath, out, ON + FN)
}



// TODO: needs an option
function ignored(state: any, nodepath: string[], name: string, topath: string) {
  return !!name.match(/(~|-jostraca-off)$/)
}


function excludeFile(fs: any, state: any, nodepath: string[], name: string, topath: string) {
  const { opts } = state.ctx$
  const { log } = state.buildctx
  let exclude = false

  for (let ignoreRE of opts.cmp.Copy.ignore) {
    if (name.match(ignoreRE)) {
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
  let out = false
  if (excludes.filter(exc => 'string' === typeof exc).includes(path)) {
    out = true
  }
  else if (excludes
    .filter(exc => 'object' === typeof exc)
    .reduce((a, exc) => (a ? a : (a || !!path.match(exc))), false)) {
    out = true
  }

  return out
}


function processTemplate(
  state: any,
  src: any,
  spec: { name: string, frompath: string, topath: string }) {

  if (isTemplate(spec.name)) {
    return template(src, state.ctx$.model, {
      replace: {
        ...(state.node?.replace || {}),
      }
    })
  }
  return src
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
