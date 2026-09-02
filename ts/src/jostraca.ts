/* Copyright (c) 2024 Richard Rodger, MIT License */

// TODO:
// Need to check file existence in define phase, otherwise error stack is useless
// Options for each cmp; for copy, option to exclude ~ backups

import * as Fs from 'node:fs'

import { AsyncLocalStorage } from 'node:async_hooks'

import { Shape, Skip, One } from 'shape'

import { memfs as MemFs } from './util/memfs'


import type {
  Node,
  OpDef,
  Component,
  Log,
  JostracaResult,
} from './types'

import {
  BuildContext
} from './build/BuildContext'

import {
  each,
  get,
  getx,
  camelify,
  snakify,
  kebabify,
  cmap,
  vmap,
  deep,
  omap,
  names,
  template,
  escre,
  indent,
  isbincontent,
  isbinext,
  partify,
  lcf,
  ucf,
  getdlog,
} from './util/basic'


import * as PointUtil from './util/point'
import * as DiffUtil from './diff'


import { Content } from './cmp/Content'
import { Line } from './cmp/Line'
import { Slot } from './cmp/Slot'
import { Copy } from './cmp/Copy'
import { File } from './cmp/File'
import { Inject } from './cmp/Inject'
import { Fragment } from './cmp/Fragment'
import { Folder } from './cmp/Folder'
import { Project } from './cmp/Project'
import { List } from './cmp/List'

import { CopyOp } from './op/CopyOp'
import { ProjectOp } from './op/ProjectOp'
import { FolderOp } from './op/FolderOp'
import { FileOp } from './op/FileOp'
import { SlotOp } from './op/SlotOp'
import { InjectOp } from './op/InjectOp'
import { FragmentOp } from './op/FragmentOp'
import { ContentOp } from './op/ContentOp'
import { NoneOp } from './op/NoneOp'



const GLOBAL = (global as any)
const KONSOLE = GLOBAL['con' + 'sole']

// One AsyncLocalStorage, created once and shared.
//
// `cmp()` resolves this at call time, so replacing it on every Jostraca()
// construction made every component depend on whichever instance happened
// to be built last. It stays on `global` so that two copies of the package
// (an npm dedupe miss) still interoperate.
GLOBAL.jostraca = GLOBAL.jostraca || new AsyncLocalStorage()

const DEFAULT_LOGGER = {
  trace: (...args: any[]) => KONSOLE.log(new Date().toISOString(), 'TRACE', ...args),
  debug: (...args: any[]) => KONSOLE.log(new Date().toISOString(), 'DEBUG', ...args),
  info: (...args: any[]) => KONSOLE.log(new Date().toISOString(), 'INFO', ...args),
  warn: (...args: any[]) => KONSOLE.warn(new Date().toISOString(), 'WARN', ...args),
  error: (...args: any[]) => KONSOLE.error(new Date().toISOString(), 'ERROR', ...args),
  fatal: (...args: any[]) => KONSOLE.error(new Date().toISOString(), 'FATAL', ...args),
}


// Log non-fatal wierdness.
const dlog = getdlog('jostraca', __filename)


const OptionsShape = Shape({
  folder: Skip(String), // Base output folder for generated files. Default: `.`.

  // TODO: implement
  name: {
    file: {
      prefix: Skip(String), // Prefix for all output file names
      suffix: Skip(String), // Suffix for all output file names
    },
    folder: {
      prefix: Skip(String), // Prefix for all output folder names
      suffix: Skip(String), // Prefix for all output folder names
    },
    // Files excluded from prefixing and suffixing
    exclude: Skip(One(String, RegExp, [One(String, RegExp)]))
  },

  meta: {} as any, // Provide meta data to the generation process. Default: `{}`

  fs: Skip(Function) as any, // File system API. Default: `node:fs`.
  now: undefined as any, // Provide current time.

  log: Skip() as any, // Logging interface.
  debug: Skip('info'), // Generate additional debugging information.

  // TOOD: needs rethink
  exclude: false, // Exclude modified output files. Default: `false`.

  // Validated in separate shape to allow overriding.
  existing: { txt: {}, bin: {} },

  model: Skip({}) as any,
  build: true,
  mem: Skip(Boolean),
  vol: Skip({}),

  // Component specific options.
  cmp: {
    Copy: {
      ignore: [] as any[]
    }
  },

  // Each key is Skip so that shape does NOT inject a default here. A literal
  // default would be injected into EVERY per-call options object, including an
  // empty one, and the merge below would then let that injected default beat a
  // global setting -- which silently disabled a global `dryrun: true` and wrote
  // the user's files. Defaults are applied once, after the merge, from
  // CONTROL_DEFAULTS. See PARITY_PLAN.md 1.1.
  control: {
    // Do not modify any files or folders.
    dryrun: Skip(Boolean),

    // Create duplicate of generated output (for 3diff).
    duplicate: Skip(Boolean),

    // Allow .jostraca files to be added to git.
    version: Skip(Boolean),
  },

}, { name: 'Jostraca Options' })


const ExistingShape = Shape({
  txt: {
    write: true, // Overwrite existing files (unless present=true).
    preserve: false, // Keep a backup copy (.old.) of overwritten files.
    present: false, // Present the new file using .new. name annotation.
    diff: false, // Annotated 2-way diff of new generate and existing file.
    merge: false, // Annotated 3-way merge of new generate and existing file.
  },
  bin: {
    write: true, // Overwrite existing files (unless present=true).
    preserve: false, // Keep a backup copy (.old.) of overwritten files.
    present: false, // Present the new file using .new. name annotation.
    // No diff of binary files
    // No merge of binary files
  }

}, { name: 'Jostraca Options (`existing` property)' })



// Copy an options object so shape's injection cannot reach the caller's own
// objects, and no further than that.
//
// The injection is RECURSIVE, so this has to be: `{cmp: {Copy: {}}}` had its
// `Copy` object handed straight through by a one-level copy, and shape wrote
// `ignore: []` into the caller's object two levels down. Measuring `existing`
// and `meta` and concluding one level was enough is how that was missed.
//
// What is NOT copied, and why:
//
//   - `model` at the top level. It is the caller's DATA rather than option
//     structure -- every component reads it through `ctx$.model` -- so
//     cloning it per `generate` would change identity semantics and copy an
//     arbitrarily large object to guard against an injection that does not
//     touch it.
//   - Anything carrying a constructor of its own: Buffer, RegExp, Date, a
//     class instance. Copying their enumerable properties is not copying
//     them, which is the rule `deep` follows for the same reason. A
//     `cmp.Copy.ignore` entry is a RegExp, and must stay the same RegExp.
//
// `seen` keeps a shared reference shared and makes a cyclic options object
// terminate rather than overflow the stack.
function copyOptions(opts_in: any): any {
  return copyOptionTree(opts_in, new WeakMap(), true)
}


function copyOptionTree(
  val: any, seen: WeakMap<object, any>, top: boolean): any {
  if (null == val || 'object' !== typeof val) {
    return val
  }

  const isArray = Array.isArray(val)
  if (!isArray && Object !== val.constructor) {
    return val
  }

  const already = seen.get(val)
  if (undefined !== already) {
    return already
  }

  const out: any = isArray ? [] : {}
  seen.set(val, out)

  for (const key of Object.keys(val)) {
    out[key] = (top && 'model' === key) ? val[key] :
      copyOptionTree(val[key], seen, false)
  }

  return out
}


type JostracaOptions = ReturnType<typeof OptionsShape>
type ExistingOptions = ReturnType<typeof ExistingShape>

type Existing = {
  txt: ExistingOptions["txt"]
  bin: ExistingOptions["bin"]
}


const sysFs = () => Fs


// Applied once, beneath both the global and the per-call `control`, so that
// precedence runs defaults < global < per-call. These are NOT declared as
// literals in OptionsShape: shape would inject them into every validated
// options object, and an injected default is indistinguishable from a caller's
// choice at merge time.
const CONTROL_DEFAULTS = {
  dryrun: false,
  duplicate: true,
  version: false,
}


function Jostraca(gopts_in?: JostracaOptions | {}) {
  // Global options are shared by calls to `generate`.
  const gOpts = OptionsShape(gopts_in || {})

  const gUseMemFs = !!gOpts.mem
  const gVol = deep({}, gOpts.vol)
  const gMemFs = gUseMemFs ? MemFs(gVol) : undefined

  function get_gMemFs() { return gMemFs ? gMemFs.fs : undefined }

  // `get_gMemFs` is a function declaration, so it is always truthy. Only
  // install it as the global provider when memfs is actually in use —
  // otherwise it short-circuits the `sysFs` fallback in `generate` and
  // resolves to `undefined`, leaving a plain `Jostraca()` with no
  // filesystem at all.
  const gGetFs = gOpts.fs || (gUseMemFs ? get_gMemFs : undefined)


  async function generate(
    opts_in: JostracaOptions | {},
    root: Function):
    Promise<JostracaResult> {
    // Validate a COPY. `OptionsShape` injects its defaults into the object
    // it is handed and returns that same object, so validating the caller's
    // own options wrote `build`, `cmp`, `control`, `exclude` and `name`
    // into it -- and `bin` into an `existing` they passed in. A caller who
    // reuses one options object across two `generate` calls was not passing
    // what they thought on the second.
    //
    // The injection itself stays: DEPENDENCY_PLAN.md 3.2 and PARITY_PLAN.md
    // 1.3 are explicit that a validator which checks without injecting
    // crashes on `existing` and silently produces a wrong output tree on
    // `control`. Change where it lands, not whether it happens. Go has never
    // had this: its Options is a value struct. See PARITY_PLAN.md 2.3.
    const opts = OptionsShape(copyOptions(opts_in))

    // Parameters to `generate` override any global options.
    const useMemFS = null == opts.mem ? gUseMemFs : !!opts.mem

    const vol = null == opts.vol ? gVol : deep({}, gVol, opts.vol)
    const memfs = useMemFS ?
      (null == opts.vol && null != gMemFs ? gMemFs : MemFs(vol)) :
      undefined

    const fs = (opts.fs || (memfs && (() => memfs.fs)) || gGetFs || sysFs)()
    const now = opts.now || gOpts.now || Date.now

    const meta = {
      ...(gOpts?.meta || {}),
      ...(opts.meta || {}),
    }

    const folder = null == opts.folder ? (null == gOpts.folder ? '.' : gOpts.folder) :
      opts.folder

    const log: Log = null == opts.log ? (null == gOpts.log ? DEFAULT_LOGGER : gOpts.log) :
      opts.log

    const debug = null == opts.debug ? (null == gOpts.debug ? '.' : gOpts.debug) :
      opts.debug

    // TODO: this is no actual connection between debug and logging!

    // build=true unless explicitly false
    const doBuild: boolean = null == opts.build ? false !== gOpts.build : false !== opts.build

    const model = null == opts.model ? null == gOpts.model ? {} : gOpts.model : opts.model


    const existing = ExistingShape({
      // FIX: this does not work as generate opts get defaults from OptionsShape
      txt: deep({}, gOpts.existing.txt, opts.existing.txt),
      bin: deep({}, gOpts.existing.bin, opts.existing.bin),
    })

    // console.log('EXISTING', existing)

    const control = deep({}, CONTROL_DEFAULTS, gOpts.control, opts.control)

    // Component defaults.
    opts.cmp = deep({
      Copy: {
        ignore: [/~$/]
      }
    }, gOpts?.cmp, opts.cmp)

    // Synthetic top-level node so the user's first component has a parent
    // to append to, and so bare top-level SIBLINGS are children of a common
    // root instead of orphans. Path is empty and kind 'none' is a build-phase
    // noop, so it contributes no path segment and no output. Mirrors the
    // rootNode the Go port already creates in Generate.
    const rootnode: Node = {
      kind: 'none',
      children: [],
      path: [],
      meta: {},
      content: [],
    }

    const ctx$ = {
      fs: () => fs,
      now: () => now(),
      folder,
      content: null,
      meta,
      opts,
      log,
      debug,
      // existing,
      model,
      node: rootnode,
      children: rootnode.children,
      root: rootnode,
    }

    // Only report warnings raised by *this* generate: the dlog buffer is
    // process-global, so reading all of it re-emitted every warning from
    // every earlier run.
    // A monotonic sequence, NOT the buffer length: the buffer is capped
    // and evicts, so a length-based mark goes permanently stale once a
    // long-lived process fills it (see getdlog).
    const dlogMark = dlog.seq()

    return GLOBAL.jostraca.run(ctx$, async () => {
      // Define phase.
      //
      // Awaited: an async define callback used to have its promise dropped
      // on the floor, so the build phase ran against a partially built tree
      // with no error. Awaiting a synchronous callback is a no-op beyond a
      // microtask, and AsyncLocalStorage propagates across it.
      await root()

      const ctx$ = GLOBAL.jostraca.getStore()

      // Build phase
      const buildctx = new BuildContext(
        folder,
        existing,
        control,
        ctx$.fs,
        ctx$.now,
      )

      if (doBuild) {
        await build(ctx$, buildctx)
      }

      const res: JostracaResult = {
        when: buildctx.when,
        files: buildctx.fh.files,
        audit: () => buildctx.audit,
      }

      if (memfs) {
        res.vol = () => memfs.vol
        res.fs = () => fs
      }

      const alldlogs = dlog.log()
      const dlogs = alldlogs.filter((entry: any) => (entry.seq || 0) > dlogMark)
      if (0 < dlogs.length) {
        for (let dlogentry of dlogs) {
          log.debug({ point: 'jostraca-warning', dlogentry, note: String(dlogentry) })
        }
      }
      return res
    })
  }


  async function build(ctx$: any, buildctx: BuildContext) {
    const topnode = ctx$.node

    // No components were defined at all: nothing to walk, and nothing to
    // record. Mirrors runBuild's `st.root == nil` bail in the Go port.
    if (0 === topnode.children.length) {
      return { node: topnode, ctx$, buildctx }
    }

    await step(topnode, ctx$, buildctx)

    buildctx.bmeta.done()

    return { node: topnode, ctx$, buildctx }
  }


  async function step(node: Node, ctx$: any, buildctx: any) {
    try {
      const op = opmap[node.kind]
      if (null == op) {
        throw new Error('missing op: ' + node.kind)
      }

      await op.before(node, ctx$, buildctx)

      if (node.children) {
        for (let childnode of node.children) {
          try {
            await step(childnode, ctx$, buildctx)
          }
          catch (err: any) {
            if (childnode.meta.callsite) {
              err.callsite = childnode.meta.callsite
            }
            throw err
          }
        }
      }

      await op.after(node, ctx$, buildctx)
    }
    catch (err: any) {
      if (err.jostraca) {
        throw err
      }
      err.jostraca = true
      err.step = node.kind
      throw err
    }
  }

  const opmap: Record<string, OpDef> = {
    project: ProjectOp,
    folder: FolderOp,
    file: FileOp,
    inject: InjectOp,
    fragment: FragmentOp,
    content: ContentOp,
    copy: CopyOp,
    slot: SlotOp,
    none: NoneOp,
  }

  return {
    generate,
  }
}


function cmp(component: Function): Component {
  const cf = (props: any, children?: any) => {
    const ctx$ = GLOBAL.jostraca.getStore()

    // Components only mean anything inside the define phase. Without this
    // the next line throws a bare "Cannot read properties of undefined",
    // which says nothing about the actual mistake.
    if (null == ctx$) {
      throw new Error('jostraca: component ' + (component.name || '<anon>') +
        ' called outside generate(); components can only be used inside the ' +
        'callback passed to Jostraca().generate()')
    }

    children = null == children ?
      (('function' === typeof props || Array.isArray(props)) ? props : null) : children

    // if (undefined === props) {
    //   props = ctx$.props ? ctx$.props() : undefined
    // }

    if (null == props || 'object' !== typeof props) {
      props = { arg: props }
    }

    props.ctx$ = ctx$

    let parent = ctx$.node

    if (parent?.filter && !parent.filter({ props, children, component })) {
      return undefined
    }

    children = 'function' === typeof children ? [children] : children

    let node: Node = {
      kind: 'none',
      children: [],
      path: [],
      meta: {},
      content: [],
    }

    // `parent` is ctx$.node, which generate() seeds with the synthetic root
    // node, so top-level components are siblings under a common parent
    // rather than the first one becoming the root and orphaning the rest.

    if (ctx$.debug) {
      node.meta.debug = (node.meta.debug || {})
      node.meta.debug.callsite = new Error('component: ' + component.name).stack
    }

    const siblings = ctx$.children = (ctx$.children || [])
    siblings.push(node)

    ctx$.children = node.children
    ctx$.node = node

    node.path = parent.path.slice(0)
    if ('string' === typeof props.name) {
      node.path.push(props.name)
    }

    // finally: a component that throws must not leave the ambient tree
    // cursor pointing at its own node — the error propagates out of
    // generate(), but a caller that catches it would otherwise be left
    // with a corrupted context.
    try {
      return component(props, children)
    }
    finally {
      ctx$.children = siblings
      ctx$.node = parent
    }
  }
  Object.defineProperty(cf, 'name', { value: component.name })
  return cf
}


// function makeNode() {
//   return { kind: 'none', path: [], meta: {}, content: [] }
// }



export type {
  JostracaResult,
  JostracaOptions,
  Component,
  Node,
  Existing,
}


export {
  Jostraca,
  BuildContext,
  cmp,

  each,
  get,
  getx,
  camelify,
  snakify,
  kebabify,
  cmap,
  vmap,
  names,
  template,
  escre,
  indent,
  isbincontent,
  isbinext,
  partify,
  lcf,
  ucf,

  deep,
  omap,

  Project,
  Content,
  File,
  Inject,
  Fragment,
  Folder,
  Copy,
  Line,
  Slot,
  List,

  PointUtil,
  DiffUtil,
}





