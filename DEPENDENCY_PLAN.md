# Jostraca — the dependency-free question

Scope: what it would take for `ts/` and `go/` to ship with no third-party
dependencies, which of the current ones could be vendored, which must be
reimplemented, and what a Rust port would need.

Findings marked **[verified]** were reproduced by running code, not inferred
from reading. Reproductions ran against `ts/dist`, the installed
`ts/node_modules`, and a scratch copy of the Go module.

---

## 0. Summary

Two packages stand between jostraca and a dependency-free published artifact:
`shape` and `memfs`, both TypeScript peer dependencies. The Go module carries
one more, `github.com/rjrodger/shape/go`, for a single schema.

The recommendation is to reimplement all three rather than vendor any of them,
because that is what the used subsets are worth and because it is what this
project has already done twice.

| target | today | action | size |
|---|---|---|---|
| `go/` shape | 1 module, 3813 LOC, one 4-line schema | reimplement | ~40 LOC |
| `ts/` shape | 1 package, 356K, 5 schemas in 4 files | reimplement | ~200-300 LOC |
| `ts/` memfs | 20 packages, 68,557 JS LOC | reimplement | ~350-600 LOC |
| `ts/gen/readme.js` | phantom `oxc-parser`, never installed | delete or rewrite | — |
| `typescript`, `@types/node` | dev only, not shipped | keep | — |

The Go removal is not a proposal. It was carried out in a sandbox and the
full suite passed. **[verified]**

A Rust port is a larger question and gets its own section. The short version:
Rust's std covers everything except JSON, regex and ISO-8601 formatting; of
those, only regex genuinely justifies a crate.

---

## 1. What is actually depended on today

`ts/package.json` declares `dependencies: {}`. That is accurate and also
misleading: `memfs` and `shape` are `peerDependencies`, they are imported at
module scope, and neither is marked optional.

A consumer installs 21 third-party packages, roughly 6.8 MiB of file content
(about 15 MB on disk at 4 KiB block granularity). **[verified]**

```
shape ............  1 package    356K on disk / 319K apparent   2,366 JS LOC
memfs closure ... 20 packages   ~15 MB on disk / 6.8 MiB apparent  68,557 JS LOC
```

The memfs half is 95% of the packages and about 98% of the bytes. memfs 4.68.2
is a 77-line facade; the implementation lives in eight lockstep-pinned
`@jsonjoy.com/fs-*` packages plus six more transitive `@jsonjoy.com` packages
and four third-party helpers. Of the byte total, 35% is sourcemaps. **[verified]**

### The peers are hard requires, not optional extras

`ts/src/jostraca.ts:11` and `:13` import both at the top level, and they compile
to module-scope requires sitting together in the emitted output:

```js
// ts/dist/jostraca.js
45: const shape_1 = require("shape");
46: const memfs_1 = require("memfs");
```

There is no `peerDependenciesMeta`, so npm treats both as required. Renaming
`ts/node_modules/memfs` away and requiring the package produces
`Error: Cannot find module 'memfs'` with exit code 1, without any call to
`mem: true` and without touching the API at all. **[verified]** A consumer whose
package manager does not auto-install peers — yarn classic,
`npm --legacy-peer-deps`, or pnpm with `auto-install-peers` turned off — gets
that crash today. Current pnpm defaults that setting to true, so a stock pnpm
install is not affected.

### shape is also a compile-time dependency

`ts/dist/jostraca.d.ts` and `ts/dist/util/point.d.ts` carry 52 references to
`import("shape")` between them. **[verified]** The exported chain is:

```ts
declare const OptionsShape: { ... }                              // :16
type JostracaOptions = ReturnType<typeof OptionsShape>           // :270
declare function Jostraca(gopts_in?: JostracaOptions | {}): ...  // :276
export type { JostracaResult, JostracaOptions, ... }             // :280
```

So the exported factory's parameter type resolves through `import("shape")`, and
any TypeScript consumer needs the package on disk to typecheck. memfs by
contrast never reaches the declaration surface: zero `.d.ts` hits, and zero hits
for `Volume`. **[verified]** memfs is runtime-only; shape is runtime and types.

### Go

`go/go.mod` has a single `require`, and the dependency's own `go.mod` is three
lines with no `require` at all, so the transitive set is empty. **[verified]**
It is 3813 non-test LOC, MIT, copyright Richard Rodger — the same author as
jostraca, which makes it a first-party dependency in everything but packaging.

Its entire use is `go/template.go:50-53`:

```go
var templateSpecSchema = shape.MustShape(map[string]any{
	"replace": shape.Optional(map[string]any{}),
	"eject":   shape.Optional([]any{shape.String, shape.String}),
})
```

consumed once, at `go/template.go:58`. `go/options.go` does not import it;
`OptionsFromMap` is a hand-written type switch. So the Go module already
contains two validation styles, and the imperative one is dominant.

---

## 2. Precedent: two dependencies already removed

This is the third round of the same exercise, and the earlier two set a
pattern worth following.

| date | runtime | peer | total |
|---|---|---|---|
| 2026-03-24 | diff, gubu, node-diff3 | jsonic, memfs | 5 |
| 2026-07-24 | diff, node-diff3 | jsonic, memfs, shape | 5 |
| 2026-08-17 | — | memfs, shape | 2 |

**`node-diff3` and `diff`** went in `f66767d`. The motive was not tidiness. The
two stacks ran different merge algorithms and disagreed on about 72% of
non-trivial merges, and node-diff3 took 62 seconds on a 10,000-line merge. The
commit puts the principle plainly: *"Two implementations only stay byte-identical
if they are the same algorithm."* The replacement is one engine mirrored
function for function in `ts/src/diff.ts` and `go/diff.go`.

**`jsonic`** went in `b15f1fd`, five days later. It supplied exactly two object
helpers, `deep` and `omap`, for three packages. Both were inlined into
`ts/src/util/basic.ts` and verified against the real package with a differential
harness, all 30 cases byte-identical. One deviation was deliberate and
documented: `omap` sorts, because a Go map has no insertion order to reproduce.

Neither removal vendored. Both reimplemented, and both followed the same five
steps: show the used subset is small, reimplement in both stacks, differential-test
against the real package before deleting, pin the behaviour in `test/spec/`, then
write down the deviations.

That history also supplies the strongest argument for finishing the job. Every
dependency is a place the two stacks can drift, and shape is drifting already —
see §3.4.

---

## 3. TypeScript: shape

### 3.1 What is used

Four files, five schemas, seven of shape's sixty-plus exports. **[verified]**
There are no dynamic imports and no subpath imports.

| file | schema | builders |
|---|---|---|
| `ts/src/jostraca.ts:104` | `OptionsShape` | `Shape`, `Skip`, `One` |
| `ts/src/jostraca.ts:161` | `ExistingShape` | `Shape` |
| `ts/src/util/point.ts:207` | `PointDefShape` | `Shape`, `Skip`, `Any` |
| `ts/src/cmp/Fragment.ts:13` | `FragmentShape` | `Shape`, `One`, `Optional`, `Check`, `Empty` |
| `ts/src/cmp/Copy.ts:11` | `CopyShape` | `Shape`, `One`, `Optional`, `Check` |

Only the call form `Shape(schema, {name})(value, ctx)` is used, never `.valid`,
`.match`, `.error` or `.spec`. Four behaviours are relied on:

1. **Type validation** that throws at define time, so `generate()` rejects and
   later components never run.
2. **Default injection**, in place. shape mutates the caller's object
   recursively and returns the same reference; `input === output` and
   `input.nested === output.nested`. **[verified]**
3. **Closed objects** — an unknown key is an error.
4. **`Check(fn)`** predicates that stat `from` through the injected filesystem.
   `ts/src/cmp/Fragment.ts:41` passes a validation context,
   `FragmentShape(props, { fs: props.ctx$.fs })`, read back inside the predicate
   as `s.ctx.fs()`. A replacement has to thread that context, not merely check
   types.

### 3.2 Default injection: three categories, not one

This is the part a replacement is most likely to get wrong, and the earlier
survey got it wrong too. Only one injected default actually crashes.

| default | without injection | evidence |
|---|---|---|
| `existing` | **crashes** | `TypeError: Cannot read properties of undefined (reading 'txt')` at `dist/jostraca.js:220`, which is `src/jostraca.ts:252` |
| `control` | **silently wrong output** | `control.duplicate` goes falsy; the run stops writing `.jostraca/generated/...` and `.jostraca/.gitignore`. No error. |
| `cmp` | fine | a literal default is assigned at `jostraca.ts:261` |
| `name`, `meta` | fine | injected and then read by nothing, or guarded independently |

All four rows reproduced by monkeypatching `Shape` to a non-injecting
passthrough and running the real compiled `generate()`. **[verified]**

`control` is the dangerous one. A validator that checks without injecting
produces a green test run and a wrong output tree.

`deep` tolerates `undefined` explicitly (`ts/src/util/basic.ts:833`), which is
why `control` and `cmp` degrade rather than throw.

Separately, `opts.name.*` is injected and read by nothing — zero hits in
`ts/src`. That matches the `// TODO: implement` at `ts/src/jostraca.ts:107`.
`name.exclude` is dead in both stacks (see §9.3).

### 3.3 Nothing pins the error messages, except one doc line that is not run

Six patterns grepped across `ts/test` — `Validation failed`, `ShapeError`,
`does not satisfy`, `is required`, `not of type`, `is not allowed` — return
zero hits. **[verified]** All twelve throw/reject assertions in the suite target
jostraca's own messages or filesystem errors. `test/spec/` has no validation
cases.

One place in the repo does pin the exact text:

```
docs/reference-options.md:25
Jostraca Options: Validation failed for object "{folder:/out,bogus:1}" because the property "bogus" is not allowed.
```

It is the only copy of that string anywhere in the repo, and it is not executed.
The fence above it is opened untagged, and `ts/test/docs.test.ts:612` skips
untagged fences (`if ('' === b.lang) { continue }`). Replacing the whole line
with `TOTALLY BOGUS ERROR TEXT THAT SHAPE NEVER EMITS xyzzy` leaves all ten doc
tests passing. **[verified]** The harness does work — mutating a *tagged* fence
in `docs/tutorial.md` fails `scenarios-run-and-match` as designed — it simply
does not reach this one. **[verified]**

`ts/README.md` is outside the harness entirely; `docPages()` enumerates only
`docs/*.md` and `docs/how-to/*.md`.

So a replacement is free to choose its own message wording.

### 3.4 shape is already a source of TS/Go divergence

Two behaviours differ today, neither tested on either side:

- TS rejects unknown top-level option keys, because plain objects are closed in
  shape. `go/options.go:123` says unknown keys are ignored.
- TS rejects `existing.bin.diff` for the same reason. Go's `decodeExistingBin`
  reads only known keys and drops it silently.

`ts/tools/scenario-corpus.js:206-208` documents the TS rejection as intended
cross-stack behaviour. It is not what Go does. Removing shape in favour of
explicit checks makes these author-owned decisions instead of library-inherited
accidents, and is the natural moment to pin them in `test/spec/`.

### 3.5 Vendor, or reimplement

**Vendoring** is legally and mechanically easy. One file, 3388 LOC, zero runtime
dependencies, MIT, and the copyright holder is jostraca's own author. It would
also silence the `EBADENGINE` warning noted in `CLAUDE.md`, since that comes from
shape's `engines: node >= 24`, not from jostraca.

Two costs and one constraint. About 90% of it is dead weight — seven builders
used of thirty, none of the `expr`/`Refer`/`Define`/StandardSchema machinery.
The published type surface stays as it is, which means `JostracaOptions` keeps
resolving to mostly `any`.

The constraint is on where it lands, and it is satisfied for free by the obvious
choice. Two filters look for a path segment named `shape`: `ShapeError` strips
its own stack frames with `/.*\/shape\/shape\.[tj]s.*\n/`, and
`ts/src/cmp/Copy.ts:41` builds its callsite suffix by dropping frames containing
`/shape/`. Vendoring to `ts/src/shape/shape.ts`, emitting to
`ts/dist/shape/shape.js`, satisfies both patterns; only a different directory or
basename would break them. This is a naming rule to follow, not a reason to
prefer reimplementation.

**Reimplementing** means per-schema imperative checks, in the style Go already
ships: `go/builder.go:258-273` and `:337-346` are about ten lines each, and
`go/options.go:124-218` covers the options surface. The TypeScript equivalents
come to roughly 200-300 LOC:

- `validateOptions` (~80-100) — type-check the leaf keys, inject the two
  required default groups, reject unknown top-level keys
- `validateExisting` (~25)
- `validateCopyProps`, `validateFragmentProps` (~25 each) — required-string
  `from`, `statSync` through the injected fs inside `try`/`catch`, arm checks
- `validatePointDef` (~15)

A generic mini-validator reproducing shape's combinators is the third option and
the worst of the three: it costs 350-500 LOC to rebuild machinery that exists
upstream, and inherits the injection quirks without inheriting the tests.

**Recommendation: reimplement.** It matches the two prior removals, it lets both
stacks converge on one message vocabulary that can then be pinned in
`test/spec/`, and it replaces `ReturnType<typeof OptionsShape>` with real
interfaces, which improves the published types rather than merely preserving
them. If the type-surface churn is unwelcome right now, vendoring into
`ts/src/shape/` is a valid stepping stone: it removes the install-tree entry
immediately and leaves narrowing for later.

### 3.6 Invariants a replacement must keep

1. Inject into the **same object**; callers observe the mutation.
2. Inject `existing` (crash) and `control` (silent corruption).
3. Throw at define time, so `generate()` rejects and later components are skipped.
4. Stat `from` through `props.ctx$.fs`, not `node:fs`, and only **after** the
   relative-`from` resolution at `ts/src/cmp/Fragment.ts:38-40`.
5. Catch every `statSync` throw, not only `ENOENT`.
6. Either reproduce or deliberately drop the `to: ''` and `exclude: []`
   injections on `Copy`. Downstream handles `''`, `[]`, `null` and `undefined`
   alike at `CopyOp.ts:34` and `:87-89`, so dropping is safe, but it changes
   `node.name` and `node.exclude` on every bare `Copy` and could move parity
   snapshots.

---

## 4. TypeScript: memfs

### 4.1 The required surface is ten methods

Every method reached on the fs provider anywhere in `ts/src`, by call
frequency: **[verified]**

```
11 statSync   9 existsSync   7 chmodSync   6 readFileSync   3 mkdirSync
 2 writeFileSync   2 unlinkSync   2 renameSync   2 realpathSync   1 readdirSync
```

Ten methods, and the split matters:

- **Required (6)** — `existsSync`, `readFileSync`, `writeFileSync`, `mkdirSync`,
  `statSync`, `readdirSync`.
- **Feature-detected (4)** — `renameSync`, `chmodSync`, `unlinkSync`,
  `realpathSync`. Each has a fallback. `ts/src/build/FileHandler.ts:913` drops
  from atomic temp-and-rename to a direct write when `renameSync` is absent.

Only `existsSync` is hard-validated, at `FileHandler.ts:137` and
`BuildContext.ts:77`.

Confirmed absent: `copyFileSync`, `lstatSync`, `openSync`, `appendFileSync`,
`accessSync`, `rmSync`, `symlinkSync`, `readlinkSync`, `utimesSync` and nine
others. File copy is `readFileSync` plus a write, which is why `copyFileSync`
never appears. There is no use of `fs.promises`, callbacks, or streams anywhere
in `ts/src`, and no direct `Fs.<method>` call — `node:fs` is imported once, as
the default provider.

Stat fields consumed: `isFile`, `isDirectory`, `mode`, `mtimeMs`. Nothing else —
no `size`, no `ino`, no `isSymbolicLink`. `readdirSync` is the plain
string-array form.

The behavioural details a replacement must match: `writeFileSync` with
`flag: 'wx'` must throw an error whose `.code` is `EEXIST`
(`FileHandler.ts:936`, `:959`, `:962`), `mkdirSync` takes `{recursive: true}`,
`statSync` takes `{throwIfNoEntry: false}`, and mode comparisons mask with
`0o7777`.

### 4.2 The test-side surface is smaller still

Eleven files import memfs: eight suites and the three parity-corpus tools.
Across them, 57 `memfs()` constructions. **[verified]**

`vol.toJSON` is the only `vol` method used anywhere in the repo, 81 call sites.
No `fromJSON`, no `reset`, no `mkdirp`. **[verified]**

Direct fs calls in tests are `writeFileSync` (21), `mkdirSync` (7),
`appendFileSync` (5), `readFileSync` (3), `unlinkSync` (1). `appendFileSync` is
the only one the src side never uses.

`symlinkSync` appears four times: three on real `node:fs` against tmpdirs, and
exactly one on a memfs handle — `ts/test/robustness.test.ts:829`, a dangling
link. **[verified]** A replacement either carries minimal symlink records or that
one test moves to the real-tmpdir style its three siblings already use.

Keeping the `memfs(json) -> {fs, vol}` factory signature reduces migration to
about eleven import lines.

### 4.3 Vendoring is not viable; the Go port already proved the alternative

Vendoring means adopting 20 packages, 68,557 lines of JavaScript and four
licences to use six required methods and `toJSON()`. The `@jsonjoy.com` family
versions in lockstep with memfs, so any security update means re-vendoring the
whole family. Pinning an older pre-split memfs would shrink the tree but
contradicts the published `>= 4` range.

`go/fs.go` is the existence proof for the other path: an 8-method `FS`
interface, three optional capability interfaces discovered by type assertion
(`realpathFS`, `chmodFS`, `exclusiveFS`), an `OsFS`, and a 301-LOC `MemFS` over
a mutex-guarded map. **[verified]** `go/PORT_PLAN.md:1195` records why nothing
off-the-shelf was used: `io/fs.FS` and `testing/fstest.MapFS` are read-only, and
writing generated files is the whole point.

A TypeScript equivalent needs somewhat more than 301 lines, because it must
speak `node:fs` shapes: encodings, errno-style `Error` objects carrying `.code`,
mode bits, `mtimeMs`, nested-JSON seeding, and a `vol` facade with `toJSON()`.
Estimate 350-600 LOC in a single `ts/src/util/memfs.ts`.

**Recommendation: reimplement, in two steps.**

Step one is a five-line change that removes the hard crash immediately: move
the import inside `Jostraca()`/`generate()` behind the `useMemFS` branch, add
`peerDependenciesMeta: { memfs: { optional: true } }`, and move memfs to
`devDependencies` for the suite. Consumers who never ask for `mem: true` stop
paying for it. Step two replaces it.

### 4.4 What constrains the replacement

- `mem`, `vol` and `res.vol()` are documented public API across five doc pages,
  including shared-volume semantics — a global `mem: true` with no per-call
  `vol` shares one volume across generates (`ts/src/jostraca.ts:220-223`).
- `docs/reference-options.md:108` documents `vol()` as returning a *memfs
  Volume*. An in-repo `vol` is a semver-visible narrowing even though nothing in
  the repo calls anything but `toJSON()`.
- `res.fs()` narrows too, and by more. `ts/src/types.ts:55` types it
  `fs?: () => FST` where `FST = typeof import('node:fs')` (`types.ts:7`), so the
  declared return is the *entire* Node filesystem API, and memfs supplies a
  handle broad enough to honour it. A consumer may legitimately call
  `appendFileSync`, `symlinkSync` or `copyFileSync` on `res.fs()` even though
  `ts/src` never does. A ten-method replacement therefore either ships a wider
  compatibility facade or declares a new, smaller result type and documents the
  break. Of the two narrowings this is the easier one to miss, because the ten
  methods in §4.1 are what jostraca calls, not what it publishes.
- The parity-corpus tools run on memfs, and CI runs them. The `corpus` job in
  `.github/workflows/go-test.yml` regenerates `go/testdata/parity` by running
  `ts/tools/extract-parity.js`, which requires memfs at line 16 and pulls in two
  more memfs consumers. **[verified]** Dropping memfs without porting these
  breaks the gate that keeps the two stacks from drifting, so they move in the
  same change.
- Two memfs quirks the corpus tools already work around must be reproduced or
  deliberately sidestepped: `vol.toJSON()` decodes bytes lossily, turning `0xFF`
  into `U+FFFD` (`ts/tools/corpus-bytes.js:7`), and memfs resolves relative paths
  against `process.cwd()` (`ts/tools/scenario-corpus.js:354`).

---

## 5. Go: shape

This one is done, not proposed.

A sandbox copy of `go/` had the import at `template.go:14` removed, the schema
at `:50-53` deleted, and `ParseTemplateSpec`'s body replaced with a hand-written
key switch: unknown key is an error, `replace` must be `map[string]any`, `eject`
must be a two-element `[]any` of strings. The `require` was dropped from
`go.mod` and `go.sum` emptied, then separately deleted. **[verified]**

With **zero test files touched**:

```
gofmt -l .                     -> (no output)
go build ./...                 -> OK
go vet ./...                   -> OK
go test ./...                  -> ok  github.com/jostraca/jostraca/go  2.386s
go test ./... -race            -> ok  11.650s
go test ./... (go.sum deleted) -> ok  2.357s
```

`diff -rq` against the original reports exactly three differing files and no
additions: `go.mod`, `go.sum`, `template.go`.

That result is unsurprising once the tests are read. `ParseTemplateSpec` has no
production callers; its only two callers are tests, and both assert success
paths only. No Go test contains `Validation failed`. `go/shape_validation_test.go`
is named for the TypeScript mechanism it mirrors, not one it uses — it imports
only `strings` and `testing`, and asserts substrings authored in
`go/builder.go:262`, `:271`, `:340` and `:344`.

Two decisions come with the change:

1. **Unknown keys.** shape's schema is closed; `OptionsFromMap` ignores unknown
   keys. Keeping the rejection matches TS, which is canonical.
2. **`eject` arity.** The map-parse path admits only a two-tuple of strings,
   while `TemplateSpec.Eject` accepts regexes. `go/template.go:56` calls this a
   Phase 1 surface. Removal is a reasonable moment to widen it, but that is a
   behaviour change and should be flagged, not smuggled in.

Add error-path tests in the same change, since nothing currently pins unknown-key
rejection, eject arity, or the non-nil empty `Replace` map that
`ParseTemplateSpec(nil)` returns today.

Stale notes to sweep: `go/PORT_PLAN.md:50` names v0.1.0 where `go.mod` pins
v0.1.3, and says the dependency validates options, which it never did.
`PORT_PLAN.md:3105` lists `sergi/go-diff` and `google/go-cmp` as expected
dependencies; neither ever landed. **[verified]** `PORT_PLAN.md:445-457`,
`:1633` and `:2825-2830` describe shape roles that will no longer exist.

---

## 6. The rest of the dependency surface

### 6.1 `oxc-parser` — the one genuinely hidden dependency

`ts/gen/readme.js:4` requires `oxc-parser`. It appears in no manifest, no
lockfile, and is not installed. Running it: **[verified]**

```
Error: Cannot find module 'oxc-parser'
    at Object.<anonymous> (/home/user/jostraca/ts/gen/readme.js:4:16)
  code: 'MODULE_NOT_FOUND'
EXIT: 1
```

It is broken three ways over. Installing the parser would not fix it: the script
injects between `<!--START-OPTIONS-->` and `<!--END-OPTIONS-->` markers that
exist nowhere in the repo, and it reads `JostracaOptions` from `src/types.ts`,
where that name is commented out of the export list at `ts/src/types.ts:114`.
The exported `JostracaOptions` is a different definition in
`ts/src/jostraca.ts:181`. So it would document a dead type into markers that do
not exist. **[verified]**

And `gen` is in the `files` array, so this ships to every npm consumer.

Delete it, or rewrite it without a parser. Either way it should not survive a
dependency-free claim.

### 6.2 The irreducible dev floor

`devDependencies` are exactly `typescript@7.0.2` and `@types/node@26.2.0`. A
TypeScript package cannot compile without a compiler, and `dist/types.d.ts`
imports `node:fs`, so node typings are needed for the declarations. Neither
ships. Note that typescript 7 is the native compiler and pulls per-platform
binaries through `optionalDependencies`, which can bite on unusual platforms or
restricted networks.

Go needs nothing beyond the toolchain once shape is gone.

### 6.3 Tooling assumptions, and one that is broken

The Makefile and CI assume `node`, `npm`, `go`, `git`, `sed`, `awk`, `grep`,
`mktemp`, a POSIX shell, and optionally `gh` (guarded by `command -v`). CI adds
`gofmt`, Node 24, Go 1.22, forced bash on windows-latest, and npm OIDC trusted
publishing pinned to the workflow filename.

`make publish` cannot run on Linux. The `bump-go` recipe uses BSD `sed -i ''`,
which GNU sed reads as a script argument: **[verified]**

```
sed: can't read s/^const Version = ".*"/const Version = "9.9.9"/: No such file or directory
sed exit: 2
```

The follow-up `grep -q` guard catches it, so it fails loudly rather than shipping
a stale version, but the release path is macOS-only. Unrelated to dependencies,
and on the same list of hidden assumptions.

No lockfile is committed — `.gitignore:68` ignores `package-lock.json`, and
`git ls-files` matches none. **[verified]**

---

## 7. What removal would buy

**Parity.** The strongest argument, and the project's own history. Every shared
dependency is a place the two stacks can diverge, and shape is diverging now
(§3.4). node-diff3 was removed for exactly this reason after the two stacks were
found disagreeing on 72% of non-trivial merges.

**Supply chain.** `shape` and `memfs` are short, generic npm names on unpinned
ranges, `>= 10` and `>= 4`. Both are executed at `require()` time, before any
jostraca code runs. Removing them removes 21 packages from that exposure.

**Install cost.** 21 packages and about 6.8 MiB become zero.

**Peer-dep friction.** The `require('jostraca')` crash under yarn classic,
`--legacy-peer-deps` and peer-less pnpm configurations goes away.

**Types.** Replacing `ReturnType<typeof OptionsShape>` with explicit interfaces
gives consumers real types where they currently get mostly `any`.

Against: roughly 550-900 LOC of new in-repo code to own and test, a
semver-visible change to the published type surface, and the `vol()` narrowing.

---

## 8. A sequenced plan

Each step is independently shippable, and TS leads Go per `CLAUDE.md`.

1. **Go shape.** Already validated end to end (§5). Three files, no test changes.
   Add error-path tests and sweep the stale `PORT_PLAN.md` claims. One CI change
   travels with it: both `setup-go` steps in `.github/workflows/go-test.yml` set
   `cache-dependency-path: go/go.sum` (`:86` and `:128`), and a module with no
   requires has no `go.sum`, so those must be retargeted at `go/go.mod` or their
   caching disabled. The comments directly above those lines record the
   *Restore cache failed* warning this exact mistake produced once already.
   Leaves the Go module fully dependency-free.
2. **`gen/readme.js`.** Delete or rewrite. Removes the phantom dependency and
   stops shipping a broken script.
3. **memfs, step one.** Lazy import behind `useMemFS`, `peerDependenciesMeta`
   optional, memfs to `devDependencies`. Five lines, and the load-time crash is
   gone for everyone not using `mem: true`.
4. **TS shape.** Per-schema imperative checks (§3.5), adopting Go's message
   wording so the two stacks converge. Differential-test against real shape
   before deleting, the way `jsonic` was handled. Pin the unknown-key and
   `existing.bin` decisions in `test/spec/`, then fix Go to match.
5. **memfs, step two.** In-repo `memfs(json) -> {fs, vol}` keeping the factory
   signature. Port the three corpus tools in the same change so the CI parity
   gate never goes dark.
6. **Docs.** Six citations name the peers, none pinned by any test (§3.3).
   `ts/README.md:22-24` and `:77`, `docs/tutorial.md:20` and `:28`,
   `docs/how-to/generate-in-memory.md:84`, `docs/reference-options.md:25` and
   `:108-130`. Also `CLAUDE.md:50` and `:91-93`, and
   `docs/reference-go.md:144-157`, which frames Go's lack of memfs as a
   deviation — a deviation that closes when TS stops using it.

---

## 9. A Rust port

The Go port is the guide to follow, because it already did the hard translation:
every Node-ism has been mapped to explicit code once.

### 9.1 What has to be written

`go/` is 6,781 non-test LOC across 17 files, against 5,371 in `ts/src`. **[verified]**
The Go figure is the one to budget against; it is larger precisely because it
hand-rolls what TypeScript gets from regex literals and JS built-ins.

| module | from | est. LOC |
|---|---|---|
| `value.rs` | new — `Value` enum, JSON parse/serialize, JS number format | 450-600 |
| `util.rs` | `util.go` 1059 | ~1000 |
| `build.rs` | `build.go` 899 | ~950 |
| `filehandler.rs` | `filehandler.go` 850 | ~900 |
| `template.rs` | `template.go` 832 | ~850 |
| `diff.rs` | `diff.go` 638 | ~650 |
| `fs.rs` | `fs.go` 452 | ~500 |
| `builder.rs` | `builder.go` 430 | ~450 |
| `getx.rs` | `getx.go` 384 | ~400 |
| `options.rs` | `options.go` 372 | ~400 |
| `buildmeta.rs` | `buildmeta.go` 278 | ~300 |
| `jostraca.rs`, `node.rs`, `errors.rs`, `log.rs`, `dlog.rs` | 436 | ~550 |

Roughly 7.5-9k LOC with a regex crate, 9-10.5k fully zero-crate, plus about 350
for the spec runner.

`ts/src/util/point.ts` (296 LOC) has no Go counterpart and is deferred as D15 in
`go/PORT_PLAN.md`. **[verified]** Defer it in Rust on the same grounds.

### 9.2 What Rust's std does not cover

The Go port imports exactly 24 stdlib packages. **[verified]** Most map straight
across: `bytes`, `fmt`, `io`, `math`, `os`, `sort`, `strconv`, `strings`, `sync`,
`sync/atomic`, `unicode`, `unicode/utf8` are all native. `runtime` appears once,
for `runtime.GOOS == "windows"`, and becomes `cfg!(windows)` — though
`isAbsFromPathOn` deliberately takes the platform as a parameter for
testability, and that seam is worth keeping. `reflect` disappears entirely: it
exists only to accept arbitrary `map[string]any` and `[]any`, and a `Value` enum
replaces it, which also gives sorted-key determinism for free.

Three genuine gaps.

**JSON.** Smaller than it looks. There are exactly four `json.` call sites in
non-test Go, and only **one** is a parse: `go/buildmeta.go:88`, reading the
meta log, whose failure mode is already "log and reset to empty". **[verified]**
The meta-file *writer* is hand-rolled byte by byte precisely because
`json.Marshal` sorts keys and cannot reproduce JS insertion order
(`go/buildmeta.go:170-241`, ordering contract at `:10-13`). So `serde_json` would
not spare the hard part.

What is needed: a recursive-descent parser into `Value` (~250-350 LOC) and a
canonical serializer (~120 LOC) with sorted keys and HTML escaping off. One
caveat the earlier survey understated — `marshalJSLike` at `go/template.go:360-369`
is not a parity shim. It is reached from `formatValue` whenever a container
model value is interpolated into a template, so it is user-data serialization on
the hot path, and it must match `encoding/json`'s exact escape set. **[verified]**
Numbers are already separate: `formatJSNumber` hand-implements ECMAScript
`Number::toString`.

**Regex.** The deciding question, and the answer is: take the crate.

Internal patterns can all become scanners, and the Go port has already done
three of these conversions, two of them against JS lookahead that RE2 cannot
express at all — `indent` (`/(\n|^)(?!$)/g` became a byte loop, with the
backtracking edge case reproduced in a comment), the name-case family
(`/([A-Z])([A-Z]+)(?![a-z])/g` became `glueInitials(splitOnUpperAndSeps(collapseAcronyms(v)))`,
leaving `util.go` with no regex but `QuoteMeta`), and `InjectOp`'s marker regex
(became a `strings.Index` scan with a zero-width forward-progress guard). Two
compiled patterns are already dead and can simply go: `defaultMacroRE` at
`go/template.go:48` is never referenced, and `go/node.go:101` holds
`var _ = regexp.MustCompile` purely to keep an import alive. **[verified]**

What cannot become a scanner is user-supplied regex, and one item settles it.
`TemplateSpec.Insert` (`go/template.go:40`, used at `:135-138`; `insert?: RegExp`
in `ts/src/util/basic.ts:396`) lets a caller **replace the entire template
scanner** with a regex of their own. Worse, `resolveModelRef` reflects it back:
the magic ref `__JOSTRACA_REPLACE__` renders the live pattern through
`formatJSStyleRegex`, converting Go's `(?P<` to JS's `(?<` and wrapping it in
slashes. **[verified]** A port must therefore run an arbitrary user pattern *and*
round-trip its source text into JS syntax. No hand-written scanner does that.

On lookaround, no API narrowing is needed, because the port already narrowed
itself. `unsupportedLookRE` at `go/template.go:487` rejects `(?=`, `(?!`, `(?<=`
and `(?<!` with `ErrLookbehind`, since RE2 has no lookaround. Rust's `regex`
crate has the identical restriction and supports the `(?P<name>)` groups the
template dispatch depends on.

It is not, however, a drop-in on character classes, and this is a real trap. Go
defines the Perl classes as ASCII, while Rust's `regex` makes them Unicode-aware
by default. Measured against Go 1.22: **[verified]**

```
\d+ on "123"   -> "123"      \d+ on "١٢٣" -> no match    \d+ on "०१" -> no match
\w+ on "héllo" -> "h"
```

Under Rust's defaults every one of those matches. So a user-supplied
`TemplateSpec.Insert`, `Copy.exclude` or getx `~` pattern containing `\d`, `\w`
or `\b` would accept input in a Rust port that the Go and TS stacks reject. The
port must compile user patterns with Unicode mode off — `(?-u)`, which reduces
`\d` to `[0-9]` — or translate the classes explicitly, and pin the decision with
non-ASCII corpus rows. Note that `test/spec` is ASCII-heavy today, so this
divergence would not show up in any existing test.

Hand-rolling instead means 800-1500 LOC of backtracking engine whose semantics
must match RE2 on a corpus that barely pins them — `test/spec/template.tsv` has
exactly two user-regex rows, `/Q+/` and a `/Q*/` that must error, and the getx
`~` operator is not pinned by the shared corpus at all. **[verified]** That is
the wrong place to spend risk.

Also user-facing, and therefore engine-dependent: template `/.../` replace keys
with named groups, `eject` markers given as regex objects, `Copy.exclude`,
`cmp.Copy.ignore`, `Inject.exclude`, and the getx `~` operator. `name.exclude`
is **not** on this list — see §9.3.

**Time.** One format string, `2006-01-02T15:04:05.000Z`, for conflict-marker
labels and `Humanify`. Days-from-civil arithmetic, about 40 LOC. No `chrono`.

### 9.3 Corrections to carry into a port

- **`name.exclude` is inert, but still accepted.** Go declares
  `Exclude []NameMatcher` at `options.go:77`, `decodeName` never populates it,
  and nothing reads it. The TS schema entry sits under a `// TODO: implement`.
  **[verified]** It is nonetheless part of the accepted surface: it appears in
  `OptionsShape`, reaches the exported `JostracaOptions` type, and
  `docs/reference-options.md:55` says outright that `name.folder.suffix` and
  `name.exclude` "validate, and no code reads" them. So a port must keep
  **accepting** the field, or configurations the canonical TS API takes would be
  rejected. What it does not need is an engine behind it: nothing matches
  against it, so it places no requirement on the regex decision above.
- **`eject` with a slash-wrapped string diverges.** `go/template.go:773-790`
  treats `"/START.*/"` as a regex body, citing `basic.ts:584-590` as its
  authority. That citation points at the function-replacement branch. TS's real
  eject path (`basic.ts:407-414` into `getCachedEjectRE` at `:677-684`) always
  escapes: `new RegExp('[ \t]*' + escre(s) + '[ \t]*\\n?')`. So
  `eject: ["/START.*/", "END"]` compiles a pattern in Go and matches literal text
  in TS. **[verified]** Neither side tests it. Per `CLAUDE.md`, TS is canonical
  and Go is the one to fix. Passing a real regex object works correctly in both,
  so eject-as-regex remains genuine API through the typed value.

### 9.4 What must not be substituted

`go/diff.go` is 638 LOC importing only `strings` and `time`, mirrored at 657 LOC
in `ts/src/diff.ts`, which has no imports at all. It is Hirschberg, not Myers,
and it carries one tie-break that both files document identically: **[verified]**

```go
// `>=` so a tie takes the LARGEST split. This is THE load-bearing
// tie-break: changing it to `>` changes the merged content on 658 of
// the differential corpus cases
```

The literal `658` appears in exactly two places in the repo, `go/diff.go:268`
and `ts/src/diff.ts:249`. A Rust port must transcribe this function for
function. Using `similar`, `diffy` or `imara-diff` would reintroduce precisely
the divergence that removing node-diff3 fixed.

### 9.5 Architecture, and where the risk is

Copy `go/fs.go`'s design: a trait with the eight methods, the three optional
capabilities as default-unsupported trait methods rather than downcasting, and a
`MemFs` over `Mutex<HashMap<String, Vec<u8>>>`. Rust has no lexical
`path.Clean`, so `memClean` gets ported too and used wherever Go calls
`path.Clean`.

The part most likely to force rework is Fragment replay. `fragmentAfter` builds
a replace map of slot-marker closures that **re-enter the builder** mid-template-scan
to construct throwaway subtrees, with a `replayErr` side channel because
`ReplaceFunc` can only return a string. Go's free-closure-over-shared-state shape
will not survive the borrow checker. Plan for an arena-indexed node tree
(`Vec<Node>`) and an explicit `&mut` context threaded through the template
engine, and prototype that slice first — it de-risks the whole port.

Other traps: Rust's `{}` for `f64` differs from ECMAScript `Number::toString`, so
`formatJSNumber` must be ported exactly; `char::to_uppercase` can expand where
Go's `unicode.ToUpper` is one-rune-to-one-rune, and the corpus is ASCII-heavy
enough that drift would be silent; `MemFS` mtimes use wall-clock time rather
than the injectable `Options.Now`, which is a real if minor nondeterminism that
should be copied faithfully rather than quietly fixed.

### 9.6 Testing a port

`test/spec/` is the entry gate: 280 cases across 8 TSV files, dispatching the
same 18 functions in both existing runners. **[verified]** A Rust runner needs a
CRLF-tolerant TSV reader with header validation and cell padding, a JSON args
parser, the 18 adapters, canonical-JSON comparison with sorted keys and HTML
escaping off, nil-to-empty container normalization, substring error matching,
and the two guards both runners already have — unknown `fn` is a hard failure,
never a skip, and the suite fails if the corpus shrinks below 100 cases.

That is necessary and not sufficient. The corpus does not cover the build
pipeline, the five existing-file modes, conflict markers, or most of the regex
surface. `go/testdata/parity` carries those as TS-generated whole-generation
snapshots, and a Rust port has to consume them too. Port the diff and merge
corpora before trusting any Rust merge output.

For perf, `test/spec/perf/` compares `workload_ns / calibration_ns` against a
fixed pure-CPU hash loop identical across languages, failing at 2.5x baseline.
A Rust harness is a hand loop mirroring `go/perf_test.go`, plus new rows in
`baseline.tsv` and an extension to `tools/perf-check.js`. No `criterion`; the
protocol is deliberately hand-rolled.

### 9.7 Verdict

Zero-crate is achievable for everything except regex, and there one crate buys
more than it costs. `regex` matches the RE2 contract the port already enforces
on lookaround, needs `(?-u)` to match it on character classes, and is the only
thing that can serve `TemplateSpec.Insert`.
Neither `serde_json` nor `chrono` earns its place, since the hard parts of both
are already hand-rolled for byte-parity, and a diff crate is disqualified
outright. Test-only, `tempfile` is defensible, and nothing else is.

---

## 10. Defects found while surveying

Not dependency questions, but found on the way and worth recording.

1. **`eject` slash-string divergence** between the stacks, untested on both
   sides, with a wrong source citation in the Go comment (§9.3).
2. **`docs/reference-options.md:25`** pins shape's exact error text in an
   untagged fence that the doc harness skips, so it will go stale silently
   (§3.3).
3. **`ts/gen/readme.js`** is broken three ways and ships to npm (§6.1).
4. **`make publish`** cannot run on GNU/Linux (§6.3).
5. **Dead code**: `defaultMacroRE` (`go/template.go:48`) is compiled and never
   referenced; `go/node.go:101` holds a `var _ = regexp.MustCompile` to keep an
   import alive; `name.exclude` is declared in both stacks and read by neither.
6. **`go/PORT_PLAN.md`** names shape v0.1.0 against a v0.1.3 pin, says it
   validates options when it never has, and lists two dependencies that never
   landed (§5).
7. **`ts/test/parity-fidelity.test.ts:3`** claims to cover per-component shape
   validation; the file contains no such test.
