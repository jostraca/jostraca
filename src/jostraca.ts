/* Copyright (c) 2024 Richard Rodger, MIT License */

import * as Fs from 'node:fs'

import { AsyncLocalStorage } from 'node:async_hooks'


import type {
  JostracaOptions,
  Node,
  OpDef,
  Component,
} from './utility'


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
} from './utility'


import { Content } from './cmp/Content'
import { Copy } from './cmp/Copy'
import { File } from './cmp/File'
import { Folder } from './cmp/Folder'
import { Project } from './cmp/Project'

import { CopyOp } from './op/CopyOp'
import { ProjectOp } from './op/ProjectOp'
import { FolderOp } from './op/FolderOp'
import { FileOp } from './op/FileOp'
import { ContentOp } from './op/ContentOp'
import { NoneOp } from './op/NoneOp'



const GLOBAL = (global as any)



function Jostraca() {
  GLOBAL.jostraca = new AsyncLocalStorage()


  function generate(opts: JostracaOptions, root: Function) {
    const fs = opts.fs || Fs
    const meta = opts.meta || {}
    const folder = opts.folder || '.'

    const ctx$ = {
      folder,
      content: null,
      meta,
    }

    GLOBAL.jostraca.run(ctx$, () => {
      try {
        // Define phase
        root()

        const ctx$ = GLOBAL.jostraca.getStore()

        // Build phase
        build(ctx$, {
          fs,
          current: {
            folder: {
              parent: folder
            }
          }
        })
      }
      catch (err: any) {
        console.log('JOSTRACA ERROR:', err)
        throw err
      }
    })
  }


  function build(ctx$: any, buildctx: any) {
    const topnode = ctx$.node
    step(topnode, ctx$, buildctx)
  }


  function step(node: Node, ctx$: any, buildctx: any) {
    try {
      const op = opmap[node.kind]
      if (null == op) {
        throw new Error('missing op: ' + node.kind)
      }

      op.before(node, ctx$, buildctx)

      if (node.children) {
        for (let childnode of node.children) {
          step(childnode, ctx$, buildctx)
        }
      }

      op.after(node, ctx$, buildctx)
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
    content: ContentOp,
    copy: CopyOp,
    none: NoneOp,
  }


  return {
    generate,
  }
}


function cmp(component: Function): Component {
  const cf = (props: any, children?: any) => {
    props = props || {}
    if (null == props || 'object' !== typeof props) {
      props = { arg: props }
    }
    props.ctx$ = GLOBAL.jostraca.getStore()
    children = 'function' === typeof children ? [children] : children

    let node = {
      kind: 'none',
      children: []
    }

    const parent = props.ctx$.node = (props.ctx$.node || node)
    const siblings = props.ctx$.children = (props.ctx$.children || [])
    siblings.push(node)

    props.ctx$.children = node.children
    props.ctx$.node = node

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

  Project,
  Content,
  File,
  Folder,
  Copy,
}
