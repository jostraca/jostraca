/* Copyright (c) 2024 Richard Rodger, MIT License */

import * as Fs from 'node:fs'
import Path from 'node:path'

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


  async function generate(opts: JostracaOptions, root: Function) {
    const fs = opts.fs || Fs
    const meta = opts.meta || {}
    const folder = opts.folder || '.'

    const ctx$ = {
      folder,
      content: null,
      meta,
      fs,
    }

    return GLOBAL.jostraca.run(ctx$, async () => {
      try {
        // Define phase
        root()

        const ctx$ = GLOBAL.jostraca.getStore()

        // console.dir(ctx$.node, { depth: null })

        // Build phase

        const buildctx = {
          fs,
          folder,
          current: {
            folder: {
              parent: folder
            }
          }
        }
        await build(ctx$, buildctx)
        return buildctx
      }
      catch (err: any) {
        console.log('JOSTRACA ERROR:', err)
        throw err
      }
    })
  }


  async function build(ctx$: any, buildctx: any) {
    const topnode = ctx$.node

    let info = { exclude: [], last: -1 }
    const infopath = Path.join(buildctx.folder, '.jostraca', 'info.json')

    try {
      info = JSON.parse(ctx$.fs.readFileSync(
        infopath, 'utf8'))
    }
    catch (err: any) {
      // console.log(err)
      // TODO: file not foound ignored, handle others!
    }

    buildctx.info = info
    // console.log('B-INFO', buildctx.info)

    await step(topnode, ctx$, buildctx)


    try {
      ctx$.fs.mkdirSync(Path.dirname(infopath), { recursive: true })
      const info = {
        last: Date.now(),
        exclude: buildctx.info.exclude,
      }
      ctx$.fs.writeFileSync(infopath, JSON.stringify(info, null, 2), { flush: true })
    }
    catch (err: any) {
      console.log(err)
      // TODO: file not foound ignored, handle others!
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
          await step(childnode, ctx$, buildctx)
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

    let node: Node = {
      kind: 'none',
      children: [],
      path: [],
    }

    const parent = props.ctx$.node = (props.ctx$.node || node)
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

  Project,
  Content,
  File,
  Folder,
  Copy,
}

