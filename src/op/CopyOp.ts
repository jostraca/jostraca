
import Path from 'node:path'

import type { Node } from '../jostraca'

import { getx } from '../jostraca'

import { FileOp } from './FileOp'


const CopyOp = {

  before(node: Node, ctx$: any, buildctx: any) {
    const fs = buildctx.fs

    // TODO: do these need null checks here?
    const name = node.name as string
    const from = node.from as string

    const fromStat = fs.statSync(from)

    if (fromStat.isFile()) {
      FileOp.before(node, ctx$, buildctx)
      const topath = buildctx.current.file.path
      const state = {
        fileCount: 0,
        folderCount: 0,
        tmCount: 0,
        ctx$,
        buildctx,
      }
      const spec = { name, frompath: from, topath }

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


  after(node: Node, ctx$: any, buildctx: any) {
    const kind = node.after.kind

    const frompath = node.from as string
    const topath = buildctx.current.folder.path.join('/')

    let exclude = node.exclude
    if (ctx$.info && true === exclude) {
      return
    }

    if ('file' === kind) {
      FileOp.after(node, ctx$, buildctx)
    }
    else if ('copy' === kind) {
      const state = {
        fileCount: 0,
        folderCount: 0,
        tmCount: 0,
        ctx$,
        buildctx,
      }

      // TODO: node.path is wrong
      // change prop.name to prop.to and account for subfolders

      walk(state, node.path, frompath, topath)
    }
    else {
      throw new Error('Unknown kind=' + kind + ' for file: ' + frompath)
    }
  },

}


function walk(state: any, nodepath: string[], from: string, to: string) {
  const buildctx = state.buildctx
  const fs = buildctx.fs
  const entries = fs.readdirSync(from)

  for (let name of entries) {
    const frompath = Path.join(from, name)
    const topath = Path.join(to, name)
    const stat = fs.statSync(frompath)

    if (stat.isDirectory()) {
      state.folderCount++
      walk(state, nodepath.concat(name), frompath, topath)
    }
    else if (isTemplate(name)) {
      if (excludeFile(state, nodepath, topath)) { continue }
      const src = fs.readFileSync(frompath, 'utf8')
      const out = genTemplate(state, src, { name, frompath, topath })
      writeFileSync(buildctx, topath, out)
      state.fileCount++
      state.tmCount++
    }
    else {
      if (excludeFile(state, nodepath, topath)) { continue }
      copyFileSync(buildctx, frompath, topath)
      state.fileCount++
    }
  }
}


function excludeFile(state: any, nodepath: string[], frompath: string) {
  let exclude = false
  if (state.ctx$.info) {
    const stat = state.buildctx.fs.statSync(frompath, { throwIfNoEntry: false })
    if (stat && stat.mtimeMs > state.ctx$.info.last) {
      exclude = true
    }
    console.log('COPYSTAT', frompath, stat?.mtimeMs, state.ctx$.info.last, exclude)
  }

  if (exclude && state.ctx$.info) {
    state.ctx$.info.exclude.push(nodepath.join('/')) // NOT Path.sep - has to be canonical
  }

  return exclude
}


function writeFileSync(buildctx: any, path: string, content: string) {
  const fs = buildctx.fs
  // TODO: check excludes
  fs.mkdirSync(Path.dirname(path), { recursive: true })
  fs.writeFileSync(path, content, 'utf8')
}


function copyFileSync(buildctx: any, frompath: string, topath: string) {
  const fs = buildctx.fs
  // TODO: check excludes
  fs.mkdirSync(Path.dirname(topath), { recursive: true })
  fs.copyFileSync(frompath, topath)
}


function processTemplate(
  state: any,
  src: any,
  spec: { name: string, frompath: string, topath: string }) {
  if (isTemplate(spec.name)) {
    return genTemplate(state, src, spec)
  }
  return src
}

function isTemplate(name: string) {
  // TODO: need a better way; alsp should be configurable
  return !name.match(/\.(gif|jpe?g|png|ico|bmp|tiff)$/i)
}

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

export {
  CopyOp
}
