"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InjectOp = void 0;
const InjectOp = {
    before(node, _ctx$, buildctx) {
        const cfile = buildctx.current.file = node;
        cfile.filepath = buildctx.current.folder.path.join('/') + '/' + node.name;
        cfile.content = [];
    },
    after(node, _ctx$, buildctx) {
        const { fs, info, current } = buildctx;
        const cfile = current.file;
        let content = cfile.content.join('');
        const rpath = cfile.path.join('/'); // NOT Path.sep - needs to be canonical
        let exclude = node.exclude;
        if (info && null == exclude) {
            exclude = info.exclude.includes(rpath);
            if (!exclude) {
                const stat = fs.statSync(cfile.filepath, { throwIfNoEntry: false });
                if (stat) {
                    let timedelta = stat.mtimeMs - info.last;
                    if ((timedelta > 0 && timedelta < stat.mtimeMs)) {
                        exclude = true;
                    }
                }
            }
        }
        // console.log('FILE-a write', rpath, exclude) // , content.substring(0, 111))
        if (!exclude) {
            let src = fs.readFileSync(cfile.filepath, 'utf8');
            content = node.meta.markers.join(content);
            // console.log(content)
            let re = new RegExp(node.meta.markers.join('(.*?)'), 'sg');
            // console.log(re)
            src = src.replace(re, content);
            // console.log(src)
            fs.writeFileSync(cfile.filepath, src, { flush: true });
        }
        else {
            if (!info.exclude.includes(rpath)) {
                info.exclude.push(rpath);
            }
        }
    },
};
exports.InjectOp = InjectOp;
//# sourceMappingURL=InjectOp.js.map