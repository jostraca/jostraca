"use strict";
/* Copyright (c) 2026 Richard Rodger, MIT License */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TREE_CMP_DEPRECATED = exports.TREE_CMP = void 0;
exports.cmpTree = cmpTree;
// THE DATA-DRIVEN DEFINE PHASE -- SPIKE (docs/design/AONTU.0.md).
//
// `Jostraca().generate(opts, root)` runs `root` to build the node
// tree, and `root` is a function that calls components. That is the
// right surface for a generator written in TypeScript and the wrong
// one for a generator written somewhere else: aontu evaluates a model
// to a component tree as DATA (aontu-lang/aontu, ts/src/val/
// CmpFuncVal.ts), and there is no way to hand jostraca one.
//
//   const tree = JSON.parse(...)  // from `aontu model.aon`
//   await Jostraca().generate({ folder: 'out' }, cmpTree(tree))
//
// `cmpTree` is that missing half: a plain tree in, a define-phase
// callback out. It is not an interpreter -- it calls the SAME
// exported components a hand-written generator calls, in the same
// define phase, so every rule the components already carry (the
// containment the ops assume, the existing-file modes, dryrun) holds
// unchanged and there is no second implementation to keep in parity.
//
// THE NODE VOCABULARY is three keys, and it is deliberately jostraca's
// own component surface rather than a new schema:
//
//   {cmp: "File", props: {name: "main.ts"}, children: [...]}
//
// `cmp` names an exported component, `props` is its first argument and
// `children` its second. So the vocabulary needs no entry per
// component and no version of its own: a component this file has
// never heard of works the moment it is exported, which is the
// property that makes the aontu side able to grow one primitive at a
// time.
//
// NO DEPENDENCY IN EITHER DIRECTION. The contract between the two
// projects is this JSON shape, not a package: jostraca does not
// depend on aontu (see docs/ADR.md record 0001 -- a production
// dependency needs its own record) and aontu does not depend on
// jostraca. A pipe is the whole integration.
//
// A DATA TREE IS NOT A HAND-WRITTEN ONE, and two rules follow from
// that difference rather than from the components.
//
// (1) THE TREE MAY NOT CHOOSE THE OUTPUT ROOT. `ProjectOp` takes a
// `folder` prop as given -- an absolute path unchanged, a relative one
// joined to the base -- which is right when a developer wrote the call
// and wrong when the tree arrived as JSON: `cmptree-gen --folder
// ./build` would write wherever the input said. `File` and `Folder`
// names are already refused a `..` segment by `validName`; `folder` had
// no such check because nothing could reach it from data. So an
// absolute or upward `folder` is refused here. The operator picks the
// root, through `generate`; the tree fills it.
//
// (2) A COMPONENT NAME MUST BE ONE THE REGISTRY OWNS. `cmps[name]` on
// an ordinary object answers for `toString` and `constructor` too, and
// the resulting call ran `Object.prototype.toString` as a component:
// no node, no output, no error.
//
// SPIKE SCOPE. TypeScript only; the Go port has no twin yet. aontu
// serves three primitives so far (Folder, File, Content), but nothing
// here is limited to those.
const node_path_1 = __importDefault(require("node:path"));
const Content_1 = require("./cmp/Content");
const Line_1 = require("./cmp/Line");
const Slot_1 = require("./cmp/Slot");
const CopyFiles_1 = require("./cmp/CopyFiles");
const File_1 = require("./cmp/File");
const Inject_1 = require("./cmp/Inject");
const Fragment_1 = require("./cmp/Fragment");
const Folder_1 = require("./cmp/Folder");
const Project_1 = require("./cmp/Project");
const ListItems_1 = require("./cmp/ListItems");
// The components a tree may name. The exported set, keyed by the name
// each is exported under -- which is also the name aontu spells the
// function with, because both sides took jostraca's capitalisation.
//
// Written out rather than derived: `tree.ts` is imported BY the barrel,
// so reading the barrel back at module init is a cycle. What keeps it
// complete is a drift guard -- `test/tree.test.ts` reads `src/cmp/` and
// fails if a component file has no entry here -- so a new component is
// one line away from being reachable and cannot land unreachable
// quietly.
const TREE_CMP = {
    Project: Project_1.Project,
    Folder: Folder_1.Folder,
    File: File_1.File,
    Content: Content_1.Content,
    Fragment: Fragment_1.Fragment,
    Inject: Inject_1.Inject,
    Line: Line_1.Line,
    Slot: Slot_1.Slot,
    CopyFiles: CopyFiles_1.CopyFiles,
    ListItems: ListItems_1.ListItems,
};
exports.TREE_CMP = TREE_CMP;
// THE NAMES TWO COMPONENTS SHIPPED UNDER, kept working for a tree
// written against them. Separate from TREE_CMP rather than merged into
// it so the drift guard stays meaningful: that check compares TREE_CMP
// against `src/cmp/` file for file, and folding two extra keys in would
// have meant loosening it to a subset test.
const TREE_CMP_DEPRECATED = {
    Copy: CopyFiles_1.CopyFiles,
    List: ListItems_1.ListItems,
};
exports.TREE_CMP_DEPRECATED = TREE_CMP_DEPRECATED;
const ON = 'cmpTree:';
function nodeErr(msg, path) {
    return new Error(ON + ' ' + msg + ' (at ' + (path || '<root>') + ')');
}
// A COPY DEEP ENOUGH THAT NO COMPONENT CAN REACH THE CALLER'S TREE.
// The outer spread was not: `Fragment` writes its slot markers into
// `props.replace`, so a tree carrying one came back with extra keys,
// accumulated them on a second generate, and threw outright if the map
// was frozen.
//
// Plain objects and arrays are rebuilt; everything else -- a function,
// a RegExp, a Date, a class instance, a primitive -- passes by
// reference, because those are values a component may legitimately be
// handed and copying them would change what they mean. `seen` is there
// for a hand-built tree that refers to itself; JSON cannot make one.
function copyProps(v, seen) {
    if (null == v || 'object' !== typeof v) {
        return v;
    }
    const hit = seen.get(v);
    if (undefined !== hit) {
        return hit;
    }
    if (Array.isArray(v)) {
        const out = [];
        seen.set(v, out);
        for (const el of v) {
            out.push(copyProps(el, seen));
        }
        return out;
    }
    // Only a PLAIN object is walked. `Object.create(null)` counts: it is
    // a bag of data like any object literal.
    const proto = Object.getPrototypeOf(v);
    if (null !== proto && Object.prototype !== proto) {
        return v;
    }
    const out = {};
    seen.set(v, out);
    for (const k of Object.keys(v)) {
        out[k] = copyProps(v[k], seen);
    }
    return out;
}
// Rule (1) above: the tree may not choose the output root.
function validFolder(props, path) {
    const folder = props?.folder;
    if (null == folder) {
        return;
    }
    if ('string' !== typeof folder) {
        throw nodeErr('folder is not a string', path);
    }
    if (node_path_1.default.isAbsolute(folder)) {
        throw nodeErr('folder must not be absolute: ' + folder, path);
    }
    if (folder.split(/[/\\]/).includes('..')) {
        throw nodeErr('folder must not contain a ".." segment: ' + folder, path);
    }
}
// Build the define-phase callback for one node, and recursively for
// its children. Returns a thunk, because that is what a component
// takes as a child: `each(children, {call: true})` calls each one
// inside the parent's own context.
function nodeThunk(node, cmps, path) {
    if (null == node || 'object' !== typeof node || Array.isArray(node)) {
        throw nodeErr('node is not an object', path);
    }
    const name = node.cmp;
    if ('string' !== typeof name || '' === name) {
        throw nodeErr('node has no cmp name', path);
    }
    // An OWN property only: `cmps['toString']` answers on any ordinary
    // object, and the call then ran `Object.prototype.toString` as a
    // component -- no node, no output, no error (rule (2) above).
    const component = Object.prototype.hasOwnProperty.call(cmps, name) ?
        cmps[name] :
        Object.prototype.hasOwnProperty.call(TREE_CMP_DEPRECATED, name) ?
            TREE_CMP_DEPRECATED[name] : undefined;
    if ('function' !== typeof component) {
        throw nodeErr('unknown component: ' + name, path);
    }
    const props = node.props;
    if (null != props && ('object' !== typeof props || Array.isArray(props))) {
        throw nodeErr('props is not an object', path);
    }
    validFolder(props, path);
    const kids = node.children;
    if (null != kids && !Array.isArray(kids)) {
        throw nodeErr('children is not an array', path);
    }
    const children = (kids || []).map((kid, i) => nodeThunk(kid, cmps, path + '/' + name + '[' + i + ']'));
    // THE PARENT'S ARGUMENTS REACH THE CHILD. A component walks its
    // children with `each(children, {call: true, args})`, and `List`
    // passes the per-item `item`, `indent` and `replace` that make
    // `{item.path}` mean anything -- a hand-written child takes them as
    // its parameter. A data child has no parameter list, so they are
    // merged UNDER its own props: context first, the node's own
    // statement last, since that is the half the author wrote.
    //
    // A COPY, every call, and deep enough (see copyProps). `cmp()` writes
    // `ctx$` into the props object it is handed and components write into
    // nested props, so passing the caller's own node would scribble on
    // their data -- and a tree generated twice would carry the first run
    // into the second. `generate` copies its options for the same reason.
    // Per CALL, not per node: `List` invokes each child once per item.
    return (...args) => {
        const invoked = (null != args[0] && 'object' === typeof args[0] &&
            !Array.isArray(args[0])) ? args[0] : undefined;
        return component({ ...invoked, ...copyProps(props || {}, new WeakMap()) }, children);
    };
}
// A define-phase callback for a component tree given as data.
//
//   await Jostraca().generate(opts, cmpTree(tree))
//
// The root may be one node or a list of them; a list becomes
// siblings, which is what `generate`'s synthetic root node is for.
function cmpTree(root, opts) {
    const cmps = null == opts?.cmp ? TREE_CMP : { ...TREE_CMP, ...opts.cmp };
    const nodes = Array.isArray(root) ? root : [root];
    // Built EAGERLY, so a malformed tree is refused by the call that
    // reads it rather than half way through a define phase that has
    // already made folders.
    const thunks = nodes.map((node, i) => nodeThunk(node, cmps, '[' + i + ']'));
    return () => {
        for (const thunk of thunks) {
            thunk();
        }
    };
}
//# sourceMappingURL=tree.js.map