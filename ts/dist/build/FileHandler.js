"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileHandler = void 0;
exports.annotatedPath = annotatedPath;
exports.validName = validName;
exports.validPath = validPath;
const Diff = require('diff');
const Diff3 = require('node-diff3');
const node_path_1 = __importDefault(require("node:path"));
const basic_1 = require("../util/basic");
const CN = 'FileHandler:';
// Normalize path separators to forward slashes for cross-platform consistency.
// memfs and canonical paths require forward slashes; Path.normalize/join/dirname
// produce backslashes on Windows.
function fwd(p) {
    return p.includes('\\') ? p.replace(/\\/g, '/') : p;
}
const JOSTRACA_PROTECT = 'JOSTRACA_PROTECT';
// Suffix for the sibling temp file used by the atomic write-then-rename.
const TMP_SUFFIX = '.jostraca-tmp';
// TODO: if EOL != '\n', normalize to '\n' in load,save 
// Log non-fatal wierdness.
const dlog = (0, basic_1.getdlog)('jostraca', __filename);
class FileHandler {
    when;
    fs;
    now;
    folder;
    audit;
    maxdepth;
    existing;
    control;
    duplicateFolder;
    last;
    addmeta;
    metafile;
    files;
    createdDirs;
    savedPaths;
    constructor(bctx, existing, control) {
        this.fs = bctx.fs;
        this.now = bctx.now;
        this.when = bctx.when;
        this.folder = fwd(node_path_1.default.normalize(bctx.folder));
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
        this.createdDirs = new Set();
        this.savedPaths = new Set();
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
        const rpath = this.withinFolder(path) ?
            path.substring('.' === this.folder || '/' === this.folder ? this.folder.length :
                this.folder.length).replace(/^[/\\]+/, '') :
            path;
        // Canonical paths use forward slashes, NOT Path.sep
        return rpath.replace(/\\/g, '/');
    }
    // Whether `path` resolves inside the configured output folder.
    //
    // Matched on a separator boundary, not a raw string prefix: with folder
    // `/out`, the path `/output/x.txt` is NOT inside it. The plain
    // `startsWith` this replaced yielded the relative path `put/x.txt`, and
    // from there a bogus duplicate-baseline location and meta key.
    withinFolder(path) {
        if ('.' === this.folder) {
            return !node_path_1.default.isAbsolute(path);
        }
        if ('/' === this.folder) {
            return path.startsWith('/');
        }
        return path === this.folder ||
            path.startsWith(this.folder + '/') ||
            path.startsWith(this.folder + '\\');
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
        path = fwd(node_path_1.default.normalize(path));
        const withinFolder = this.withinFolder(path);
        const rpath = this.relative(path, FN + wstr);
        // Two components resolving to the same output path is almost always a
        // mistake (the second silently wins). Detect it here rather than
        // inferring it from adjacent entries in one of the `files` lists —
        // that only caught the case where both saves happened to take the same
        // branch, so it stopped firing as soon as one of them became a no-op.
        if (this.savedPaths.has(path)) {
            dlog('save', 'duplicate save, later content wins: ' + path);
        }
        else {
            this.savedPaths.add(path);
        }
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
        // Tracks whether the generated content actually differs from what is
        // already on disk, so the write path can skip a no-op rewrite.
        let unchanged = false;
        if (exists) {
            why.push('exists-0');
            let currentContent = this.loadFile(path);
            const protect = 0 <= currentContent.indexOf(JOSTRACA_PROTECT);
            meta.protect = protect;
            unchanged = currentContent.length === newContentSource.length &&
                currentContent === newContentSource;
            if (existing.preserve) {
                why.push('preserve-0');
                if (protect) {
                    why.push('protect-0');
                    write = false;
                }
                else if (currentContent.length !== newContentSource.length ||
                    currentContent !== newContentSource) {
                    why.push('content-0');
                    let oldpath = annotatedPath(path, 'old');
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
                    let newpath = annotatedPath(path, 'new');
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
                            const dpath = fwd(node_path_1.default.join(dfolder, rpath));
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
            // A byte-identical rewrite is a no-op that still bumps mtime, which
            // re-triggers every watcher, bundler and incremental compiler
            // downstream — and costs a full write per file on every run. Record
            // the intent (so meta still says `write`, and the duplicate baseline
            // below is still refreshed) but skip touching the file. Matches the
            // Go port, which already did this.
            if (unchanged) {
                why.push('unchanged-0');
                meta.action = 'write';
                this.filelog('unchanged', path);
            }
            else {
                why.push('write-1');
                meta.action = 'write';
                this.saveFile(path, newContentSource, whence + meta.action);
                // this.files.written.push(path)
                this.filelog('written', path);
            }
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
                const dpath = fwd(node_path_1.default.join(dfolder, rpath));
                if (!this.control.dryrun) {
                    this.ensureDir(fwd(node_path_1.default.dirname(dpath)));
                    this.writeFileAtomic(dpath, newContentSource, { flush: true });
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
        // Fast paths — avoid the diff3 LCS entirely when its result is known.
        // The LCS is quadratic, and on large generated files that change almost
        // completely (regenerating a reshaped model over 500KB+ config/reference
        // outputs) it effectively never terminates. Both cases below are
        // semantics-identical to running the merge:
        // 1. The existing file already equals the new generate — nothing to do.
        if (!done && editA === editB) {
            why.push('merge-same-0');
            done = true;
        }
        // 2. The existing file is untouched since the last generate (no manual
        // edits) — a 3-way merge over an unchanged base yields editA exactly.
        if (!done && editB === orig) {
            why.push('merge-clean-0');
            out.content = editA;
            done = true;
        }
        // Don't stack conflicts
        if (!done && editB.includes('>>>>>>> EXISTING:')) {
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
        // Paths are canonical (already folder-prefixed by the build phase, or
        // absolute); use them directly. Do NOT re-join `this.folder`, which would
        // double-prefix relative non-`.` output folders. Matches the Go port.
        const fullpath = fwd(node_path_1.default.normalize(path));
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
        // Canonical paths: use directly, do not re-join `this.folder` (see existsFile).
        const fulltopath = fwd(node_path_1.default.normalize(topath));
        const fullfrompath = fwd(node_path_1.default.normalize(frompath));
        try {
            const existed = fs.existsSync(fulltopath);
            const content = fs.readFileSync(fullfrompath, isBinary ? undefined : 'utf8');
            // ensureDir must stay inside the dryrun guard: a dry run must not
            // mutate the tree, and creating the destination folder is a mutation
            // (saveFile already gets this right).
            if (!this.control.dryrun) {
                this.ensureDir(fwd(node_path_1.default.dirname(fulltopath)));
                this.writeFileAtomic(fulltopath, content, { flush: true });
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
            // Canonical path: use directly, do not re-join `this.folder` (see existsFile).
            const fullpath = fwd(node_path_1.default.normalize(path));
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
        if (!this.control.dryrun) {
            this.ensureDir(path);
        }
    }
    ensureDir(dir) {
        if (!this.createdDirs.has(dir)) {
            this.fs().mkdirSync(dir, { recursive: true });
            this.createdDirs.add(dir);
        }
    }
    // Replace `path` atomically: write a sibling temp file, then rename it
    // over the target. Rename within a directory is atomic, so a crash, a
    // SIGINT, or a full disk leaves the user's existing file intact rather
    // than truncated or half-written. That matters most in `merge` and
    // `diff` mode, where the file being rewritten is the one holding the
    // user's hand edits.
    //
    // Rename replaces the inode, so a hard link to the target is broken and
    // the new file would otherwise take default permissions — hence the
    // mode copy below. This is the same trade-off git and npm make.
    //
    // The `fs` provider is pluggable; fall back to a direct write when it
    // has no rename.
    writeFileAtomic(path, content, opts) {
        const fs = this.fs();
        if ('function' !== typeof fs.renameSync) {
            fs.writeFileSync(path, content, opts);
            return;
        }
        const tmppath = path + TMP_SUFFIX;
        try {
            fs.writeFileSync(tmppath, content, opts);
            // Best-effort mode preservation: a provider may stat but not chmod,
            // and losing a permission bit is not worth failing the write over.
            if ('function' === typeof fs.chmodSync && 'function' === typeof fs.statSync) {
                try {
                    const stat = fs.statSync(path);
                    if (stat && !stat.isDirectory()) {
                        fs.chmodSync(tmppath, stat.mode);
                    }
                }
                catch (err) {
                    // Target absent (the common case for a new file): keep the
                    // default mode.
                }
            }
            fs.renameSync(tmppath, path);
        }
        catch (err) {
            try {
                if ('function' === typeof fs.unlinkSync) {
                    fs.unlinkSync(tmppath);
                }
            }
            catch (cleanuperr) {
                dlog('writeFileAtomic', 'temp cleanup failed: ' + tmppath);
            }
            throw err;
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
            // Canonical path: use directly, do not re-join `this.folder` (see existsFile).
            path = fwd(node_path_1.default.normalize(path));
            const fullpath = path;
            const parentfolder = fwd(node_path_1.default.dirname(fullpath));
            const existed = fs.existsSync(fullpath);
            if (!this.control.dryrun) {
                this.ensureDir(parentfolder);
                this.writeFileAtomic(fullpath, content, opts);
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
        path = fwd(path);
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
// Rewrite `foo/bar.txt` to `foo/bar.<kind>.txt`, used for the `.old`
// (preserve) and `.new` (present) annotations.
//
// Node's `Path.extname('.env')` is '', so a leading-dot name has no
// extension to split off and the whole basename is the stem. The previous
// implementation stripped the final `.`-suffix with a regex, which for a
// dotfile removed the entire name: every dotfile in a folder collapsed to
// the same `.old` path, so a second dotfile silently destroyed the first
// one's backup.
function annotatedPath(target, kind) {
    const dir = node_path_1.default.dirname(target);
    const base = node_path_1.default.basename(target);
    const ext = node_path_1.default.extname(base);
    const stem = 0 === ext.length ? base : base.substring(0, base.length - ext.length);
    return fwd(node_path_1.default.join(dir, stem + '.' + kind + ext));
}
// Reject path traversal in a component name. Names compose directly into
// output paths, and models are routinely third-party data, so a name
// containing a `..` segment is an arbitrary-file-write primitive: it
// escapes not just the project folder but the output folder entirely.
//
// A leading `/` is deliberately still allowed — an absolute Folder name
// composes with the Project folder (see the `absolute_paths` parity
// scenario). `Project.folder` is likewise not checked here: it is
// developer-authored top-level configuration rather than model-derived,
// and `Project({folder: '../sibling'})` is a legitimate pattern.
function validName(name, kind, errmark) {
    if (null == name) {
        return;
    }
    const segments = ('' + name).split(/[/\\]/);
    if (segments.includes('..')) {
        throw new Error('ERROR:' + errmark + ' ' + kind +
            ' name must not contain a ".." path segment, name=' + name);
    }
}
function validPath(path, maxdepth, errmark) {
    if (null == path || '' == path || 'string' !== typeof path) {
        throw new Error('ERROR:' + errmark + ' invalid path, path=' + path);
    }
    const normalized = fwd(node_path_1.default.normalize(node_path_1.default.dirname(path)));
    let depth = 0;
    let inSegment = false;
    for (let i = 0; i < normalized.length; i++) {
        if (normalized[i] === '/') {
            inSegment = false;
        }
        else if (!inSegment) {
            depth++;
            inSegment = true;
        }
    }
    if (maxdepth < depth) {
        throw new Error(errmark + ' path too deep, path=' + path);
    }
}
//# sourceMappingURL=FileHandler.js.map