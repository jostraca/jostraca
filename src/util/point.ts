
import { Gubu, Skip, Any } from 'gubu'

import { getx } from './basic'


type PointCtx = {
  async: boolean
  log: LogEntry[]
  data: Record<string, any>
  depth: number,
  sys: (() => {
    now: () => number,
    print: (...s: any) => void
  }) & { plog?: string[] }
}


type LogEntry = {
  note: string
  when: number
  depth: number
  args: any
}


abstract class Point implements Point {
  id: string
  name?: string
  args?: any

  constructor(id: string, name?: string) {
    this.id = id
    this.name = name
  }

  async runner(pctx: PointCtx): Promise<void> {
    const suffix = (null == this.name || '' === this.name) ? '' : ':' + this.name
    this.logger(pctx, {
      note: this.constructor.name + ':before:' + this.id + suffix, args: this.args
    })
    if (pctx.async) {
      await this.run(pctx)
    }
    else {
      this.run(pctx)
    }
    this.logger(pctx, {
      note: this.constructor.name + ':after:' + this.id + suffix, args: this.args
    })
  }


  logger(pctx: PointCtx, entry: Partial<LogEntry>) {
    entry.note = null == entry.note ? 'none' : entry.note
    entry.when = pctx.sys().now()
    entry.depth = pctx.depth
    if (undefined === entry.args) {
      delete entry.args
    }
    pctx.log.push(entry as LogEntry)
  }

  abstract run(pctx: PointCtx): Promise<void>
}


class SerialPoint extends Point {
  points: Point[]

  constructor(id: string) {
    super(id)
    this.points = []
  }

  add(p: Point) {
    this.points.push(p)
  }

  async run(pctx: PointCtx): Promise<void> {
    let childctx: PointCtx = { ...pctx }
    childctx.depth++
    for (let p of this.points) {
      if (pctx.async) {
        await p.runner(childctx)
      }
      else {
        p.runner(childctx)
      }
    }
  }
}


class RootPoint extends SerialPoint {
  points: Point[]

  constructor(id: string) {
    super(id)
    this.points = []
  }

  direct(data?: Record<string, any>, sys?: any): PointCtx {
    const pctx = this.makePointCtx(false, data, sys)
    this.runner(pctx)
    return pctx
  }

  async start(data?: Record<string, any>, sys?: any): Promise<PointCtx> {
    const pctx = this.makePointCtx(true, data, sys)
    await this.runner(pctx)
    return pctx
  }


  makePointCtx(async: boolean, data?: Record<string, any>, sys?: any): PointCtx {
    const pctx: PointCtx = {
      async,
      log: [],
      data: data || {},
      depth: 0,
      sys: sys || (() => ({
        now: () => Date.now(),
        print: (...s: any) => {
          if (null != s[0] && 'string' === typeof s[0]) {
            console.dir(s[0], s[1] || { depth: null })
          }
          else {
            console.log(...s)
          }
        }
      }))
    }
    return pctx
  }
}



class ParallelPoint extends Point {
  points: Point[]

  constructor(id: string) {
    super(id)
    this.points = []
  }

  add(p: Point) {
    this.points.push(p)
  }

  async run(pctx: PointCtx): Promise<void> {
    let childctx: PointCtx = { ...pctx }
    childctx.depth++
    await Promise.all(this.points.map(p => p.runner(childctx)))
  }
}




class FuncPoint extends Point {
  func: (pctx: PointCtx) => any

  constructor(id: string, func: (pctx: PointCtx) => any) {
    super(id, func.name)
    this.func = func
  }

  async run(pctx: PointCtx): Promise<void> {
    if (pctx.async) {
      await this.func(pctx)
    }
    else {
      this.func(pctx)
    }
  }
}


class PrintPoint extends Point {
  path?: string

  constructor(id: string, path?: string) {
    super(id)
    this.path = path
  }

  async run(pctx: PointCtx): Promise<void> {
    let print = pctx.sys().print
    let d = pctx.data
    if (null != this.path) {
      d = getx(d, this.path)
    }

    if (null != d && 'object' === typeof d) {
      print('POINTCTX:')
      print(d)
    }
    else {
      print('POINTCTX: ' + d)
    }
  }
}


const PointDefShape = Gubu({
  k: Skip(String),
  n: Skip(String),
  p: Skip([]),
  a: Any(),
  m: {}
})

type PointDef = Partial<ReturnType<typeof PointDefShape>>

type MakePoint = (id: () => string, pdef: PointDef) => Point


function buildPoints(pdef: PointDef, pm: Record<string, MakePoint>, id?: () => string): Point {
  let idi = 0
  id = id || (() => (++idi) + '')
  let p: Point | undefined = undefined

  // TODO: fix point kind resolution to be more extensible

  pdef = PointDefShape(pdef)
  let isSerial = 'Serial' === pdef.k || Array.isArray(pdef.p)

  const mp = pm[pdef.k]
  if (null != mp) {
    p = mp(id, pdef)
  }
  else if (null == pdef.k || 'Root' === pdef.k) {
    const rp = new RootPoint(id())
    let cp = pdef.p
    for (let c of cp) {
      rp.add(buildPoints(c, pm, id))
    }
    p = rp
    isSerial = false
  }
  else if ('Parallel' === pdef.k) {
    const sp = new ParallelPoint(id())
    let cp = pdef.p
    for (let c of cp) {
      sp.add(buildPoints(c, pm, id))
    }
    p = sp
    isSerial = false
  }

  if (isSerial) {
    const sp = (p || new SerialPoint(id())) as SerialPoint
    let cp = pdef.p
    for (let c of cp) {
      sp.add(buildPoints(c, pm, id))
    }
    p = sp
  }

  if (null == p) {
    throw new Error('Unknown point kind: ' + JSON.stringify(pdef))
  }

  return p
}


function makeFuncDef(fd: (pdef: PointDef) => (pctx: PointCtx) => any) {
  return (id: () => string, pdef: PointDef) => {
    const fp = new FuncPoint(id(), fd(pdef))
    fp.args = pdef.a
    return fp
  }
}



export type {
  PointCtx,
  MakePoint,
  PointDef,
}


export {
  Point,
  RootPoint,
  SerialPoint,
  ParallelPoint,
  FuncPoint,
  PrintPoint,
  buildPoints,
  makeFuncDef,
}
