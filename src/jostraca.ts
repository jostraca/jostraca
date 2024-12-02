/* Copyright (c) 2024 Richard Rodger, MIT License */

// TODO:
// Need to check file existence in define phase, otherwise error stack is useless
// Options for each cmp; for copy, option to exclude ~ backups


import * as Fs from 'node:fs'
import Path from 'node:path'

import { AsyncLocalStorage } from 'node:async_hooks'

import { util as JsonicUtil } from 'jsonic'

import { memfs as MemFs } from 'memfs'


import type {
  JostracaOptions,
  Node,
  OpDef,
  Component,
  Log,
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


function Jostraca(gopts?: JostracaOptions) {
  GLOBAL.jostraca = new AsyncLocalStorage()


  async function generate(opts: JostracaOptions, root: Function) {
    const useMemFS = opts.mem || gopts?.mem
    const memfs = useMemFS ? MemFs(opts.vol || gopts?.vol || {}) : undefined
    const fs = opts.fs || gopts?.fs || memfs?.fs || Fs
    const meta = {
      ...(gopts?.meta || {}),
      ...(opts.meta || {}),
    }
    const folder = opts.folder || gopts?.folder || '.'
    const log: Log = opts.log || gopts?.log || DEFAULT_LOGGER
    const debug: boolean = !!(null == opts.debug ? gopts?.debug : opts.debug)

    const doBuild: boolean = null == gopts?.build ? false !== opts.build : false !== gopts?.build

    const model = opts.model || gopts?.model || {}

    // Component defaults.
    opts.cmp = deep({
      Copy: {
        ignore: [/~$/]
      }
    }, gopts?.cmp, opts.cmp)

    const ctx$ = {
      folder,
      content: null,
      meta,
      fs,
      opts,
      log,
      debug,
      model,
    }

    return GLOBAL.jostraca.run(ctx$, async () => {
      // Define phase
      root()

      const ctx$ = GLOBAL.jostraca.getStore()

      // Build phase
      const buildctx = {
        root: ctx$.root,
        fs,
        vol: memfs?.vol,
        folder,
        current: {
          folder: {
            parent: folder
          }
        }
      }

      if (doBuild) {
        await build(ctx$, buildctx)
      }

      return buildctx
    })
  }


  async function build(ctx$: any, buildctx: any) {
    const topnode = ctx$.node

    let log = { exclude: [], last: -1 }
    const logpath = Path.join(buildctx.folder, '.jostraca', 'jostraca.json.log')

    try {
      log = JSON.parse(ctx$.fs.readFileSync(
        logpath, 'utf8'))
    }
    catch (err: any) {
      // console.log(err)
      // TODO: file not foound ignored, handle others!
    }

    buildctx.log = log
    // console.log('B-LOG', buildctx.log)

    await step(topnode, ctx$, buildctx)


    try {
      ctx$.fs.mkdirSync(Path.dirname(logpath), { recursive: true })
      const log = {
        last: Date.now(),
        exclude: buildctx.log.exclude,
      }
      ctx$.fs.writeFileSync(logpath, JSON.stringify(log, null, 2), { flush: true })
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
            console.log('JERR', childnode)
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
      // console.log('PF', component, props)
      return undefined
    }

    children = 'function' === typeof children ? [children] : children

    let node: Node = {
      kind: 'none',
      children: [],
      path: [],
      meta: {},
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
      // console.log('CMP-PATH', component.name, node.path)
      // console.trace()
    }

    let out = component(props, children)

    props.ctx$.children = siblings
    props.ctx$.node = parent

    return out
  }
  Object.defineProperty(cf, 'name', { value: component.name })
  return cf
}




export type {
  JostracaOptions,
  Component,
  Node,
}


export {
  Jostraca,
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

