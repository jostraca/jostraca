
import { test, describe } from 'node:test'
import { expect } from '@hapi/code'


import type {
  PointCtx,
  MakePoint,
  PointDef,
} from '../dist/util/point'

import {
  RootPoint,
  PrintPoint,
  FuncPoint,
  SerialPoint,
  ParallelPoint,
  buildPoints,
  makeFuncDef,
} from '../dist/util/point'


import {
  Jostraca,
  Content,
  File,
} from '..'



function make_now(s?: number) {
  s = null == s ? 0 : s
  // // 2025-01-01T00:00:00.000Z
  return () => 1735689600000 + (++(s as number) * 100)
}

function make_sys(s?: number): any {
  const plog: string[] = []
  const now = make_now(s)
  const sys: any = () => ({
    now,
    print: (...s: any) =>
      plog.push(s.map((p: any) => JSON.stringify(p).replace(/^"|"$/, '')).join(' '))
  })
  sys.plog = plog
  return sys
}

function make_id(i?: number) {
  i = null == i ? 0 : i
  return () => (++(i as number), '' + i)
}


describe('point', () => {

  test('direct', async () => {
    const id = make_id()
    const rp1 = new RootPoint(id())
    rp1.add(new PrintPoint(id()))

    // console.log(pp1)

    const d1 = { x: 1 }
    const pc1 = await rp1.start(d1, make_sys())

    expect(pc1).includes({
      log: [
        { note: 'RootPoint:before:1', when: 1735689600100, depth: 0 },
        { note: 'PrintPoint:before:2', when: 1735689600200, depth: 1 },
        { note: 'PrintPoint:after:2', when: 1735689600300, depth: 1 },
        { note: 'RootPoint:after:1', when: 1735689600400, depth: 0 }
      ],
      data: { x: 1 },
    })
    expect(pc1.sys.plog).equals(['POINTCTX:"', '{"x":1}'])

    rp1.add(new FuncPoint(id(), (pctx: PointCtx) => {
      pctx.data.y = 2
    }))

    const d2 = { x: 1 }
    const pc2 = await rp1.start(d2, make_sys())

    expect(pc2).includes({
      log: [
        { note: 'RootPoint:before:1', when: 1735689600100, depth: 0 },
        { note: 'PrintPoint:before:2', when: 1735689600200, depth: 1 },
        { note: 'PrintPoint:after:2', when: 1735689600300, depth: 1 },
        { note: 'FuncPoint:before:3', when: 1735689600400, depth: 1 },
        { note: 'FuncPoint:after:3', when: 1735689600500, depth: 1 },
        { note: 'RootPoint:after:1', when: 1735689600600, depth: 0 }
      ],
      data: { x: 1, y: 2 },
    })
    expect(pc2.sys.plog).equals(['POINTCTX:"', '{"x":1}'])


    const sp1 = new SerialPoint(id())
    sp1.add(new FuncPoint(id(), (pctx: PointCtx) => {
      pctx.data.z = 3
    }))
    sp1.add(new PrintPoint(id()))

    rp1.add(sp1)

    const d3 = { x: 1 }
    const pc3 = await rp1.start(d3, make_sys())

    expect(pc3).includes({
      log: [
        { note: 'RootPoint:before:1', when: 1735689600100, depth: 0 },
        { note: 'PrintPoint:before:2', when: 1735689600200, depth: 1 },
        { note: 'PrintPoint:after:2', when: 1735689600300, depth: 1 },
        { note: 'FuncPoint:before:3', when: 1735689600400, depth: 1 },
        { note: 'FuncPoint:after:3', when: 1735689600500, depth: 1 },
        { note: 'SerialPoint:before:4', when: 1735689600600, depth: 1 },
        { note: 'FuncPoint:before:5', when: 1735689600700, depth: 2 },
        { note: 'FuncPoint:after:5', when: 1735689600800, depth: 2 },
        { note: 'PrintPoint:before:6', when: 1735689600900, depth: 2 },
        { note: 'PrintPoint:after:6', when: 1735689601000, depth: 2 },
        { note: 'SerialPoint:after:4', when: 1735689601100, depth: 1 },
        { note: 'RootPoint:after:1', when: 1735689601200, depth: 0 }
      ],
      data: { x: 1, y: 2, z: 3 },
      depth: 0,
    })
    expect(pc3.sys.plog).equals([
      'POINTCTX:"',
      '{"x":1}',
      'POINTCTX:"',
      '{"x":1,"y":2,"z":3}'
    ])


    const pp1 = new ParallelPoint(id())
    pp1.add(new FuncPoint(id(), function plus2(pctx: PointCtx) {
      pctx.data.s += 2
    }))
    pp1.add(new FuncPoint(id(), function plus3(pctx: PointCtx) {
      pctx.data.s += 3
    }))

    rp1.add(pp1)
    rp1.add(new PrintPoint(id()))

    const d4 = { x: 1, s: 0 }
    const pc4 = await rp1.start(d4, make_sys())

    expect(pc4).includes({
      log: [
        { note: 'RootPoint:before:1', when: 1735689600100, depth: 0 },
        { note: 'PrintPoint:before:2', when: 1735689600200, depth: 1 },
        { note: 'PrintPoint:after:2', when: 1735689600300, depth: 1 },
        { note: 'FuncPoint:before:3', when: 1735689600400, depth: 1 },
        { note: 'FuncPoint:after:3', when: 1735689600500, depth: 1 },
        { note: 'SerialPoint:before:4', when: 1735689600600, depth: 1 },
        { note: 'FuncPoint:before:5', when: 1735689600700, depth: 2 },
        { note: 'FuncPoint:after:5', when: 1735689600800, depth: 2 },
        { note: 'PrintPoint:before:6', when: 1735689600900, depth: 2 },
        { note: 'PrintPoint:after:6', when: 1735689601000, depth: 2 },
        { note: 'SerialPoint:after:4', when: 1735689601100, depth: 1 },
        { note: 'ParallelPoint:before:7', when: 1735689601200, depth: 1 },
        { note: 'FuncPoint:before:8:plus2', when: 1735689601300, depth: 2 },
        { note: 'FuncPoint:before:9:plus3', when: 1735689601400, depth: 2 },
        { note: 'FuncPoint:after:8:plus2', when: 1735689601500, depth: 2 },
        { note: 'FuncPoint:after:9:plus3', when: 1735689601600, depth: 2 },
        { note: 'ParallelPoint:after:7', when: 1735689601700, depth: 1 },
        { note: 'PrintPoint:before:10', when: 1735689601800, depth: 1 },
        { note: 'PrintPoint:after:10', when: 1735689601900, depth: 1 },
        { note: 'RootPoint:after:1', when: 1735689602000, depth: 0 }
      ],
      data: { x: 1, s: 5, y: 2, z: 3 },
      depth: 0,
    })
    expect(pc4.sys.plog).equals([
      'POINTCTX:"',
      '{"x":1,"s":0}',
      'POINTCTX:"',
      '{"x":1,"s":0,"y":2,"z":3}',
      'POINTCTX:"',
      '{"x":1,"s":5,"y":2,"z":3}',
    ])
  })


  test('declare', async () => {

    const def0: PointDef = {
      p: [
        { k: 'Func', a: (pctx: PointCtx) => pctx.data.x = 1 },
        {
          k: 'Serial', p: [
            { k: 'Func', a: function y2(pctx: PointCtx) { pctx.data.y = 2 } },
            { k: 'Func', a: function z3(pctx: PointCtx) { pctx.data.z = 3 } },
          ]
        },
      ]
    }

    const pm: Record<string, MakePoint> = {
      Func: (id: () => string, pdef: PointDef) => {
        return new FuncPoint(id(), pdef.a)
      },
      Print: (id: () => string, pdef: PointDef) => {
        return new PrintPoint(id(), pdef.a)
      },
    }

    const rp0 = buildPoints(def0, pm) as RootPoint
    // console.dir(rp0, { depth: null })

    const d0 = {}
    const pc0 = await rp0.start(d0, make_sys())
    // console.dir(pc0, { depth: null })

    expect(pc0).includes({
      log: [
        { note: 'RootPoint:before:1', when: 1735689600100, depth: 0 },
        { note: 'FuncPoint:before:2:a', when: 1735689600200, depth: 1 },
        { note: 'FuncPoint:after:2:a', when: 1735689600300, depth: 1 },
        { note: 'SerialPoint:before:3', when: 1735689600400, depth: 1 },
        { note: 'FuncPoint:before:4:y2', when: 1735689600500, depth: 2 },
        { note: 'FuncPoint:after:4:y2', when: 1735689600600, depth: 2 },
        { note: 'FuncPoint:before:5:z3', when: 1735689600700, depth: 2 },
        { note: 'FuncPoint:after:5:z3', when: 1735689600800, depth: 2 },
        { note: 'SerialPoint:after:3', when: 1735689600900, depth: 1 },
        { note: 'RootPoint:after:1', when: 1735689601000, depth: 0 }
      ],
      data: { x: 1, y: 2, z: 3 },
      depth: 0,
    })

  })


  test('generate-basic', async () => {

    const def0: PointDef = {
      p: [
        { k: 'Value', a: 11 },
        { k: 'Operation', a: 'add' },
        { k: 'Value', a: 22 },
      ]
    }

    const pm: Record<string, MakePoint> = {
      Value: (id: () => string, pdef: PointDef) =>
        new FuncPoint(id(), function value(_pctx: PointCtx) {
          Content('' + pdef.a)
        }),
      Operation: (id: () => string, pdef: PointDef) =>
        new FuncPoint(id(), function value(pctx: PointCtx) {
          Content(pctx.data.op[pdef.a])
        }),
    }

    const rp0 = buildPoints(def0, pm) as RootPoint
    // console.dir(rp0, { depth: null })

    const d0 = {
      op: {
        add: '+',
        sub: '-',
      }
    }

    let pc0: any
    const j0 = Jostraca({ mem: true, folder: '/' })
    const r0 = await j0.generate({}, async () => {
      File({ name: 'a.txt' }, async () => {
        Content('<')
        pc0 = rp0.direct(d0, make_sys())
        Content('>')
      })
    })

    //console.log('r0', r0)
    //console.log('a.txt', (r0.vol as any)().toJSON()['/a.txt'])

    expect((r0.vol as any)().toJSON()['/a.txt']).equal('<11+22>')

    expect(pc0).includes({
      log: [
        { note: 'RootPoint:before:1', when: 1735689600100, depth: 0 },
        { note: 'FuncPoint:before:2:value', when: 1735689600200, depth: 1 },
        { note: 'FuncPoint:after:2:value', when: 1735689600300, depth: 1 },
        { note: 'FuncPoint:before:3:value', when: 1735689600400, depth: 1 },
        { note: 'FuncPoint:after:3:value', when: 1735689600500, depth: 1 },
        { note: 'FuncPoint:before:4:value', when: 1735689600600, depth: 1 },
        { note: 'FuncPoint:after:4:value', when: 1735689600700, depth: 1 },
        { note: 'RootPoint:after:1', when: 1735689600800, depth: 0 }
      ],
    })
  })



  test('generate-deep', async () => {

    const def0: PointDef = {
      p: [
        {
          k: 'Expr', p: [
            { k: 'Value', a: 11 },
            { k: 'Operation', a: 'sub' },
            { k: 'Value', a: 22 },
          ]
        },
        { k: 'Operation', a: 'add' },
        {
          k: 'Expr', p: [
            { k: 'Value', a: 33 },
            { k: 'Operation', a: 'add' },
            { k: 'Value', a: 44 },
          ]
        },
      ]
    }

    class ExprPoint extends SerialPoint {
      constructor(id: string) {
        super(id)
      }

      async run(pctx: PointCtx): Promise<void> {
        Content('(')
        super.run(pctx)
        Content(')')
      }

    }

    const pm: Record<string, MakePoint> = {
      Value: makeFuncDef((pdef: PointDef) => function value(_pctx: PointCtx) {
        Content('' + pdef.a)
      }),
      Operation: makeFuncDef((pdef: PointDef) => function value(pctx: PointCtx) {
        Content(pctx.data.op[pdef.a])
      }),
      Expr: (id: () => string, _pdef: PointDef) => new ExprPoint(id()),
    }

    const rp0 = buildPoints(def0, pm) as RootPoint
    // console.dir(rp0, { depth: null })

    const d0 = {
      op: {
        add: '+',
        sub: '-',
      }
    }

    let pc0: any
    const j0 = Jostraca({ mem: true, folder: '/' })
    const r0 = await j0.generate({}, async () => {
      File({ name: 'a.txt' }, async () => {
        Content('<')
        pc0 = rp0.direct(d0, make_sys())
        Content('>')
      })
    })

    //console.log('r0', r0)
    //console.log('a.txt', (r0.vol as any)().toJSON()['/a.txt'])

    expect((r0.vol as any)().toJSON()['/a.txt']).equal('<(11-22)+(33+44)>')

    expect(pc0.log.map((n: any) => (delete n.when, delete n.depth, n))).includes([
      { note: 'RootPoint:before:1' },
      { note: 'ExprPoint:before:2' },
      { note: 'FuncPoint:before:3:value', 'args': 11 },
      { note: 'FuncPoint:after:3:value', 'args': 11 },
      { note: 'FuncPoint:before:4:value', 'args': 'sub' },
      { note: 'FuncPoint:after:4:value', 'args': 'sub' },
      { note: 'FuncPoint:before:5:value', 'args': 22 },
      { note: 'FuncPoint:after:5:value', 'args': 22 },
      { note: 'ExprPoint:after:2' },
      { note: 'FuncPoint:before:6:value', 'args': 'add' },
      { note: 'FuncPoint:after:6:value', 'args': 'add' },
      { note: 'ExprPoint:before:7' },
      { note: 'FuncPoint:before:8:value', 'args': 33 },
      { note: 'FuncPoint:after:8:value', 'args': 33 },
      { note: 'FuncPoint:before:9:value', 'args': 'add' },
      { note: 'FuncPoint:after:9:value', 'args': 'add' },
      { note: 'FuncPoint:before:10:value', 'args': 44 },
      { note: 'FuncPoint:after:10:value', 'args': 44 },
      { note: 'ExprPoint:after:7' },
      { note: 'RootPoint:after:1' }
    ])

  })


})


