"use strict";
/* Copyright (c) 2024 Richard Rodger, MIT License */
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
exports.List = exports.Slot = exports.Line = exports.Copy = exports.Folder = exports.Fragment = exports.Inject = exports.File = exports.Content = exports.Project = exports.deep = exports.indent = exports.escre = exports.template = exports.names = exports.vmap = exports.cmap = exports.kebabify = exports.snakify = exports.camelify = exports.getx = exports.get = exports.select = exports.each = void 0;
exports.Jostraca = Jostraca;
exports.cmp = cmp;
// TODO:
// Need to check file existence in define phase, otherwise error stack is useless
// Options for each cmp; for copy, option to exclude ~ backups
const Fs = __importStar(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_async_hooks_1 = require("node:async_hooks");
const jsonic_1 = require("jsonic");
const gubu_1 = require("gubu");
const Diff = require('diff');
const memfs_1 = require("memfs");
const utility_1 = require("./utility");
Object.defineProperty(exports, "each", { enumerable: true, get: function () { return utility_1.each; } });
Object.defineProperty(exports, "select", { enumerable: true, get: function () { return utility_1.select; } });
Object.defineProperty(exports, "get", { enumerable: true, get: function () { return utility_1.get; } });
Object.defineProperty(exports, "getx", { enumerable: true, get: function () { return utility_1.getx; } });
Object.defineProperty(exports, "camelify", { enumerable: true, get: function () { return utility_1.camelify; } });
Object.defineProperty(exports, "snakify", { enumerable: true, get: function () { return utility_1.snakify; } });
Object.defineProperty(exports, "kebabify", { enumerable: true, get: function () { return utility_1.kebabify; } });
Object.defineProperty(exports, "cmap", { enumerable: true, get: function () { return utility_1.cmap; } });
Object.defineProperty(exports, "vmap", { enumerable: true, get: function () { return utility_1.vmap; } });
Object.defineProperty(exports, "names", { enumerable: true, get: function () { return utility_1.names; } });
Object.defineProperty(exports, "template", { enumerable: true, get: function () { return utility_1.template; } });
Object.defineProperty(exports, "escre", { enumerable: true, get: function () { return utility_1.escre; } });
Object.defineProperty(exports, "indent", { enumerable: true, get: function () { return utility_1.indent; } });
const Content_1 = require("./cmp/Content");
Object.defineProperty(exports, "Content", { enumerable: true, get: function () { return Content_1.Content; } });
const Line_1 = require("./cmp/Line");
Object.defineProperty(exports, "Line", { enumerable: true, get: function () { return Line_1.Line; } });
const Slot_1 = require("./cmp/Slot");
Object.defineProperty(exports, "Slot", { enumerable: true, get: function () { return Slot_1.Slot; } });
const Copy_1 = require("./cmp/Copy");
Object.defineProperty(exports, "Copy", { enumerable: true, get: function () { return Copy_1.Copy; } });
const File_1 = require("./cmp/File");
Object.defineProperty(exports, "File", { enumerable: true, get: function () { return File_1.File; } });
const Inject_1 = require("./cmp/Inject");
Object.defineProperty(exports, "Inject", { enumerable: true, get: function () { return Inject_1.Inject; } });
const Fragment_1 = require("./cmp/Fragment");
Object.defineProperty(exports, "Fragment", { enumerable: true, get: function () { return Fragment_1.Fragment; } });
const Folder_1 = require("./cmp/Folder");
Object.defineProperty(exports, "Folder", { enumerable: true, get: function () { return Folder_1.Folder; } });
const Project_1 = require("./cmp/Project");
Object.defineProperty(exports, "Project", { enumerable: true, get: function () { return Project_1.Project; } });
const List_1 = require("./cmp/List");
Object.defineProperty(exports, "List", { enumerable: true, get: function () { return List_1.List; } });
const CopyOp_1 = require("./op/CopyOp");
const ProjectOp_1 = require("./op/ProjectOp");
const FolderOp_1 = require("./op/FolderOp");
const FileOp_1 = require("./op/FileOp");
const SlotOp_1 = require("./op/SlotOp");
const InjectOp_1 = require("./op/InjectOp");
const FragmentOp_1 = require("./op/FragmentOp");
const ContentOp_1 = require("./op/ContentOp");
const NoneOp_1 = require("./op/NoneOp");
const deep = jsonic_1.util.deep;
exports.deep = deep;
const GLOBAL = global;
const DEFAULT_LOGGER = {
    trace: (...args) => console.log(new Date().toISOString(), 'TRACE', ...args),
    debug: (...args) => console.log(new Date().toISOString(), 'DEBUG', ...args),
    info: (...args) => console.log(new Date().toISOString(), 'INFO', ...args),
    warn: (...args) => console.warn(new Date().toISOString(), 'WARN', ...args),
    error: (...args) => console.error(new Date().toISOString(), 'ERROR', ...args),
    fatal: (...args) => console.error(new Date().toISOString(), 'FATAL', ...args),
};
const OptionsShape = (0, gubu_1.Gubu)({
    folder: '.', // Base output folder for generated files. Default: `.`.
    meta: {}, // Provide meta data to the generation process. Default: `{}`
    fs: (() => undefined), // File system API. Default: `node:fs`.
    log: DEFAULT_LOGGER, // Logging interface.
    debug: 'info', // Generate additional debugging information.
    // TOOD: needs rethink
    exclude: false, // Exclude modified output files. Default: `false`.
    existing: {
        write: true, // Overwrite existing files.
        preserve: false, // Keep a backup copy (.old.) of overwritten files.
        present: false, // Present the new file using .new. name annotation.
        merge: false, // Annotated merge of new generate and existing file.
    },
    model: {},
    build: true,
    mem: false,
    vol: {},
    // Component specific options.
    cmp: {
        Copy: {
            ignore: []
        }
    }
});
function Jostraca(gopts_in) {
    GLOBAL.jostraca = new node_async_hooks_1.AsyncLocalStorage();
    const gopts = OptionsShape(gopts_in || {});
    async function generate(opts_in, root) {
        const opts = OptionsShape(opts_in);
        const useMemFS = opts.mem || gopts.mem;
        const vol = deep({}, gopts.vol, opts.vol);
        const memfs = useMemFS ? (0, memfs_1.memfs)(vol) : undefined;
        const fs = opts.fs() || gopts.fs() || memfs?.fs || Fs;
        const meta = {
            ...(gopts?.meta || {}),
            ...(opts.meta || {}),
        };
        const folder = opts.folder || gopts?.folder || '.';
        const log = opts.log || gopts?.log || DEFAULT_LOGGER;
        const debug = !!(null == opts.debug ? gopts?.debug : opts.debug);
        const existing = deep(gopts.existing, opts.existing);
        const doBuild = null == gopts?.build ? false !== opts.build : false !== gopts?.build;
        const model = deep({}, gopts.model, opts.model);
        // Component defaults.
        opts.cmp = deep({
            Copy: {
                ignore: [/~$/]
            }
        }, gopts?.cmp, opts.cmp);
        const ctx$ = {
            fs: () => fs,
            folder,
            content: null,
            meta,
            opts,
            log,
            debug,
            existing,
            model,
        };
        return GLOBAL.jostraca.run(ctx$, async () => {
            // Define phase
            root();
            const ctx$ = GLOBAL.jostraca.getStore();
            // Build phase
            const buildctx = {
                root: ctx$.root,
                vol: memfs?.vol,
                folder,
                current: {
                    project: {
                        node: makeNode(),
                    },
                    folder: {
                        node: makeNode(),
                        parent: folder,
                        path: [],
                    },
                    // TODI: should be file.node
                    file: makeNode(),
                    content: undefined,
                },
                log: { exclude: [], last: -1 },
                file: {
                    write: [],
                    preserve: [],
                    present: [],
                    merge: [],
                },
                util: {
                    save: () => null,
                    copy: () => null,
                }
            };
            buildctx.util.save = makeSave(fs, existing, buildctx);
            buildctx.util.copy = makeCopy(fs, existing, buildctx);
            if (doBuild) {
                await build(ctx$, buildctx);
            }
            return buildctx;
        });
    }
    async function build(ctx$, buildctx) {
        const topnode = ctx$.node;
        const logpath = node_path_1.default.join(buildctx.folder, '.jostraca', 'jostraca.json.log');
        try {
            buildctx.log = JSON.parse(ctx$.fs().readFileSync(logpath, 'utf8'));
        }
        catch (err) {
            // console.log(err)
            // TODO: file not foound ignored, handle others!
        }
        await step(topnode, ctx$, buildctx);
        try {
            ctx$.fs().mkdirSync(node_path_1.default.dirname(logpath), { recursive: true });
            const log = {
                last: Date.now(),
                exclude: buildctx.log.exclude,
            };
            ctx$.fs().writeFileSync(logpath, JSON.stringify(log, null, 2), { flush: true });
        }
        catch (err) {
            console.log(err);
            // TODO: file not found ignored, handle others!
        }
        return { node: topnode, ctx$, buildctx };
    }
    async function step(node, ctx$, buildctx) {
        try {
            const op = opmap[node.kind];
            if (null == op) {
                throw new Error('missing op: ' + node.kind);
            }
            await op.before(node, ctx$, buildctx);
            if (node.children) {
                for (let childnode of node.children) {
                    try {
                        await step(childnode, ctx$, buildctx);
                    }
                    catch (err) {
                        if (childnode.meta.callsite) {
                            err.callsite = childnode.meta.callsite;
                        }
                        throw err;
                    }
                }
            }
            await op.after(node, ctx$, buildctx);
        }
        catch (err) {
            if (err.jostraca) {
                throw err;
            }
            err.jostraca = true;
            err.step = node.kind;
            throw err;
        }
    }
    const opmap = {
        project: ProjectOp_1.ProjectOp,
        folder: FolderOp_1.FolderOp,
        file: FileOp_1.FileOp,
        inject: InjectOp_1.InjectOp,
        fragment: FragmentOp_1.FragmentOp,
        content: ContentOp_1.ContentOp,
        copy: CopyOp_1.CopyOp,
        slot: SlotOp_1.SlotOp,
        none: NoneOp_1.NoneOp,
    };
    return {
        generate,
    };
}
function cmp(component) {
    const cf = (props, children) => {
        children = null == children ?
            (('function' === typeof props || Array.isArray(props)) ? props : null) : children;
        if (null == props || 'object' !== typeof props) {
            props = { arg: props };
        }
        props.ctx$ = GLOBAL.jostraca.getStore();
        let parent = props.ctx$.node;
        // console.log('BBB', component, props, parent?.filter?.({ props }))
        if (parent?.filter && !parent.filter({ props, children, component })) {
            return undefined;
        }
        children = 'function' === typeof children ? [children] : children;
        let node = {
            kind: 'none',
            children: [],
            path: [],
            meta: {},
            content: [],
        };
        props.ctx$.root = (props.ctx$.root || node);
        parent = props.ctx$.node || node;
        if (props.ctx$.debug) {
            node.meta.debug = (node.meta.debug || {});
            node.meta.debug.callsite = new Error('component: ' + component.name).stack;
        }
        const siblings = props.ctx$.children = (props.ctx$.children || []);
        siblings.push(node);
        props.ctx$.children = node.children;
        props.ctx$.node = node;
        node.path = parent.path.slice(0);
        if ('string' === typeof props.name) {
            node.path.push(props.name);
        }
        let out = component(props, children);
        props.ctx$.children = siblings;
        props.ctx$.node = parent;
        return out;
    };
    Object.defineProperty(cf, 'name', { value: component.name });
    return cf;
}
function makeNode() {
    return { kind: 'none', path: [], meta: {}, content: [] };
}
function makeSave(fs, existing, buildctx) {
    return function save(path, content, write = false) {
        path = node_path_1.default.normalize(path);
        const folder = node_path_1.default.dirname(path);
        // console.log('SAVE', path)
        const exists = fs.existsSync(path);
        write = write || !exists;
        if (exists) {
            let oldcontent;
            // TODO: if content matchs do nothing
            // console.log('EXISTS', path)
            if (existing.preserve) {
                oldcontent = null == oldcontent ? fs.readFileSync(path, 'utf8').toString() : oldcontent;
                if (oldcontent.length !== content.length || oldcontent !== content) {
                    let oldpath = node_path_1.default.join(folder, node_path_1.default.basename(path).replace(/\.[^.]+$/, '') +
                        '.old' + node_path_1.default.extname(path));
                    buildctx.util.copy(path, oldpath, true);
                    buildctx.file.preserve.push({ path, action: 'preserve' });
                }
            }
            if (existing.write) {
                write = true;
            }
            else if (existing.present) {
                oldcontent = null == oldcontent ? fs.readFileSync(path, 'utf8').toString() : oldcontent;
                if (oldcontent.length !== content.length || oldcontent !== content) {
                    let newpath = node_path_1.default.join(folder, node_path_1.default.basename(path).replace(/\.[^.]+$/, '') +
                        '.new' + node_path_1.default.extname(path));
                    fs.writeFileSync(newpath, content, 'utf8', { flush: true });
                    buildctx.file.preserve.push({ path, action: 'present' });
                }
            }
            if (existing.merge) {
                oldcontent = null == oldcontent ? fs.readFileSync(path, 'utf8').toString() : oldcontent;
                write = false;
                if (oldcontent.length !== content.length || oldcontent !== content) {
                    merge(fs, path, content, oldcontent);
                    buildctx.file.merge.push({ path, action: 'merge' });
                }
            }
        }
        if (write) {
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(path, content, 'utf8', { flush: true });
            buildctx.file.write.push({ path, action: 'write' });
        }
    };
}
function makeCopy(fs, existing, buildctx) {
    return function copy(frompath, topath, write = false) {
        const isBinary = utility_1.BINARY_EXT.includes(node_path_1.default.extname(frompath));
        // TODO: check excludes
        fs.mkdirSync(node_path_1.default.dirname(topath), { recursive: true });
        const contents = fs.readFileSync(frompath, isBinary ? undefined : 'utf8');
        fs.writeFileSync(topath, contents, { flush: true });
    };
}
function merge(fs, path, oldcontent, newcontent) {
    const diff = Diff.diffLines(newcontent, oldcontent);
    const out = [];
    const when = new Date().toISOString();
    diff.forEach((part) => {
        if (part.added) {
            out.push('<<<<<< GENERATED: ' + when + '\n');
            out.push(part.value);
            out.push('>>>>>> GENERATED: ' + when + '\n');
        }
        else if (part.removed) {
            out.push('<<<<<< EXISTING: ' + when + '\n');
            out.push(part.value);
            out.push('>>>>>> EXISTING: ' + when + '\n');
        }
        else {
            out.push(part.value);
        }
    });
    const content = out.join('');
    // console.log('MERGE', path, content)
    fs.writeFileSync(path, content, { flush: true });
}
//# sourceMappingURL=jostraca.js.map