"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FragmentOp = void 0;
const node_path_1 = __importDefault(require("node:path"));
const FragmentOp = {
    before(node, _ctx$, buildctx) {
    },
    after(node, ctx$, buildctx) {
        const { fs } = buildctx;
        let frompath = node.from;
        // TODO: this is relative to the output - but that is just one case - provide more control?
        if (!node_path_1.default.isAbsolute(frompath)) {
            // console.log('FRAG REL', node.folder, node.path, frompath, '|') // , process.cwd(), buildctx)
            frompath = node_path_1.default.join(buildctx.folder, ...node.path, frompath);
            // console.log('FRAG RESOLVED', frompath)
        }
        let src = fs.readFileSync(frompath, 'utf8');
        if ('string' === typeof node.indent) {
            src = src.replace(/([^\n]+\n)/g, node.indent + '$1');
        }
        buildctx.current.file.content.push(src);
    },
};
exports.FragmentOp = FragmentOp;
//# sourceMappingURL=FragmentOp.js.map