# A component tree given as data — the aontu seam

**Status:** SUPPORTED, 2026-09-13. Began as a spike on 2026-09-09 (in
TypeScript only, behind no flag, with no Go twin). Both ports now carry
it, it is documented in the reference pages, and §6 records the P0 work
aontu's `UNITS-AND-TREES.1.md` asked for. There is still no production
dependency in either direction. §1 to §5 are the spike's own record,
kept as written except where an item is marked resolved.

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
`build/src/planet-body.ts` holding the five expected lines. `--at` takes one
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

**`$$...$$` — RESOLVED, see §6.1.** `Content` templates
unconditionally, so a `$$path$$` sequence in aontu-generated bytes is
silently substituted from the generate model — aontu owns the bytes
right up until jostraca takes the last edit. [verified] both halves:
with an empty model `a $$path$$ b` survives, and with
`model: {path: 'ZZZ'}` it becomes `a ZZZ b`. aontu once asked for a
`raw: true` prop on this side and withdrew the ask when it retired the
bridge, so nothing is outstanding — but the hazard is not, and it now
belongs to whoever runs the pipeline. The tool passes an empty model,
which is safe for a caller who wants no model of their own and not for
one who does. `raw: true` on `Content`, or a `cmpTree` option that sets
it for every node, is the fix and it is small.

*The claim about the empty model is too generous, and §6.1 has the
measurement: `$$"quoted"$$` and `$$__JOSTRACA_REPLACE__$$` substitute
with no model at all.*

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

**Whether `cmpTree` belongs in the package at all — RESOLVED, see
§6.2.** It is exported from `jostraca` today because that is the
cheapest thing that could work. A data-driven define phase is a small,
self-contained surface with one known consumer; if it grows options it
should be argued on its own, because everything it can express, a
hand-written generator can already express by writing it.

---

## 6. P0 as delivered

**Method:** every claim marked [verified] below was run against this
tree at the commit that carries it — `npm run build && npm test` in
`ts/`, `go test ./...` in `go/`, and the command named — with the aontu
checkout at `97b7de5`.

The asks are aontu's `docs/design/UNITS-AND-TREES.1.md` §5 and §10,
2026-09-13. **This section is the answer to them, and three of the five
answers are not the ones that were asked for.** Where that is so it says
which measurement changed the answer.

### 6.1 `raw` — done, and the hazard is wider than §5 recorded

`raw: true` on `Content` and on `Line`, plus `cmpTree(tree, {raw: true})`
and `CmpTreeOptions{Raw: true}`. Passing it skips `template` entirely:
no model substitution and no `replace`. `indent` still applies, because
that is placement rather than substitution. Templating stays the
default, which is stated in `docs/reference-components.md` under
`Content` → `raw`, with the reason: a generator that writes its text at
the call site put the `$$` there on purpose.

[verified] `content-raw`, `content-raw-keeps-indent-and-drops-replace`
and `raw-hands-the-bytes-through-untouched` in `ts/test/`, and
`TestCmpTreeRaw`, `TestCmpTreeRawUnderListItems` and
`TestCmpTreeRawKeepsIndent` in `go/`. The payload is six lines of `$$`
shapes; it round-trips byte-identically with `raw` and, as the control,
three of the six are rewritten without it. **Both ports produce the same
bytes for the control**, matcher dump included — the Go expectation was
written with `(?P<...>` on the guess that Go's regexp syntax would leak,
and the test failed until it was corrected to TypeScript's `(?<...>`.

**§5 above understates the hazard, and it is worth aontu knowing which
way.** It says an empty model leaves `$$path$$` alone, and it does. It
does not cover the two forms that substitute with NO model:

    $$"quoted"$$              -> quoted
    $$__JOSTRACA_REPLACE__$$  -> /(?<J_O>\$\$)(?<J_R>[^$]+)(?<J_C>\$\$)/

So `model: {}`, which is what `cmptree-gen` passed and what a careful
caller would reach for, was never the guard it looked like. Only
skipping the render is skipping the render.

**The whole-tree option reaches `Content` and `Line`, not every node,
and that is a correction rather than a shortcut.** "Every node" was
built first and refused its own test: `Fragment` and `CopyFiles`
validate a CLOSED prop set, so a `raw` they have no use for failed the
run outright. A whole-tree option that cannot be used on a tree holding
two of the ten components is not a whole-tree option. `TREE_RAW_CMP`
(TypeScript, by identity) and `treeRawCmp` (Go, by name) hold the two
that render text they were handed, and
`raw-option-is-safe-on-every-component` /
`TestCmpTreeRawIsSafeOnEveryComponent` generate every registered
component under the option so the next one cannot land refusing it.

### 6.2 `cmpTree` is supported

Exported (it already was), documented as `cmpTree()` in
`docs/reference-components.md` and under "A component tree as data" in
`docs/reference-go.md`, given a how-to at
`docs/how-to/generate-from-a-tree.md` whose example the docs suite
executes, and held by `ts/test/tree.test.ts` and `go/tree_test.go`
rather than by a fixture. The spike's closing question — whether a
surface with one known consumer belongs in the package — is answered in
the file header: that consumer is making it the only door, and the
alternative is aontu reimplementing the build phase.

The ports stay byte-identical, and getting there closed four
divergences the promotion surfaced. Three are §6.5.

### 6.3 `cmptree-gen --check <dir>` — done, and proved against rb-solar

`aontu gen.aon | cmptree-gen --check <dir>` generates into memory,
compares with the tree on disk, exits 1 on drift and names each drifted
path with a few lines of the difference (`-` on disk, `+` generated).
Exit codes match the verb it replaces: 0 clean, 1 drift, 2 usage or I/O.

**Extra files on disk are ignored, deliberately.** rb-solar decides it:
one generator of nine writes a handful of files into a whole Rails
application, so a check that called every file it did not write "drift"
would report the other eight generators' output, and the hand-written
tree around them, as a failure. `aontu render --check` already works
this way. The cost is that a file which STOPS being generated lingers
and is not reported; deleting it is the same review as adding it. Both
halves are in `docs/reference-components.md` and in the tool's header.

**The output folder is shadowed by an in-memory filesystem**, so nothing
committed under `<dir>` can change what the generators produce: no
existing-file mode fires, no `exclude` skips a comparison, and the check
writes nothing anywhere. Reads OUTSIDE `<dir>` fall through to the real
filesystem, so a `Fragment` or `CopyFiles` source works as it does on a
write run. The edge is `Inject`, and a component reading a file inside
`<dir>`: under `--check` the committed tree is not visible to the run,
so those are refused with a message saying why rather than a bare
ENOENT. That is the price of the check being a function of the tree
alone, and it is the property a CI gate wants.

**`raw` is ON by default in this tool** and `--template` turns it off —
the opposite way round from the library, because the tool's input is
text somebody else already finished. `--check` and `--folder` are
refused together rather than one silently winning, since that would make
the exit code mean the other thing.

[verified] against `test/system/rb-solar` in `aontu-lang/aontu` at
`97b7de5`. The nine generators still render `aontu:code` units, so the
harness does the one mechanical step P4 will do inside the document — a
unit `{path, text}` becomes `File(path, [Content(text)])` — and hands
the result to `cmptree-gen --check` instead of to `render --check`:

| generator | files | result |
|---|---|---|
| `routes.rb`, `seeds.rb`, `api_base.rb`, `erd.mmd` | 1 each | clean |
| `migrate.rb`, `model.rb`, `api_controller.rb`, `ui_controller.rb` | 2 each | clean |
| `views.aon` | 4 | clean |

Sixteen files across the nine, all byte-identical to the committed tree,
exit 0. Then, as the controls: appending one line to
`app/app/models/planet.rb` reports `app/models/planet.rb differs from
the generated tree` with the changed lines and exits 1, and removing
`app/config/routes.rb` reports it `missing` and exits 1. The checkout
was left clean (`git status --porcelain` empty), and rb-solar's own
`check.sh` passes all 10 of its checks before and after.

**One thing rb-solar does NOT prove: `raw`.** No committed file in that
system contains `$$`, so the check passes with `--template` as well.
The `$$` round-trip is proved by the unit cases in §6.1, in both ports.

`ts/test/cmptree-gen.test.ts` is the committed regression suite: nine
cases, each spawning the tool so the exit code and stderr are what is
asserted, covering the clean tree, a hand edit, a missing file, an
ignored extra file, "a check writes nothing", the `raw` default and its
`--template` control, the usage refusals, and `--at`. It takes no
dependency on aontu; the rb-solar run above is the acceptance and is
reproducible from this note.

### 6.4 Duplicate paths — added, and NOT where the ask put it

Two `File` components resolving to one output path is refused, naming
the path and both components. The second used to win and the first was
never written: output missing, exit 0, nothing to say which component
lost.

**It is at the build phase, not in `cmpTree`.** The ask put it in
`cmpTree`, and that is the one place it cannot go correctly: a `File`
name composes with whatever `Project` and `Folder` nesting encloses it,
and under `ListItems` one node is invoked once per item. Deciding a
final path from the tree would mean a second implementation of path
composition — the thing `cmpTree` exists not to have. At the build phase
the path is final, so there is one implementation and it covers every
road in, a hand-written generator included.

It counts `File` nodes. `FileHandler.savedPaths` already noticed
duplicate SAVES and could only log, because an `Inject` legitimately
saves to a path a `File` in the same run created; the new guard sees the
two statements that cannot both be true.
[verified] `two-files-at-one-path-are-refused` and
`inject-into-a-generated-file-is-not-a-duplicate` in both ports.

**A finding for aontu's P4, and it is a real constraint on the tree
form:** a `File` name is NOT templated. `File` assigns `props.name` to
the node and the build composes it as given, so a data tree cannot vary
a file name — `{"cmp":"File","props":{"name":"f{item.n}.txt"}}` under a
`ListItems` is one filename containing braces, invoked twice, and is now
refused as the duplicate it always was rather than writing one file and
dropping the rest. A hand-written generator varies the name by computing
it in the host language. A document that wants N files states N `File`
nodes, which is what aontu does anyway since it iterates in the
language. [verified] `list-items-cannot-vary-a-file-name`,
`TestCmpTreeListItemsCannotVaryAFileName`.

### 6.5 The prop surface — PUBLISHED, at `docs/cmp-surface.tsv`

Option 1 of the two. One row per prop per component: name, type, whether
it is required, what it does, and a `*` row per component saying what an
unknown prop does. Tab-separated, comment lines, the same shape as the
shared corpus — and deliberately NOT in `test/spec/`, because both
stacks' spec runners read every `.tsv` there as function cases and fail
on an unknown `fn`.

**The trade, stated plainly, because the ask says the answer is not
obvious.** What is bought: the contract aontu is about to depend on
entirely stops being a page of prose. What is paid: a release coupling.
When jostraca adds a prop, a consumer pinning an older copy refuses a
tree jostraca would accept, until it re-pins. That is a real cost and it
falls on aontu, not here.

Three things make it the better side of the trade:

- **There is no package edge and there is no new one.** The file is
  fetched at a tag and vendored, the way aontu already pins bundled
  profiles by hash. A pipe is still the whole integration.
- **The surface is not uniform, and prose was hiding it.** Two of the
  ten components — `Fragment` and `CopyFiles` — validate a CLOSED prop
  set and refuse an unknown prop; the other eight accept anything and
  drop what they do not read. A consumer cannot guess which, and "props
  are unchecked" would have been the wrong statement to publish.
- **Saying nothing costs the same class of failure as §6.1.** A typo'd
  `indent` on a `Line` is a silently dropped prop, which is the shape of
  the bug being treated as a blocker one section up.

**It is guarded, not asserted.** `ts/test/cmp-surface.test.ts` reads the
file and the components beside it and fails when they disagree: every
component on disk has rows, every declared prop is one the source reads
and every read prop is declared (a `unused:` note is the one exemption,
for a prop both ports accept and neither reads), and every `*` row is
checked BEHAVIOURALLY — a component declared `refused:` is generated
with an unknown prop and must refuse it, one declared `ignored:` must
accept it. `go/cmp_surface_test.go` holds the Go port to the same `*`
rows through the data path.

**What jostraca is NOT doing: checking props at the seam.** No runtime
closed check across the board, because the engine legitimately hands a
component props it never declared — `ListItems` binds `item`, `indent`
and `replace` for each invocation of its children. aontu checks what its
author wrote, at its own call site, against this file. That keeps the
check where the typo is.

Publishing it surfaced four TS↔Go divergences, all at the data path and
all now closed:

1. **`CopyFilesProps.Indent` (Go) accepted a prop TypeScript refuses**,
   and was read by nothing on either side. Removed from Go —
   TypeScript is canonical and is also right; indenting a spliced copy
   is a feature and would arrive with an implementation.
2. **`Project` handed its own props to its data children** (TypeScript),
   so `project([copyfiles(...)])` was refused outright with *the
   properties "name, folder" are not allowed*. Only the data path could
   reach it: a hand-written child is an arrow that ignores its
   parameter. **The Go port was already right** — its `Project` builder
   passes a nil inherit map — so this is the `Line` case from §5 again,
   and the fix went into TypeScript. `cmpTree` now forwards a parent's
   BINDINGS and not a parent's props, told apart by `ctx$`: `cmp()`
   writes it into every props object it is handed, so an args object
   carrying one is some component's props, while a binding built for
   children is a fresh object. No list to keep.
3. **A closed prop set refused the engine's own bindings**
   (TypeScript). A `Fragment` or `CopyFiles` under a `ListItems`
   received the `item` binding and failed validation, so a fragment
   repeated once per entity could not be written as a tree at all.
   **The Go port was already right** for the same reason as (2). Both
   shapes now admit the binding keys, and still refuse anything else.
4. **Go refused nothing.** With (3) fixed, TypeScript refused an
   unknown prop on those two components and Go accepted it — and a tree
   that one port refuses and the other generates does not mean one
   thing. `treeClosedCmp` in `go/tree.go` restores the refusal,
   eagerly, where `CmpTree` refuses everything else it refuses.

### 6.6 What aontu should decide

- **Distribution.** `tools/cmptree-gen.js` is a repository script, not a
  published binary: the npm package ships `src`, `dist` and the licence.
  If the four `--check` consumers need to run it from an install rather
  than from a checkout, it needs a `bin` entry and a move under `ts/`.
  That is small, and it is a change to what the package installs, so it
  waits on aontu saying it is wanted.
- **Whether the prop surface is pinned or advisory.** §6.5 publishes it;
  whether aontu REFUSES an unknown prop against its vendored copy or
  warns is aontu's call, and the release coupling is different in each
  case.
