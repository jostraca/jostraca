"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const code_1 = require("@hapi/code");
const point_1 = require("../dist/util/point");
function make_now(s) {
    s = null == s ? 0 : s;
    // // 2025-01-01T00:00:00.000Z
    return () => 1735689600000 + (++s * 100);
}
function make_sys(s) {
    const plog = [];
    const now = make_now(s);
    const sys = () => ({
        now,
        print: (...s) => plog.push(s.map((p) => JSON.stringify(p).replace(/^"|"$/, '')).join(' '))
    });
    sys.plog = plog;
    return sys;
}
function make_id(i) {
    i = null == i ? 0 : i;
    return () => (++i, '' + i);
}
(0, node_test_1.describe)('point', () => {
    (0, node_test_1.test)('direct', async () => {
        const id = make_id();
        const rp1 = new point_1.RootPoint(id());
        rp1.add(new point_1.PrintPoint(id()));
        // console.log(pp1)
        const d1 = { x: 1 };
        const pc1 = await rp1.start(d1, make_sys());
        (0, code_1.expect)(pc1).includes({
            log: [
                { note: 'RootPoint:before:1', when: 1735689600100, depth: 0 },
                { note: 'PrintPoint:before:2', when: 1735689600200, depth: 1 },
                { note: 'PrintPoint:after:2', when: 1735689600300, depth: 1 },
                { note: 'RootPoint:after:1', when: 1735689600400, depth: 0 }
            ],
            data: { x: 1 },
        });
        (0, code_1.expect)(pc1.sys.plog).equals(['POINTCTX:"', '{"x":1}']);
        rp1.add(new point_1.FuncPoint(id(), (pctx) => {
            pctx.data.y = 2;
        }));
        const d2 = { x: 1 };
        const pc2 = await rp1.start(d2, make_sys());
        (0, code_1.expect)(pc2).includes({
            log: [
                { note: 'RootPoint:before:1', when: 1735689600100, depth: 0 },
                { note: 'PrintPoint:before:2', when: 1735689600200, depth: 1 },
                { note: 'PrintPoint:after:2', when: 1735689600300, depth: 1 },
                { note: 'FuncPoint:before:3', when: 1735689600400, depth: 1 },
                { note: 'FuncPoint:after:3', when: 1735689600500, depth: 1 },
                { note: 'RootPoint:after:1', when: 1735689600600, depth: 0 }
            ],
            data: { x: 1, y: 2 },
        });
        (0, code_1.expect)(pc2.sys.plog).equals(['POINTCTX:"', '{"x":1}']);
        const sp1 = new point_1.SerialPoint(id());
        sp1.add(new point_1.FuncPoint(id(), (pctx) => {
            pctx.data.z = 3;
        }));
        sp1.add(new point_1.PrintPoint(id()));
        rp1.add(sp1);
        const d3 = { x: 1 };
        const pc3 = await rp1.start(d3, make_sys());
        (0, code_1.expect)(pc3).includes({
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
        });
        (0, code_1.expect)(pc3.sys.plog).equals([
            'POINTCTX:"',
            '{"x":1}',
            'POINTCTX:"',
            '{"x":1,"y":2,"z":3}'
        ]);
        const pp1 = new point_1.ParallelPoint(id());
        pp1.add(new point_1.FuncPoint(id(), function plus2(pctx) {
            pctx.data.s += 2;
        }));
        pp1.add(new point_1.FuncPoint(id(), function plus3(pctx) {
            pctx.data.s += 3;
        }));
        rp1.add(pp1);
        rp1.add(new point_1.PrintPoint(id()));
        const d4 = { x: 1, s: 0 };
        const pc4 = await rp1.start(d4, make_sys());
        (0, code_1.expect)(pc4).includes({
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
        });
        (0, code_1.expect)(pc4.sys.plog).equals([
            'POINTCTX:"',
            '{"x":1,"s":0}',
            'POINTCTX:"',
            '{"x":1,"s":0,"y":2,"z":3}',
            'POINTCTX:"',
            '{"x":1,"s":5,"y":2,"z":3}',
        ]);
    });
    (0, node_test_1.test)('declare', async () => {
        const def0 = {
            p: [
                { k: 'Func', a: (pctx) => pctx.data.x = 1 },
                {
                    k: 'Serial', p: [
                        { k: 'Func', a: function y2(pctx) { pctx.data.y = 2; } },
                        { k: 'Func', a: function z3(pctx) { pctx.data.z = 3; } },
                    ]
                },
            ]
        };
        const pm = {
            Func: (id, pdef) => {
                return new point_1.FuncPoint(id(), pdef.a);
            },
            Print: (id, pdef) => {
                return new point_1.PrintPoint(id(), pdef.a);
            },
        };
        const rp0 = (0, point_1.buildPoints)(def0, pm);
        // console.dir(rp0, { depth: null })
        const d0 = {};
        const pc0 = await rp0.start(d0, make_sys());
        // console.dir(pc0, { depth: null })
        (0, code_1.expect)(pc0).includes({
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
        });
    });
});
//# sourceMappingURL=point.test.js.map