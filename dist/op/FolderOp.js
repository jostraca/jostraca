"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FolderOp = void 0;
const FolderOp = {
    before(node, _ctx$, buildctx) {
        const cfolder = buildctx.current.folder = (buildctx.current.folder || {});
        cfolder.node = node;
        cfolder.path = (0 < cfolder.path.length ? cfolder.path : [buildctx.current.folder.parent]);
        cfolder.path.push(node.name);
        let fullpath = cfolder.path.join('/');
        if ('' !== fullpath) {
            // ctx$.fs().mkdirSync(fullpath, { recursive: true )}
            buildctx.fh.ensureFolder(fullpath);
        }
    },
    after(_node, _ctx$, buildctx) {
        const cfolder = buildctx.current.folder;
        cfolder.path.length = cfolder.path.length - 1;
    },
};
exports.FolderOp = FolderOp;
//# sourceMappingURL=FolderOp.js.map