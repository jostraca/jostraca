/* Copyright (c) 2024 Richard Rodger, MIT License */

import * as Fs from 'node:fs'

import { AsyncLocalStorage } from 'node:async_hooks'


import { util as JostracaUtil } from '@jsonic/jsonic-next'

const { deep } = JostracaUtil


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


const GLOBAL = (global as any)



function Jostraca() {
  GLOBAL.jostraca = new AsyncLocalStorage()


  function generate(opts: JostracaOptions, root: Function) {
    const fs = opts.fs || Fs
    GLOBAL.jostraca.run({
      fs,
      content: null,
    }, () => {
      try {
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
      }
      catch (err: any) {
        console.log('JOSTRACA ERROR:', err)
        throw err
      }
    })
  }


  function build(topnode: Node, ctx: any) {
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
        const content = ctx.current.content = node
        ctx.current.file.content.push(content.content)
      },

      after(_node: Node, _ctx: any) {
      },
    },


    none: {
      before(_node: Node, _ctx: any) {
      },

      after(_node: Node, _ctx: any) {
      },
    },

  }


  return {
    generate,
  }
}


const Code = cmp(function Code(props: any) {
  props.ctx$.node.kind = 'content'
  let src = props.arg
  props.ctx$.node.content = src
})


const File = cmp(function File(props: any, children: any) {
  props.ctx$.node.kind = 'file'
  props.ctx$.node.name = props.name

  // Code('// FILE START: ' + props.name + '\n')

  each(children)

  // Code('// FILE END: ' + props.name + '\n')
})


const Copy = cmp(function Copy(props: any, children: any) {
  props.ctx$.node.kind = 'file'
  props.ctx$.node.name = props.name

  const content = props.ctx$.fs.readFileSync(props.from).toString()
  Code(content)
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


function each(subject?: any, apply?: any) {
  if (null == apply) {
    let out = []
    if (Array.isArray(subject)) {
      for (let fn of subject) {
        out.push('function' === typeof fn ? fn() : fn)
      }
      return out.sort()
    }
    else if (null == subject || 'object' !== typeof subject) {
      return []
    }
  }
  else if (Array.isArray(subject)) {
    return subject.map(apply)
  }

  if (null == subject || 'object' !== typeof subject) {
    return []
  }

  const entries: any = Object.entries(subject).map((n: any[], _: any) =>
  (_ = typeof n[1],
    (null != n[1] && 'object' === _) ? (n[1].key$ = n[0]) :
      (n[1] = { name: n[0], key$: n[0], val$: n[1] }), n))

  if (1 < entries.length) {
    if (entries[0] && entries[0][1] && 'string' === typeof entries[0][1].name) {
      entries.sort((a: any, b: any) =>
        a[1].name < b[1].name ? -1 : b[1].name < a[1].name ? 1 : 0)
    }
    else if (entries[0] && entries[0][1] && 'string' === typeof entries[0][1].key$) {
      entries.sort((a: any, b: any) =>
        a[1].key$ < b[1].key$ ? -1 : b[1].key$ < a[1].key$ ? 1 : 0)
    }
  }

  apply = 'function' === typeof apply ? apply : (x: any) => x

  return entries.map((n: any, ...args: any[]) =>
    apply(n[1], n[0], ...args))
}



function select(key: any, map: Record<string, Function>) {
  const fn = map && map[key]
  return fn ? fn() : undefined
}



function getx(root: any, path: string | string[]): any {
  path = ('string' === typeof path ? path.split(/[.\s\r\n\t]/) : path).filter(part => '' != part)
  let node = root
  let parents = []

  partloop:
  for (let i = 0; i < path.length && null != node; i++) {
    let part = String(path[i]).trim()
    let m = part.match(/^([^<=>~^?!]*)([<=>~^?!]+)(.*)$/)

    if (m) {
      part = m[1]
      let op = m[2]
      let arg = m[3]

      let val = '' === part ? node : node[part]

      if ('=' === op && 'null' === arg) {
        parents.push(node)
        node = {} // virtual node so that ^ works consistently
        continue partloop
      }
      else if ('^' === op && '' === part && '' !== arg) {
        node = parents[parents.length - Number(arg)]
        continue partloop
      }
      else if ('?' === op[0]) {
        arg = (1 < op.length ? op.substring(1) : '') + arg
        node = Array.isArray(val) ?
          each(val).filter((n: any) => (
            null != getx(n, arg))) :
          each(val).filter((n: any) => (
            null != getx(n, arg)))
            .reduce((a: any, n: any) => (a[n.key$] = n, delete n.key$, a), {})

        continue partloop
      }

      if (null == val) return undefined

      val = Array.isArray(val) ? val.length :
        'object' === typeof val ? Object.keys(val).filter(k => !k.includes('$')).length :
          val

      switch (op) {
        case '<':
          if (!(val < arg)) return undefined
          break
        case '<=':
          if (!(val <= arg)) return undefined
          break
        case '>':
          if (!(val > arg)) return undefined
          break
        case '>=':
          if (!(val >= arg)) return undefined
          break
        case '=':
          if (!(val == arg)) return undefined
          break
        case '!=':
          if (!(val != arg)) return undefined
          break
        case '~':
          if (!(String(val).match(RegExp(arg)))) return undefined
          break
        case '^':
          node = parents[parents.length - Number(arg)]
          continue partloop
        default:
          return undefined
      }
    }

    parents.push(node)
    node = '' === part ? node : node[part]
  }
  return node
}


function get(root: any, path: string | string[]): any {
  path = 'string' === typeof path ? path.split('.') : path
  let node = root
  for (let i = 0; i < path.length && null != node; i++) {
    node = node[path[i]]
  }
  return node
}


function camelify(input: any[] | string) {
  let parts = 'string' == typeof input ? input.split('-') : input.map(n => '' + n)
  return parts
    .map((p: string) => ('' === p ? '' : (p[0].toUpperCase() + p.substring(1))))
    .join('')
}


function snakeify(input: any[] | string) {
  let parts = 'string' == typeof input ? input.split(/([A-Z])/) : input.map(n => '' + n)
  return parts
    .filter((p: string) => '' !== p)
    .reduce((a: any[], n: string, i: number) =>
      ((0 === i % 2 ? a.push(n.toLowerCase()) : a[(i / 2) | 0] += n), a), [])
    .join('-')
}


// Map child objects to new child objects
function cmap(o: any, p: any) {
  return Object
    .entries(o)
    .reduce((r: any, n: any, _: any) => (_ = Object
      .entries(p)
      .reduce((s: any, m: any) => (cmap.FILTER === s ? s : (s[m[0]] = (
        // transfom(val,key,current,parentkey,parent)
        'function' === typeof m[1] ? m[1](n[1][m[0]], {
          skey: m[0], self: n[1], key: n[0], parent: o
        }) : m[1]
      ), (cmap.FILTER === s[m[0]] ? cmap.FILTER : s))), {})
      , (cmap.FILTER === _ ? 0 : r[n[0]] = _), r), {})
}

cmap.COPY = (x: any) => x
// keep self if x is truthy, or function returning truthy-new-value or [truthy,new-value]
cmap.FILTER = (x: any) => 'function' === typeof x ? ((y: any, p: any, _: any) =>
  (_ = x(y, p), Array.isArray(_) ? !_[0] ? _[1] : cmap.FILTER : _)) : (x ? x : cmap.FILTER)
cmap.KEY = (_: any, p: any) => p.key


// Map child objects to a list of child objects
function vmap(o: any, p: any) {
  return Object
    .entries(o)
    .reduce((r: any, n: any, _: any) => (_ = Object
      .entries(p)
      .reduce((s: any, m: any) => (vmap.FILTER === s ? s : (s[m[0]] = (
        // transfom(val,key,current,parentkey,parent)
        // 'function' === typeof m[1] ? m[1](n[1][m[0]], m[0], n[1], n[0], o) : m[1]
        'function' === typeof m[1] ? m[1](n[1][m[0]], {
          skey: m[0], self: n[1], key: n[0], parent: o
        }) : m[1]
      ), (vmap.FILTER === s[m[0]] ? vmap.FILTER : s))), {})
      , (vmap.FILTER === _ ? 0 : r.push(_)), r), [])

}
vmap.COPY = (x: any) => x
vmap.FILTER = (x: any) => 'function' === typeof x ? ((y: any, p: any, _: any) =>
  (_ = x(y, p), Array.isArray(_) ? !_[0] ? _[1] : vmap.FILTER : _)) : (x ? x : vmap.FILTER)
vmap.KEY = (_: any, p: any) => p.key





export type {
  JostracaOptions,
  Component,
}


export {
  Jostraca,
  cmp,

  each,
  select,
  get,
  getx,
  camelify,
  snakeify,
  cmap,
  vmap,

  Project,
  Code,
  File,
  Folder,
  Copy,
}
