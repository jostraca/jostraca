
import Path from 'node:path'

import type { Node } from '../jostraca'

import { getx } from '../jostraca'

import { BINARY_EXT } from '../utility'

import { FileOp } from './FileOp'


const CopyOp = {

  before(node: Node, ctx$: any, buildctx: any) {
    const fs = buildctx.fs

    if (null == node.name && null != node.from) {
      node.name = Path.basename(node.from)
    }

    // TODO: do these need null checks here?
    const name = node.name as string
    const from = node.from as string

    const fromStat = fs.statSync(from)

    // console.log('COPY', from, name, fromStat.isFile())

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

    // let exclude = node.exclude
    // if (true === exclude) {
    //   return
    // }

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
        node,
        excludes: 'string' === node.exclude ? [node.exclude] :
          Array.isArray(node.exclude) ? node.exclude :
            []
      }

      // TODO: node.path is wrong
      // change prop.name to prop.to and account for subfolders

      // console.log('COPY WALK', frompath, topath, node.exclude, state.excludes)
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

    const isDirectory = stat.isDirectory()
    const isTemplateFile = isTemplate(name)
    const isIgnored = ignored(state, nodepath, name, topath)

    // console.log('COPY FROM', frompath, isDirectory, isTemplateFile, isIgnored)

    if (isDirectory) {
      state.folderCount++
      walk(state, nodepath.concat(name), frompath, topath)
    }
    else if (isTemplateFile) {
      if (excludeFile(state, nodepath, name, topath)) { continue }
      const src = fs.readFileSync(frompath, 'utf8')
      const out = genTemplate(state, src, { name, frompath, topath })
      writeFileSync(buildctx, topath, out)
      state.fileCount++
      state.tmCount++
    }
    else if (!isIgnored) {
      if (excludeFile(state, nodepath, name, topath)) { continue }
      copyFileSync(buildctx, frompath, topath)
      state.fileCount++
    }
  }
}


function ignored(state: any, nodepath: string[], name: string, topath: string) {
  return !name.match(/(~|-jostraca-off)$/)
}


function excludeFile(state: any, nodepath: string[], name: string, topath: string) {
  const { opts } = state.ctx$
  const { fs, log } = state.buildctx
  let exclude = false

  // NOT Path.sep - needs to be canonical
  const rpath = nodepath.concat(name).join('/')
  const fileExists = fs.existsSync(topath)

  // console.log('COPY EXCLUDE', fileExists, state.excludes.includes(rpath), rpath, '|', state.excludes)
  if (fileExists && state.excludes.includes(rpath)) {
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
          // console.log('COPYOP-STAT', rpath, timedelta, exclude, stat?.mtimeMs, log.last)
        }
      }
    }

    // if ('sdk.js' === name) {
    // console.log('COPYSTAT', rpath, frompath,
    //   timedelta,
    //   log.exclude.includes(rpath),
    //   stat?.mtimeMs - log.last,
    //   stat?.mtimeMs, log.last, exclude)
    // }
  }

  if (exclude && log && !log.exclude.includes(rpath)) {
    // NOT Path.sep - has to be canonical
    log.exclude.push(rpath)
  }

  // console.log('COPY-EXCLUDE', rpath, exclude)
  return exclude
}


function writeFileSync(buildctx: any, path: string, content: string) {
  // console.log('WF', path)
  const fs = buildctx.fs
  // TODO: check excludes
  fs.mkdirSync(Path.dirname(path), { recursive: true })
  fs.writeFileSync(path, content, 'utf8', { flush: true })
}


function copyFileSync(buildctx: any, frompath: string, topath: string) {
  const fs = buildctx.fs

  const isBinary = BINARY_EXT.includes(Path.extname(frompath))

  // TODO: check excludes
  fs.mkdirSync(Path.dirname(topath), { recursive: true })
  const contents = fs.readFileSync(frompath, isBinary ? undefined : 'utf8')
  fs.writeFileSync(topath, contents, { flush: true })
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
