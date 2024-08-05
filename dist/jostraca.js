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
exports.Jostraca = Jostraca;
const Fs = __importStar(require("node:fs"));
const node_async_hooks_1 = require("node:async_hooks");
function Jostraca() {
    const GLOBAL = global;
    GLOBAL.jostraca = new node_async_hooks_1.AsyncLocalStorage();
    function generate(opts, root) {
        const fs = opts.fs || Fs;
        GLOBAL.jostraca.run({
            content: null,
        }, () => {
            root();
            const ctx$ = GLOBAL.jostraca.getStore();
            const node = ctx$.node;
            build(node, {
                fs,
                current: {
                    folder: {
                        parent: opts.folder
                    }
                }
            });
        });
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
                kind: 'content',
                children: []
            };
            const parent = props.ctx$.node = (props.ctx$.node || node);
            const siblings = props.ctx$.children = (props.ctx$.children || []);
            siblings.push(node);
            props.ctx$.children = node.children;
            props.ctx$.node = node;
            let out = component(props, children);
            props.ctx$.children = siblings;
            props.ctx$.node = parent;
            return out;
        };
        Object.defineProperty(cf, 'name', { value: component.name });
        return cf;
    }
    function each(fnarr) {
        if (fnarr) {
            for (let fn of fnarr) {
                fn();
            }
        }
    }
    function build(topnode, ctx) {
        // console.dir(topnode, { depth: null })
        step(topnode, ctx);
    }
    function step(node, ctx) {
        const op = opmap[node.kind];
        if (null == op) {
            throw new Error('missing op: ' + node.kind);
        }
        op.before(node, ctx);
        if (node.children) {
            for (let childnode of node.children) {
                step(childnode, ctx);
            }
        }
        op.after(node, ctx);
    }
    const opmap = {
        project: {
            before(node, ctx) {
                const cproject = ctx.current.project = (ctx.current.project || {});
                cproject.node = node;
            },
            after(_node, _ctx) {
            },
        },
        folder: {
            before(node, ctx) {
                const cfolder = ctx.current.folder = (ctx.current.folder || {});
                cfolder.node = node;
                cfolder.path = (cfolder.path || [ctx.current.folder.parent]);
                cfolder.path.push(node.name);
                let fullpath = cfolder.path.join('/');
                ctx.fs.mkdirSync(fullpath, { recursive: true });
            },
            after(_node, ctx) {
                const cfolder = ctx.current.folder;
                cfolder.path.length = cfolder.path.length - 1;
            },
        },
        file: {
            before(node, ctx) {
                const cfile = ctx.current.file = node;
                cfile.path = ctx.current.folder.path.join('/') + '/' + node.name;
                cfile.content = [];
            },
            after(_node, ctx) {
                const cfile = ctx.current.file;
                const content = cfile.content.join('');
                ctx.fs.writeFileSync(cfile.path, content);
            },
        },
        content: {
            before(node, ctx) {
                const ccontent = ctx.current.content = node;
                ctx.current.file.content.push(ccontent.content);
            },
            after(_node, _ctx) {
            },
        },
    };
    const Code = cmp(function Code(props) {
        let src = props.arg;
        props.ctx$.node.content = src;
    });
    const File = cmp(function File(props, children) {
        props.ctx$.node.kind = 'file';
        props.ctx$.node.name = props.name;
        Code('// FILE START: ' + props.name + '\n');
        each(children);
        Code('// FILE END: ' + props.name + '\n');
    });
    const Project = cmp(function Project(props, children) {
        props.ctx$.node.kind = 'project';
        props.ctx$.node.name = props.name;
        each(children);
    });
    const Folder = cmp(function Folder(props, children) {
        props.ctx$.node.kind = 'folder';
        props.ctx$.node.name = props.name;
        each(children);
    });
    return {
        cmp,
        each,
        generate,
        Project,
        Code,
        File,
        Folder,
    };
}
//# sourceMappingURL=jostraca.js.map