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
exports.Copy = exports.Folder = exports.File = exports.Code = exports.Project = void 0;
exports.Jostraca = Jostraca;
exports.cmp = cmp;
exports.each = each;
exports.select = select;
exports.get = get;
exports.getx = getx;
exports.camelify = camelify;
exports.snakeify = snakeify;
exports.cmap = cmap;
exports.vmap = vmap;
const Fs = __importStar(require("node:fs"));
const node_async_hooks_1 = require("node:async_hooks");
const jsonic_next_1 = require("@jsonic/jsonic-next");
const { deep } = jsonic_next_1.util;
const GLOBAL = global;
function Jostraca() {
    GLOBAL.jostraca = new node_async_hooks_1.AsyncLocalStorage();
    function generate(opts, root) {
        const fs = opts.fs || Fs;
        GLOBAL.jostraca.run({
            fs,
            content: null,
        }, () => {
            try {
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
            }
            catch (err) {
                console.log('JOSTRACA ERROR:', err);
                throw err;
            }
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
            before(_node, _ctx) {
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
const Copy = cmp(function Copy(props, children) {
    props.ctx$.node.kind = 'file';
    props.ctx$.node.name = props.name;
    const content = props.ctx$.fs.readFileSync(props.from).toString();
    Code(content);
});
exports.Copy = Copy;
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
        let out = [];
        if (Array.isArray(subject)) {
            for (let fn of subject) {
                out.push('function' === typeof fn ? fn() : fn);
            }
            return out.sort();
        }
        else if (null == subject || 'object' !== typeof subject) {
            return [];
        }
    }
    else if (Array.isArray(subject)) {
        return subject.map(apply);
    }
    if (null == subject || 'object' !== typeof subject) {
        return [];
    }
    const entries = Object.entries(subject).map((n, _) => (_ = typeof n[1],
        (null != n[1] && 'object' === _) ? (n[1].key$ = n[0]) :
            (n[1] = { name: n[0], key$: n[0], val$: n[1] }), n));
    if (1 < entries.length) {
        if (entries[0] && entries[0][1] && 'string' === typeof entries[0][1].name) {
            entries.sort((a, b) => a[1].name < b[1].name ? -1 : b[1].name < a[1].name ? 1 : 0);
        }
        else if (entries[0] && entries[0][1] && 'string' === typeof entries[0][1].key$) {
            entries.sort((a, b) => a[1].key$ < b[1].key$ ? -1 : b[1].key$ < a[1].key$ ? 1 : 0);
        }
    }
    apply = 'function' === typeof apply ? apply : (x) => x;
    return entries.map((n, ...args) => apply(n[1], n[0], ...args));
}
function select(key, map) {
    const fn = map && map[key];
    return fn ? fn() : undefined;
}
function getx(root, path) {
    path = ('string' === typeof path ? path.split(/[.\s\r\n\t]/) : path).filter(part => '' != part);
    let node = root;
    let parents = [];
    partloop: for (let i = 0; i < path.length && null != node; i++) {
        let part = String(path[i]).trim();
        let m = part.match(/^([^<=>~^?!]*)([<=>~^?!]+)(.*)$/);
        if (m) {
            part = m[1];
            let op = m[2];
            let arg = m[3];
            let val = '' === part ? node : node[part];
            if ('=' === op && 'null' === arg) {
                parents.push(node);
                node = {}; // virtual node so that ^ works consistently
                continue partloop;
            }
            else if ('^' === op && '' === part && '' !== arg) {
                node = parents[parents.length - Number(arg)];
                continue partloop;
            }
            else if ('?' === op[0]) {
                arg = (1 < op.length ? op.substring(1) : '') + arg;
                node = Array.isArray(val) ?
                    each(val).filter((n) => (null != getx(n, arg))) :
                    each(val).filter((n) => (null != getx(n, arg)))
                        .reduce((a, n) => (a[n.key$] = n, delete n.key$, a), {});
                continue partloop;
            }
            if (null == val)
                return undefined;
            val = Array.isArray(val) ? val.length :
                'object' === typeof val ? Object.keys(val).filter(k => !k.includes('$')).length :
                    val;
            switch (op) {
                case '<':
                    if (!(val < arg))
                        return undefined;
                    break;
                case '<=':
                    if (!(val <= arg))
                        return undefined;
                    break;
                case '>':
                    if (!(val > arg))
                        return undefined;
                    break;
                case '>=':
                    if (!(val >= arg))
                        return undefined;
                    break;
                case '=':
                    if (!(val == arg))
                        return undefined;
                    break;
                case '!=':
                    if (!(val != arg))
                        return undefined;
                    break;
                case '~':
                    if (!(String(val).match(RegExp(arg))))
                        return undefined;
                    break;
                case '^':
                    node = parents[parents.length - Number(arg)];
                    continue partloop;
                default:
                    return undefined;
            }
        }
        parents.push(node);
        node = '' === part ? node : node[part];
    }
    return node;
}
function get(root, path) {
    path = 'string' === typeof path ? path.split('.') : path;
    let node = root;
    for (let i = 0; i < path.length && null != node; i++) {
        node = node[path[i]];
    }
    return node;
}
function camelify(input) {
    let parts = 'string' == typeof input ? input.split('-') : input.map(n => '' + n);
    return parts
        .map((p) => ('' === p ? '' : (p[0].toUpperCase() + p.substring(1))))
        .join('');
}
function snakeify(input) {
    let parts = 'string' == typeof input ? input.split(/([A-Z])/) : input.map(n => '' + n);
    return parts
        .filter((p) => '' !== p)
        .reduce((a, n, i) => ((0 === i % 2 ? a.push(n.toLowerCase()) : a[(i / 2) | 0] += n), a), [])
        .join('-');
}
// Map child objects to new child objects
function cmap(o, p) {
    return Object
        .entries(o)
        .reduce((r, n, _) => (_ = Object
        .entries(p)
        .reduce((s, m) => (cmap.FILTER === s ? s : (s[m[0]] = (
    // transfom(val,key,current,parentkey,parent)
    'function' === typeof m[1] ? m[1](n[1][m[0]], {
        skey: m[0], self: n[1], key: n[0], parent: o
    }) : m[1]), (cmap.FILTER === s[m[0]] ? cmap.FILTER : s))), {})
        , (cmap.FILTER === _ ? 0 : r[n[0]] = _), r), {});
}
cmap.COPY = (x) => x;
// keep self if x is truthy, or function returning truthy-new-value or [truthy,new-value]
cmap.FILTER = (x) => 'function' === typeof x ? ((y, p, _) => (_ = x(y, p), Array.isArray(_) ? !_[0] ? _[1] : cmap.FILTER : _)) : (x ? x : cmap.FILTER);
cmap.KEY = (_, p) => p.key;
// Map child objects to a list of child objects
function vmap(o, p) {
    return Object
        .entries(o)
        .reduce((r, n, _) => (_ = Object
        .entries(p)
        .reduce((s, m) => (vmap.FILTER === s ? s : (s[m[0]] = (
    // transfom(val,key,current,parentkey,parent)
    // 'function' === typeof m[1] ? m[1](n[1][m[0]], m[0], n[1], n[0], o) : m[1]
    'function' === typeof m[1] ? m[1](n[1][m[0]], {
        skey: m[0], self: n[1], key: n[0], parent: o
    }) : m[1]), (vmap.FILTER === s[m[0]] ? vmap.FILTER : s))), {})
        , (vmap.FILTER === _ ? 0 : r.push(_)), r), []);
}
vmap.COPY = (x) => x;
vmap.FILTER = (x) => 'function' === typeof x ? ((y, p, _) => (_ = x(y, p), Array.isArray(_) ? !_[0] ? _[1] : vmap.FILTER : _)) : (x ? x : vmap.FILTER);
vmap.KEY = (_, p) => p.key;
//# sourceMappingURL=jostraca.js.map