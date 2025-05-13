
import { getx } from './basic'


type PointCtx = {
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
}


abstract class Point implements Point {
  id: string
  name?: string

  constructor(id: string, name?: string) {
    this.id = id
    this.name = name
  }

  async runner(pctx: PointCtx): Promise<void> {
    const suffix = (null == this.name || '' === this.name) ? '' : ':' + this.name
    this.logger(pctx, { note: this.constructor.name + ':before:' + this.id + suffix })
    await this.run(pctx)
    this.logger(pctx, { note: this.constructor.name + ':after:' + this.id + suffix })
  }

  logger(pctx: PointCtx, entry: Partial<LogEntry>) {
    entry.note = null == entry.note ? 'none' : entry.note
    entry.when = pctx.sys().now()
    entry.depth = pctx.depth
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
      await p.runner(childctx)
    }
  }
}


class RootPoint extends SerialPoint {
  points: Point[]

  constructor(id: string) {
    super(id)
    this.points = []
  }

  add(p: Point) {
    this.points.push(p)
  }

  async start(data?: Record<string, any>, sys?: any): Promise<PointCtx> {
    const pctx: PointCtx = {
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

    await this.runner(pctx)
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
    return this.func(pctx)
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


export type {
  PointCtx,
}

export {
  Point,
  RootPoint,
  SerialPoint,
  ParallelPoint,
  FuncPoint,
  PrintPoint,
}
