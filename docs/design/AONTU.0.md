# A component tree given as data — the aontu seam, a spike

**Status:** SPIKE, 2026-09-09. Built, in TypeScript only, and behind no
flag. There is no Go twin, no shared-spec row and no production
dependency in either direction. This note records what was built, what
it proved, and what it did not.

**Origin:** Richard Rodger, 2026-09-09: *"Jostraca should be used by
aontu for code generation. The Jostraca component primitives like
Folder, File etc should be available as aontu functions (keep upper
case)."* The companion change is in the aontu repository, whose note is
`docs/design/JOSTRACA.0.md` there; it adds `Folder`, `File` and
`Content` as aontu functions that evaluate to the tree this file reads.

**Method:** every claim marked [verified] was run against this tree —
`npm run build` in `ts/` then the command or test named — with the aontu
checkout at `f661a87` plus its own spike branch.

---

## 1. The gap

`Jostraca().generate(opts, root)` runs `root` to build the node tree,
and `root` is a function that calls components. That is the right
surface for a generator written in TypeScript and the wrong one for a
generator written anywhere else. aontu evaluates a model to a component
tree as DATA, and there was no way to hand jostraca one.

The gap was named in aontu's own design and then dismissed. G9
Resolution 1 in that repository concluded: *"because the bridge builds
the Project tree in the host from a render report, Jostraca needs no
data-driven `Tree(nodedef)` component. That was named as blocking; it is
not."* The spike is the other road, and on that road the component IS
needed — so this file is the `Tree(nodedef)` that was ruled out, built to
find out what it costs. It cost 150 lines and no dependency.

## 2. What was built

`ts/src/tree.ts`, exporting `cmpTree(tree, opts?)`: a component tree
given as data in, a define-phase callback out.

```ts
const tree = JSON.parse(...)        // from `aontu model.aon`
await Jostraca().generate({ folder: 'out' }, cmpTree(tree))
```

**It is not an interpreter.** It calls the same exported components a
hand-written generator calls, in the same define phase, so every rule
the components already carry — the containment the ops assume, the
existing-file modes, `dryrun`, the meta log — holds unchanged and there
is no second implementation to keep in parity. That is the whole design
decision, and it is what keeps the file at 150 lines.

**The node vocabulary is jostraca's own component surface**, not a new
schema:

```json
{"cmp": "File", "props": {"name": "main.ts"}, "children": [...]}
```

`cmp` names an exported component, `props` is its first argument,
`children` its second. So the vocabulary needs no entry per component
and no version of its own: a component this file has never heard of
works the moment it is exported. [verified] `test/tree.test.ts`
generates through `Project`, `Folder`, `File`, `Content` and `Line`
without `tree.ts` knowing anything about any of them, and pins the
exported set so a new component cannot land unreachable.

`props` and `children` are both optional — a leaf with nothing to say is
a legitimate node — and a root may be a list, which becomes siblings
under the synthetic root node `generate` already creates.

## 3. Three things the implementation had to get right

**The tree is the caller's data.** `cmp()` writes `ctx$` into the props
object it is handed, so passing a node's own `props` would scribble a
live context onto the caller's data — and a tree parsed once and
generated twice would carry the first run's context into the second.
The bridge passes a shallow copy. `generate` copies its options for the
same reason (see `docs/design/PARITY_PLAN.md` 1.3). [verified]
`the-tree-is-not-scribbled-on`.

**A malformed tree is refused by the call that reads it**, not half way
through a define phase that has already made folders. `cmpTree` walks
the whole tree eagerly and returns a thunk; every refusal names the
offending node by path (`[0]/Folder[0]/File[0]`). [verified]
`malformed-trees-are-refused`.

**Children are thunks.** A component's second argument is walked with
`each(children, {call: true})`, so each child must be a function called
inside the parent's own context — not a node, and not a node already
built.

## 3a. What the data path exposed

Nothing in the engine had to change -- no component, no op, no build
phase, no file handler. But a tree that arrives as JSON is not a tree a
developer wrote at the call site, and five things turned on that
difference. All five were found by review on the pull request, and all
five were reproduced before they were fixed; each has a case in
`test/tree.test.ts`.

Two are properties of jostraca that only the data path makes reachable:

- **`Project.folder` has no traversal check.** `validName` refuses a
  `..` segment in a `File` or `Folder` name; `ProjectOp` takes `folder`
  as given -- an absolute path unchanged, a relative one joined to the
  base. That is right when a developer wrote the call and wrong when
  the tree is input: `cmptree-gen --folder ./build` would write
  wherever the JSON said. [verified] both spellings escaped. `cmpTree`
  now refuses an absolute or upward `folder`; the operator picks the
  root, the tree fills it.
- **`Fragment` writes into `props.replace`.** It assigns its slot
  markers into the map it is handed, so an outer-object copy was not
  enough: a tree carrying a `replace` came back with extra keys,
  accumulated them on a second generate, and threw outright if the map
  was frozen. [verified]. The bridge now copies plain objects and
  arrays to any depth, passing functions, RegExps and class instances
  by reference because those are values a component is meant to
  receive.

Three are the bridge's own:

- **A parent's invocation arguments were dropped.** `List` walks its
  children once per item with `{item, indent, replace}`, which a
  hand-written child takes as its parameter. A data child has no
  parameter list, so `n={item.n}` was emitted verbatim, twice
  [verified]. The thunk now merges those arguments UNDER the node's own
  props: context first, the author's own statement last.
- **An inherited name resolved to a component.** `cmps['toString']`
  answers on any ordinary object, so `{cmp: "toString"}` passed
  validation and ran `Object.prototype.toString` as a component -- no
  node, no output, no error [verified]. The lookup requires an own
  property.
- **The CLI read an option as a value.** `--folder --dryrun` consumed
  `--dryrun` as the directory and wrote into a folder of that name with
  dry-run off [verified].

## 4. The pipeline

`tools/cmptree-gen.js` is the end of it:

```sh
aontu model.aon | node tools/cmptree-gen.js --at out --folder ./build
```

[verified] against the aontu worked example, which writes
`build/src/planet.ts` holding the five expected lines. `--at` takes one
top-level key, because aontu prints the whole document and the tree is
usually one field of it; `--dryrun` reports without writing.

**Neither project depends on the other.** The contract is the JSON
shape. jostraca does not depend on aontu — a production dependency needs
its own record, `docs/ADR.md` 0001 — and aontu does not depend on
jostraca. A pipe is the whole integration, and that it is enough is the
finding: aontu's own design once had it importing jostraca as an
exact-pinned production dependency in both ports, with a pin-equality
guard, an isolated bridge package and a require-graph assertion to keep
its language server away from the file writer. That plan was retired in
that repository in September 2026, on two grounds — the write story is
regenerate-everything rather than a merge over hand edits, and the
dependency was an eleven-fold install growth — and the retirement
explicitly leaves the hand-off to a tool that owns files as a pipeline
step the user runs. This is that pipeline step, and none of the
dependency machinery is needed to run it.

**One of those two grounds no longer holds, and it is this repository's
doing.** The install figure was `memfs`, imported unconditionally for a
capability used only under `mem: true`. It was replaced by the in-repo
port at `ts/src/util/memfs.ts`, and the published tree is now `shape`
and nothing else: [verified] 736 KB installed, with no transitive
dependency. Recorded here because the figure that decided it is quoted
in the other repository and is stale. The other ground, the lifecycle,
is untouched and is the load-bearing one.

## 5. What the spike did not answer

**`Line` no longer differs from `Content` — FIXED.** `Line` called
`template(src, model)` and never forwarded `props.replace` or
`props.extra`, so a `Line` inside a `ListItems` emitted `{item.n}`
verbatim where a `Content` in the same position substituted. [verified]
both before and after. THE GO PORT WAS ALREADY RIGHT: `LineP` delegates
to `ContentP`, which merges `Extra` and forwards `Replace`. So this is
the case AGENTS.md names — the port pre-empting a latent TS bug — and
the fix went into TypeScript with Go left alone.

**`$$...$$`.** `Content` templates unconditionally, so a `$$path$$`
sequence in aontu-generated bytes is silently substituted from the
generate model — aontu owns the bytes right up until jostraca takes the
last edit. [verified] both halves: with an empty model
`a $$path$$ b` survives, and with `model: {path: 'ZZZ'}` it becomes
`a ZZZ b`. aontu once asked for a `raw: true` prop on this side and
withdrew the ask when it retired the bridge, so nothing is outstanding —
but the hazard is not, and it now belongs to whoever runs the pipeline.
The tool passes an empty model, which is safe for a caller who wants no
model of their own and not for one who does. `raw: true` on `Content`,
or a `cmpTree` option that sets it for every node, is the fix and it is
small.

**Line termination.** `FileOp` joins a file's content spans with the
empty string, so two `Content` nodes concatenate with nothing between
them and an aontu generator has to carry its own `\n`. `Line` is the
answer and the bridge already reaches it; aontu has no `Line` primitive
yet.

**Name casing.** jostraca ships `camelify`, `snakify`, `kebabify` and
`names`; aontu has whole-string `upper`/`lower` and no title case. A
generator that wants an identifier in the target's convention derives it
on this side or writes it out. Neither is right, and it is the same gap
on both sides of the seam.

**Go — DONE.** `go/tree.go` is the twin, with `go/tree_test.go`
mirroring the TypeScript cases, and both ports generate byte-identical
output from the same aontu tree. Two differences are forced by the
language and recorded in `go/README.md`: the inherited props are an
explicit parameter, because a Go component body is `func(*J)` and
carries nothing; and there is no inherited-name hazard to guard,
because a Go map answers only for keys it holds.

**Whether the registry should derive itself.** `TREE_CMP` is written
out, because `tree.ts` is imported BY the barrel and reading the barrel
back at module init is a cycle. What keeps it honest is a drift guard:
the suite reads `src/cmp/` and fails if a component file has no entry,
so a new component is one line from reachable and cannot land
unreachable quietly. Deriving it properly needs a marker on what `cmp()`
returns, which is a change to the component machinery for one consumer.

**Whether `cmpTree` belongs in the package at all.** It is exported from
`jostraca` today because that is the cheapest thing that could work. A
data-driven define phase is a small, self-contained surface with one
known consumer; if it grows options it should be argued on its own,
because everything it can express, a hand-written generator can already
express by writing it.
