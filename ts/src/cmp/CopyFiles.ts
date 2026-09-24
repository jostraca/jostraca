
import type { Node } from '../jostraca'

import { cmp } from '../jostraca'

import { Shape, One, Optional, Check, Skip } from 'shape'


/**
 * The props `CopyFiles` reads.
 *
 * Validated, like `Fragment` and unlike the other eight: the shape below
 * is a closed set, so a misspelled prop stops the run instead of being
 * dropped. The type and the shape say the same thing at two different
 * times.
 */
type CopyFilesProps = {

  /**
   * File or directory to copy. Independent of the output folder: a
   * relative path resolves against the process working directory, not
   * against the project. It must exist at define time.
   */
  from: string

  /**
   * Destination name below the enclosing folder, when it differs from
   * the source name. A directory copy lands under it.
   */
  to?: string

  /**
   * Substitutions applied to copied text. A binary file is copied
   * through unchanged.
   */
  replace?: Record<string, any>

  /**
   * Paths to skip, relative to the copied source root. A scalar is as
   * legal as a list; a boolean is accepted and does nothing.
   */
  exclude?: boolean | string | RegExp | (string | RegExp)[]
}


const From = (from: any, _: any, s: any) => s.ctx.meta.fs().statSync(from)

// A CLOSED PROP SET HAS TO ADMIT THE ENGINE'S OWN BINDINGS -- see the
// same note in Fragment.ts. `ListItems` binds `item`, `indent` and
// `replace` for each invocation of its children, and a data child
// receives all three merged under its own props. `replace` this
// component reads, and it is a prop besides; `item` and `indent` it
// does not, which is why they are here and not in `CopyFilesProps`. A
// props type says what a CALLER writes, and nobody writes a binding.
const CopyFilesSpec = {
  ctx$: Object,

  // The From path is independent of the project folder.
  from: Check(From).String() as unknown as string,
  //from: String,

  // output folder is current folder, this is an optional subfolder,
  // or if copying a file, the output filename, if different.
  to: Optional(String) as unknown as string,

  replace: {} as any,

  // A SCALAR String or RegExp is as legal as a list of them, matching
  // File (which shape-validates nothing) and the Go port. The
  // Boolean-or-Array-only spelling made the scalar arm of `state.excludes`
  // in CopyOp unreachable.
  exclude: Optional(One(Boolean, String, RegExp, [One(String, RegExp)])) as unknown as any,

  // Bindings, accepted and not read. NOT a copy-time indent: nothing on
  // either side indents a copied file, and the Go port's vestigial
  // `Indent` field was removed rather than kept as a promise.
  item: Skip() as any,
  indent: Skip() as any,
}

// The props a data node may state -- see FRAGMENT_PROPS in Fragment.ts.
const COPYFILES_PROPS: string[] =
  Object.keys(CopyFilesSpec).filter((k) => 'ctx$' !== k)

const CopyFilesShape = Shape(CopyFilesSpec, { name: 'CopyFiles' })


const CopyFiles = cmp<CopyFilesProps>(function CopyFiles(props, _children) {
  const ctx = props.ctx$
  const node: Node = ctx.node

  // TODO: expand this to support a file extract and/or source mapping back to ts
  const errstk: any = new Error()
  const suffixLines = errstk.stack.split('\n')
    .filter((n: string) => !n.includes('/shape/'))
    .filter((n: string) => !n.includes('/jostraca/'))
  const suffix = '[' + (suffixLines[1] || '').trim() + ']'

  props = CopyFilesShape(props, {
    prefix: `(${ctx.model.name}: ${node.path.join('/')})`,
    meta: { fs: props.ctx$.fs },
    suffix,
  })

  node.kind = 'copy'
  node.from = props.from

  // NOTE: props.to is used as the Node name 
  node.name = props.to

  node.exclude = null == props.exclude ? node.exclude : props.exclude

  node.replace = props.replace
})


// `Copy` is the name this component shipped under. It stays exported as
// a DEPRECATED ALIAS -- the same function object, so `===` still holds
// and a `component.name` check sees `CopyFiles` either way -- because
// renaming an exported component is not worth breaking every consumer
// over. The name changed to match jostraca's other verb+noun components
// and the aontu functions that drive them (`copyfiles`), where plain
// `copy` was already taken by the builtin that copies a VALUE.
const Copy = CopyFiles

/** @deprecated Use `CopyFilesProps`. */
type CopyProps = CopyFilesProps


export {
  CopyFiles,
  Copy,
  COPYFILES_PROPS,
}

export type {
  CopyFilesProps,
  CopyProps,
}
