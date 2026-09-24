"use strict";
/* Copyright (c) 2026 Richard Rodger, MIT License */
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
exports.META_FOLDER = void 0;
exports.checkRun = checkRun;
// HOLD A COMMITTED TREE TO WHAT THE GENERATORS PRODUCE.
//
//   const res = await Jostraca().check({ folder: './app' }, root)
//   if (0 < res.drift.length) { /* the tree is stale */ }
//
// Generate into memory, compare with the folder on disk, and answer
// with the difference as DATA. It is the CI half of generating: a
// generator is run, its output is committed and reviewed, and the
// question a build asks from then on is whether the two still agree.
//
// A GENERATION MODE, NOT A TOOL. `mem`, `dryrun`, the existing-file
// modes and `build: false` are all options on `generate`, and this
// belongs beside them: every generator wants this gate, whether it is
// written in TypeScript at the call site or arrives as a component tree
// from another language. It lived in `tools/cmptree-gen.js` first,
// which made a general capability look like one consumer's integration
// detail and put it outside the published package.
//
// THE ANSWER IS DATA. `drift` carries the bytes, not a rendered diff: a
// CLI wants hunks on stderr, a test wants an assertion, a report wants
// a count. `DiffUtil.hunks` is exported for the first of those.
//
// --- what makes the answer trustworthy ------------------------------
//
// A CHECK IS A PURE FUNCTION OF THE GENERATOR. The folder is shadowed
// by an in-memory filesystem, so nothing committed under it can change
// what the generators produce: every file takes the same path through
// FileHandler whatever is already there, no existing-file mode fires,
// and no `exclude` skips a comparison. Without the shadow the check
// would be reading a tree that had been allowed to influence it.
//
// A CHECK WRITES NOTHING, ANYWHERE. Every write goes to memory,
// including one aimed outside the folder. A command that only asks a
// question must not be able to answer it by changing something.
//
// READS OUTSIDE THE FOLDER FALL THROUGH, so this stays a faithful dry
// run of a real generate: a `Fragment` or `CopyFiles` source lives
// outside the output tree and is read as it would be. The one component
// this cannot serve is `Inject`, which rewrites a file that already
// exists -- under a check the committed tree is not visible to the run,
// so an Inject into a file the same run does not also create is refused.
// That is the price of the shadow, and the shadow is what the gate is
// for.
const node_path_1 = __importDefault(require("node:path"));
const Fs = __importStar(require("node:fs"));
const memfs_1 = require("./util/memfs");
// jostraca's own bookkeeping under the output folder (BuildMeta's
// `foldername`). Timestamped, so never byte-stable, and never part of
// what a generator claims to produce.
const META_FOLDER = '.jostraca';
exports.META_FOLDER = META_FOLDER;
// Canonical form of a path, AS THE MEMORY VOLUME KEYS IT.
//
// `memClean` rather than a second normaliser of its own, so the two
// agree by construction. They did not when this was `Path.resolve`:
// that turns `/app` into `D:/app` on Windows while the volume keeps
// `/app`, and it resolves a relative folder against the process working
// directory while the writer hands the volume the relative path it
// composed. Either mismatch made the walk find nothing and every check
// answer "clean" -- the one wrong answer a gate must never give.
function canon(p) {
    return (0, memfs_1.memClean)(String(p));
}
// Is `p` at or below `root`? On a path BOUNDARY: `/out2/a` is not under
// `/out`, however much of the string it shares.
//
// CASE-INSENSITIVE ON WINDOWS, where the filesystem is: `C:\Users` and
// `c:\users` name one directory, and treating them as two would route
// an output path's reads to the committed tree instead of the shadow.
// That cannot write anything -- every write goes to memory
// unconditionally -- but it would let what is committed change how a
// generated file is classified, which is the one thing a check must not
// allow.
const FOLD = 'win32' === process.platform;
function under(p, root) {
    const a = FOLD ? p.toLowerCase() : p;
    const b = FOLD ? root.toLowerCase() : root;
    return a === b || a.startsWith('/' === b ? b : b + '/');
}
// Memory under the output folder, `base` outside it.
//
// `base` is the filesystem holding the committed tree, which is
// `node:fs` unless the caller provided one. Keeping it a parameter is
// what lets a test check one in-memory tree against another without
// touching disk.
//
// `modes` is filled as the run goes: A MODE THE RUN ACTUALLY ASKED FOR.
// The volume cannot answer this on its own, because it gives every file
// a default mode, so "what is this file's mode in memory" does not
// distinguish `File({mode: 0o644})` from a File that said nothing about
// it. The narrower question -- did the tree DECLARE a mode for this
// path -- is only visible here, where FileHandler passes it.
function shadowFs(mem, base, root, modes) {
    const declare = (p, mode) => {
        if (null != mode) {
            modes.set(canon(p), mode & 0o777);
        }
    };
    // memfs reproduces node's refusal to write into a directory that does
    // not exist; FileHandler.ensureDir normally makes it first, and does
    // not when it can see one through the fall-through. So the shadow
    // makes the parent itself.
    const parents = (p) => {
        const dir = node_path_1.default.dirname(canon(p));
        if (!mem.existsSync(dir)) {
            mem.mkdirSync(dir, { recursive: true });
        }
    };
    const readThrough = (name) => (p, ...rest) => ((under(canon(p), root) || null == base[name]) ?
        mem : base)[name](p, ...rest);
    return {
        existsSync: readThrough('existsSync'),
        readFileSync: readThrough('readFileSync'),
        statSync: readThrough('statSync'),
        readdirSync: readThrough('readdirSync'),
        realpathSync: readThrough('realpathSync'),
        writeFileSync: (p, data, opts) => (parents(p),
            declare(p, null == opts || 'string' === typeof opts ? undefined : opts.mode),
            mem.writeFileSync(p, data, opts)),
        mkdirSync: (p, opts) => mem.mkdirSync(p, opts),
        // The atomic write lands under a temp name and is renamed into
        // place, so the declaration follows the bytes to their final path.
        renameSync: (from, to) => {
            parents(to);
            const held = modes.get(canon(from));
            if (undefined !== held) {
                modes.set(canon(to), held);
                modes.delete(canon(from));
            }
            ;
            mem.renameSync(from, to);
        },
        chmodSync: (p, mode) => (declare(p, mode), mem.chmodSync(p, mode)),
        unlinkSync: (p) => mem.unlinkSync(p),
    };
}
// What the generators produced, by path relative to the output folder.
//
// WALKED FROM THE OUTPUT ROOT rather than read off `vol.toJSON()`. That
// serialiser walks from `/`, and a Windows path is rooted at its drive
// (`C:/Users/...`), which has no `/` ancestor to be reached from -- so
// it answered with nothing at all on a Windows runner while the run
// itself had gone perfectly. Walking from a root this already knows is
// both narrower and portable.
function generated(mem, root) {
    const out = new Map();
    const walk = (dir, rel) => {
        let names;
        try {
            names = mem.readdirSync(dir);
        }
        catch {
            // Nothing was generated under it, which is not an error: an empty
            // tree is a clean check against an empty claim.
            return;
        }
        for (const name of names) {
            const key = '' === rel ? name : rel + '/' + name;
            if (key === META_FOLDER || key.startsWith(META_FOLDER + '/')) {
                continue;
            }
            const full = dir + '/' + name;
            let st;
            try {
                st = mem.statSync(full);
            }
            catch {
                continue;
            }
            if (st.isDirectory()) {
                walk(full, key);
            }
            else {
                out.set(key, mem.readFileSync(full));
            }
        }
    };
    walk(root, '');
    return out;
}
// Hold each generated file to the folder.
//
// AN UNCLAIMED FILE ON DISK IS LEFT ALONE, and that is a decision
// rather than an omission. A generator owns the files it emits, not the
// directory it emits them into: one generator of nine writes a handful
// of files into a whole application, and a check that called every file
// it did not write "drift" would report the other eight generators'
// output, and the hand-written tree around them, as a failure. The cost
// is that a file which STOPS being generated lingers and is not
// reported; deleting it is the same review as adding it.
function compare(base, folder, root, files, modes) {
    const drift = [];
    for (const path of [...files.keys()].sort()) {
        const gen = files.get(path);
        const at = node_path_1.default.join(folder, path);
        let have;
        let stat;
        try {
            have = base.readFileSync(at);
            stat = base.statSync(at);
        }
        catch {
            drift.push({ path, kind: 'missing', generated: gen });
            continue;
        }
        if (!gen.equals(have)) {
            drift.push({ path, kind: 'content', generated: gen, existing: have });
            continue;
        }
        // A MODE IS OUTPUT TOO. `File({mode: 0o755})` makes a generated
        // script executable, and a committed copy with the right bytes and
        // the wrong bits is drift no byte comparison can see -- a run would
        // chmod it and the gate would have said clean.
        //
        // Only where the TREE DECLARED one: a File that says nothing about
        // mode leaves whatever is there, so there is nothing to hold it to.
        // And only on POSIX, because Windows has no permission bits to
        // compare -- chmod there toggles the read-only attribute and
        // nothing else, so this would fail every file on that platform for
        // a difference the filesystem cannot express.
        const mode = modes.get(canon(node_path_1.default.join(root, path)));
        if (!FOLD && null != mode && (stat.mode & 0o777) !== mode) {
            drift.push({
                path,
                kind: 'mode',
                generated: gen,
                existing: have,
                mode,
                existingMode: stat.mode & 0o777,
            });
        }
    }
    return drift;
}
// Run `generate` against a shadowed folder and compare.
//
// Takes the driver rather than building one, because `generate` closes
// over the global options a `Jostraca()` was constructed with, and a
// check has to run with exactly the ones the caller set up. The folder
// and filesystem resolve as generate resolves them: per-call, else
// global, else the default.
async function checkRun(generate, opts, root, gopts) {
    const folder = opts?.folder ?? gopts?.folder ?? '.';
    const abs = canon(folder);
    const base = (null != opts?.fs ? opts.fs() :
        null != gopts?.fs ? gopts.fs() : Fs);
    const vol = (0, memfs_1.memfs)({});
    const modes = new Map();
    const res = await generate({
        ...opts,
        folder,
        fs: () => shadowFs(vol.fs, base, abs, modes),
        // Forced, because each would answer a different question than the
        // one asked. `duplicate` writes a `.jostraca/generated` baseline
        // for a later merge, and a check makes no next run to merge into;
        // `dryrun` would write nothing to the volume, leaving nothing to
        // compare; `build: false` never reaches the file handler at all.
        control: { ...(opts?.control || {}), duplicate: false, dryrun: false },
        build: true,
    }, root);
    const files = generated(vol.fs, abs);
    return {
        folder,
        checked: [...files.keys()].sort(),
        drift: compare(base, folder, abs, files, modes),
        files: res.files,
    };
}
//# sourceMappingURL=check.js.map