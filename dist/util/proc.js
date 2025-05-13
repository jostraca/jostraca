"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrintPoint = exports.FuncPoint = exports.ParentPoint = exports.Point = void 0;
const basic_1 = require("./basic");
class Point {
    constructor(id) {
        this.id = id;
    }
    async runner(pctx) {
        this.logger(pctx, { note: 'before:' + this.id });
        await this.run(pctx);
        this.logger(pctx, { note: 'after:' + this.id });
    }
    logger(pctx, entry) {
        entry.note = null == entry.note ? 'none' : entry.note;
        entry.when = Date.now();
        pctx.log.push(entry);
    }
}
exports.Point = Point;
class ParentPoint extends Point {
    constructor(id) {
        super(id);
        this.points = [];
    }
    add(p) {
        this.points.push(p);
    }
    async start(data) {
        const pctx = {
            log: [],
            data: data || {},
        };
        await this.run(pctx);
        return pctx;
    }
    async run(pctx) {
        await Promise.all(this.points.map(p => p.runner(pctx)));
    }
}
exports.ParentPoint = ParentPoint;
class FuncPoint extends Point {
    constructor(id, func) {
        super(id);
        this.func = func;
    }
    async run(pctx) {
        return this.func(pctx);
    }
}
exports.FuncPoint = FuncPoint;
class PrintPoint extends Point {
    constructor(id, path) {
        super(id);
        this.path = path;
    }
    async run(pctx) {
        let d = pctx.data;
        if (null != this.path) {
            d = (0, basic_1.getx)(d, this.path);
        }
        if (null != d && 'object' === typeof d) {
            console.log('POINTCTX:');
            console.dir(d, { depth: null });
        }
        else {
            console.log('POINTCTX: ' + d);
        }
    }
}
exports.PrintPoint = PrintPoint;
//# sourceMappingURL=proc.js.map