
const Diff = require('diff')


import Path from 'node:path'

import { BuildContext } from './BuildContext'

import { FST, Audit } from './types'

import {
  isbinext,
} from './util/basic'


const CN = 'FileHandler:'

const JOSTRACA_PROTECT = 'JOSTRACA_PROTECT'

class FileHandler {

  when: number
  fs: () => FST
  folder: string
  audit: Audit
  maxdepth: number
  existing: { txt: any, bin: any }

  preserve: any[]


  constructor(
    bctx: BuildContext,
    existing: { txt: any, bin: any }
  ) {
    this.when = bctx.when
    this.fs = bctx.fs
    this.folder = bctx.folder
    this.audit = bctx.audit
    this.existing = existing

    this.maxdepth = 22 // TODO: get from JostracaOptions

    this.preserve = []

    if (!this.fs().existsSync) {
      throw new Error(CN + ' Invalid file system provider: ' + this.fs())
    }
  }


  save(path: string, content: string | Buffer, write = false, whence?: string): void {
    const when = Date.now()
    const wstr = null == whence ? '' : whence + ':'
    const fs = this.fs()
    const FN = 'save:'

    const existing = 'string' === typeof content ? this.existing.txt : this.existing.bin

    path = Path.normalize(path)
    const folder = Path.dirname(path)

    const exists = fs.existsSync(path)
    write = write || !exists

    if (exists) {
      let oldcontent = fs.readFileSync(path, 'utf8').toString()
      const protect = 0 <= oldcontent.indexOf(JOSTRACA_PROTECT)

      if (existing.preserve) {
        if (protect) {
          write = false
        }
        else if (oldcontent.length !== content.length || oldcontent !== content) {
          let oldpath =
            Path.join(folder, Path.basename(path).replace(/\.[^.]+$/, '') +
              '.old' + Path.extname(path))
          this.copyFile(path, oldpath, whence)
          this.preserve.push({ path, action: 'preserve' })
        }
      }

      if (existing.write && !protect) {
        write = true
      }
      else if (existing.present) {
        if (oldcontent.length !== content.length || oldcontent !== content) {
          let newpath =
            Path.join(folder, Path.basename(path).replace(/\.[^.]+$/, '') +
              '.new' + Path.extname(path))
          this.saveFile(newpath, content, { flush: true })
          this.preserve.push({ path, action: 'present' })
        }
      }

      if (existing.diff && !protect) {
        write = false

        if (oldcontent.length !== content.length || oldcontent !== content) {
          const cstr = 'string' === typeof content ? content : content.toString('utf8')
          const diffcontent = this.diff(this.when, cstr, oldcontent)
          this.saveFile(path, diffcontent)
          this.audit.push([CN + FN + wstr + ':diff', { path, action: 'diff' }])
          // FIX buildctx.file.diff.push({ path, action: 'diff' })
        }
      }
    }

    if (write) {
      this.saveFile(path, content)
      this.audit.push([CN + FN + wstr + ':write', { path, action: 'write' }])

      // FIX fs.mkdirSync(folder, { recursive: true })
      // FIX fs.writeFileSync(path, content, 'utf8', { flush: true })
      // FIX buildctx.file.write.push({ path, action: 'write' })
    }
  }




  diff(when: number, oldcontent: string, newcontent: string): string {
    const difflines = Diff.diffLines(newcontent, oldcontent)

    const out: string[] = []
    const isowhen = new Date(when).toISOString()

    difflines.forEach((part: any) => {
      if (part.added) {
        out.push('<<<<<< GENERATED: ' + isowhen + '\n')
        out.push(part.value)
        out.push('>>>>>> GENERATED: ' + isowhen + '\n')
      }
      else if (part.removed) {
        out.push('<<<<<< EXISTING: ' + isowhen + '\n')
        out.push(part.value)
        out.push('>>>>>> EXISTING: ' + isowhen + '\n')
      }
      else {
        out.push(part.value)
      }
    })

    const content = out.join('')
    return content
  }



  existsFile(path: string, whence?: string): boolean {
    const when = Date.now()
    const wstr = null == whence ? '' : whence + ':'
    const fs = this.fs()
    const FN = 'existsFile:'

    validPath(path, this.maxdepth, CN + FN + 'from:' + wstr)

    const fullpath = Path.isAbsolute(path) ? path : Path.join(this.folder, path)

    try {
      const exists = fs.existsSync(fullpath)
      this.audit.push([CN + FN + wstr,
      { path, when, exists }])
      return exists
    }
    catch (err: any) {
      this.audit.push(['ERROR:' + CN + FN + wstr,
      { path, when, err }])
      err.message = CN + FN + wstr + ' path=' + path +
        ' err=' + err.message
      throw err
    }
  }


  copyFile(frompath: string, topath: string, whence?: string): void {
    const when = Date.now()
    const wstr = null == whence ? '' : whence + ':'
    const fs = this.fs()
    const FN = 'copyFile:'

    validPath(frompath, this.maxdepth, CN + FN + 'from:' + wstr)
    validPath(topath, this.maxdepth, CN + FN + 'to:' + wstr)

    const isBinary = isbinext(frompath)
    const fulltopath = Path.isAbsolute(topath) ? topath : Path.join(this.folder, topath)
    const fullfrompath = Path.isAbsolute(frompath) ? frompath : Path.join(this.folder, frompath)

    try {
      const existed = fs.existsSync(fulltopath)
      fs.mkdirSync(Path.dirname(fulltopath), { recursive: true })
      const content = fs.readFileSync(fullfrompath, isBinary ? undefined : 'utf8')
      fs.writeFileSync(topath, content, { flush: true })
      this.audit.push([CN + FN + wstr,
      { topath, frompath, when, existed, size: content.length }])
    }
    catch (err: any) {
      this.audit.push(['ERROR:' + CN + FN + wstr,
      { topath, frompath, when, err }])
      err.message = CN + FN + wstr + ' topath=' + topath + ' frompath=' + frompath +
        ' err=' + err.message
      throw err
    }
  }


  loadFile(path: string, opts?: any, whence?: string): string | Buffer {
    const when = Date.now()
    const wstr = null == whence ? '' : whence + ':'
    const fs = this.fs()
    const FN = 'loadFile:'

    opts = opts || {}
    opts.encoding = opts.encoding || 'utf8'

    validPath(path, this.maxdepth, CN + FN + wstr)

    try {
      const fullpath = Path.isAbsolute(path) ? path : Path.join(this.folder, path)
      const content = fs.readFileSync(fullpath, opts)
      this.audit.push([CN + FN + wstr,
      { path, when, size: content.length }])
      return content
    }
    catch (err: any) {
      this.audit.push(['ERROR:' + CN + FN + wstr,
      { path, when, err }])
      err.message = CN + FN + wstr + ' path=' + path + ' err=' + err.message
      throw err
    }
  }


  loadJSON(path: string, opts?: any, whence?: string): any {
    const when = Date.now()
    const wstr = null == whence ? '' : whence + ':'
    const FN = 'loadJSON:'

    opts = opts || {}
    opts.encoding = opts.encoding || 'utf8'

    try {
      const content = this.loadFile(path, opts, whence)
      const cstr = 'string' === typeof content ? content : content.toString(opts.encoding)
      const json = JSON.parse(cstr)
      this.audit.push([CN + FN + wstr,
      { path, when, size: content.length }])
      return json
    }
    catch (err: any) {
      this.audit.push(['ERROR:' + CN + FN + wstr,
      { path, when, err }])
      err.message = CN + FN + wstr + ' path=' + path + ' err=' + err.message
      throw err
    }
  }


  saveJSON(path: string, json: any, opts?: any, whence?: string): any {
    const when = Date.now()
    const wstr = null == whence ? '' : whence + ':'
    const FN = 'saveJSON:'

    opts = opts || {}
    opts.encoding = opts.encoding || 'utf8'

    try {
      const jstr = 'string' === typeof json ? json : JSON.stringify(json, null, 2)
      this.saveFile(path, jstr, opts, whence)
      this.audit.push([CN + FN + wstr,
      { path, when, size: jstr.length }])
      return jstr
    }
    catch (err: any) {
      this.audit.push(['ERROR:' + CN + FN + wstr,
      { path, when, err }])
      err.message = CN + FN + wstr + ' path=' + path + ' err=' + err.message
      throw err
    }
  }


  saveFile(path: string, content: string | Buffer, opts?: any, whence?: string): void {
    const when = Date.now()
    const wstr = null == whence ? '' : whence + ':'
    const fs = this.fs()
    const FN = 'saveFile:'

    opts = opts || {}
    opts.encoding = opts.encoding || ('string' === typeof content ? 'utf8' : undefined)

    validPath(path, this.maxdepth, FN)

    if ('string' !== typeof content) {
      throw new Error(CN + FN + wstr + ' invalid content, path=' + path +
        ' content=' + content)
    }

    try {
      const fullpath = Path.isAbsolute(path) ? path : Path.join(this.folder, path)
      const parentfolder = Path.dirname(fullpath)
      const existed = fs.existsSync(fullpath)
      fs.mkdirSync(parentfolder, { recursive: true })
      fs.writeFileSync(fullpath, content, opts)
      this.audit.push([CN + FN + wstr,
      { path, when, existed, size: content.length }])
    }
    catch (err: any) {
      this.audit.push(['ERROR:' + CN + FN + wstr,
      { path, when, size: content.length, err }])
      err.message = CN + FN + wstr + ' path=' + path + ':' + err.message
      throw err
    }
  }



}


function validPath(path: string, maxdepth: number, errmark: string) {
  if (null == path || '' == path || 'string' !== typeof path) {
    throw new Error('ERROR:' + errmark + ' invalid path, path=' + path)
  }

  const depth = Path.normalize(Path.dirname(path)).split(Path.sep).filter(Boolean).length

  if (maxdepth < depth) {
    throw new Error(errmark + ' path too deep, path=' + path)
  }

}



export {
  validPath,
  FileHandler
}
