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
        // Save the enclosing file. An Inject makes itself current.file so its
        // children accumulate into the injected region rather than into the
        // file around it, and it has to put that back in after() - the same
        // save/restore FragmentOp and SlotOp do. Without it every later sibling
        // of the Inject accumulated into the Inject's buffer, and the enclosing
        // File then wrote that buffer over the Inject's TARGET, destroying a
        // file the build was only supposed to edit a region of. Same defect as
        // the nested Copy in #39, one component along.
        node.meta.inject_file = buildctx.current.file;
        const cfile = buildctx.current.file = node;
        (0, FileHandler_1.validName)(node.name, 'Inject', ON + 'before:');
        cfile.fullpath = buildctx.folderPath() + '/' + node.name;
        cfile.content = [];
    },
    after(node, ctx$, buildctx) {
        const fs = ctx$.fs();
        // Read the node's own buffer rather than current.file, and put the
        // enclosing file back before anything below can throw.
        //
        // Nothing is pushed into it, unlike FragmentOp and SlotOp: an Inject
        // writes to its own target and contributes no text to the file that
        // contains it. Matches Go, whose fileAfter splices its KindInject
        // children and finds no Content because injectAfter never sets any.
        const cfile = node;
        buildctx.current.file = node.meta.inject_file;
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