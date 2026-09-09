/* Copyright (c) 2026 Richard Rodger, MIT License */

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
// SPIKE SCOPE. TypeScript only; the Go port has no twin yet. aontu
// serves three primitives so far (Folder, File, Content), but nothing
// here is limited to those.

import type { Component } from './types'

import { Content } from './cmp/Content'
import { Line } from './cmp/Line'
import { Slot } from './cmp/Slot'
import { Copy } from './cmp/Copy'
import { File } from './cmp/File'
import { Inject } from './cmp/Inject'
import { Fragment } from './cmp/Fragment'
import { Folder } from './cmp/Folder'
import { Project } from './cmp/Project'
import { List } from './cmp/List'


// One node of the tree. `cmp` is required; the other two are not,
// because a leaf with no props is a legitimate thing to say.
type CmpTreeNode = {
  cmp: string
  props?: Record<string, any>
  children?: CmpTreeNode[]
}


type CmpTreeOptions = {
  // Extra components, by the name a node's `cmp` uses. Merged over the
  // exported set, so a caller may add their own or override one.
  cmp?: Record<string, Component>
}


// The components a tree may name. The exported set, keyed by the name
// each is exported under -- which is also the name aontu spells the
// function with, because both sides took jostraca's capitalisation.
const TREE_CMP: Record<string, Component> = {
  Project,
  Folder,
  File,
  Content,
  Fragment,
  Inject,
  Copy,
  Line,
  Slot,
  List,
}


const ON = 'cmpTree:'


function nodeErr(msg: string, path: string): Error {
  return new Error(ON + ' ' + msg + ' (at ' + (path || '<root>') + ')')
}


// Build the define-phase callback for one node, and recursively for
// its children. Returns a thunk, because that is what a component
// takes as a child: `each(children, {call: true})` calls each one
// inside the parent's own context.
function nodeThunk(
  node: CmpTreeNode,
  cmps: Record<string, Component>,
  path: string
): () => any {
  if (null == node || 'object' !== typeof node || Array.isArray(node)) {
    throw nodeErr('node is not an object', path)
  }

  const name = node.cmp
  if ('string' !== typeof name || '' === name) {
    throw nodeErr('node has no cmp name', path)
  }

  const component = cmps[name]
  if ('function' !== typeof component) {
    throw nodeErr('unknown component: ' + name, path)
  }

  const props = node.props
  if (null != props && ('object' !== typeof props || Array.isArray(props))) {
    throw nodeErr('props is not an object', path)
  }

  const kids = node.children
  if (null != kids && !Array.isArray(kids)) {
    throw nodeErr('children is not an array', path)
  }

  const children = (kids || []).map(
    (kid: CmpTreeNode, i: number) =>
      nodeThunk(kid, cmps, path + '/' + name + '[' + i + ']'))

  return () => component(
    // A COPY, every call. `cmp()` writes `ctx$` into the props object
    // it is handed, so passing the caller's own node would scribble a
    // live context onto their data -- and a tree parsed once and
    // generated twice would carry the first run's context into the
    // second. `generate` copies its options for the same reason.
    { ...(props || {}) },
    children)
}


// A define-phase callback for a component tree given as data.
//
//   await Jostraca().generate(opts, cmpTree(tree))
//
// The root may be one node or a list of them; a list becomes
// siblings, which is what `generate`'s synthetic root node is for.
function cmpTree(
  root: CmpTreeNode | CmpTreeNode[],
  opts?: CmpTreeOptions
): () => void {
  const cmps = null == opts?.cmp ? TREE_CMP : { ...TREE_CMP, ...opts.cmp }

  const nodes: CmpTreeNode[] = Array.isArray(root) ? root : [root]

  // Built EAGERLY, so a malformed tree is refused by the call that
  // reads it rather than half way through a define phase that has
  // already made folders.
  const thunks = nodes.map(
    (node: CmpTreeNode, i: number) => nodeThunk(node, cmps, '[' + i + ']'))

  return () => {
    for (const thunk of thunks) {
      thunk()
    }
  }
}


export type {
  CmpTreeNode,
  CmpTreeOptions,
}

export {
  TREE_CMP,
  cmpTree,
}
