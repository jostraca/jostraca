"use strict";
/* Copyright (c) 2026 Richard Rodger, MIT License */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TREE_CMP = void 0;
exports.cmpTree = cmpTree;
const Content_1 = require("./cmp/Content");
const Line_1 = require("./cmp/Line");
const Slot_1 = require("./cmp/Slot");
const Copy_1 = require("./cmp/Copy");
const File_1 = require("./cmp/File");
const Inject_1 = require("./cmp/Inject");
const Fragment_1 = require("./cmp/Fragment");
const Folder_1 = require("./cmp/Folder");
const Project_1 = require("./cmp/Project");
const List_1 = require("./cmp/List");
// The components a tree may name. The exported set, keyed by the name
// each is exported under -- which is also the name aontu spells the
// function with, because both sides took jostraca's capitalisation.
const TREE_CMP = {
    Project: Project_1.Project,
    Folder: Folder_1.Folder,
    File: File_1.File,
    Content: Content_1.Content,
    Fragment: Fragment_1.Fragment,
    Inject: Inject_1.Inject,
    Copy: Copy_1.Copy,
    Line: Line_1.Line,
    Slot: Slot_1.Slot,
    List: List_1.List,
};
exports.TREE_CMP = TREE_CMP;
const ON = 'cmpTree:';
function nodeErr(msg, path) {
    return new Error(ON + ' ' + msg + ' (at ' + (path || '<root>') + ')');
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
    const component = cmps[name];
    if ('function' !== typeof component) {
        throw nodeErr('unknown component: ' + name, path);
    }
    const props = node.props;
    if (null != props && ('object' !== typeof props || Array.isArray(props))) {
        throw nodeErr('props is not an object', path);
    }
    const kids = node.children;
    if (null != kids && !Array.isArray(kids)) {
        throw nodeErr('children is not an array', path);
    }
    const children = (kids || []).map((kid, i) => nodeThunk(kid, cmps, path + '/' + name + '[' + i + ']'));
    return () => component(
    // A COPY, every call. `cmp()` writes `ctx$` into the props object
    // it is handed, so passing the caller's own node would scribble a
    // live context onto their data -- and a tree parsed once and
    // generated twice would carry the first run's context into the
    // second. `generate` copies its options for the same reason.
    { ...(props || {}) }, children);
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