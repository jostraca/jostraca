"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectOp = void 0;
const node_path_1 = __importDefault(require("node:path"));
const ProjectOp = {
    before(node, ctx$, buildctx) {
        node.folder = (node.folder ||
            ctx$.folder + '/__project__' || // Fake current folder, so Folder cmp will work
            '.');
        buildctx.current.project = { node };
        buildctx.current.folder = {
            node,
            path: node_path_1.default.dirname(node.folder).split(node_path_1.default.sep),
        };
    },
    after(_node, _ctx$, _buildctx) { },
};
exports.ProjectOp = ProjectOp;
//# sourceMappingURL=ProjectOp.js.map