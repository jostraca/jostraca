"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InjectOp = void 0;
const jostraca_1 = require("../jostraca");
const basic_1 = require("../util/basic");
const FileHandler_1 = require("../build/FileHandler");
const ON = 'InjectOp:';
// Log non-fatal weirdness.
const dlog = (0, basic_1.getdlog)('jostraca', __filename);
const InjectOp = {
    before(node, _ctx$, buildctx) {
        const cfile = buildctx.current.file = node;
        (0, FileHandler_1.validName)(node.name, 'Inject', ON + 'before:');
        cfile.fullpath = buildctx.folderPath() + '/' + node.name;
        cfile.content = [];
    },
    after(node, ctx$, buildctx) {
        const { current } = buildctx;
        const fs = ctx$.fs();
        const cfile = current.file;
        let content = cfile.content.join('');
        // const rpath = cfile.path.join('/') // NOT Path.sep - needs to be canonical
        let exclude = node.exclude;
        /* buildctx.info ?
        if (info && null == exclude) {
          exclude = info.exclude.includes(rpath)
          if (!exclude && true === ctx$.opts.exclude) {
            const stat = fs.statSync(cfile.fullpath, { throwIfNoEntry: false })
            if (stat) {
              let timedelta = stat.mtimeMs - info.last
              if ((timedelta > 0 && timedelta < stat.mtimeMs)) {
                exclude = true
              }
            }
          }
        }
        */
        if (!exclude) {
            const FN = 'after:';
            const fullpath = cfile.fullpath;
            const markers = node.meta.markers;
            // Inject rewrites a region of an existing file. A missing target is a
            // user error worth naming: previously this surfaced as a bare ENOENT
            // from readFileSync, with no indication of which component caused it.
            if (!fs.existsSync(fullpath)) {
                throw new Error(ON + FN + ' inject target does not exist, path=' + fullpath +
                    ' (Inject rewrites an existing file; use File to create one)');
            }
            let src = fs.readFileSync(fullpath, 'utf8');
            content = markers.join(content);
            // Escape markers so regex metacharacters in custom markers are matched
            // literally, and use a replacement function so `$`-sequences in the
            // injected content (e.g. `$1`, `$&`, shell/PHP/JS variables) are not
            // interpreted as special replacement patterns.
            let re = new RegExp(markers.map(jostraca_1.escre).join('(.*?)'), 'sg');
            let matched = false;
            src = src.replace(re, () => (matched = true, content));
            // No marker pair in the target means the injection silently did
            // nothing. Not fatal — the file may legitimately not be marked up yet
            // — but it should not be invisible.
            if (!matched) {
                dlog('inject', 'markers not found, nothing injected: path=' + fullpath +
                    ' markers=' + JSON.stringify(markers));
            }
            buildctx.fh.save(fullpath, src);
        }
        /*
        else {
          if (!info.exclude.includes(rpath)) {
            info.exclude.push(rpath)
          }
          }
          */
    },
};
exports.InjectOp = InjectOp;
//# sourceMappingURL=InjectOp.js.map