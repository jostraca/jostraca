"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FragmentOp = void 0;
const jostraca_1 = require("../jostraca");
const FragmentOp = {
    before(node, _ctx$, buildctx) {
        node.meta.fragment_file = buildctx.current.file;
        const cfile = buildctx.current.file = node;
        cfile.filepath = buildctx.current.folder.path.join('/') + '?fragment=' + node.name;
        cfile.content = [];
    },
    after(node, _ctx$, buildctx) {
        let src = node.content?.join('') || '';
        if (null != node.indent) {
            src = (0, jostraca_1.indent)(src, node.indent);
        }
        buildctx.current.file = node.meta.fragment_file;
        buildctx.current.file.content.push(src);
    },
};
exports.FragmentOp = FragmentOp;
//# sourceMappingURL=FragmentOp.js.map