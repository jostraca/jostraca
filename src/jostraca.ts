/* Copyright (c) 2024 Richard Rodger, MIT License */

// TODO:
// Need to check file existence in define phase, otherwise error stack is useless
// Options for each cmp; for copy, option to exclude ~ backups


import * as Fs from 'node:fs'
import Path from 'node:path'

import { AsyncLocalStorage } from 'node:async_hooks'

import { util as JsonicUtil } from 'jsonic'

import { Gubu } from 'gubu'

const Diff = require('diff')

import { memfs as MemFs } from 'memfs'


import type {
  Node,
  OpDef,
  Component,
  Log,
  BuildContext,
} from './types'


import {
  each,
  select,
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
  BINARY_EXT,
} from './utility'


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


const deep: any = JsonicUtil.deep

const GLOBAL = (global as any)

const DEFAULT_LOGGER = {
  trace: (...args: any[]) => console.log(new Date().toISOString(), 'TRACE', ...args),
  debug: (...args: any[]) => console.log(new Date().toISOString(), 'DEBUG', ...args),
  info: (...args: any[]) => console.log(new Date().toISOString(), 'INFO', ...args),
  warn: (...args: any[]) => console.warn(new Date().toISOString(), 'WARN', ...args),
  error: (...args: any[]) => console.error(new Date().toISOString(), 'ERROR', ...args),
  fatal: (...args: any[]) => console.error(new Date().toISOString(), 'FATAL', ...args),
}


const OptionsShape = Gubu({
  folder: '.', // Base output folder for generated files. Default: `.`.
  meta: {} as any, // Provide meta data to the generation process. Default: `{}`
  fs: (() => undefined) as any, // File system API. Default: `node:fs`.
  log: DEFAULT_LOGGER as any, // Logging interface.
  debug: 'info', // Generate additional debugging information.

  // TOOD: needs rethink
  exclude: false, // Exclude modified output files. Default: `false`.

  existing: {
    write: true, // Overwrite existing files.
    preserve: false, // Keep a backup copy (.old.) of overwritten files.
    present: false, // Present the new file using .new. name annotation.
    merge: false, // Annotated merge of new generate and existing file.
  },

  model: {},
  build: true,
  mem: false,
  vol: {},

  // Component specific options.
  cmp: {
    Copy: {
      ignore: [] as any[]
    }
  }
})

type JostracaOptions = ReturnType<typeof OptionsShape>


function Jostraca(gopts_in?: JostracaOptions | {}) {
  GLOBAL.jostraca = new AsyncLocalStorage()

  const gopts = OptionsShape(gopts_in || {})

  async function generate(opts_in: JostracaOptions | {}, root: Function) {
    const opts = OptionsShape(opts_in)

    const useMemFS = opts.mem || gopts.mem

    const vol = deep({}, gopts.vol, opts.vol)
    const memfs = useMemFS ? MemFs(vol) : undefined

    const fs = opts.fs() || gopts.fs() || memfs?.fs || Fs

    const meta = {
      ...(gopts?.meta || {}),
      ...(opts.meta || {}),
    }
    const folder = opts.folder || gopts?.folder || '.'
    const log: Log = opts.log || gopts?.log || DEFAULT_LOGGER
    const debug: boolean = !!(null == opts.debug ? gopts?.debug : opts.debug)

    const existing = deep(gopts.existing, opts.existing)

    const doBuild: boolean = null == gopts?.build ? false !== opts.build : false !== gopts?.build

    const model = deep({}, gopts.model, opts.model)

    // Component defaults.
    opts.cmp = deep({
      Copy: {
        ignore: [/~$/]
      }
    }, gopts?.cmp, opts.cmp)

    const ctx$ = {
      fs: () => fs,
      folder,
      content: null,
      meta,
      opts,
      log,
      debug,
      existing,
      model,
    }

    return GLOBAL.jostraca.run(ctx$, async () => {
      // Define phase
      root()

      const ctx$ = GLOBAL.jostraca.getStore()

      // Build phase
      const buildctx: BuildContext = {
        root: ctx$.root,
        vol: memfs?.vol,
        folder,
        current: {
          project: {
            node: makeNode(),
          },
          folder: {
            node: makeNode(),
            parent: folder,
            path: [],
          },
          // TODI: should be file.node
          file: makeNode(),
          content: undefined,
        },
        log: { exclude: [], last: -1 },
        file: {
          write: [],
          preserve: [],
          present: [],
          merge: [],
        },
        util: {
          save: () => null,
          copy: () => null,
        }
      }

      buildctx.util.save = makeSave(fs, existing, buildctx)
      buildctx.util.copy = makeCopy(fs, existing, buildctx)

      if (doBuild) {
        await build(ctx$, buildctx)
      }

      return buildctx
    })
  }


  async function build(ctx$: any, buildctx: BuildContext) {
    const topnode = ctx$.node

    const logpath = Path.join(buildctx.folder, '.jostraca', 'jostraca.json.log')

    try {
      buildctx.log = JSON.parse(ctx$.fs().readFileSync(
        logpath, 'utf8'))
    }
    catch (err: any) {
      // console.log(err)
      // TODO: file not foound ignored, handle others!
    }

    await step(topnode, ctx$, buildctx)


    try {
      ctx$.fs().mkdirSync(Path.dirname(logpath), { recursive: true })
      const log = {
        last: Date.now(),
        exclude: buildctx.log.exclude,
      }
      ctx$.fs().writeFileSync(logpath, JSON.stringify(log, null, 2), { flush: true })
    }
    catch (err: any) {
      console.log(err)
      // TODO: file not found ignored, handle others!
    }


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
    children = null == children ?
      (('function' === typeof props || Array.isArray(props)) ? props : null) : children

    if (null == props || 'object' !== typeof props) {
      props = { arg: props }
    }
    props.ctx$ = GLOBAL.jostraca.getStore()

    let parent = props.ctx$.node
    // console.log('BBB', component, props, parent?.filter?.({ props }))

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

    props.ctx$.root = (props.ctx$.root || node)
    parent = props.ctx$.node || node

    if (props.ctx$.debug) {
      node.meta.debug = (node.meta.debug || {})
      node.meta.debug.callsite = new Error('component: ' + component.name).stack
    }

    const siblings = props.ctx$.children = (props.ctx$.children || [])
    siblings.push(node)

    props.ctx$.children = node.children
    props.ctx$.node = node

    node.path = parent.path.slice(0)
    if ('string' === typeof props.name) {
      node.path.push(props.name)
    }

    let out = component(props, children)

    props.ctx$.children = siblings
    props.ctx$.node = parent

    return out
  }
  Object.defineProperty(cf, 'name', { value: component.name })
  return cf
}


function makeNode() {
  return { kind: 'none', path: [], meta: {}, content: [] }
}


function makeSave(fs: any, existing: any, buildctx: any) {
  return function save(path: string, content: string, write = false) {
    path = Path.normalize(path)
    const folder = Path.dirname(path)

    // console.log('SAVE', path)

    const exists = fs.existsSync(path)
    write = write || !exists

    if (exists) {
      let oldcontent

      // TODO: if content matchs do nothing
      // console.log('EXISTS', path)

      if (existing.preserve) {
        oldcontent = null == oldcontent ? fs.readFileSync(path, 'utf8').toString() : oldcontent

        if (oldcontent.length !== content.length || oldcontent !== content) {
          let oldpath =
            Path.join(folder, Path.basename(path).replace(/\.[^.]+$/, '') +
              '.old' + Path.extname(path))
          buildctx.util.copy(path, oldpath, true)
          buildctx.file.preserve.push({ path, action: 'preserve' })
        }
      }

      if (existing.write) {
        write = true
      }
      else if (existing.present) {
        oldcontent = null == oldcontent ? fs.readFileSync(path, 'utf8').toString() : oldcontent

        if (oldcontent.length !== content.length || oldcontent !== content) {
          let newpath =
            Path.join(folder, Path.basename(path).replace(/\.[^.]+$/, '') +
              '.new' + Path.extname(path))
          fs.writeFileSync(newpath, content, 'utf8', { flush: true })
          buildctx.file.preserve.push({ path, action: 'present' })
        }
      }

      if (existing.merge) {
        oldcontent = null == oldcontent ? fs.readFileSync(path, 'utf8').toString() : oldcontent
        write = false

        if (oldcontent.length !== content.length || oldcontent !== content) {
          merge(fs, path, content, oldcontent)
          buildctx.file.merge.push({ path, action: 'merge' })
        }
      }
    }

    if (write) {
      fs.mkdirSync(folder, { recursive: true })
      fs.writeFileSync(path, content, 'utf8', { flush: true })
      buildctx.file.write.push({ path, action: 'write' })
    }
  }
}


function makeCopy(fs: any, existing: any, buildctx: any) {
  return function copy(frompath: string, topath: string, write = false) {
    const isBinary = BINARY_EXT.includes(Path.extname(frompath))

    // TODO: check excludes
    fs.mkdirSync(Path.dirname(topath), { recursive: true })
    const contents = fs.readFileSync(frompath, isBinary ? undefined : 'utf8')
    fs.writeFileSync(topath, contents, { flush: true })
  }
}


function merge(fs: any, path: string, oldcontent: string, newcontent: string) {
  const diff = Diff.diffLines(newcontent, oldcontent)

  const out: string[] = []
  const when = new Date().toISOString()

  diff.forEach((part: any) => {
    if (part.added) {
      out.push('<<<<<< GENERATED: ' + when + '\n')
      out.push(part.value)
      out.push('>>>>>> GENERATED: ' + when + '\n')
    }
    else if (part.removed) {
      out.push('<<<<<< EXISTING: ' + when + '\n')
      out.push(part.value)
      out.push('>>>>>> EXISTING: ' + when + '\n')
    }
    else {
      out.push(part.value)
    }
  })

  const content = out.join('')
  // console.log('MERGE', path, content)

  fs.writeFileSync(path, content, { flush: true })
}


export type {
  JostracaOptions,
  Component,
  Node,
}


export {
  Jostraca,
  BuildContext,
  cmp,

  each,
  select,
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
  deep,

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
}





