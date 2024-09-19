/* Copyright (c) 2024 Richard Rodger, MIT License */


type JostracaOptions = {
  folder?: string
  fs?: any
  meta?: any
}


type Node = {
  kind: string
  children?: Node[]
  name?: string
  path: string[]
  from?: string
  content?: any[]
  folder?: string
  after?: any
  exclude?: boolean
}


type OpStep = (node: Node, ctx$: any, buildctx: any) => void

type OpDef = {
  before: OpStep,
  after: OpStep,
}


type Component = (props: any, children?: any) => void




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

    if ('*' === part) {
      // console.log('STAR', each(node), path.slice(i + 1))
      return getx(each(node), path.slice(i + 1))
    }

    let m = part.match(/^([^<=>~^?!]*)([<=>~^?!]+)(.*)$/)

    if (m) {
      part = m[1]
      let op = m[2]
      let arg: any = m[3]

      let val = '' === part ? node : node[part]

      const argtype = typeof arg
      arg =
        'true' === arg ? true :
          'false' === arg ? false :
            'string' === argtype ?
              (arg.match(/^"[^"]+"$/) ? arg.substring(1, arg.length - 1) : arg) : arg

      // console.log('GETX-M', val, part, op, arg)

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
        // no property name
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

      // const valtype = typeof val

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
        case '==':
          if (!(val === arg)) return undefined
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


function kebabify(input: any[] | string) {
  let parts = 'string' == typeof input ? input.split(/([A-Z])/) : input.map(n => '' + n)
  return parts
    .filter((p: string) => '' !== p)
    .reduce((a: any[], n: string, i: number) =>
      ((0 === i % 2 ? a.push(n.toLowerCase()) : a[(i / 2) | 0] += n), a), [])
    .join('-')
}


function snakify(input: any[] | string) {
  let parts = 'string' == typeof input ? input.split(/([A-Z])/) : input.map(n => '' + n)
  return parts
    .filter((p: string) => '' !== p)
    .reduce((a: any[], n: string, i: number) =>
      ((0 === i % 2 ? a.push(n.toLowerCase()) : a[(i / 2) | 0] += n), a), [])
    .join('_')
}


function names(base: any, name: string, prop = 'name') {
  base.name$ = name
  base[prop.toLowerCase()] = name.toLowerCase()
  base[camelify(prop)] = camelify(name)
  base[snakify(prop)] = snakify(name)
  base[kebabify(prop)] = kebabify(name)
  base[prop.toUpperCase()] = name.toUpperCase()
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
  Node,
  OpStep,
  OpDef,
  Component,
}


export {
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
}
