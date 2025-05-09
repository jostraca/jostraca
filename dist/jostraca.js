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
Object.defineProperty(exports, "__esModule", { value: true });
exports.List = exports.Slot = exports.Line = exports.Copy = exports.Folder = exports.Fragment = exports.Inject = exports.File = exports.Content = exports.Project = exports.omap = exports.deep = exports.ucf = exports.lcf = exports.partify = exports.isbinext = exports.indent = exports.escre = exports.template = exports.names = exports.vmap = exports.cmap = exports.kebabify = exports.snakify = exports.camelify = exports.getx = exports.get = exports.select = exports.each = exports.BuildContext = void 0;
exports.Jostraca = Jostraca;
exports.cmp = cmp;
// TODO:
// Need to check file existence in define phase, otherwise error stack is useless
// Options for each cmp; for copy, option to exclude ~ backups
const Fs = __importStar(require("node:fs"));
const node_async_hooks_1 = require("node:async_hooks");
const jsonic_1 = require("jsonic");
const gubu_1 = require("gubu");
const memfs_1 = require("memfs");
const BuildContext_1 = require("./build/BuildContext");
Object.defineProperty(exports, "BuildContext", { enumerable: true, get: function () { return BuildContext_1.BuildContext; } });
const basic_1 = require("./util/basic");
Object.defineProperty(exports, "each", { enumerable: true, get: function () { return basic_1.each; } });
Object.defineProperty(exports, "select", { enumerable: true, get: function () { return basic_1.select; } });
Object.defineProperty(exports, "get", { enumerable: true, get: function () { return basic_1.get; } });
Object.defineProperty(exports, "getx", { enumerable: true, get: function () { return basic_1.getx; } });
Object.defineProperty(exports, "camelify", { enumerable: true, get: function () { return basic_1.camelify; } });
Object.defineProperty(exports, "snakify", { enumerable: true, get: function () { return basic_1.snakify; } });
Object.defineProperty(exports, "kebabify", { enumerable: true, get: function () { return basic_1.kebabify; } });
Object.defineProperty(exports, "cmap", { enumerable: true, get: function () { return basic_1.cmap; } });
Object.defineProperty(exports, "vmap", { enumerable: true, get: function () { return basic_1.vmap; } });
Object.defineProperty(exports, "names", { enumerable: true, get: function () { return basic_1.names; } });
Object.defineProperty(exports, "template", { enumerable: true, get: function () { return basic_1.template; } });
Object.defineProperty(exports, "escre", { enumerable: true, get: function () { return basic_1.escre; } });
Object.defineProperty(exports, "indent", { enumerable: true, get: function () { return basic_1.indent; } });
Object.defineProperty(exports, "isbinext", { enumerable: true, get: function () { return basic_1.isbinext; } });
Object.defineProperty(exports, "partify", { enumerable: true, get: function () { return basic_1.partify; } });
Object.defineProperty(exports, "lcf", { enumerable: true, get: function () { return basic_1.lcf; } });
Object.defineProperty(exports, "ucf", { enumerable: true, get: function () { return basic_1.ucf; } });
// TODO: the actual signatures
const deep = jsonic_1.util.deep;
exports.deep = deep;
const omap = jsonic_1.util.omap;
exports.omap = omap;
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
    folder: (0, gubu_1.Skip)(String), // Base output folder for generated files. Default: `.`.
    meta: {}, // Provide meta data to the generation process. Default: `{}`
    fs: (0, gubu_1.Skip)(Function), // File system API. Default: `node:fs`.
    now: undefined, // Provide current time.
    log: DEFAULT_LOGGER, // Logging interface.
    debug: (0, gubu_1.Skip)('info'), // Generate additional debugging information.
    // TOOD: needs rethink
    exclude: false, // Exclude modified output files. Default: `false`.
    // Validated in separate shape to allow overriding.
    existing: { txt: {}, bin: {} },
    model: (0, gubu_1.Skip)({}),
    build: true,
    mem: false,
    vol: {},
    // Component specific options.
    cmp: {
        Copy: {
            ignore: []
        }
    },
    control: {
        duplicate: true,
        version: false,
    },
}, { name: 'Jostraca Options' });
const ExistingShape = (0, gubu_1.Gubu)({
    txt: {
        write: true, // Overwrite existing files (unless present=true).
        preserve: false, // Keep a backup copy (.old.) of overwritten files.
        present: false, // Present the new file using .new. name annotation.
        diff: false, // Annotated 2-way diff of new generate and existing file.
        merge: false, // Annotated 3-way merge of new generate and existing file.
    },
    bin: {
        write: true, // Overwrite existing files (unless present=true).
        preserve: false, // Keep a backup copy (.old.) of overwritten files.
        present: false, // Present the new file using .new. name annotation.
        // No diff of binary files
        // No merge of binary files
    }
}, { name: 'Jostraca Options (`existing` property)' });
function Jostraca(gopts_in) {
    GLOBAL.jostraca = new node_async_hooks_1.AsyncLocalStorage();
    const gopts = OptionsShape(gopts_in || {});
    async function generate(opts_in, root) {
        const opts = OptionsShape(opts_in);
        const useMemFS = opts.mem || gopts.mem;
        const vol = deep({}, gopts.vol, opts.vol);
        const memfs = useMemFS ? (0, memfs_1.memfs)(vol) : undefined;
        const fs = (opts.fs || gopts.fs || (() => memfs?.fs) || (() => Fs))();
        const now = opts.now || gopts.now || Date.now;
        const meta = {
            ...(gopts?.meta || {}),
            ...(opts.meta || {}),
        };
        const folder = opts.folder || gopts?.folder || '.';
        const log = opts.log || gopts?.log || DEFAULT_LOGGER;
        // const debug: boolean = !!(null == opts.debug ? gopts?.debug : opts.debug)
        const debug = opts.debug || gopts.debug;
        const existing = ExistingShape({
            // FIX: this does not work as generate opts get defaults from OptionsShape
            txt: deep({}, gopts.existing.txt, opts.existing.txt),
            bin: deep({}, gopts.existing.bin, opts.existing.bin),
        });
        const control = opts.control;
        const doBuild = null == gopts?.build ? false !== opts.build : false !== gopts?.build;
        // const model = deep({}, gopts.model, opts.model)
        const model = opts.model || gopts.model || {};
        // Component defaults.
        opts.cmp = deep({
            Copy: {
                ignore: [/~$/]
            }
        }, gopts?.cmp, opts.cmp);
        const ctx$ = {
            fs: () => fs,
            now: () => now(),
            folder,
            content: null,
            meta,
            opts,
            log,
            debug,
            // existing,
            model,
        };
        return GLOBAL.jostraca.run(ctx$, async () => {
            // Define phase
            root();
            const ctx$ = GLOBAL.jostraca.getStore();
            // Build phase
            const buildctx = new BuildContext_1.BuildContext(folder, existing, control, ctx$.fs, ctx$.now);
            if (doBuild) {
                await build(ctx$, buildctx);
            }
            const res = {
                when: buildctx.when,
                files: buildctx.fh.files
            };
            if (memfs) {
                res.vol = memfs.vol;
            }
            return res;
        });
    }
    async function build(ctx$, buildctx) {
        const topnode = ctx$.node;
        await step(topnode, ctx$, buildctx);
        buildctx.bmeta.done();
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
        const ctx$ = GLOBAL.jostraca.getStore();
        children = null == children ?
            (('function' === typeof props || Array.isArray(props)) ? props : null) : children;
        // if (undefined === props) {
        //   props = ctx$.props ? ctx$.props() : undefined
        // }
        if (null == props || 'object' !== typeof props) {
            props = { arg: props };
        }
        props.ctx$ = ctx$;
        let parent = ctx$.node;
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
        ctx$.root = (ctx$.root || node);
        parent = ctx$.node || node;
        if (ctx$.debug) {
            node.meta.debug = (node.meta.debug || {});
            node.meta.debug.callsite = new Error('component: ' + component.name).stack;
        }
        const siblings = ctx$.children = (ctx$.children || []);
        siblings.push(node);
        ctx$.children = node.children;
        ctx$.node = node;
        node.path = parent.path.slice(0);
        if ('string' === typeof props.name) {
            node.path.push(props.name);
        }
        // ctx$.props = () => props
        let out = component(props, children);
        ctx$.children = siblings;
        ctx$.node = parent;
        return out;
    };
    Object.defineProperty(cf, 'name', { value: component.name });
    return cf;
}
//# sourceMappingURL=jostraca.js.map