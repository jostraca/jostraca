"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FragmentOp = void 0;
const node_path_1 = __importDefault(require("node:path"));
const jostraca_1 = require("../jostraca");
const FragmentOp = {
    before(node, _ctx$, buildctx) {
        node.meta.fragment_file = buildctx.current.file;
        const cfile = buildctx.current.file = node;
        cfile.filepath = buildctx.current.folder.path.join('/') + '#' + node.name;
        cfile.content = [];
    },
    after(node, ctx$, buildctx) {
        const { fs } = buildctx;
        let frompath = node.from;
        // TODO: this is relative to the output - but that is just one case - provide more control?
        if (!node_path_1.default.isAbsolute(frompath)) {
            frompath = node_path_1.default.join(buildctx.folder, ...node.path, frompath);
        }
        let src = fs.readFileSync(frompath, 'utf8');
        let replace = {};
        let content = buildctx.current.file.content;
        if (0 < content.length) {
            replace['<[SLOT]>'] = content.join('');
        }
        const contentMap = node.meta.content_map || {};
        (0, jostraca_1.each)(contentMap, (content) => {
            replace['<[SLOT:' + content.key$ + ']>'] = content.join('');
        });
        // console.log('REPLACE', replace)
        src = (0, jostraca_1.template)(src, ctx$.model, { replace });
        // console.log('SRC', src)
        if ('string' === typeof node.indent) {
            src = src.replace(/([^\n]+\n)/g, node.indent + '$1');
        }
        buildctx.current.file = node.meta.fragment_file;
        buildctx.current.file.content.push(src);
    },
};
exports.FragmentOp = FragmentOp;
//# sourceMappingURL=FragmentOp.js.map