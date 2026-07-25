"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopyOp = void 0;
const node_path_1 = __importDefault(require("node:path"));
const jostraca_1 = require("../jostraca");
const basic_1 = require("../util/basic");
// Log non-fatal weirdness.
const dlog = (0, basic_1.getdlog)('jostraca', __filename);
const FileHandler_1 = require("../build/FileHandler");
const FileOp_1 = require("./FileOp");
const ON = 'Copy:';
const IGNORED_RE = /(~|-jostraca-off)$/;
const CopyOp = {
    before(node, ctx$, buildctx) {
        const fs = ctx$.fs();
        // TODO: do these need null checks here?
        let name = node.name;
        const from = node.from;
        const fromStat = fs.statSync(from);
        if (fromStat.isFile()) {
            if (null == node.name || '' === node.name) {
                name = node.name = node_path_1.default.basename(from);
            }
            FileOp_1.FileOp.before(node, ctx$, buildctx);
            const topath = buildctx.current.file.path;
            const state = {
                fileCount: 0,
                folderCount: 0,
                tmCount: 0,
                ctx$,
                buildctx,
            };
            const spec = { name, frompath: from, topath: topath.join('/') };
            let content = processTemplate(state, fs.readFileSync(from), spec);
            buildctx.current.file.content.push(content);
            node.after = node.after || {};
            node.after.kind = 'file';
        }
        else if (fromStat.isDirectory()) {
            if (null != from && '' != from) {
                node.after = node.after || {};
                node.after.kind = 'copy';
            }
        }
        else {
            throw new Error('Unable to process file: ' + from);
        }
    },
    after(node, ctx$, buildctx) {
        const fs = ctx$.fs();
        const kind = node.after.kind;
        const frompath = node.from;
        let topath = buildctx.folderPath();
        const state = {
            fileCount: 0,
            folderCount: 0,
            tmCount: 0,
            ctx$,
            buildctx,
            node,
            // Real directory paths already entered, for symlink-cycle detection.
            visited: new Set(),
            excludes: 'string' === node.exclude ? [node.exclude] :
                Array.isArray(node.exclude) ? node.exclude :
                    []
        };
        // node.name carries the Copy `to` prop.
        (0, FileHandler_1.validName)(node.name, 'Copy(to)', ON + 'after:');
        topath = null == node.name ? topath : topath + '/' + node.name;
        if ('file' === kind) {
            copyFile(frompath, topath, state, buildctx, fs);
            // FileOp.after(node, ctx$, buildctx)
        }
        else if ('copy' === kind) {
            walk(fs, state, node.path, frompath, topath);
        }
        else {
            // TODO: need Standrd JostracaError
            throw new Error('Unknown kind=' + kind + ' for file: ' + frompath);
        }
    },
};
exports.CopyOp = CopyOp;
const MAX_COPY_DEPTH = 64;
function walk(fs, state, nodepath, from, to) {
    const FN = 'walk:';
    const buildctx = state.buildctx;
    // statSync follows symlinks, so a link pointing at one of its own
    // ancestors used to recurse until the stack blew. Track the real paths
    // already entered on this branch, and cap depth as a backstop for
    // filesystems where realpath cannot resolve.
    const realfrom = realpath(fs, from);
    if (state.visited.has(realfrom)) {
        dlog('copy', 'symlink cycle, not descending: ' + from + ' -> ' + realfrom);
        return;
    }
    if (MAX_COPY_DEPTH < nodepath.length) {
        throw new Error(ON + FN + ' copy tree too deep (>' + MAX_COPY_DEPTH +
            '), possible symlink cycle, path=' + from);
    }
    state.visited.add(realfrom);
    const entries = fs.readdirSync(from).sort();
    for (let name of entries) {
        const frompath = from + '/' + name;
        const topath = to + '/' + name;
        const stat = fs.statSync(frompath);
        const isDirectory = stat.isDirectory();
        const isTemplateFile = isTemplate(name);
        const isIgnored = ignored(state, nodepath, name, topath);
        // The ignore rule (`~` backups, `-jostraca-off`) has to be checked
        // before the template/binary split. It used to sit only on the binary
        // branch, so it never applied to text files — i.e. to almost
        // everything, and `-jostraca-off` did nothing at all.
        if (isIgnored) {
            continue;
        }
        if (isDirectory) {
            state.folderCount++;
            walk(fs, state, nodepath.concat(name), frompath, topath);
        }
        else if (isTemplateFile) {
            const excluded = excludeFile(fs, state, nodepath, name, topath);
            if (excluded) {
                continue;
            }
            copyFile(frompath, topath, state, buildctx, fs);
            state.fileCount++;
            state.tmCount++;
        }
        else {
            const excluded = excludeFile(fs, state, nodepath, name, topath);
            if (excluded) {
                continue;
            }
            buildctx.fh.copy(frompath, topath, ON + FN);
            state.fileCount++;
        }
    }
}
function copyFile(frompath, topath, state, buildctx, fs) {
    const FN = 'copyFile:';
    // Read bytes, not utf8. The extension list that routed us here cannot be
    // exhaustive (.wasm, .zst, .sqlite, extensionless binaries), and decoding
    // a binary as utf8 then re-encoding it replaces every invalid sequence
    // with U+FFFD — corrupting the copy. Sniff the content and pass bytes
    // through untouched when it does not look like text.
    const raw = fs.readFileSync(frompath);
    if ((0, basic_1.isbincontent)(raw)) {
        buildctx.fh.save(topath, raw, ON + FN);
        return;
    }
    const src = raw.toString('utf8');
    const out = (0, jostraca_1.template)(src, state.ctx$.model, { replace: state.node.replace });
    buildctx.fh.save(topath, out, ON + FN);
}
// TODO: needs an option
function ignored(state, nodepath, name, topath) {
    return IGNORED_RE.test(name);
}
// Resolve a directory to its canonical path so a symlink and its target
// compare equal. Providers without realpathSync (or a path that cannot be
// resolved) fall back to the path as given — the depth cap still applies.
function realpath(fs, p) {
    if ('function' !== typeof fs.realpathSync) {
        return p;
    }
    try {
        return fs.realpathSync(p);
    }
    catch (err) {
        return p;
    }
}
function excludeFile(fs, state, nodepath, name, topath) {
    const { opts } = state.ctx$;
    const { log } = state.buildctx;
    let exclude = false;
    for (let ignoreRE of opts.cmp.Copy.ignore) {
        if (ignoreRE.test(name)) {
            return true;
        }
    }
    // NOT Path.sep - needs to be canonical
    const rpath = nodepath.concat(name).join('/');
    // TOOD: use exclude only for actual excludes, refactor logic to ignore if exists,
    // use a different prop for that
    // const fileExists = fs.existsSync(topath)
    if (excluded(rpath, state.excludes)) {
        return true;
    }
    if (true !== opts.exclude) {
        return false;
    }
    if (log) {
        exclude = log.exclude.includes(rpath);
        let stat, timedelta;
        if (!exclude) {
            stat = fs.statSync(topath, { throwIfNoEntry: false });
            if (stat) {
                timedelta = stat.mtimeMs - log.last;
                if (stat && (timedelta > 0 && timedelta < stat.mtimeMs)) {
                    exclude = true;
                }
            }
        }
    }
    if (exclude && log && !log.exclude.includes(rpath)) {
        // NOT Path.sep - has to be canonical
        log.exclude.push(rpath);
    }
    return exclude;
}
function excluded(path, excludes) {
    for (const exc of excludes) {
        if ('string' === typeof exc) {
            if (exc === path)
                return true;
        }
        else if (exc instanceof RegExp) {
            if (exc.test(path))
                return true;
        }
    }
    return false;
}
function processTemplate(state, raw, spec) {
    // Same reasoning as copyFile: the extension check alone is not enough to
    // know a file is safe to decode and re-encode as utf8.
    if (isTemplate(spec.name) && !(0, basic_1.isbincontent)(raw)) {
        return (0, jostraca_1.template)(raw.toString('utf8'), state.ctx$.model, {
            replace: {
                ...(state.node?.replace || {}),
            }
        });
    }
    return raw;
}
function isTemplate(name) {
    return !(0, jostraca_1.isbinext)(name);
}
//# sourceMappingURL=CopyOp.js.map