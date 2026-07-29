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
        const fullpath = cfile.fullpath;
        const fileExists = fs.existsSync(fullpath);
        if (fileExists) {
            if (true === node.exclude) {
                return;
            }
            // `'string' === node.exclude` compared the value against the literal
            // text "string", so a string exclude never matched anything.
            const excludes = 'string' === typeof node.exclude ? [node.exclude] :
                Array.isArray(node.exclude) ? node.exclude :
                    [];
            if (excludes.includes(rpath)) {
                return;
            }
            // Global Options.exclude: leave alone any output file modified on
            // disk since the last successful build.
            //
            // This was unreachable: `exclude` had already been assigned a boolean
            // above, so the `null == exclude` guard it sat behind was never true.
            // The Go port implements it, so TS is the side that was wrong.
            if (true === ctx$.opts.exclude) {
                const last = buildctx.bmeta.prev.last;
                const stat = fs.statSync(fullpath, { throwIfNoEntry: false });
                if (stat && 0 < last && stat.mtimeMs > last) {
                    if (!log.exclude.includes(rpath)) {
                        log.exclude.push(rpath);
                    }
                    return;
                }
            }
        }
        buildctx.fh.save(fullpath, content, ON + FN, undefined, node.mode);
    },
};
exports.FileOp = FileOp;
//# sourceMappingURL=FileOp.js.map