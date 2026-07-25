"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileOp = void 0;
const FileHandler_1 = require("../build/FileHandler");
const ON = 'FileOp:';
const FileOp = {
    before(node, _ctx$, buildctx) {
        const cfile = buildctx.current.file = node;
        const name = node.name;
        (0, FileHandler_1.validName)(name, 'File', ON + 'before:');
        // folderPath() falls back to the base output folder when no Project or
        // Folder has seeded the path, so a top-level File stays inside the
        // output folder instead of resolving to '/<name>'.
        cfile.fullpath = buildctx.folderPath() + '/' + name;
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