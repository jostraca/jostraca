/* Copyright (c) 2024 Richard Rodger, MIT License */

import * as Fs from 'node:fs'

import { AsyncLocalStorage } from 'node:async_hooks'


type JostracaOptions = {
  folder: string
  fs: any
}


type Node = {
  kind: string
  children?: Node[]
  name?: string
  path?: string
  content?: any[]
}


type Component = (props: any, children?: any) => void


function Jostraca() {

  const GLOBAL = (global as any)
  GLOBAL.jostraca = new AsyncLocalStorage()


  function generate(opts: JostracaOptions, root: Function) {
    const fs = opts.fs || Fs
    GLOBAL.jostraca.run({
      content: null,
    }, () => {
      root()

      const ctx$ = GLOBAL.jostraca.getStore()
      const node = ctx$.node

      build(
        node,
        {
          fs,
          current: {
            folder: {
              parent: opts.folder
            }
          }
        })
    })
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
        kind: 'content',
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


  function each(fnarr: Function[]) {
    if (fnarr) {
      for (let fn of fnarr) {
        fn()
      }
    }
  }


  function build(topnode: Node, ctx: any) {
    // console.dir(topnode, { depth: null })
    step(topnode, ctx)
  }


  function step(node: Node, ctx: any) {
    const op = opmap[node.kind]
    if (null == op) {
      throw new Error('missing op: ' + node.kind)
    }

    op.before(node, ctx)

    if (node.children) {
      for (let childnode of node.children) {
        step(childnode, ctx)
      }
    }

    op.after(node, ctx)
  }



  const opmap: any = {

    project: {
      before(node: Node, ctx: any) {
        const cproject: any = ctx.current.project = (ctx.current.project || {})
        cproject.node = node
      },

      after(_node: Node, _ctx: any) {

      },
    },


    folder: {
      before(node: Node, ctx: any) {
        const cfolder = ctx.current.folder = (ctx.current.folder || {})

        cfolder.node = node
        cfolder.path = (cfolder.path || [ctx.current.folder.parent])
        cfolder.path.push(node.name)

        let fullpath = cfolder.path.join('/')
        ctx.fs.mkdirSync(fullpath, { recursive: true })
      },


      after(_node: Node, ctx: any) {
        const cfolder = ctx.current.folder
        cfolder.path.length = cfolder.path.length - 1
      },
    },


    file: {
      before(node: Node, ctx: any) {
        const cfile = ctx.current.file = node
        cfile.path = ctx.current.folder.path.join('/') + '/' + node.name
        cfile.content = []
      },

      after(_node: Node, ctx: any) {
        const cfile = ctx.current.file
        const content = cfile.content.join('')
        ctx.fs.writeFileSync(cfile.path, content)
      },
    },


    content: {
      before(node: Node, ctx: any) {
        const ccontent = ctx.current.content = node
        ctx.current.file.content.push(ccontent.content)
      },

      after(_node: Node, _ctx: any) {

      },
    },


  }



  const Code = cmp(function Code(props: any) {
    let src = props.arg
    props.ctx$.node.content = src
  })


  const File = cmp(function File(props: any, children: any) {
    props.ctx$.node.kind = 'file'
    props.ctx$.node.name = props.name

    Code('// FILE START: ' + props.name + '\n')

    each(children)

    Code('// FILE END: ' + props.name + '\n')
  })


  const Project: Component = cmp(function Project(props: any, children: any) {
    props.ctx$.node.kind = 'project'
    props.ctx$.node.name = props.name

    each(children)
  })


  const Folder = cmp(function Folder(props: any, children: any) {
    props.ctx$.node.kind = 'folder'
    props.ctx$.node.name = props.name

    each(children)
  })



  return {
    cmp,
    each,
    generate,

    Project,
    Code,
    File,
    Folder,
  }


}


export type {
  JostracaOptions,
  Component,
}


export {
  Jostraca,
}
