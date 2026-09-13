
import type { Node } from '../jostraca'

import { cmp, each } from '../jostraca'


/** The props `File` reads. */
type FileProps = {

  /**
   * Path below the enclosing folder. It may hold `/`, so a File can
   * reach into subfolders without a Folder around it. A `..` segment is
   * refused, and so are two Files that resolve to one output path.
   */
  name: string

  /**
   * Leave the file alone when it already exists. `true` always skips it;
   * a string, or a list of strings and regexes, names paths relative to
   * the output folder.
   */
  exclude?: boolean | string | (string | RegExp)[]

  /**
   * POSIX permission bits, e.g. `0o755` to make a generated script
   * executable. Unset leaves the platform default, or, where the file
   * already exists, the mode it already has.
   */
  mode?: number
}


const File = cmp<FileProps>(function File(props, children) {
  const node: Node = props.ctx$.node

  node.kind = 'file'
  node.name = props.name
  node.exclude = null == props.exclude ? node.exclude : props.exclude

  // e.g. File({ name: 'run.sh', mode: 0o755 })
  node.mode = props.mode

  each(children, { call: true })
})



export {
  File
}

export type {
  FileProps
}
