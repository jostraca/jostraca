"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectOp = void 0;
const node_path_1 = __importDefault(require("node:path"));
const ProjectOp = {
    before(node, ctx$, buildctx) {
        // console.log('PROJECT-B', node.folder, ctx$.folder)
        node.folder = null == node.folder || '' === node.folder ? '.' : node.folder;
        node.folder = node_path_1.default.isAbsolute(node.folder) ? node.folder : node_path_1.default.join(ctx$.folder, node.folder);
        // console.log('PROJECT-B folder', node.folder)
        buildctx.current.project = { node };
        buildctx.current.folder = {
            node,
            path: node.folder.split(node_path_1.default.sep),
        };
        buildctx.fs.mkdirSync(node.folder, { recursive: true });
    },
    after(_node, _ctx$, _buildctx) { },
};
exports.ProjectOp = ProjectOp;
//# sourceMappingURL=ProjectOp.js.map