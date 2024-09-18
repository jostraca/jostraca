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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Copy = exports.Folder = exports.File = exports.Content = exports.Project = exports.names = exports.vmap = exports.cmap = exports.kebabify = exports.snakify = exports.camelify = exports.getx = exports.get = exports.select = exports.each = void 0;
exports.Jostraca = Jostraca;
exports.cmp = cmp;
const Fs = __importStar(require("node:fs"));
const node_async_hooks_1 = require("node:async_hooks");
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
const Content_1 = require("./cmp/Content");
Object.defineProperty(exports, "Content", { enumerable: true, get: function () { return Content_1.Content; } });
const Copy_1 = require("./cmp/Copy");
Object.defineProperty(exports, "Copy", { enumerable: true, get: function () { return Copy_1.Copy; } });
const File_1 = require("./cmp/File");
Object.defineProperty(exports, "File", { enumerable: true, get: function () { return File_1.File; } });
const Folder_1 = require("./cmp/Folder");
Object.defineProperty(exports, "Folder", { enumerable: true, get: function () { return Folder_1.Folder; } });
const Project_1 = require("./cmp/Project");
Object.defineProperty(exports, "Project", { enumerable: true, get: function () { return Project_1.Project; } });
const CopyOp_1 = require("./op/CopyOp");
const ProjectOp_1 = require("./op/ProjectOp");
const FolderOp_1 = require("./op/FolderOp");
const FileOp_1 = require("./op/FileOp");
const ContentOp_1 = require("./op/ContentOp");
const NoneOp_1 = require("./op/NoneOp");
const GLOBAL = global;
function Jostraca() {
    GLOBAL.jostraca = new node_async_hooks_1.AsyncLocalStorage();
    function generate(opts, root) {
        const fs = opts.fs || Fs;
        const meta = opts.meta || {};
        const folder = opts.folder || '.';
        const ctx$ = {
            folder,
            content: null,
            meta,
            fs,
        };
        GLOBAL.jostraca.run(ctx$, () => {
            try {
                // Define phase
                root();
                const ctx$ = GLOBAL.jostraca.getStore();
                console.dir(ctx$.node, { depth: null });
                // Build phase
                build(ctx$, {
                    fs,
                    current: {
                        folder: {
                            parent: folder
                        }
                    }
                });
            }
            catch (err) {
                console.log('JOSTRACA ERROR:', err);
                throw err;
            }
        });
    }
    function build(ctx$, buildctx) {
        const topnode = ctx$.node;
        step(topnode, ctx$, buildctx);
    }
    function step(node, ctx$, buildctx) {
        try {
            const op = opmap[node.kind];
            if (null == op) {
                throw new Error('missing op: ' + node.kind);
            }
            op.before(node, ctx$, buildctx);
            if (node.children) {
                for (let childnode of node.children) {
                    step(childnode, ctx$, buildctx);
                }
            }
            op.after(node, ctx$, buildctx);
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
        content: ContentOp_1.ContentOp,
        copy: CopyOp_1.CopyOp,
        none: NoneOp_1.NoneOp,
    };
    return {
        generate,
    };
}
function cmp(component) {
    const cf = (props, children) => {
        props = props || {};
        if (null == props || 'object' !== typeof props) {
            props = { arg: props };
        }
        props.ctx$ = GLOBAL.jostraca.getStore();
        children = 'function' === typeof children ? [children] : children;
        let node = {
            kind: 'none',
            children: [],
            path: [],
        };
        const parent = props.ctx$.node = (props.ctx$.node || node);
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
//# sourceMappingURL=jostraca.js.map