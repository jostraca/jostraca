"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileHandler = void 0;
exports.validPath = validPath;
const Diff = require('diff');
const Diff3 = require('node-diff3');
const node_path_1 = __importDefault(require("node:path"));
const basic_1 = require("../util/basic");
const CN = 'FileHandler:';
const JOSTRACA_PROTECT = 'JOSTRACA_PROTECT';
// TODO: if EOL != '\n', normalize to '\n' in load,save 
// Log non-fatal wierdness.
const dlog = (0, basic_1.getdlog)('jostraca', __filename);
class FileHandler {
    constructor(bctx, existing, control) {
        this.fs = bctx.fs;
        this.now = bctx.now;
        this.when = bctx.when;
        this.folder = node_path_1.default.normalize(bctx.folder);
        this.audit = bctx.audit;
        this.existing = existing;
        this.control = control;
        this.maxdepth = 22; // TODO: get from JostracaOptions
        this.files = {
            preserved: [],
            written: [],
            presented: [],
            diffed: [],
            merged: [],
            conflicted: [],
            unchanged: [],
        };
        // Yikes!
        this.duplicateFolder = bctx.duplicateFolder.bind(bctx);
        this.last = () => bctx.bmeta.prev.last;
        this.addmeta = bctx.addmeta.bind(bctx);
        this.metafile = () => bctx.bmeta.next.filename;
        if (!this.fs().existsSync) {
            throw new Error(CN + ' Invalid file system provider: ' + this.fs());
        }
    }
    relative(path, whence) {
        const FN = 'relative:';
        const wstr = null == whence ? '' : whence + ':';
        if ('string' !== typeof path) {
            throw new Error(CN + FN + wstr + ' invalid path, path=' + path);
        }
        const withinFolder = path.startsWith(this.folder);
        const rpath = withinFolder ? path.substring(this.folder.length).replace(/^\/+/, '') : path;
        return rpath;
    }
    save(path, newContentSource, write, whence) {
        const wstr = null == whence ? '' : whence + ':';
        const fs = this.fs();
        const FN = 'save:';
        let why = [];
        if ('string' === typeof write) {
            whence = write;
            write = false;
        }
        else if (null == write) {
            write = false;
        }
        whence = null == whence ? '' : whence;
        const existing = 'string' === typeof newContentSource ? this.existing.txt : this.existing.bin;
        path = node_path_1.default.normalize(path);
        const folder = node_path_1.default.dirname(path);
        const withinFolder = path.startsWith(this.folder) || ('.' === this.folder && !node_path_1.default.isAbsolute(path));
        const rpath = this.relative(path, FN + wstr);
        const exists = fs.existsSync(path);
        write = write || !exists;
        why.push(`start<${write ? 'w' : 'W'}${exists ? 'x' : 'X'}>`);
        const meta = {
            action: 'init',
            path: rpath,
            exists,
            actions: [],
            protect: false,
            conflict: false,
        };
        if (exists) {
            why.push('exists-0');
            let currentContent = this.loadFile(path);
            const protect = 0 <= currentContent.indexOf(JOSTRACA_PROTECT);
            meta.protect = protect;
            if (existing.preserve) {
                why.push('preserve-0');
                if (protect) {
                    why.push('protect-0');
                    write = false;
                }
                else if (currentContent.length !== newContentSource.length ||
                    currentContent !== newContentSource) {
                    why.push('content-0');
                    let oldpath = node_path_1.default.join(folder, node_path_1.default.basename(path).replace(/\.[^.]+$/, '') +
                        '.old' + node_path_1.default.extname(path));
                    this.copyFile(path, oldpath, whence + 'preserve:');
                    // this.files.preserved.push(path)
                    this.filelog('preserved', path);
                    meta.action = 'preserve';
                    whenify(meta, this.now());
                    meta.actions.push(meta.action);
                    this.audit.push([CN + FN + wstr + meta.action,
                        { ...meta, why, action: meta.action, path }]);
                }
            }
            if (existing.write && !protect) {
                why.push('write-0');
                write = true;
            }
            else if (existing.present) {
                why.push('present-0');
                if (currentContent.length !== newContentSource.length || currentContent !== newContentSource) {
                    why.push('content-1');
                    let newpath = node_path_1.default.join(folder, node_path_1.default.basename(path).replace(/\.[^.]+$/, '') +
                        '.new' + node_path_1.default.extname(path));
                    this.saveFile(newpath, newContentSource, { flush: true }, whence + 'present:');
                    this.filelog('presented', path);
                    meta.action = 'present';
                    whenify(meta, this.now());
                    meta.actions.push(meta.action);
                    this.audit.push([CN + FN + wstr + meta.action,
                        { ...meta, why, action: meta.action, path }]);
                }
            }
            if (!protect) {
                why.push('not-protect-1');
                if (existing.diff) {
                    why.push('diff-0');
                    write = false;
                    if (currentContent.length !== newContentSource.length ||
                        currentContent !== newContentSource) {
                        why.push('content-2');
                        meta.action = 'diff';
                        const newContent = 'string' === typeof newContentSource ? newContentSource :
                            newContentSource.toString('utf8');
                        const diffContent = this.diff(newContent, currentContent.toString());
                        this.saveFile(path, diffContent, { encoding: 'utf8' }, whence + meta.action);
                        // this.files.diffed.push(path)
                        this.filelog('diffed', path);
                        const conflict = newContent !== diffContent;
                        if (conflict) {
                            // this.files.conflicted.push(path)
                            this.filelog('conflicted', path);
                        }
                        whenify(meta, this.now());
                        meta.actions.push(meta.action);
                        meta.conflict = conflict;
                        this.audit.push([CN + FN + wstr + meta.action,
                            { ...meta, why, action: meta.action, path }]);
                    }
                    else {
                        // this.files.unchanged.push(path)
                        this.filelog('unchanged', path);
                    }
                }
                else if (existing.merge) {
                    why.push('merge-0');
                    if (currentContent.length !== newContentSource.length ||
                        currentContent !== newContentSource) {
                        why.push('content-3');
                        if (this.control.duplicate) {
                            why.push('duplicate-0');
                            const dfolder = this.duplicateFolder();
                            const dpath = node_path_1.default.join(dfolder, rpath);
                            if (this.existsFile(dpath)) {
                                why.push('dupexists-0');
                                write = false;
                                meta.action = 'merge';
                                const newContent = 'string' === typeof newContentSource ? newContentSource :
                                    newContentSource.toString('utf8');
                                const prevGenContent = this.loadFile(dpath, { encoding: 'utf8' });
                                const mergeres = this.merge(newContent, prevGenContent, currentContent.toString(), why);
                                const diffcontent = mergeres.content;
                                const conflict = mergeres.conflict;
                                this.saveFile(path, diffcontent, { encoding: 'utf8' }, whence + meta.action);
                                // this.files.merged.push(path)
                                this.filelog('merged', path);
                                if (conflict) {
                                    // this.files.conflicted.push(path)
                                    this.filelog('conflicted', path);
                                }
                                whenify(meta, this.now());
                                meta.actions.push(meta.action);
                                meta.conflict = conflict;
                                this.audit.push([CN + FN + wstr + meta.action,
                                    { ...meta, why, action: meta.action, path }]);
                            }
                        }
                    }
                    else {
                        why.push('unchanged-0');
                        write = false;
                        // this.files.unchanged.push(path)
                        this.filelog('unchanged', path);
                    }
                }
            }
        }
        if (write) {
            why.push('write-1');
            meta.action = 'write';
            this.saveFile(path, newContentSource, whence + meta.action);
            // this.files.written.push(path)
            this.filelog('written', path);
            meta.actions.push(meta.action);
            whenify(meta, this.now());
            this.audit.push([CN + FN + wstr + meta.action,
                { ...meta, why, action: meta.action, path }]);
        }
        else if (0 === meta.actions.length) {
            why.push('skip-0');
            meta.action = 'skip';
            meta.actions.push(meta.action);
            this.audit.push([CN + FN + wstr + meta.action,
                { ...meta, why, action: meta.action, path }]);
        }
        if (this.control.duplicate) {
            why.push('duplicate-1');
            if (withinFolder && (node_path_1.default.basename(path) !== this.metafile())) {
                why.push('within-0');
                const dfolder = this.duplicateFolder();
                const dpath = node_path_1.default.join(dfolder, rpath);
                if (!this.control.dryrun) {
                    fs.mkdirSync(node_path_1.default.dirname(dpath), { recursive: true });
                    const dopts = { flush: true };
                    fs.writeFileSync(dpath, newContentSource, dopts);
                }
                if (null == meta.when) {
                    whenify(meta, this.now());
                }
            }
        }
        // console.log('WHY', path, why)
        this.addmeta(path, meta);
    }
    copy(frompath, topath, write, whence) {
        const wstr = null == whence ? '' : whence + ':';
        const FN = 'copy:';
        if ('string' === typeof write) {
            whence = write;
            write = false;
        }
        else if (null == write) {
            write = false;
        }
        whence = wstr + FN;
        const isBinary = (0, basic_1.isbinext)(frompath);
        const content = this.loadFile(frompath, { encoding: isBinary ? null : 'utf8' }, whence);
        this.save(topath, content, whence);
    }
    merge(editA, orig, editB, why) {
        const out = { content: editB, conflict: false };
        let done = false;
        // Only merge if needed
        // if (origcontent.length === newcontent.length &&
        //   origcontent === newcontent
        // ) {
        //   done = true
        // }
        // Don't stack conflicts
        if (editB.includes('>>>>>>> EXISTING:')) {
            why.push('merge-unresolved-0');
            done = true;
            // TODO: should this be a error, or collected?
        }
        if (!done) {
            why.push('merge-run-0');
            const isowhen = new Date(this.when).toISOString();
            const isolast = new Date(this.last()).toISOString();
            // Consider the previously generated pure version, stored in
            // .jostraca/generated to be the "original". That preserves
            // manual edits in the main generated output.
            const diffres = Diff3.merge(editA, orig, editB, {
                // stringSeparator: '\n',
                stringSeparator: /\r?\n/,
                excludeFalseConflicts: true,
                label: {
                    a: 'GENERATED: ' + isowhen + '/merge',
                    b: 'EXISTING: ' + isolast + '/merge',
                }
            });
            const conflict = diffres.conflict;
            const content = diffres.result.join('\n');
            out.content = content;
            out.conflict = conflict;
        }
        return out;
    }
    diff(oldcontent, newcontent) {
        // Only diff if needed
        if (oldcontent.length === newcontent.length &&
            oldcontent === newcontent) {
            return newcontent;
        }
        const isowhen = new Date(this.when).toISOString();
        const isolast = new Date(this.last()).toISOString();
        const difflines = Diff.diffLines(newcontent, oldcontent);
        const out = [];
        difflines.forEach((part) => {
            if (part.added) {
                out.push('<<<<<<< GENERATED: ' + isowhen + '/diff\n');
                out.push(part.value);
                out.push('>>>>>>> GENERATED: ' + isowhen + '/diff\n');
            }
            else if (part.removed) {
                out.push('<<<<<<< EXISTING: ' + isolast + '/diff\n');
                out.push(part.value);
                out.push('>>>>>>> EXISTING: ' + isolast + '/diff\n');
            }
            else {
                out.push(part.value);
            }
        });
        const content = out.join('');
        return content;
    }
    existsFile(path, whence) {
        const when = this.now();
        const wstr = null == whence ? '' : whence + ':';
        const fs = this.fs();
        const FN = 'existsFile:';
        validPath(path, this.maxdepth, CN + FN + 'from:' + wstr);
        const fullpath = node_path_1.default.isAbsolute(path) ? path : node_path_1.default.join(this.folder, path);
        try {
            const exists = fs.existsSync(fullpath);
            this.audit.push([CN + FN + wstr,
                { path, when, exists }]);
            return exists;
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { path, when, err }]);
            err.message = CN + FN + wstr + ' path=' + path +
                ' err=' + err.message;
            throw err;
        }
    }
    copyFile(frompath, topath, whence) {
        const when = this.now();
        const wstr = null == whence ? '' : whence + ':';
        const fs = this.fs();
        const FN = 'copyFile:';
        validPath(frompath, this.maxdepth, CN + FN + 'from:' + wstr);
        validPath(topath, this.maxdepth, CN + FN + 'to:' + wstr);
        const isBinary = (0, basic_1.isbinext)(frompath);
        const fulltopath = node_path_1.default.isAbsolute(topath) ? topath : node_path_1.default.join(this.folder, topath);
        const fullfrompath = node_path_1.default.isAbsolute(frompath) ? frompath : node_path_1.default.join(this.folder, frompath);
        try {
            const existed = fs.existsSync(fulltopath);
            fs.mkdirSync(node_path_1.default.dirname(fulltopath), { recursive: true });
            const content = fs.readFileSync(fullfrompath, isBinary ? undefined : 'utf8');
            if (!this.control.dryrun) {
                fs.writeFileSync(topath, content, { flush: true });
            }
            this.audit.push([CN + FN + wstr,
                { topath, frompath, when, existed, size: content.length }]);
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { topath, frompath, when, err }]);
            err.message = CN + FN + wstr + ' topath=' + topath + ' frompath=' + frompath +
                ' err=' + err.message;
            throw err;
        }
    }
    loadJSON(path, opts, whence) {
        const when = this.now();
        const wstr = null == whence ? '' : whence + ':';
        const FN = 'loadJSON:';
        if ('string' === typeof opts) {
            whence = opts;
            opts = {};
        }
        else {
            opts = opts || {};
        }
        opts.encoding = opts.encoding || 'utf8';
        try {
            const content = this.loadFile(path, opts, whence);
            const cstr = 'string' === typeof content ? content : content.toString(opts.encoding);
            const json = JSON.parse(cstr);
            this.audit.push([CN + FN + wstr,
                { path, when, size: content.length }]);
            return json;
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { path, when, err }]);
            err.message = CN + FN + wstr + ' path=' + path + ' err=' + err.message;
            throw err;
        }
    }
    saveJSON(path, json, opts, whence) {
        const when = this.now();
        const wstr = null == whence ? '' : whence + ':';
        const FN = 'saveJSON:';
        if ('string' === typeof opts) {
            whence = opts;
            opts = {};
        }
        else {
            opts = opts || {};
        }
        opts.encoding = opts.encoding || 'utf8';
        try {
            const jstr = 'string' === typeof json ? json : JSON.stringify(json, null, 2);
            this.saveFile(path, jstr, opts, whence);
            this.audit.push([CN + FN + wstr,
                { path, when, size: jstr.length }]);
            return jstr;
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { path, when, err }]);
            err.message = CN + FN + wstr + ' path=' + path + ' err=' + err.message;
            throw err;
        }
    }
    loadFile(path, opts, whence) {
        const when = this.now();
        const wstr = null == whence ? '' : whence + ':';
        const fs = this.fs();
        const FN = 'loadFile:';
        if ('string' === typeof opts) {
            whence = opts;
            opts = {};
        }
        else {
            opts = opts || {};
        }
        opts.encoding = undefined === opts.encoding ? 'utf8' : opts.encoding;
        validPath(path, this.maxdepth, CN + FN + wstr);
        try {
            const fullpath = node_path_1.default.isAbsolute(path) ? path : node_path_1.default.join(this.folder, path);
            const content = fs.readFileSync(fullpath, opts);
            this.audit.push([CN + FN + wstr,
                { path, when, size: content.length }]);
            return content;
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { path, when, err }]);
            err.message = CN + FN + wstr + ' path=' + path + ' err=' + err.message;
            throw err;
        }
    }
    ensureFolder(path) {
        const fs = this.fs();
        if (!this.control.dryrun) {
            fs.mkdirSync(path, { recursive: true });
        }
    }
    saveFile(path, content, opts, whence) {
        const when = this.now();
        const wstr = null == whence ? '' : whence + ':';
        const fs = this.fs();
        const FN = 'saveFile:';
        if ('string' === typeof opts) {
            whence = opts;
            opts = {};
        }
        else {
            opts = opts || {};
        }
        opts.encoding = opts.encoding || ('string' === typeof content ? 'utf8' : undefined);
        validPath(path, this.maxdepth, FN);
        if ('string' !== typeof content && !(content instanceof Buffer)) {
            throw new Error(CN + FN + wstr + ' invalid content, path=' + path +
                ' content=' + content);
        }
        try {
            path = node_path_1.default.normalize(path);
            const isAbsolute = node_path_1.default.isAbsolute(path);
            const fullpath = isAbsolute ? path : node_path_1.default.join(this.folder, path);
            const parentfolder = node_path_1.default.dirname(fullpath);
            const existed = fs.existsSync(fullpath);
            if (!this.control.dryrun) {
                fs.mkdirSync(parentfolder, { recursive: true });
                fs.writeFileSync(fullpath, content, opts);
            }
            this.audit.push([CN + FN + wstr,
                { path, when, existed, size: content.length }]);
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { path, when, size: content.length, err }]);
            err.message = CN + FN + wstr + ' path=' + path + ':' + err.message;
            throw err;
        }
    }
    filelog(kind, path) {
        let files = this.files;
        if (files[kind]) {
            const kindlog = files[kind];
            if (path === kindlog[kindlog.length - 1]) {
                dlog('filelog', kind, 'duplicate: ' + path);
            }
            else {
                kindlog.push(path);
            }
        }
        else {
            dlog('filelog', 'invalid kind: ' + kind);
        }
    }
}
exports.FileHandler = FileHandler;
function whenify(meta, now) {
    meta.when = now;
    meta.hwhen = (0, basic_1.humanify)(now);
}
function validPath(path, maxdepth, errmark) {
    if (null == path || '' == path || 'string' !== typeof path) {
        throw new Error('ERROR:' + errmark + ' invalid path, path=' + path);
    }
    const depth = node_path_1.default.normalize(node_path_1.default.dirname(path)).split(node_path_1.default.sep).filter(Boolean).length;
    if (maxdepth < depth) {
        throw new Error(errmark + ' path too deep, path=' + path);
    }
}
//# sourceMappingURL=FileHandler.js.map