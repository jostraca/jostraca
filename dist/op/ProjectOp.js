"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectOp = void 0;
const node_path_1 = __importDefault(require("node:path"));
const ProjectOp = {
    before(node, ctx$, buildctx) {
        node.folder = null == node.folder || '' === node.folder ? '.' : node.folder;
        node.folder =
            node_path_1.default.isAbsolute(node.folder) ? node.folder : node_path_1.default.join(ctx$.folder, node.folder);
        buildctx.current.project = { node };
        buildctx.current.folder.node = node;
        buildctx.current.folder.path = node.folder.split(node_path_1.default.sep);
        // ctx$.fs().mkdirSync(node.folder, { recursive: true })
        buildctx.fh.ensureFolder(node.folder);
    },
    after(_node, _ctx$, _buildctx) { },
};
exports.ProjectOp = ProjectOp;
//# sourceMappingURL=ProjectOp.js.map