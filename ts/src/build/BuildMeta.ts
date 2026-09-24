
import Path from 'node:path'

import { FileHandler, canonPath } from './FileHandler'

import { humanify, getdlog } from '../util/basic'


// Log non-fatal weirdness.
const dlog = getdlog('jostraca', __filename)


type FileMetaData = {
  path: string
  size: number
  last: number
  exclude: boolean
}

type BuildMetaData = {
  foldername: string
  filename: string
  last: number  // epoch time
  hlast: number // humanified time
  files: Record<string, FileMetaData>
}


// Handle loading, recording,and saving of build meta data
class BuildMeta {

  fh: FileHandler

  prev: BuildMetaData
  next: BuildMetaData

  constructor(
    fh: FileHandler
  ) {
    this.fh = fh

    // TODO: file folder and name default can be overriden by jopts
    this.prev = {
      foldername: '.jostraca',
      filename: 'jostraca.meta.log',
      last: -1,
      hlast: -1,
      files: {}
    }

    this.prev = loadMetaData(this.fh, this.prev)

    // TODO: load prev if exists

    this.next = {
      foldername: this.prev.foldername,
      filename: this.prev.filename,
      last: -1,
      hlast: -1,
      files: {}
    }

  }


  last() {
    return this.prev.last
  }


  add(file: string, meta: any) {
    const rfile = this.fh.relative(file, 'BuildMeta.add')
    this.next.files[rfile] = meta
  }


  done() {
    this.next.last = this.fh.now()
    this.next.hlast = humanify(this.next.last)

    // save over previous
    saveMetaData(this.fh, this.next)

    if (false === this.fh.control.version) {
      this.fh.saveFile(canonPath(Path.join(this.fh.folder, this.next.foldername, '.gitignore')), `
${this.next.filename}
generated
`)
    }

    return this.next
  }
}


function loadMetaData(fh: FileHandler, bmeta: BuildMetaData) {
  // Full (folder-prefixed) path: the FileHandler FS methods use paths
  // directly and no longer re-join `this.folder`.
  const metapath = canonPath(Path.join(fh.folder, bmeta.foldername, bmeta.filename))
  if (fh.existsFile(metapath)) {
    try {
      const json = fh.loadJSON(metapath)
      bmeta.last = isTime(json?.last) ? json.last : -1
      bmeta.hlast = isTime(json?.hlast) ? json.hlast : -1
      bmeta.files = isPlainObject(json?.files) ? json.files : {}
    }
    catch (err: any) {
      // A truncated or hand-edited meta log used to throw straight out of
      // the BuildMeta constructor, so a corrupt bookkeeping file blocked
      // generation entirely — with a JSON parse error that says nothing
      // about how to recover. The log is regenerated on every run, so
      // starting from empty state is safe: the only cost is that merge
      // baselines look absent for one run.
      dlog('meta', 'unreadable meta log, continuing with empty state: ' +
        metapath + ' err=' + err.message)
      bmeta.last = -1
      bmeta.hlast = -1
      bmeta.files = {}
    }
  }
  return bmeta
}


// A previous `last` is used only when a Date can carry it. A string, a
// boolean or 1e20 in a hand-edited log reached the merge labels and threw
// "Invalid time value"; anything else is treated as absent, as an
// unreadable log is.
function isTime(v: any): boolean {
  return 'number' === typeof v && Number.isFinite(v) && Math.abs(v) <= 8.64e15
}


function isPlainObject(v: any): boolean {
  return null != v && 'object' === typeof v && !Array.isArray(v)
}


function saveMetaData(fh: FileHandler, bmeta: BuildMetaData) {
  // Full (folder-prefixed) path: the FileHandler FS methods use paths
  // directly and no longer re-join `this.folder`.
  const metapath = canonPath(Path.join(fh.folder, bmeta.foldername, bmeta.filename))
  fh.saveJSON(metapath, bmeta)
}


export {
  BuildMeta
}
