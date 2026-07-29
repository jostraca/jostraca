
import Path from 'node:path'

import {
  Node,
  FST,
  Audit,
} from '../types'


import {
  FileHandler
} from './FileHandler'

import {
  BuildMeta
} from './BuildMeta'


import type {
  Existing
} from '../jostraca'


import {
  None
} from '../cmp/None'


const CN = 'BuildContext:'


// TODO: rename meta folder to build, move into build folder
class BuildContext {

  fs: () => FST
  now: () => number

  bmeta: BuildMeta
  fh: FileHandler
  audit: Audit
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

  dfolder?: string


  constructor(
    folder: string,
    existing: Existing,
    control: {
      dryrun: boolean,
      duplicate: boolean,
      version: boolean,
    },
    fs: () => FST,
    now: () => number,
  ) {
    this.fs = fs
    this.now = now

    if (!this.fs().existsSync) {
      throw new Error(CN + ' Invalid file system provider: ' + this.fs())
    }

    this.audit = []
    this.when = now()

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

    this.fh = new FileHandler(this, existing, control)
    this.bmeta = new BuildMeta(this.fh)
  }


  addmeta(file: string, meta: any) {
    this.bmeta.add(file, meta)
  }


  // Folder path segments for the current build position, as a canonical
  // (forward-slash) prefix. When neither a Project nor a Folder has seeded
  // the path, fall back to the base output folder — otherwise a top-level
  // File would join onto '' and resolve to '/<name>' at the filesystem
  // root, ignoring the configured output folder entirely. FolderOp.before
  // applies the same fallback when seeding the path.
  folderPath(): string {
    const { path, parent } = this.current.folder
    return 0 < path.length ? path.join('/') : parent
  }


  duplicateFolder() {
    if (null == this.dfolder) {
      this.dfolder =
        Path.normalize(
          Path.join(this.folder, this.bmeta.next.foldername, 'generated'))
    }

    return this.dfolder
  }
}


function emptyNode() {
  return { kind: 'none', path: [], meta: {}, content: [] }
}



export {
  BuildContext
}
