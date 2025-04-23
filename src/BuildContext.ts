
import {
  Node,
  FileEntry,
  Component,
  FST,
} from './types'


import {
  FileHandler
} from './FileHandler'

import {
  BuildMeta
} from './meta/BuildMeta'


import type {
  Existing
} from './jostraca'


import {
  None
} from './cmp/None'


const CN = 'BuildContext:'


// TODO: rename meta folder to build, move into build folder
class BuildContext {

  bmeta: BuildMeta
  fh: FileHandler
  fs: () => FST
  audit: [string, any][]
  root: Component
  when: number
  vol: any
  folder: string
  current: {
    project: { node: Node }
    folder: {
      node: Node,
      parent: string
      path: string[]
    }
    file: Node
    content: any
  }
  log: {
    exclude: string[],
    last: number,
  }
  file: {
    write: FileEntry[],
    preserve: FileEntry[],
    present: FileEntry[],
    diff: FileEntry[],
  }


  constructor(
    folder: string,
    existing: Existing,
    fs: () => FST,
  ) {

    this.fs = fs

    if (!this.fs().existsSync) {
      throw new Error(CN + ' Invalid file system provider: ' + this.fs())
    }


    this.audit = []
    this.root = None
    this.when = Date.now()
    this.folder = folder
    this.current = {
      project: {
        node: emptyNode(),
      },
      folder: {
        node: emptyNode(),
        parent: folder,
        path: [],
      },
      // TODO: should be file.node
      file: emptyNode(),
      content: undefined,
    }
    this.log = { exclude: [], last: -1 }
    this.file = {
      write: [],
      preserve: [],
      present: [],
      diff: [],
    }

    this.fh = new FileHandler(this, existing)
    this.bmeta = new BuildMeta(this)
  }

}


function emptyNode() {
  return { kind: 'none', path: [], meta: {}, content: [] }
}



export {
  BuildContext
}
