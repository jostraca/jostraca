"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FragmentOp = void 0;
const FragmentOp = {
    before(node, _ctx$, buildctx) {
        node.meta.fragment_file = buildctx.current.file;
        const cfile = buildctx.current.file = node;
        cfile.filepath = buildctx.current.folder.path.join('/') + '?fragment=' + node.name;
        cfile.content = [];
    },
    after(node, _ctx$, buildctx) {
        let src = node.content?.join('') || '';
        if ('string' === typeof node.indent) {
            src = src.replace(/([^\n]+\n)/g, node.indent + '$1');
        }
        buildctx.current.file = node.meta.fragment_file;
        buildctx.current.file.content.push(src);
    },
};
exports.FragmentOp = FragmentOp;
//# sourceMappingURL=FragmentOp.js.map