"use strict";
/* Copyright (c) 2024 Richard Rodger, MIT License */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemVolume = void 0;
exports.memfs = memfs;
exports.memClean = memClean;
// An in-process filesystem, speaking the `node:fs` synchronous shape.
//
// This replaces the `memfs` package, which cost 20 transitive packages to
// provide six methods jostraca requires and four it feature-detects. The
// design is a port of `go/fs.go`'s MemFS -- maps under one store, canonical
// forward-slash paths, defensive copies in and out -- with node's errno
// objects and encoding rules layered on so it stays a drop-in `fs` provider.
//
// Deliberately NOT a port of Go's write semantics: Go's MemFS creates parent
// directories implicitly, while node (and the `memfs` package) fail a write
// whose parent is missing. The node behaviour is the one reproduced here,
// because FileHandler.ensureDir already mkdirs first and the tests pin the
// resulting ENOENT.
const S_IFREG = 0o100000;
const S_IFDIR = 0o40000;
const S_IFLNK = 0o120000;
const DEFAULT_FILE_MODE = 0o666;
const DEFAULT_DIR_MODE = 0o777;
const ERRMSG = {
    ENOENT: 'no such file or directory',
    EEXIST: 'file already exists',
    EISDIR: 'illegal operation on a directory',
    ENOTDIR: 'not a directory',
    ENOTEMPTY: 'directory not empty',
};
// Node-shaped errno error: `.code` is what callers branch on (FileHandler
// keys its temp-file retry on `EEXIST`), the message matches node's format.
function fserr(code, syscall, path, dest) {
    const where = null == dest ? `'${path}'` : `'${path}' -> '${dest}'`;
    const err = new Error(`${code}: ${ERRMSG[code]}, ${syscall} ${where}`);
    err.code = code;
    err.syscall = syscall;
    err.path = path;
    if (null != dest) {
        err.dest = dest;
    }
    return err;
}
// Normalise to a canonical absolute key: forward slashes, no trailing slash,
// no `.` or `..` segments. Relative paths resolve against process.cwd(), which
// is what the `memfs` package does and what the corpus tools in ts/tools rely
// on. Ported from memClean in go/fs.go, plus the cwd rule.
function memClean(p) {
    let s = String(p).replace(/\\/g, '/');
    // Windows drive paths ('C:/x') are already absolute; everything else that
    // does not start with '/' is relative to the working directory.
    const drive = /^[A-Za-z]:\//.test(s);
    if (!drive && !s.startsWith('/')) {
        s = String(process.cwd()).replace(/\\/g, '/') + '/' + s;
    }
    let prefix = '';
    if (drive) {
        prefix = s.slice(0, 2);
        s = s.slice(2);
    }
    const parts = [];
    for (const part of s.split('/')) {
        if ('' === part || '.' === part) {
            continue;
        }
        if ('..' === part) {
            parts.pop();
            continue;
        }
        parts.push(part);
    }
    return prefix + '/' + parts.join('/');
}
function parentOf(cp) {
    const i = cp.lastIndexOf('/');
    return i <= 0 ? '/' : cp.slice(0, i);
}
class Stats {
    kind;
    size;
    mode;
    mtimeMs;
    constructor(kind, size, mode, mtimeMs) {
        this.kind = kind;
        this.size = size;
        this.mode = mode;
        this.mtimeMs = mtimeMs;
    }
    isFile() { return 'file' === this.kind; }
    isDirectory() { return 'dir' === this.kind; }
    isSymbolicLink() { return 'link' === this.kind; }
    get mtime() { return new Date(this.mtimeMs); }
}
class MemVolume {
    // Mirrors go/fs.go MemFS: content, times and directories in parallel maps,
    // plus modes (node surfaces st.mode, which the Go FileInfo also carries)
    // and links (one test builds a dangling symlink).
    files = new Map();
    times = new Map();
    modes = new Map();
    dirs = new Map();
    links = new Map();
    // Creation order across files AND directories together. readdirSync sorts,
    // but toJSON emits in the order entries were created, and the parity-corpus
    // tools serialise toJSON output -- so the order is part of the contract, not
    // an implementation detail.
    seq = new Map();
    nextSeq = 0;
    constructor(json) {
        this.dirs.set('/', DEFAULT_DIR_MODE);
        this.fromJSON(json);
    }
    // Record first-creation order. A rewrite keeps the original position.
    touch(cp) {
        if (!this.seq.has(cp)) {
            this.seq.set(cp, this.nextSeq++);
        }
    }
    // Re-record at the end of the order, for a key arriving at a new path.
    retouch(cp) {
        this.seq.set(cp, this.nextSeq++);
    }
    // Seed from the `memfs(json)` tree form. Accepts the flat
    // {'/a/b.txt': 'content'} shape the suites use; a null value seeds an
    // empty directory, matching what toJSON emits for one.
    fromJSON(json) {
        if (null == json) {
            return;
        }
        for (const key of Object.keys(json)) {
            const val = json[key];
            const cp = memClean(key);
            if (null == val) {
                this.mkdirp(cp);
            }
            else {
                this.mkdirp(parentOf(cp));
                this.files.set(cp, Buffer.isBuffer(val) ? Buffer.from(val) : Buffer.from(String(val)));
                this.times.set(cp, Date.now());
                this.modes.set(cp, DEFAULT_FILE_MODE);
                this.touch(cp);
            }
        }
    }
    mkdirp(cp) {
        const parts = cp.split('/').filter((p) => '' !== p);
        let cur = '';
        for (const part of parts) {
            cur = cur + '/' + part;
            if (!this.dirs.has(cur)) {
                this.dirs.set(cur, DEFAULT_DIR_MODE);
                this.touch(cur);
            }
        }
    }
    // Immediate children of a directory key.
    children(cp) {
        const prefix = '/' === cp ? '/' : cp + '/';
        const seen = new Set();
        const collect = (key) => {
            if (!key.startsWith(prefix) || key === cp) {
                return;
            }
            const rest = key.slice(prefix.length);
            if ('' === rest) {
                return;
            }
            const slash = rest.indexOf('/');
            seen.add(-1 === slash ? rest : rest.slice(0, slash));
        };
        this.files.forEach((_v, k) => collect(k));
        this.dirs.forEach((_v, k) => collect(k));
        this.links.forEach((_v, k) => collect(k));
        return Array.from(seen).sort();
    }
    // The one method anything outside this file calls on a volume. Flat
    // path -> content map; content is decoded as utf8, which is lossy for
    // binary exactly as the `memfs` package is (0xFF becomes U+FFFD -- see
    // ts/tools/corpus-bytes.js, which routes around it deliberately). An
    // empty directory appears as null.
    toJSON() {
        // Depth-first from the root, taking each directory's children in the
        // order they were created. NOT a flat creation-order listing: a subtree
        // is emitted contiguously, so files written later under an earlier
        // directory still sort ahead of an earlier file under a later one.
        const kids = new Map();
        const add = (full) => {
            const parent = parentOf(full);
            const list = kids.get(parent);
            if (null == list) {
                kids.set(parent, [full]);
            }
            else {
                list.push(full);
            }
        };
        this.files.forEach((_v, k) => add(k));
        this.dirs.forEach((_v, k) => { if ('/' !== k) {
            add(k);
        } });
        this.links.forEach((_v, k) => add(k));
        kids.forEach((list) => list.sort((a, b) => (this.seq.get(a) ?? 0) - (this.seq.get(b) ?? 0)));
        const out = {};
        const walk = (dir) => {
            for (const full of (kids.get(dir) || [])) {
                const buf = this.files.get(full);
                if (null != buf) {
                    out[full] = buf.toString('utf8');
                    continue;
                }
                if (this.dirs.has(full)) {
                    // A directory appears only while it is empty; otherwise its
                    // children stand for it.
                    if (0 === (kids.get(full) || []).length) {
                        out[full] = null;
                    }
                    else {
                        walk(full);
                    }
                }
                // A symlink is not represented in the JSON form.
            }
        };
        walk('/');
        return out;
    }
}
exports.MemVolume = MemVolume;
// Resolve a symlink chain to its ultimate target key. Bounded, so a cycle
// returns rather than hanging.
function resolveLink(vol, cp) {
    let cur = cp;
    for (let depth = 0; depth < 32; depth++) {
        const target = vol.links.get(cur);
        if (null == target) {
            return cur;
        }
        cur = memClean(target);
    }
    return cur;
}
function makeFs(vol) {
    const readEncoding = (opts) => {
        if (null == opts) {
            return null;
        }
        if ('string' === typeof opts) {
            return opts;
        }
        return null == opts.encoding ? null : opts.encoding;
    };
    const statOf = (cp) => {
        const target = resolveLink(vol, cp);
        const buf = vol.files.get(target);
        if (null != buf) {
            return new Stats('file', buf.length, S_IFREG | (vol.modes.get(target) ?? DEFAULT_FILE_MODE), vol.times.get(target) ?? 0);
        }
        if (vol.dirs.has(target)) {
            return new Stats('dir', 0, S_IFDIR | (vol.dirs.get(target) ?? DEFAULT_DIR_MODE), vol.times.get(target) ?? 0);
        }
        return undefined;
    };
    const fs = {
        existsSync(p) {
            return undefined !== statOf(memClean(p));
        },
        readFileSync(p, opts) {
            const cp = resolveLink(vol, memClean(p));
            const buf = vol.files.get(cp);
            if (null == buf) {
                if (vol.dirs.has(cp)) {
                    throw fserr('EISDIR', 'open', p);
                }
                throw fserr('ENOENT', 'open', p);
            }
            const enc = readEncoding(opts);
            return null == enc ? Buffer.from(buf) : buf.toString(enc);
        },
        writeFileSync(p, data, opts) {
            const cp = memClean(p);
            if (vol.dirs.has(cp)) {
                throw fserr('EISDIR', 'open', p);
            }
            // `wx` means create-only. FileHandler's atomic write depends on the
            // EEXIST so it can retry under a fresh temp name.
            const flag = null != opts && 'string' !== typeof opts ? opts.flag : undefined;
            if (('wx' === flag || 'ax' === flag) && vol.files.has(cp)) {
                throw fserr('EEXIST', 'open', p);
            }
            // node does not create parents on write; neither does the package this
            // replaces. (go/fs.go does -- see the header note.)
            const parent = parentOf(cp);
            if (!vol.dirs.has(parent)) {
                throw fserr('ENOENT', 'open', parent);
            }
            const enc = readEncoding(opts);
            const buf = Buffer.isBuffer(data) ? Buffer.from(data) :
                Buffer.from(String(data), (enc || 'utf8'));
            vol.files.set(cp, buf);
            vol.times.set(cp, Date.now());
            vol.touch(cp);
            const mode = null != opts && 'string' !== typeof opts ? opts.mode : undefined;
            if (null != mode) {
                vol.modes.set(cp, mode & 0o7777);
            }
            else if (!vol.modes.has(cp)) {
                vol.modes.set(cp, DEFAULT_FILE_MODE);
            }
        },
        appendFileSync(p, data, opts) {
            const cp = memClean(p);
            const prev = vol.files.get(cp);
            const enc = readEncoding(opts);
            const add = Buffer.isBuffer(data) ? Buffer.from(data) :
                Buffer.from(String(data), (enc || 'utf8'));
            if (null == prev) {
                fs.writeFileSync(p, add, opts);
                return;
            }
            vol.files.set(cp, Buffer.concat([prev, add]));
            vol.times.set(cp, Date.now());
        },
        mkdirSync(p, opts) {
            const cp = memClean(p);
            const recursive = null != opts && true === opts.recursive;
            if (vol.dirs.has(cp) || vol.files.has(cp)) {
                if (recursive) {
                    return;
                }
                throw fserr('EEXIST', 'mkdir', p);
            }
            if (!recursive && !vol.dirs.has(parentOf(cp))) {
                throw fserr('ENOENT', 'mkdir', p);
            }
            vol.mkdirp(cp);
            const mode = null != opts && 'number' === typeof opts.mode ? opts.mode : undefined;
            if (null != mode) {
                vol.dirs.set(cp, mode & 0o7777);
            }
        },
        statSync(p, opts) {
            const st = statOf(memClean(p));
            if (undefined === st) {
                if (null != opts && false === opts.throwIfNoEntry) {
                    return undefined;
                }
                throw fserr('ENOENT', 'stat', p);
            }
            return st;
        },
        readdirSync(p) {
            const cp = resolveLink(vol, memClean(p));
            if (!vol.dirs.has(cp)) {
                if (vol.files.has(cp)) {
                    throw fserr('ENOTDIR', 'scandir', p);
                }
                throw fserr('ENOENT', 'scandir', p);
            }
            return vol.children(cp);
        },
        renameSync(from, to) {
            const cf = memClean(from);
            const ct = memClean(to);
            if (vol.files.has(cf)) {
                const buf = vol.files.get(cf);
                const mode = vol.modes.get(cf);
                const time = vol.times.get(cf);
                // Renaming ONTO an existing path reuses that path's directory entry,
                // so the destination keeps its place in creation order. A new
                // destination takes a fresh place at the end. FileHandler writes
                // every file through temp-then-rename, so getting this backwards
                // moves each target to the end and reorders the parity corpus.
                const destExisted = vol.files.has(ct) || vol.dirs.has(ct);
                vol.files.delete(cf);
                vol.modes.delete(cf);
                vol.times.delete(cf);
                vol.seq.delete(cf);
                vol.files.set(ct, buf);
                if (null != mode) {
                    vol.modes.set(ct, mode);
                }
                vol.times.set(ct, null == time ? Date.now() : time);
                if (!destExisted) {
                    vol.retouch(ct);
                }
                return;
            }
            if (vol.dirs.has(cf)) {
                // Re-key the subtree under the new prefix.
                const move = (m) => {
                    for (const k of Array.from(m.keys())) {
                        if (k === cf || k.startsWith(cf + '/')) {
                            const nk = ct + k.slice(cf.length);
                            m.set(nk, m.get(k));
                            m.delete(k);
                        }
                    }
                };
                move(vol.files);
                move(vol.times);
                move(vol.modes);
                move(vol.dirs);
                move(vol.links);
                move(vol.seq);
                return;
            }
            throw fserr('ENOENT', 'rename', from, to);
        },
        unlinkSync(p) {
            const cp = memClean(p);
            if (vol.links.delete(cp)) {
                return;
            }
            if (!vol.files.has(cp)) {
                if (vol.dirs.has(cp)) {
                    throw fserr('EISDIR', 'unlink', p);
                }
                throw fserr('ENOENT', 'unlink', p);
            }
            vol.files.delete(cp);
            vol.times.delete(cp);
            vol.modes.delete(cp);
            vol.seq.delete(cp);
        },
        chmodSync(p, mode) {
            const cp = resolveLink(vol, memClean(p));
            if (vol.files.has(cp)) {
                vol.modes.set(cp, mode & 0o7777);
                return;
            }
            if (vol.dirs.has(cp)) {
                vol.dirs.set(cp, mode & 0o7777);
                return;
            }
            throw fserr('ENOENT', 'chmod', p);
        },
        realpathSync(p) {
            const cp = memClean(p);
            const target = resolveLink(vol, cp);
            if (undefined === statOf(target)) {
                throw fserr('ENOENT', 'realpath', p);
            }
            return target;
        },
        symlinkSync(target, p) {
            const cp = memClean(p);
            if (vol.files.has(cp) || vol.dirs.has(cp) || vol.links.has(cp)) {
                throw fserr('EEXIST', 'symlink', p);
            }
            vol.links.set(cp, String(target));
            vol.times.set(cp, Date.now());
            vol.touch(cp);
        },
    };
    return fs;
}
// Construct an in-memory filesystem. Signature matches the `memfs` package's
// `memfs(json)` so call sites read the same.
function memfs(json) {
    const vol = new MemVolume(json);
    const fs = makeFs(vol);
    return { fs, vol };
}
//# sourceMappingURL=memfs.js.map