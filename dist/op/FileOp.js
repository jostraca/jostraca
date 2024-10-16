"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileOp = void 0;
const FileOp = {
    before(node, _ctx$, buildctx) {
        const cfile = buildctx.current.file = node;
        cfile.filepath = buildctx.current.folder.path.join('/') + '/' + node.name;
        cfile.content = [];
    },
    after(node, ctx$, buildctx) {
        // console.log('FB-LOG', buildctx.log)
        const { fs, log, current } = buildctx;
        const cfile = current.file;
        const content = cfile.content.join('');
        const rpath = cfile.path.join('/'); // NOT Path.sep - needs to be canonical
        const fileExists = fs.existsSync(cfile.filepath);
        let exclude = node.exclude;
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
        // console.log('FILE-a exclude', rpath, exclude, !!log)
        if (log && null == exclude) {
            exclude = log.exclude.includes(rpath);
            if (!exclude && true === ctx$.opts.exclude) {
                const stat = fs.statSync(cfile.filepath, { throwIfNoEntry: false });
                if (stat) {
                    let timedelta = stat.mtimeMs - log.last;
                    if ((timedelta > 0 && timedelta < stat.mtimeMs)) {
                        exclude = true;
                        // console.log('FILEOP-STAT', rpath, timedelta, exclude, stat?.mtimeMs, log.last)
                    }
                }
            }
        }
        // console.log('FILE-a write', rpath, exclude) // , content.substring(0, 111))
        if (!exclude) {
            fs.writeFileSync(cfile.filepath, content, { flush: true });
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