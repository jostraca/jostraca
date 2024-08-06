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
exports.Folder = exports.File = exports.Code = exports.Project = void 0;
exports.Jostraca = Jostraca;
exports.cmp = cmp;
exports.each = each;
exports.select = select;
const Fs = __importStar(require("node:fs"));
const node_async_hooks_1 = require("node:async_hooks");
const GLOBAL = global;
function Jostraca() {
    GLOBAL.jostraca = new node_async_hooks_1.AsyncLocalStorage();
    function generate(opts, root) {
        const fs = opts.fs || Fs;
        GLOBAL.jostraca.run({
            content: null,
        }, () => {
            root();
            const ctx$ = GLOBAL.jostraca.getStore();
            const node = ctx$.node;
            // console.log('JOSTRACA TOP')
            // console.dir(node, { depth: null })
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
    function build(topnode, ctx) {
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
                const content = ctx.current.content = node;
                ctx.current.file.content.push(content.content);
            },
            after(_node, _ctx) {
            },
        },
        none: {
            before(_node, ctx) {
            },
            after(_node, _ctx) {
            },
        },
    };
    return {
        generate,
    };
}
const Code = cmp(function Code(props) {
    props.ctx$.node.kind = 'content';
    let src = props.arg;
    props.ctx$.node.content = src;
});
exports.Code = Code;
const File = cmp(function File(props, children) {
    props.ctx$.node.kind = 'file';
    props.ctx$.node.name = props.name;
    // Code('// FILE START: ' + props.name + '\n')
    each(children);
    // Code('// FILE END: ' + props.name + '\n')
});
exports.File = File;
const Project = cmp(function Project(props, children) {
    props.ctx$.node.kind = 'project';
    props.ctx$.node.name = props.name;
    each(children);
});
exports.Project = Project;
const Folder = cmp(function Folder(props, children) {
    props.ctx$.node.kind = 'folder';
    props.ctx$.node.name = props.name;
    each(children);
});
exports.Folder = Folder;
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
function each(subject, apply) {
    if (null == apply) {
        if (Array.isArray(subject)) {
            for (let fn of subject) {
                fn();
            }
        }
    }
    else {
        if (Array.isArray(subject)) {
            return subject.map(apply);
        }
        else {
            const entries = Object.entries(subject);
            if (entries[0] && entries[0][1] && 'string' === typeof entries[0][1].name) {
                entries.sort((a, b) => a.name < b.name ? 1 : b.name < a.name ? -1 : 0);
            }
            return entries.map((n, ...args) => apply(n[1], [0], ...args));
        }
    }
}
function select(key, map) {
    const fn = map && map[key];
    return fn ? fn() : undefined;
}
//# sourceMappingURL=jostraca.js.map