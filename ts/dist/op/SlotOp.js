"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlotOp = void 0;
const SlotOp = {
    before(node, _ctx$, buildctx) {
        node.meta.fragment_file = buildctx.current.file;
        const cfile = buildctx.current.file = node;
        cfile.filepath = buildctx.current.folder.path.join('/') + '?slot=' + node.name;
        cfile.content = [];
    },
    after(node, _ctx$, buildctx) {
        let src = node.content?.join('') || '';
        buildctx.current.file = node.meta.fragment_file;
        buildctx.current.file.content.push(src);
    },
};
exports.SlotOp = SlotOp;
//# sourceMappingURL=SlotOp.js.map