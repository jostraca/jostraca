"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileOp = void 0;
const node_path_1 = __importDefault(require("node:path"));
const ON = 'File:';
const FileOp = {
    before(node, _ctx$, buildctx) {
        // TODO: error if not inside a folder
        const cfile = buildctx.current.file = node;
        const name = node.name;
        cfile.fullpath = node_path_1.default.join(buildctx.current.folder.path.join(node_path_1.default.sep), name);
        cfile.content = [];
    },
    after(node, ctx$, buildctx) {
        const FN = 'after:';
        const { log, current } = buildctx;
        const fs = ctx$.fs();
        const cfile = current.file;
        const content = cfile.content?.join('');
        const rpath = cfile.path?.join('/'); // NOT Path.sep - needs to be canonical
        const fileExists = fs.existsSync(cfile.fullpath);
        let exclude = true === node.exclude;
        if (fileExists) {
            if (true === exclude) {
                return;
            }
            const excludes = 'string' === node.exclude ? [node.exclude] :
                Array.isArray(node.exclude) ? node.exclude :
                    [];
            if (excludes.includes(rpath)) {
                return;
            }
        }
        else {
            exclude = false;
        }
        if (log && null == exclude) {
            exclude = log.exclude.includes(rpath);
            if (!exclude && true === ctx$.opts.exclude) {
                const stat = fs.statSync(cfile.fullpath, { throwIfNoEntry: false });
                if (stat) {
                    let timedelta = stat.mtimeMs - log.last;
                    if ((timedelta > 0 && timedelta < stat.mtimeMs)) {
                        exclude = true;
                    }
                }
            }
        }
        const fullpath = cfile.fullpath;
        if (!exclude) {
            buildctx.fh.save(fullpath, content, ON + FN);
        }
        else {
            if (!log.exclude.includes(rpath)) {
                log.exclude.push(rpath);
            }
        }
    },
};
exports.FileOp = FileOp;
//# sourceMappingURL=FileOp.js.map