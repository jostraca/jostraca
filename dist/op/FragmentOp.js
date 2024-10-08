"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FragmentOp = void 0;
const FragmentOp = {
    before(node, _ctx$, buildctx) {
    },
    after(node, _ctx$, buildctx) {
        const { fs } = buildctx;
        const frompath = node.from;
        const src = fs.readFileSync(frompath, 'utf8');
        buildctx.current.file.content.push(src);
    },
};
exports.FragmentOp = FragmentOp;
//# sourceMappingURL=FragmentOp.js.map