
import Path from 'node:path'

import { BuildContext } from '../BuildContext'


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

  #bctx: BuildContext
  #prev: BuildMetaData
  #next: BuildMetaData

  constructor(
    bctx: BuildContext
  ) {
    this.#bctx = bctx


    // file folder and name default can be overriden by jopts


    this.#prev = {
      foldername: '.jostraca',
      filename: 'jostraca.meta.log',
      last: -1,
      hlast: -1,
      files: {}
    }

    this.#prev = loadMetaData(this.#bctx, this.#prev)

    // TODO: load prev if exists

    this.#next = {
      foldername: this.#prev.foldername,
      filename: this.#prev.filename,
      last: -1,
      hlast: -1,
      files: {}
    }

  }


  last() {
    return this.#prev.last
  }

  // TODO: perhaps?
  get(file: any) {
    // get prev file meta data, if any
    // returns file meta
  }


  add(file: string, meta: any) {
    // add file to next buildmetadata
    // meta is size, write time, excluded, etc
  }


  done() {
    this.#next.last = Date.now()
    // this.#next.hlast = humanify(this.#next.last)

    // save over previous
    saveMetaData(this.#bctx, this.#next)

    return this.#next
  }
}


function loadMetaData(bctx: BuildContext, bmeta: BuildMetaData) {
  const metapath = Path.join(bmeta.foldername, bmeta.filename)
  if (bctx.fh.existsFile(metapath)) {
    const json = bctx.fh.loadJSON(metapath)
    bmeta.last = json.last
    bmeta.hlast = json.hlast
    bmeta.files = json.files
  }
  return bmeta
}


function saveMetaData(bctx: BuildContext, bmeta: BuildMetaData) {
  const metapath = Path.join(bmeta.foldername, bmeta.filename)
  bctx.fh.saveJSON(metapath, bmeta)
}





export {
  BuildMeta
}
