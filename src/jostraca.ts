/* Copyright (c) 2024 Richard Rodger, MIT License */

// TODO:
// Need to check file existence in define phase, otherwise error stack is useless
// Options for each cmp; for copy, option to exclude ~ backups

import * as Fs from 'node:fs'

import { AsyncLocalStorage } from 'node:async_hooks'

import { util as JsonicUtil } from 'jsonic'

import { Gubu, Skip, One } from 'gubu'

import { memfs as MemFs } from 'memfs'


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
  // select,
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
  isbinext,
  partify,
  lcf,
  ucf,
  getdlog,
} from './util/basic'


import * as PointUtil from './util/point'

// TODO: the actual signatures
const deep: (...args: any[]) => any = JsonicUtil.deep
const omap: (...args: any[]) => any = JsonicUtil.omap


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


const OptionsShape = Gubu({
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

  control: {
    // Do not modify any files or folders.
    dryrun: false,

    // Create duplicate of generated output (for 3diff).
    duplicate: true,

    // Allow .jostraca files to be added to git.
    version: false,
  },

}, { name: 'Jostraca Options' })


const ExistingShape = Gubu({
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



type JostracaOptions = ReturnType<typeof OptionsShape>
type ExistingOptions = ReturnType<typeof ExistingShape>

type Existing = {
  txt: ExistingOptions["txt"]
  bin: ExistingOptions["bin"]
}


const sysFs = () => Fs


function Jostraca(gopts_in?: JostracaOptions | {}) {
  GLOBAL.jostraca = new AsyncLocalStorage()

  // Global options are shared by calls to `generate`.
  const gOpts = OptionsShape(gopts_in || {})

  const gUseMemFs = !!gOpts.mem
  const gVol = deep({}, gOpts.vol)
  const gMemFs = gUseMemFs ? MemFs(gVol) : undefined

  function get_gMemFs() { return gMemFs ? gMemFs.fs : undefined }
  const gGetFs = gOpts.fs || get_gMemFs || undefined


  async function generate(
    opts_in: JostracaOptions | {},
    root: Function):
    Promise<JostracaResult> {
    const opts = OptionsShape(opts_in)

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

    const control = deep({}, gOpts.control, opts.control)

    // Component defaults.
    opts.cmp = deep({
      Copy: {
        ignore: [/~$/]
      }
    }, gOpts?.cmp, opts.cmp)

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
    }

    return GLOBAL.jostraca.run(ctx$, async () => {
      // Define phase
      root()

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

      const dlogs = dlog.log()
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

    ctx$.root = (ctx$.root || node)
    parent = ctx$.node || node

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

    let out = component(props, children)

    ctx$.children = siblings
    ctx$.node = parent

    return out
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
  // select,
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
}





