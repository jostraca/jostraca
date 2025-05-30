"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrintPoint = exports.FuncPoint = exports.ParallelPoint = exports.SerialPoint = exports.RootPoint = exports.Point = void 0;
exports.buildPoints = buildPoints;
exports.makeFuncDef = makeFuncDef;
const gubu_1 = require("gubu");
const basic_1 = require("./basic");
class Point {
    constructor(id, name) {
        this.id = id;
        this.name = name;
    }
    async runner(pctx) {
        const suffix = (null == this.name || '' === this.name) ? '' : ':' + this.name;
        this.logger(pctx, {
            note: this.constructor.name + ':before:' + this.id + suffix, args: this.args
        });
        if (pctx.async) {
            await this.run(pctx);
        }
        else {
            this.run(pctx);
        }
        this.logger(pctx, {
            note: this.constructor.name + ':after:' + this.id + suffix, args: this.args
        });
    }
    logger(pctx, entry) {
        entry.note = null == entry.note ? 'none' : entry.note;
        entry.when = pctx.sys().now();
        entry.depth = pctx.depth;
        if (undefined === entry.args) {
            delete entry.args;
        }
        pctx.log.push(entry);
    }
}
exports.Point = Point;
class SerialPoint extends Point {
    constructor(id) {
        super(id);
        this.points = [];
    }
    add(p) {
        this.points.push(p);
    }
    async run(pctx) {
        let childctx = { ...pctx };
        childctx.depth++;
        for (let p of this.points) {
            if (pctx.async) {
                await p.runner(childctx);
            }
            else {
                p.runner(childctx);
            }
        }
    }
}
exports.SerialPoint = SerialPoint;
class RootPoint extends SerialPoint {
    constructor(id) {
        super(id);
        this.points = [];
    }
    direct(data, sys) {
        const pctx = this.makePointCtx(false, data, sys);
        this.runner(pctx);
        return pctx;
    }
    async start(data, sys) {
        const pctx = this.makePointCtx(true, data, sys);
        await this.runner(pctx);
        return pctx;
    }
    makePointCtx(async, data, sys) {
        const pctx = {
            async,
            log: [],
            data: data || {},
            depth: 0,
            sys: sys || (() => ({
                now: () => Date.now(),
                print: (...s) => {
                    if (null != s[0] && 'string' === typeof s[0]) {
                        console.dir(s[0], s[1] || { depth: null });
                    }
                    else {
                        console.log(...s);
                    }
                }
            }))
        };
        return pctx;
    }
}
exports.RootPoint = RootPoint;
class ParallelPoint extends Point {
    constructor(id) {
        super(id);
        this.points = [];
    }
    add(p) {
        this.points.push(p);
    }
    async run(pctx) {
        let childctx = { ...pctx };
        childctx.depth++;
        await Promise.all(this.points.map(p => p.runner(childctx)));
    }
}
exports.ParallelPoint = ParallelPoint;
class FuncPoint extends Point {
    constructor(id, func) {
        super(id, func.name);
        this.func = func;
    }
    async run(pctx) {
        if (pctx.async) {
            await this.func(pctx);
        }
        else {
            this.func(pctx);
        }
    }
}
exports.FuncPoint = FuncPoint;
class PrintPoint extends Point {
    constructor(id, path) {
        super(id);
        this.path = path;
    }
    async run(pctx) {
        let print = pctx.sys().print;
        let d = pctx.data;
        if (null != this.path) {
            d = (0, basic_1.getx)(d, this.path);
        }
        if (null != d && 'object' === typeof d) {
            print('POINTCTX:');
            print(d);
        }
        else {
            print('POINTCTX: ' + d);
        }
    }
}
exports.PrintPoint = PrintPoint;
const PointDefShape = (0, gubu_1.Gubu)({
    k: (0, gubu_1.Skip)(String),
    n: (0, gubu_1.Skip)(String),
    p: (0, gubu_1.Skip)([]),
    a: (0, gubu_1.Any)(),
    m: {}
});
function buildPoints(pdef, pm, id) {
    let idi = 0;
    id = id || (() => (++idi) + '');
    let p = undefined;
    // TODO: fix point kind resolution to be more extensible
    pdef = PointDefShape(pdef);
    let isSerial = 'Serial' === pdef.k || Array.isArray(pdef.p);
    const mp = pm[pdef.k];
    if (null != mp) {
        p = mp(id, pdef);
    }
    else if (null == pdef.k || 'Root' === pdef.k) {
        const rp = new RootPoint(id());
        let cp = pdef.p;
        for (let c of cp) {
            rp.add(buildPoints(c, pm, id));
        }
        p = rp;
        isSerial = false;
    }
    else if ('Parallel' === pdef.k) {
        const sp = new ParallelPoint(id());
        let cp = pdef.p;
        for (let c of cp) {
            sp.add(buildPoints(c, pm, id));
        }
        p = sp;
        isSerial = false;
    }
    if (isSerial) {
        const sp = (p || new SerialPoint(id()));
        let cp = pdef.p;
        for (let c of cp) {
            sp.add(buildPoints(c, pm, id));
        }
        p = sp;
    }
    if (null == p) {
        throw new Error('Unknown point kind: ' + JSON.stringify(pdef));
    }
    return p;
}
function makeFuncDef(fd) {
    return (id, pdef) => {
        const fp = new FuncPoint(id(), fd(pdef));
        fp.args = pdef.a;
        return fp;
    };
}
//# sourceMappingURL=point.js.map