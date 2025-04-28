
import Path from 'node:path'

import { FileHandler } from './FileHandler'

import { humanify } from '../util/basic'


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
    this.next.files[file] = meta
  }


  done() {
    this.next.last = this.fh.now()
    this.next.hlast = humanify(this.next.last)

    // save over previous
    saveMetaData(this.fh, this.next)

    return this.next
  }
}


function loadMetaData(fh: FileHandler, bmeta: BuildMetaData) {
  const metapath = Path.join(bmeta.foldername, bmeta.filename)
  if (fh.existsFile(metapath)) {
    const json = fh.loadJSON(metapath)
    bmeta.last = json.last
    bmeta.hlast = json.hlast
    bmeta.files = json.files
  }
  return bmeta
}


function saveMetaData(fh: FileHandler, bmeta: BuildMetaData) {
  const metapath = Path.join(bmeta.foldername, bmeta.filename)
  fh.saveJSON(metapath, bmeta)
}


export {
  BuildMeta
}
