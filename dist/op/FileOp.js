"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileOp = void 0;
const FileOp = {
    before(node, _ctx$, buildctx) {
        const cfile = buildctx.current.file = node;
        cfile.filepath = buildctx.current.folder.path.join('/') + '/' + node.name;
        cfile.content = [];
    },
    after(node, _ctx$, buildctx) {
        // console.log('FB-INFO', buildctx.info)
        const { fs, info, current } = buildctx;
        const cfile = current.file;
        const content = cfile.content.join('');
        const rpath = cfile.path.join('/'); // NOT Path.sep - needs to be canonical
        let exclude = node.exclude;
        // console.log('FILE-a exclude', rpath, exclude, !!info)
        if (info && null == exclude) {
            exclude = info.exclude.includes(rpath);
            if (!exclude) {
                const stat = fs.statSync(cfile.filepath, { throwIfNoEntry: false });
                if (stat) {
                    let timedelta = stat.mtimeMs - info.last;
                    if ((timedelta > 0 && timedelta < stat.mtimeMs)) {
                        exclude = true;
                    }
                    // console.log('STAT', rpath, timedelta, exclude, stat?.mtimeMs, info.last)
                }
            }
        }
        // console.log('FILE-a write', rpath, exclude) // , content.substring(0, 111))
        if (!exclude) {
            fs.writeFileSync(cfile.filepath, content);
        }
        else {
            if (!info.exclude.includes(rpath)) {
                info.exclude.push(rpath);
            }
        }
    },
};
exports.FileOp = FileOp;
//# sourceMappingURL=FileOp.js.map