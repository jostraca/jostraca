"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileOp = void 0;
const FileOp = {
    before(node, _ctx$, buildctx) {
        const cfile = buildctx.current.file = node;
        cfile.path = buildctx.current.folder.path.join('/') + '/' + node.name;
        cfile.content = [];
    },
    after(_node, _ctx$, buildctx) {
        const cfile = buildctx.current.file;
        const content = cfile.content.join('');
        buildctx.fs.writeFileSync(cfile.path, content);
    },
};
exports.FileOp = FileOp;
//# sourceMappingURL=FileOp.js.map