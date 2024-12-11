"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FolderOp = void 0;
const node_path_1 = __importDefault(require("node:path"));
const FolderOp = {
    before(node, ctx$, buildctx) {
        const cfolder = buildctx.current.folder = (buildctx.current.folder || {});
        cfolder.node = node;
        cfolder.path = (0 < cfolder.path.length ? cfolder.path : [buildctx.current.folder.parent]);
        cfolder.path.push(node.name);
        let fullpath = cfolder.path.join(node_path_1.default.sep);
        if ('' !== fullpath) {
            ctx$.fs().mkdirSync(fullpath, { recursive: true });
        }
    },
    after(_node, _ctx$, buildctx) {
        const cfolder = buildctx.current.folder;
        cfolder.path.length = cfolder.path.length - 1;
    },
};
exports.FolderOp = FolderOp;
//# sourceMappingURL=FolderOp.js.map