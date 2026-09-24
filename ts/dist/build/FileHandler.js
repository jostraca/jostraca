"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileHandler = void 0;
exports.annotatedPath = annotatedPath;
exports.canonFolder = canonFolder;
exports.canonPath = canonPath;
exports.validName = validName;
exports.validPath = validPath;
const node_path_1 = __importDefault(require("node:path"));
const DiffUtil = __importStar(require("../diff"));
const basic_1 = require("../util/basic");
const CN = 'FileHandler:';
// Normalize path separators to forward slashes for cross-platform consistency.
// memfs and canonical paths require forward slashes; Path.normalize/join/dirname
// produce backslashes on Windows.
function fwd(p) {
    return p.includes('\\') ? p.replace(/\\/g, '/') : p;
}
// THE ONE CANONICAL FORM OF AN OUTPUT PATH: separators folded, then `.`
// and `..` segments resolved, forward slashes. Folded FIRST, so that a
// backslash `..` segment resolves as a slash one does, as in Go.
//
// Exported because `save` is not the only place that has to agree about
// what "the same file" means. `FileOp.before` composes a path from the
// enclosing Project and Folder nesting and claims it against the
// duplicate guard; `save` then normalised the same path and wrote it.
// Two Files named `a.txt` and `./a.txt` therefore claimed two paths and
// wrote one, so the second silently overwrote the first -- the very
// case the guard exists to refuse. Go has never had it: `fileBefore`
// does `path.Clean(fwd(raw))` BEFORE recording anything.
function canonPath(path) {
    return fwd(node_path_1.default.normalize(fwd(path)));
}
// The output folder, canonicalised once as canonPath does, with trailing
// separators stripped except from a filesystem root. A kept slash (`out/`)
// or an unresolved backslash `..` (`o\..\p`, when this normalised before
// folding) left the folder unlike every file path under it, so no path was
// inside it: meta keys kept the folder prefix, no baseline was written,
// and a later merge found no ancestor and overwrote the user's edits.
function canonFolder(folder) {
    const norm = canonPath(folder);
    if ('/' === norm || /^[A-Za-z]:\/$/.test(norm)) {
        return norm;
    }
    const stripped = norm.replace(/\/+$/, '');
    return '' === stripped ? '.' : stripped;
}
const JOSTRACA_PROTECT = 'JOSTRACA_PROTECT';
// Audit breadcrumb per merge outcome, so the `why` trail says which fast
// path (if any) the merge took.
const MERGE_WHY = {
    same: 'merge-same-0',
    clean: 'merge-clean-0',
    unresolved: 'merge-unresolved-0',
    merged: 'merge-run-0',
};
// Suffix for the sibling temp file used by the atomic write-then-rename.
const TMP_SUFFIX = '.jostraca-tmp';
// How many candidate temp paths an atomic write may try before giving up.
//
// MUST match tmpPathAttempts in go/filehandler.go — an identical collision
// schedule has to succeed or fail identically in both stacks.
const TMP_PATH_ATTEMPTS = 9;
// A unique sibling temp path for an atomic write.
//
// Never a fixed name: a fixed one both destroys a user file that happens to
// sit at it, and lets two concurrent runs sharing an output folder publish
// each other's bytes. pid + counter + random keeps it unique across
// processes, across writes within a process, and across retries.
let tmpseq = 0;
function tmppathFor(path) {
    const pid = 'undefined' === typeof process ? 0 : process.pid;
    const rnd = Math.floor(Math.random() * 0x100000000).toString(36);
    return path + TMP_SUFFIX + '-' + pid + '-' + (tmpseq++).toString(36) + '-' + rnd;
}
// TODO: if EOL != '\n', normalize to '\n' in load,save 
// Log non-fatal wierdness.
const dlog = (0, basic_1.getdlog)('jostraca', __filename);
// Compare two content values that may each be a string or a Buffer.
//
// `===` on a string and a Buffer is false whatever the bytes are, which is
// how a byte-identical binary target came to be reported as changed on
// every run (issue #30). Buffers compare by bytes; strings keep the cheap
// length check first, which is what the `===` sites here always did.
function sameContent(a, b) {
    if (Buffer.isBuffer(a) || Buffer.isBuffer(b)) {
        const ab = Buffer.isBuffer(a) ? a : Buffer.from(a, 'utf8');
        const bb = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8');
        return ab.equals(bb);
    }
    return a.length === b.length && a === b;
}
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
    filelogged;
    constructor(bctx, existing, control) {
        this.fs = bctx.fs;
        this.now = bctx.now;
        this.when = bctx.when;
        this.folder = canonFolder(bctx.folder);
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
        this.filelogged = {};
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
        // Strip the folder prefix only when it is ACTUALLY there.
        //
        // `save` normalizes first, so with the default folder `.` a path comes
        // in as `a.txt`, not `./a.txt` — the leading `.` this is meant to
        // consume is already gone. Cutting `this.folder.length` regardless then
        // ate the first real character: `a.txt` and `b.txt` both became `.txt`,
        // so their merge baselines and meta keys collided and a later merge
        // loaded the wrong ancestor. (The ternary this replaced had the same
        // expression in both branches — a half-finished special case.)
        //
        // The prefix must match on a PATH BOUNDARY, not as a raw string.
        //
        // A bare `startsWith` looked right and was not: with folder `.`, the
        // folder is the single character `.`, so `.env` "starts with" it and
        // the strip produced `env` — the same relative key as a sibling file
        // literally named `env`. Their merge baselines and meta entries then
        // collided, and the next run merged each against the OTHER's ancestor,
        // writing whole-file conflict markers into the user's real `.env`.
        // That is the very collision this function was fixed to prevent, one
        // case narrower. `.gitignore`, `.npmrc` and friends are all affected.
        //
        // So `.` strips only an explicit `./`, `/` strips only separators, and
        // everything else defers to `withinFolder`, which already does
        // boundary matching properly.
        const stripFolder = (s) => (s.startsWith(this.folder) ? s.substring(this.folder.length) : s)
            .replace(/^[/\\]+/, '');
        const rpath = '.' === this.folder ? path.replace(/^\.[/\\]+/, '') :
            '/' === this.folder ? path.replace(/^[/\\]+/, '') :
                this.withinFolder(path) ? stripFolder(path) :
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
            if (node_path_1.default.isAbsolute(path)) {
                return false;
            }
            // "relative" is not the same as "inside". A `..` segment walks OUT
            // of the output folder, and this returning true for it let the merge
            // baseline — `.jostraca/generated` joined to the relative path — nor-
            // malize to a location outside the baseline directory entirely, and
            // silently overwrite whatever was there.
            const norm = canonPath(path);
            return '..' !== norm && !norm.startsWith('../');
        }
        if ('/' === this.folder) {
            return path.startsWith('/');
        }
        return path === this.folder ||
            path.startsWith(this.folder + '/') ||
            path.startsWith(this.folder + '\\');
    }
    // save for content already KNOWN to be binary, whatever its extension
    // says.
    //
    // The copy paths sniff for NUL bytes so an unlisted extension (`.wasm`
    // and friends) is still treated as binary; `save` otherwise re-derives
    // the classification from the destination extension alone and throws
    // that knowledge away. With `txt.diff` on, a diff render would then
    // write textual conflict markers into binary data, and `bin.preserve`
    // would be ignored entirely.
    //
    // Mirrors saveBinary in go/filehandler.go.
    saveBinary(path, newContentSource, whence) {
        this.save(path, newContentSource, false, whence, undefined, false);
    }
    // `mode` sets POSIX permission bits on the generated file (e.g. 0o755
    // for a script). It applies to the target only — the `.old`/`.new`
    // sidecars and the merge baseline stay at the platform default, since
    // they are jostraca's bookkeeping rather than the user's output.
    //
    // `isText` overrides the extension-derived classification; only
    // `saveBinary` passes it.
    save(path, newContentSource, write, whence, mode, isText) {
        // Only ever set the key when a mode was actually given: a literal
        // `mode: undefined` is rejected by some fs providers.
        const modeopts = () => (null == mode ? {} : { mode });
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
        path = canonPath(path);
        // Which of `existing.txt` / `existing.bin` governs is decided by the
        // DESTINATION EXTENSION, with the caller able to promote a file the
        // list does not know about (`saveBinary`) — never to demote a listed
        // one.
        //
        // This used to be decided by the TYPE OF THE VALUE passed in: a string
        // took `existing.txt`, a Buffer `existing.bin`. That made the mode set
        // an artifact of how the content happened to reach save rather than of
        // what the file is, and inverted the two stacks against each other for
        // any binary-extension file whose bytes are plain text — an `a.png`
        // holding ASCII took `txt.preserve` here and `bin.preserve` in Go. It
        // also split TS against itself: the same `a.png` took `existing.txt`
        // through the single-file copy route (which sniffed content) and
        // `existing.bin` through the tree copy route (which consulted the
        // extension).
        const isTextFile = null == isText ? !(0, basic_1.isbinext)(path) : isText;
        const existing = isTextFile ? this.existing.txt : this.existing.bin;
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
        // Whether the save ends in a write or skip record.
        let final = false;
        if (exists) {
            why.push('exists-0');
            // The existing file is handled as BYTES, text included, as Go does.
            // Decoding it as UTF-8 turned every invalid byte into U+FFFD, so a
            // file the user saved in Latin-1 was judged "unchanged" against a
            // generate holding U+FFFD, and diff and merge wrote the replacement
            // characters back over the user's bytes. Every comparison below is
            // on bytes; diff and merge run over a byte-transparent latin1 form.
            const currentContent = this.loadFile(path, { encoding: null });
            const protect = 0 <= currentContent.indexOf(JOSTRACA_PROTECT);
            meta.protect = protect;
            unchanged = sameContent(currentContent, newContentSource);
            if (existing.preserve) {
                why.push('preserve-0');
                if (protect) {
                    why.push('protect-0');
                    write = false;
                }
                else if (!unchanged) {
                    why.push('content-0');
                    let oldpath = annotatedPath(path, 'old');
                    this.copyFile(path, oldpath, whence + 'preserve:');
                    // this.files.preserved.push(path)
                    this.filelog('preserved', path);
                    meta.action = 'preserve';
                    whenify(meta, this.now());
                    meta.actions.push(meta.action);
                    this.decision(CN + FN + wstr, meta, why, path);
                }
            }
            if (existing.write && !protect) {
                why.push('write-0');
                write = true;
            }
            else if (existing.present) {
                why.push('present-0');
                if (!unchanged) {
                    why.push('content-1');
                    let newpath = annotatedPath(path, 'new');
                    this.saveFile(newpath, newContentSource, { flush: true }, whence + 'present:');
                    this.filelog('presented', path);
                    meta.action = 'present';
                    whenify(meta, this.now());
                    meta.actions.push(meta.action);
                    this.decision(CN + FN + wstr, meta, why, path);
                }
            }
            if (!protect) {
                why.push('not-protect-1');
                if (existing.diff) {
                    why.push('diff-0');
                    write = false;
                    if (!unchanged) {
                        why.push('content-2');
                        meta.action = 'diff';
                        const newContent = latin1(newContentSource);
                        const diffContent = this.diff(newContent, latin1(currentContent));
                        this.saveFile(path, Buffer.from(diffContent, 'latin1'), modeopts(), whence + meta.action);
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
                        this.decision(CN + FN + wstr, meta, why, path);
                    }
                    else {
                        // Equal content is still not a no-op when an explicit mode was
                        // asked for — and `write` was already cleared above, so the
                        // chmod on the plain-write path below is unreachable from here.
                        if (this.chmodUnchanged(path, mode)) {
                            why.push('chmod-0');
                        }
                        // this.files.unchanged.push(path)
                        this.filelog('unchanged', path);
                    }
                }
                else if (existing.merge) {
                    why.push('merge-0');
                    if (!unchanged) {
                        why.push('content-3');
                        if (this.control.duplicate) {
                            why.push('duplicate-0');
                            const dfolder = this.duplicateFolder();
                            const dpath = fwd(node_path_1.default.join(dfolder, rpath));
                            if (this.existsFile(dpath)) {
                                why.push('dupexists-0');
                                write = false;
                                meta.action = 'merge';
                                const prevGenContent = this.loadFile(dpath, { encoding: null });
                                const mergeres = this.merge(latin1(newContentSource), // generated
                                latin1(prevGenContent), // baseline (last generate)
                                latin1(currentContent), // existing (on disk)
                                why);
                                const diffcontent = mergeres.content;
                                // A file still holding an earlier merge's markers is left
                                // byte-for-byte untouched, and reported conflicted: it
                                // still carries markers, and the documented guard on
                                // files.conflicted must not pass over it. Rewriting it
                                // bumped the mtime for nothing.
                                const unresolved = 'unresolved' === mergeres.outcome;
                                const conflict = mergeres.conflict || unresolved;
                                if (unresolved) {
                                    if (this.chmodUnchanged(path, mode)) {
                                        why.push('chmod-0');
                                    }
                                }
                                else {
                                    this.saveFile(path, Buffer.from(diffcontent, 'latin1'), modeopts(), whence + meta.action);
                                }
                                // this.files.merged.push(path)
                                this.filelog('merged', path);
                                if (conflict) {
                                    // this.files.conflicted.push(path)
                                    this.filelog('conflicted', path);
                                }
                                whenify(meta, this.now());
                                meta.actions.push(meta.action);
                                meta.conflict = conflict;
                                this.decision(CN + FN + wstr, meta, why, path);
                            }
                        }
                    }
                    else {
                        why.push('unchanged-0');
                        write = false;
                        // As in the diff branch: `write` is cleared here, so an
                        // explicit mode has to be applied on this path too.
                        if (this.chmodUnchanged(path, mode)) {
                            why.push('chmod-0');
                        }
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
                // Identical bytes are not a complete no-op when an explicit mode
                // was asked for. Making an already-correct script executable has
                // to work, and it only ever runs once — after that the content
                // always matches, so skipping here meant `mode` never applied
                // again. Chmod without rewriting, so mtime still is not bumped.
                if (this.chmodUnchanged(path, mode)) {
                    why.push('chmod-0');
                }
                this.filelog('unchanged', path);
            }
            else {
                why.push('write-1');
                meta.action = 'write';
                this.saveFile(path, newContentSource, modeopts(), whence + meta.action);
                // this.files.written.push(path)
                this.filelog('written', path);
            }
            meta.actions.push(meta.action);
            whenify(meta, this.now());
            final = true;
        }
        else if (0 === meta.actions.length) {
            why.push('skip-0');
            meta.action = 'skip';
            meta.actions.push(meta.action);
            whenify(meta, this.now());
            final = true;
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
            }
        }
        // The write or skip record is the save's last word, so it carries the
        // baseline breadcrumbs too.
        if (final) {
            this.decision(CN + FN + wstr, meta, why, path);
        }
        this.addmeta(path, meta);
    }
    // Push a decision record as a SNAPSHOT. The record used to share the live
    // `why` and `meta.actions` arrays, so an early record (a preserve) later
    // reported the whole save's actions and breadcrumbs.
    decision(tag, meta, why, path) {
        this.audit.push([tag + meta.action, {
                ...meta, actions: [...meta.actions], why: [...why], action: meta.action, path,
            }]);
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
        // Read bytes and classify BEFORE decoding, never the other way round.
        //
        // This used to load with `encoding: isBinary ? null : 'utf8'` — decode
        // first, sniff second. That order is a trap: for an unlisted extension
        // holding binary (`.wasm`, `.zst`, anything extensionless) the utf8
        // decode replaces every invalid sequence with U+FFFD before the sniff
        // ever runs, and `saveBinary` would then write the damaged text. The
        // sniff still says "binary", because NUL survives a utf8 round-trip;
        // the content does not.
        //
        // It was never reached. The only caller is CopyOp's tree walk, which
        // routes on `isTemplate(name)` — defined as `!isbinext(name)` — so a
        // file arrives here only when its extension IS listed, making
        // `isBinary` true and the utf8 branch dead. Removing the branch rather
        // than trusting that invariant to hold: `copy` reads as a general
        // method, and the next caller has no reason to know it must pre-filter
        // by extension.
        //
        // CopyOp's own copyFile reads a Buffer and go/build.go reads bytes;
        // this is now the same shape as both, with no order to get wrong.
        const raw = this.loadSource(frompath, { encoding: null }, whence);
        // The SOURCE decides: a binary source stays governed by `existing.bin`
        // even when copied to a destination whose extension is not on the
        // list. Same rule as CopyOp's own copy paths and go/build.go's
        // `IsBinExt(src) || IsBinContent(body)`.
        if (isBinary || (0, basic_1.isbincontent)(raw)) {
            this.saveBinary(topath, raw, whence);
        }
        else {
            // Decode only once the bytes are known to be text. Identical to what
            // `readFileSync(..., 'utf8')` produced on this path before.
            this.save(topath, raw.toString('utf8'), whence);
        }
    }
    // Three-way merge of the new generate against what is on disk, using
    // the previous generate (kept under .jostraca/generated) as the common
    // ancestor. That ancestor choice is what preserves the user's manual
    // edits.
    //
    // The fast paths and the decision of which applied now live in the diff
    // engine, which reports an `outcome`; this just records it as a
    // breadcrumb.
    merge(generated, baseline, existing, why) {
        const res = DiffUtil.merge(generated, baseline, existing, {
            when: this.when,
            last: this.last(),
            kind: 'merge',
        });
        why.push(MERGE_WHY[res.outcome]);
        return { content: res.content, conflict: res.conflict, outcome: res.outcome };
    }
    // Annotated two-way view of the difference between the new generate and
    // what is on disk.
    diff(generated, existing) {
        return DiffUtil.diff(generated, existing, {
            when: this.when,
            last: this.last(),
            kind: 'diff',
        }).content;
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
        const fullpath = canonPath(path);
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
        // Canonical paths: use directly, do not re-join `this.folder` (see existsFile).
        const fulltopath = canonPath(topath);
        const fullfrompath = canonPath(frompath);
        try {
            const existed = fs.existsSync(fulltopath);
            // Copy BYTES, always — never decode as UTF-8 first.
            //
            // This used to pick the encoding from `isbinext(frompath)`, i.e. from
            // the extension alone. Content-sniffed binaries (T5) whose extension
            // is not on the list therefore reached the `preserve` branch, which
            // backs up via this method, and were decoded as UTF-8 on the way to
            // the `.old` file: bytes `00 ff 02` were written as `00 ef bf bd 02`.
            // The preserve option silently corrupted the only backup it existed
            // to make.
            //
            // A copy has no reason to know the file type — bytes round-trip for
            // text too — so the classification is simply gone.
            const content = fs.readFileSync(fullfrompath);
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
                { path, when, size: byteLength(content) }]);
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
                { path, when, size: byteLength(jstr) }]);
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
        return this.load(path, canonPath(path), opts, whence);
    }
    // loadFile for the SOURCE of a copy, read at the path as given. A source
    // keeps its platform meaning, as every other source read does (CopyOp
    // stats and reads its entries raw): on POSIX a backslash is an ordinary
    // name character. Folding it here, as an output path is folded, sent a
    // binary tree entry named `b\in.png` to `b/in.png`, and the copy failed
    // with ENOENT while the text entry beside it was copied.
    loadSource(path, opts, whence) {
        return this.load(path, path, opts, whence);
    }
    load(path, fullpath, opts, whence) {
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
            // Used directly, never re-joined to `this.folder` (see existsFile).
            const content = fs.readFileSync(fullpath, opts);
            this.audit.push([CN + FN + wstr,
                { path, when, size: byteLength(content) }]);
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
    // Apply an explicit mode to a file whose content did not change.
    //
    // Best-effort and returns whether it did anything, so the caller can add
    // an audit breadcrumb. A provider without chmod/stat, or a target that
    // vanished, is not worth failing the build over.
    chmodUnchanged(path, mode) {
        if (null == mode || this.control.dryrun) {
            return false;
        }
        const fs = this.fs();
        if ('function' !== typeof fs.chmodSync) {
            return false;
        }
        try {
            if ('function' === typeof fs.statSync) {
                const stat = fs.statSync(path);
                if (stat && (stat.mode & 0o7777) === (mode & 0o7777)) {
                    return false;
                }
            }
            fs.chmodSync(path, mode);
            return true;
        }
        catch (err) {
            dlog('save', 'chmod of unchanged file failed: ' + path);
            return false;
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
    writeFileAtomic(path, content, opts, mode) {
        const fs = this.fs();
        if ('function' !== typeof fs.renameSync) {
            fs.writeFileSync(path, content, opts);
            if (null != mode && 'function' === typeof fs.chmodSync) {
                fs.chmodSync(path, mode);
            }
            return;
        }
        // A UNIQUE temp path, not a fixed one.
        //
        // The fixed `<target>.jostraca-tmp` had two failure modes. A user file
        // that happened to sit at that name was overwritten and then renamed
        // away — destroyed. Worse, two jostraca runs sharing an output folder
        // (a watcher plus a manual run, a CI matrix, a shared mount) collided
        // on the same temp path: one run's rename could publish the other
        // run's bytes onto the target while both reported success. The rename
        // is atomic, but atomicity is worthless if the source is shared.
        //
        // `wx` fails rather than clobbering, so a collision can never destroy
        // an existing file; retry with a fresh name. Providers that do not
        // support the flag simply ignore it, and the randomised name still
        // fixes the concurrent-run case.
        let tmppath = tmppathFor(path);
        let tmpopts = { ...opts, flag: 'wx' };
        // Whether THIS invocation created the temp file. The cleanup below must
        // not delete a path we only ever failed to create: on EEXIST exhaustion
        // that path holds someone else's file, and unlinking it would undo
        // exactly what the `wx` flag is here to guarantee.
        let created = false;
        try {
            for (let attempt = 0;; attempt++) {
                try {
                    fs.writeFileSync(tmppath, content, tmpopts);
                    created = true;
                    break;
                }
                catch (err) {
                    // EEXIST means `wx` refused and this call created NOTHING — that
                    // is the R12 case, and `created` must stay false so the cleanup
                    // does not delete somebody else's file.
                    //
                    // Any OTHER error may have come AFTER the create succeeded
                    // (ENOSPC, EIO), leaving a partial temp file that is ours to
                    // remove. Without this it survived the failed build. If the
                    // create itself failed (EACCES), the cleanup finds nothing.
                    if ('EEXIST' !== err?.code) {
                        created = true;
                    }
                    if ('EEXIST' !== err?.code || TMP_PATH_ATTEMPTS - 1 <= attempt) {
                        throw err;
                    }
                    tmppath = tmppathFor(path);
                }
            }
            // An explicit mode wins; otherwise preserve whatever the target
            // already had, since rename replaces the inode.
            //
            // Best-effort: a provider may stat but not chmod, and losing a
            // permission bit is not worth failing the write over.
            if ('function' === typeof fs.chmodSync) {
                if (null != mode) {
                    fs.chmodSync(tmppath, mode);
                }
                else if ('function' === typeof fs.statSync) {
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
            }
            fs.renameSync(tmppath, path);
        }
        catch (err) {
            try {
                if (created && 'function' === typeof fs.unlinkSync) {
                    fs.unlinkSync(tmppath);
                }
            }
            catch (cleanuperr) {
                // Already gone is not a failed cleanup: nothing was left behind.
                if ('ENOENT' !== cleanuperr?.code) {
                    dlog('writeFileAtomic', 'temp cleanup failed: ' + tmppath);
                }
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
            path = canonPath(path);
            const fullpath = path;
            const parentfolder = fwd(node_path_1.default.dirname(fullpath));
            const existed = fs.existsSync(fullpath);
            if (!this.control.dryrun) {
                this.ensureDir(parentfolder);
                this.writeFileAtomic(fullpath, content, opts, opts.mode);
            }
            this.audit.push([CN + FN + wstr,
                { path, when, existed, size: byteLength(content) }]);
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { path, when, size: byteLength(content), err }]);
            err.message = CN + FN + wstr + ' path=' + path + ':' + err.message;
            throw err;
        }
    }
    // A path appears at most once per kind, at its first position. Only the
    // LAST entry used to be checked, so File t, File u, Inject t listed t
    // twice and the list depended on sibling order.
    filelog(kind, path) {
        path = fwd(path);
        let files = this.files;
        if (files[kind]) {
            const seen = this.filelogged[kind] = this.filelogged[kind] || new Set();
            if (seen.has(path)) {
                dlog('filelog', kind, 'duplicate: ' + path);
            }
            else {
                seen.add(path);
                files[kind].push(path);
            }
        }
        else {
            dlog('filelog', 'invalid kind: ' + kind);
        }
    }
}
exports.FileHandler = FileHandler;
// The byte-transparent string form of content: one char per byte, so the
// diff engine's line splitting and equality are byte-exact and a round trip
// through Buffer.from(s, 'latin1') restores every byte. For valid UTF-8 the
// engine's output is byte-identical to running it on the decoded text.
function latin1(content) {
    return (Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'))
        .toString('latin1');
}
// Audit sizes are byte lengths, whether the content is a string or a
// Buffer; `length` counted UTF-16 units for a string.
function byteLength(content) {
    return 'string' === typeof content ? Buffer.byteLength(content, 'utf8') : content.length;
}
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