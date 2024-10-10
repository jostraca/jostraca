"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopyOp = void 0;
const node_path_1 = __importDefault(require("node:path"));
const jostraca_1 = require("../jostraca");
const utility_1 = require("../utility");
const FileOp_1 = require("./FileOp");
const CopyOp = {
    before(node, ctx$, buildctx) {
        const fs = buildctx.fs;
        // TODO: do these need null checks here?
        const name = node.name;
        const from = node.from;
        const fromStat = fs.statSync(from);
        if (fromStat.isFile()) {
            FileOp_1.FileOp.before(node, ctx$, buildctx);
            const topath = buildctx.current.file.path;
            const state = {
                fileCount: 0,
                folderCount: 0,
                tmCount: 0,
                ctx$,
                buildctx,
            };
            const spec = { name, frompath: from, topath };
            let content = processTemplate(state, fs.readFileSync(from).toString(), spec);
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
        const log = buildctx.log;
        const kind = node.after.kind;
        const frompath = node.from;
        const topath = buildctx.current.folder.path.join('/');
        let exclude = node.exclude;
        if (log && true === exclude) {
            return;
        }
        if ('file' === kind) {
            FileOp_1.FileOp.after(node, ctx$, buildctx);
        }
        else if ('copy' === kind) {
            const state = {
                fileCount: 0,
                folderCount: 0,
                tmCount: 0,
                ctx$,
                buildctx,
            };
            // TODO: node.path is wrong
            // change prop.name to prop.to and account for subfolders
            walk(state, node.path, frompath, topath);
        }
        else {
            throw new Error('Unknown kind=' + kind + ' for file: ' + frompath);
        }
    },
};
exports.CopyOp = CopyOp;
function walk(state, nodepath, from, to) {
    const buildctx = state.buildctx;
    const fs = buildctx.fs;
    const entries = fs.readdirSync(from);
    for (let name of entries) {
        const frompath = node_path_1.default.join(from, name);
        const topath = node_path_1.default.join(to, name);
        const stat = fs.statSync(frompath);
        if (stat.isDirectory()) {
            state.folderCount++;
            walk(state, nodepath.concat(name), frompath, topath);
        }
        else if (isTemplate(name)) {
            if (excludeFile(state, nodepath, name, topath)) {
                continue;
            }
            const src = fs.readFileSync(frompath, 'utf8');
            const out = genTemplate(state, src, { name, frompath, topath });
            writeFileSync(buildctx, topath, out);
            state.fileCount++;
            state.tmCount++;
        }
        else if (!ignored(state, nodepath, name, topath)) {
            if (excludeFile(state, nodepath, name, topath)) {
                continue;
            }
            copyFileSync(buildctx, frompath, topath);
            state.fileCount++;
        }
    }
}
function ignored(state, nodepath, name, topath) {
    return !name.match(/(~|-jostraca-off)$/);
}
function excludeFile(state, nodepath, name, topath) {
    const { opts } = state.ctx$;
    if (true !== opts.exclude) {
        return false;
    }
    const { fs, log } = state.buildctx;
    let exclude = false;
    // NOT Path.sep - needs to be canonical
    const rpath = nodepath.concat(name).join('/');
    if (log) {
        exclude = log.exclude.includes(rpath);
        let stat, timedelta;
        if (!exclude) {
            stat = fs.statSync(topath, { throwIfNoEntry: false });
            if (stat) {
                timedelta = stat.mtimeMs - log.last;
                if (stat && (timedelta > 0 && timedelta < stat.mtimeMs)) {
                    exclude = true;
                    // console.log('COPYOP-STAT', rpath, timedelta, exclude, stat?.mtimeMs, log.last)
                }
            }
        }
        // if ('sdk.js' === name) {
        // console.log('COPYSTAT', rpath, frompath,
        //   timedelta,
        //   log.exclude.includes(rpath),
        //   stat?.mtimeMs - log.last,
        //   stat?.mtimeMs, log.last, exclude)
        // }
    }
    if (exclude && log && !log.exclude.includes(rpath)) {
        // NOT Path.sep - has to be canonical
        log.exclude.push(rpath);
    }
    // console.log('COPY-EXCLUDE', rpath, exclude)
    return exclude;
}
function writeFileSync(buildctx, path, content) {
    // console.log('WF', path)
    const fs = buildctx.fs;
    // TODO: check excludes
    fs.mkdirSync(node_path_1.default.dirname(path), { recursive: true });
    fs.writeFileSync(path, content, 'utf8', { flush: true });
}
function copyFileSync(buildctx, frompath, topath) {
    const fs = buildctx.fs;
    const isBinary = utility_1.BINARY_EXT.includes(node_path_1.default.extname(frompath));
    // TODO: check excludes
    fs.mkdirSync(node_path_1.default.dirname(topath), { recursive: true });
    const contents = fs.readFileSync(frompath, isBinary ? undefined : 'utf8');
    fs.writeFileSync(topath, contents, { flush: true });
}
function processTemplate(state, src, spec) {
    if (isTemplate(spec.name)) {
        return genTemplate(state, src, spec);
    }
    return src;
}
function isTemplate(name) {
    // TODO: need a better way; alsp should be configurable
    return !name.match(/\.(gif|jpe?g|png|ico|bmp|tiff)$/i);
}
// NOTE: $$foo.bar$$ format used as explicit start and end markers mean regex can be used
// unambiguously ($fooa would not match `foo`)
function genTemplate(state, src, spec) {
    let model = state.ctx$.model; // { foo: 'FOO', bar: 'BAR' }
    let out = '';
    let remain = src;
    let nextm = true;
    while (nextm) {
        let m = remain.match(/\$\$([^$]+)\$\$/);
        if (m) {
            let ref = m[1];
            out += remain.substring(0, m.index);
            let insert = (0, jostraca_1.getx)(model, ref);
            if (null == insert) {
                out += '$$' + ref + '$$';
                remain = remain.substring(m.index + 4 + ref.length);
            }
            else {
                out += insert;
                remain = remain.substring(m.index + 4 + ref.length);
            }
        }
        else {
            out += remain;
            nextm = false;
        }
    }
    return out;
}
//# sourceMappingURL=CopyOp.js.map