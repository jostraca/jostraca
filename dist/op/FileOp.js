"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileOp = void 0;
const node_path_1 = __importDefault(require("node:path"));
const FileOp = {
    before(node, _ctx$, buildctx) {
        const cfile = buildctx.current.file = node;
        cfile.filepath = buildctx.current.folder.path.join('/') + '/' + node.name;
        cfile.content = [];
    },
    after(node, ctx$, buildctx) {
        const cfile = buildctx.current.file;
        const content = cfile.content.join('');
        const rpath = cfile.path.join('/'); // NOT Path.sep - needs to be canonical
        let exclude = node.exclude;
        // console.log('FILE-a exclude', cfile.path, exclude)
        if (ctx$.info && null == exclude) {
            exclude = ctx$.info.exclude.includes(rpath);
            if (!exclude) {
                const stat = buildctx.fs.statSync(cfile.filepath, { throwIfNoEntry: false });
                if (stat && stat.mtimeMs > ctx$.info.last) {
                    exclude = true;
                }
                console.log('STAT', cfile.rpath, stat?.mtimeMs, ctx$.info.last, exclude);
            }
        }
        // console.log('FILE-a write', cfile.path, exclude) // , content.substring(0, 111))
        if (!exclude) {
            buildctx.fs.writeFileSync(cfile.filepath, content);
        }
        else {
            if (!ctx$.info.exclude.includes(node_path_1.default.join(rpath))) {
                ctx$.info.exclude.push(node_path_1.default.join(rpath));
            }
        }
    },
};
exports.FileOp = FileOp;
//# sourceMappingURL=FileOp.js.map