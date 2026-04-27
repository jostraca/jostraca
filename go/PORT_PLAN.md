# Refactor the Go version to full TS parity

## Outline

### 1. Context

**Current state.** The Go module under `go/jostraca/` is a 184-line `Template()` helper plus a 65-line test (`template.go` and `template_test.go`). It exposes one function (`Template`) and one helper (`ParseTemplateSpec`) — no components, no node tree, no build pipeline, no file handling, no context machinery. The directory's own `go/README.md` is honest about scope: *"This folder contains a Go implementation of Jostraca's template utility."* That is roughly 12% of the TypeScript surface in `src/`.

By contrast, the TS package in `src/` is a code-and-project generator:

- **Core entry** (`src/jostraca.ts`, 498 lines) — `Jostraca()` factory and `generate()` driver.
- **9 components** (`src/cmp/`) — `Project`, `Folder`, `File`, `Copy`, `Inject`, `Fragment`, `Slot`, `Content`, `Line`, `List` (plus internal `None`).
- **9 ops** (`src/op/`) — one per component, with `before()`/`after()` hooks driven by a recursive `step()` walker.
- **Build pipeline** (`src/build/`) — `BuildContext` (119 lines), `BuildMeta` (107 lines), `FileHandler` (746 lines) with five existing-file modes: `write`, `preserve`, `present`, `diff`, `merge`.
- **Utilities** (`src/util/basic.ts`, 750 lines) — `each`, `get`, `getx`, `camelify`, `snakify`, `kebabify`, `partify`, `lcf`, `ucf`, `names`, `escre`, `indent`, `isbinext`, `cmap`, `vmap`, `template`, `getdlog`, plus point/orchestration in `point.ts`.
- **Tests** (`test/`) — `jostraca.test.ts`, `template.test.ts`, `utility.test.ts`, `merge.test.ts`, `control.test.ts`, `point.test.ts`.

**Why now.** The README at the repo root advertises a Go port (`README.md:281-283`); the actual Go module covers only the template engine. Anyone reaching for `import "github.com/jostraca/jostraca/go/jostraca"` to *generate code projects* in Go gets nothing. Closing the gap unblocks Go consumers and prevents the README from being misleading.

**Goal.** Bring the Go module to full feature parity with `src/`, including:
- All 9 user-facing components and their ops.
- Full build pipeline with all 5 existing-file modes — `write`, `preserve`, `present`, `diff`, *and* 3-way `merge` (hand-ported `node-diff3` algorithm).
- All non-`Point*` utilities, with `Point*` deferred to a later sub-package since it's not used by the core.
- Template engine extended to TS feature parity (14 specific gaps enumerated in §9).
- Test corpus mirroring TS, including a new concurrency regression test that the TS version can't have because Node has no real shared-state concurrency.

**Non-goals (v1).**
- `Point*` orchestration utility — not used by `src/jostraca.ts`; only re-exported as `PointUtil`. Defer to a future `point` sub-package.
- Drop-in API compatibility for callers of the existing `Template()` function — its signature stays, but the package gains many new top-level types and methods around it.
- Browser/JS interop. The Go port is a server-side library.

**Headline ergonomic constraint.** TS achieves a clean nested-callback DSL with no visible context plumbing:

```ts
generate({...}, () => {
  Project({ folder: 'sdk' }, () => {
    Folder({ name: 'src' }, () => {
      File({ name: 'main.ts' }, () => Content('...'))
    })
  })
})
```

This is powered by `AsyncLocalStorage` — `GLOBAL.jostraca = new AsyncLocalStorage()` at `src/jostraca.ts:189`, entered via `.run(ctx$, async () => { root() })` at line 271, and read by `cmp()` at line 378 to find the current parent node when a user component is invoked. Two `generate()` calls running concurrently see isolated stores.

Go has no idiomatic equivalent: `goroutine`-local storage is non-standard and discouraged, and `context.Context` threading would force an extra parameter into every component call. The plan must replicate the same *user-visible noiselessness* without using global mutable state. §2 picks the approach (receiver-shadowing closure) and shows side-by-side examples.

**Constraints.**
- Go module path stays `github.com/jostraca/jostraca/go` (`go/go.mod`).
- The existing `github.com/rjrodger/shape/go v0.1.0` dependency continues to validate options — it already validates `TemplateSpec` in `template.go:24`.
- Match TS behaviour where it's well-defined; deviate where Go idioms strongly favour an alternative, but flag every deviation explicitly (§14).

### 2. Threadlocal replacement — receiver-shadowing closure

**Decision: receiver-shadowing closure.** Rejected: goroutine-local storage (non-idiomatic Go, fragile), `context.Context` threading (forces an extra parameter into every component call), and hybrid stack-local approaches (extra ceremony with no win).

**The TS pattern being replaced.** `src/jostraca.ts:189` allocates `GLOBAL.jostraca = new AsyncLocalStorage()`. `generate()` enters its scope at line 271:

```ts
return GLOBAL.jostraca.run(ctx$, async () => { root(); ...build... })
```

The `cmp()` factory (lines 376–437) reads the store at line 378 to find the current parent node, pushes the new node onto `ctx$.children`, swaps `ctx$.node = newNode` and `ctx$.children = newNode.children`, calls the user function (which recursively does the same), then restores the parent on exit. User code never sees `ctx$`.

Two facts make this easy to translate:
- The define phase is **synchronous**. The `root()` callback runs synchronously and every component call inside it is synchronous. AsyncLocalStorage's cross-`await` propagation is not used during define.
- Async only matters for the build phase, where ops receive `ctx$` as an explicit parameter (via `step()` at lines 287, 315, 330, 335, 346) — they never call `getStore()`.

The only thing AsyncLocalStorage actually buys at runtime is **isolation between concurrent `generate()` calls**. We replicate that with per-call state, not globals.

**The Go shape.** A small carrier type `J` holds a pointer to the current node and a shared backing context:

```go
type J struct {
    st  *jstate   // shared across one Generate call
    cur *Node    // current frame; differs per nested callback
}

type jstate struct {
    opts   Options
    fs     FS
    now    func() int64
    folder string
    model  map[string]any
    log    Log
    meta   map[string]any
    debug  string
    root   *Node
    err    error    // first define-phase error; halts subsequent components
    bctx   *buildCtx // populated before build phase
}
```

Each component method on `*J` (e.g. `Project`, `Folder`, `File`) is the Go analogue of TS `cmp()`:

```go
func (j *J) Folder(name string, body func(*J)) {
    if j.st.err != nil { return }
    n := &Node{Kind: KindFolder, Name: name, Path: childPath(j.cur, name), Meta: map[string]any{}}
    j.cur.Children = append(j.cur.Children, n)
    if j.st.root == nil { j.st.root = n }
    if body != nil {
        body(&J{st: j.st, cur: n})
    }
}
```

The receiver-swap is a function-local stack variable — there is no global to mutate, no goroutine-local table, no defer needed for restore. The push/pop happens implicitly because each nested call gets a *fresh* `*J` whose `cur` is the new node, while the parent's `*J` is untouched.

**Parameter shadowing — the noise budget.** User code names the callback parameter `j`, deliberately shadowing the outer `j`:

```go
j.Generate(opts, func(j *J) {                       // outer j shadowed
    j.Project(P{Folder: "sdk"}, func(j *J) {       // shadowed again
        j.Folder("src", func(j *J) {
            j.File("main.go", func(j *J) {
                j.Content("// hello\n")
            })
        })
    })
})
```

Compared to TS:

| Cost | TS | Go (this approach) |
|---|---|---|
| Free-standing function names | `Project(...)` | `j.Project(...)` (one-character prefix) |
| Callback signature | `() => {...}` | `func(j *J) {...}` |
| Anything else | — | — |

Two characters and one identifier per call site. Every other ergonomic property is preserved: declarative nesting, no explicit context plumbing inside the callback body, no `ctx$.node` peeking. Because the parameter is shadowed, users *cannot* accidentally use the wrong `j` — the outer one is unreachable from within the callback.

**Concurrency.** Each `Generate` call constructs its own `*J` and `*jstate`. The package exports zero mutable globals. Two goroutines running `Generate` simultaneously cannot collide. This is provable by inspection (no shared state) and verified by a regression test:

```go
func TestGenerateConcurrent(t *testing.T) {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            j := New(WithMem())
            res, err := j.Generate(opts, func(j *J) {
                j.Project(P{Folder: fmt.Sprintf("p%d", i)}, func(j *J) {
                    j.File(fmt.Sprintf("f%d.txt", i), func(j *J) {
                        j.Content(fmt.Sprintf("body-%d\n", i))
                    })
                })
            })
            // assert res.Vol() contains exactly p%d/f%d.txt with body-%d
        }()
    }
    wg.Wait()
}
```

The TS suite has no equivalent because Node single-threads JS execution; this test is a genuine guarantee the Go port adds.

**Error policy.** TS `cmp()` throws synchronously and the error propagates through the stack. Go has no exceptions in idiomatic code. Inside a `func(j *J)` callback we cannot `return err`, so the rule is:

1. The first error during the define phase is stored on `j.st.err`.
2. Every component method early-returns when `j.st.err != nil`. Subsequent calls in the same callback (and all nested callbacks) become no-ops.
3. `Generate` returns `(Result, error)` — the stored `err` is surfaced after the `root()` callback returns.
4. Build-phase errors are wrapped in `NodeError{Step, Path, Callsite, Err}` and returned the same way.
5. `panic` is reserved for genuine programmer errors (nil dereference of `*J`); it is not used as control flow.

**Worked equivalence.** The TS push/pop:

```ts
ctx$.children = node.children   // line 420
ctx$.node = node                 // line 421
let out = component(props, children) // line 428
ctx$.children = siblings         // line 430 — restore
ctx$.node = parent               // line 431 — restore
```

Becomes, in Go:

```go
body(&J{st: j.st, cur: n})  // entire push/pop is implicit
```

Because `body(&J{...})` shadows the receiver inside the callback and discards the new `*J` on return, the parent's frame is never disturbed. The Go version is structurally simpler and has the same observable user surface.

**Why not the others — one-line each.**
- Goroutine-local: requires `runtime.Stack` parsing or a CGo-style hack (e.g., `petermattis/goid`); fragile under goroutine reuse and rejected in most code reviews.
- `context.Context`: idiomatic for cancellation, not DSL state; multiplies the surface of every component method.
- Hybrid stack-local: ends up being receiver-shadowing plus extra ceremony, with no readability win.

### 3. Package layout

**Decision: single `jostraca` package** at the existing import path `github.com/jostraca/jostraca/go/jostraca`. No sub-packages in v1.

**Why not mirror the TS folder split (`build/`, `cmp/`, `op/`, `util/`).** That split is an artefact of TypeScript's file-per-export idiom and JS module ergonomics. Go packages are import boundaries, not visual organisation. Splitting along TS lines would force exporting types that should be unexported (e.g. `Node`, `BuildContext`, `op`), import cycles between `cmp` and `op` (each component has a corresponding op that needs the same node type), and verbose qualified names at every call site (`cmp.Project`, `op.FileOp`). Go conventionally puts a cohesive library in one package and uses files for organisation.

**File layout.**

```
go/
  go.mod
  go.sum
  README.md                    # rewritten in phase 12
  PORT_PLAN.md                 # this document
  jostraca/
    doc.go                     # package-level godoc

    jostraca.go                # New(), Generate(), top-level glue
    options.go                 # Options, Existing, Control, CmpOptions, NameOptions, WithX, OptionsFromMap (shape)
    log.go                     # Log interface, DefaultLog, dlog
    errors.go                  # NodeError, sentinel errors

    node.go                    # Node, Kind enum
    builder.go                 # *J methods: Project/Folder/File/Content/Line/Slot/Inject/Fragment/Copy/List/Cmp
    build.go                   # step() walker, op dispatch table
    buildctx.go                # buildCtx struct (mirrors TS BuildContext)
    buildmeta.go               # BuildMeta load/save under .jostraca/

    fs.go                      # FS interface, OsFS, MemFS, FileInfo, DirEntry
    filehandler.go             # save/copy + write/preserve/present mode logic
    diff.go                    # 2-way diff render
    merge.go                   # ported diff3 algorithm + 3-way merge

    template.go                # extended; current 184-line file is replaced wholesale
    util.go                    # each, get, getx, camelify, snakify, kebabify, partify,
                               # lcf, ucf, names, escre, indent, isbinext, cmap, vmap,
                               # humanify, deep, omap

    jostraca_test.go           # ports test/jostraca.test.ts
    builder_test.go            # *J component-level tests
    template_test.go           # extended; ports test/template.test.ts
    util_test.go               # ports test/utility.test.ts
    filehandler_test.go        # write/preserve/present mode tests
    diff_test.go               # 2-way diff render
    merge_test.go              # ports test/merge.test.ts (active in v1)
    control_test.go            # ports test/control.test.ts (dryrun, version)
    concurrency_test.go        # 10-goroutine isolation regression
    fs_test.go                 # MemFS/OsFS sanity

    testdata/                  # //go:embed targets
      merge/                   # JSON corpus from test/merge.test.ts
      parity/                  # vol.toJSON snapshots from TS happy paths
      fixtures/                # template files used by Fragment/Copy tests
```

**Naming.** Files are lowercased and singular (`builder.go`, not `builders.go`); test files sit beside their subject; helpers without an obvious home land in `util.go`. Files are allowed to grow to ~600–800 lines; if `builder.go` exceeds that, split as `builder_project.go`, `builder_file.go`, etc., keeping all methods on `*J` in the same package.

**Public surface.** Exported identifiers from `jostraca`:

- `New(opts ...Option) *J` — factory replacing the TS `Jostraca()` factory; returns the root builder.
- `(*J).Generate(opts Options, root func(*J)) (Result, error)` — the entry point.
- Component methods on `*J`: `Project`, `Folder`, `File`, `Content`, `Line`, `Slot`, `Inject`, `Fragment`, `Copy`, `List`, `Cmp` (custom).
- `Option`, `Options`, `Existing`, `ExistingTxt`, `ExistingBin`, `Control`, `CmpOptions`, `NameOptions` and their `WithX` constructors.
- `OptionsFromMap(map[string]any) (Options, error)` — for callers loading config from JSON/YAML.
- `Result`, `Files`, `Audit`, `AuditEntry`.
- `Log` interface, `DefaultLog`.
- `FS`, `OsFS`, `MemFS`, `FileInfo`, `DirEntry`.
- `Node`, `Kind`, `KindXxx` constants — exported because user `Cmp` components inspect parent kind in some idioms.
- `NodeError`, `ErrMergeConflict` (sentinel).
- Utility functions: `Each`, `Get`, `GetX`, `Camelify`, `Snakify`, `Kebabify`, `Partify`, `LCF`, `UCF`, `Names`, `EscRE`, `Indent`, `IsBinExt`, `CMap`, `VMap`, `Humanify`, `Deep`, `OMap`.
- `Template`, `TemplateSpec`, `ParseTemplateSpec` — backwards-compatible with the existing helper.

**Internal-only (lowercase).** `jstate`, `buildCtx`, `buildMeta`, `op`, `step`, `newDLog`, `dLog`, regex caches, all op `before`/`after` functions.

**Module path and version.** Module path stays at `github.com/jostraca/jostraca/go`; the package qualifier in user code stays `jostraca.X`. `go.mod` adds `github.com/sergi/go-diff` (2-way diff) and `github.com/google/go-cmp` (test-only) dependencies. The hand-ported diff3 lives in-package (`merge.go`), so there is no third-party diff3 dependency.

**Deferred to v2.** A `point` sub-package (`go/jostraca/point/`) for the `Point*` orchestration utility from `src/util/point.ts`. It is not used by core in TS — only re-exported as `PointUtil` — and porting it has no impact on parity for the generator workflow. Splitting it into a sub-package isolates the dependency surface (it would otherwise pull in unrelated logging/runner concerns).

**Why this matters for §4–§9.** Subsequent sections assume:
- All types (Node, J, Options, Result, FS, Log, NodeError, Kind) live in the same package and refer to each other directly without import qualifiers.
- Internal helpers (`step`, `op`, `iterChildren`, regex caches, `newDLog`) are unexported but reachable from any file in the package.
- Tests sit alongside production code in `jostraca_test` and friends, using internal access where it simplifies assertions.

### 4. Core types
- `Node` + `Kind` enum.
- `J` + `jstate` (current-frame pointer + shared backing context).
- `Options` struct + functional `WithX` options + `OptionsFromMap` validated by `shape`.
- `Existing`, `Control`, `CmpOptions`, `NameOptions`.
- `Log` interface + `DefaultLog`.
- `Result`, `Files`, `Audit`, `AuditEntry`.
- `NodeError` (Step, Path, Callsite, Err).

### 5. Component implementation pattern
- 5-step template (alloc node → append to parent → set root if nil → recurse with child `J` → error short-circuit).
- Short form vs `…P(props)` form for full options.
- Sketches for `Project`, `File`, `Content`, `Fragment`, `Slot`, `Inject`, `Copy`, `List`, `Line`.
- `cmp()` analogue: `J.Cmp(name string, fn func(*J, Props))` for user-defined components.

### 6. Op pipeline
- Fold ops onto a fixed-size `[KindCount]op` dispatch table, indexed by `Kind`.
- Synchronous depth-first walk in `step(n, st, b)`.
- Error wrapping with callsite + step kind.
- Trade-off note: no third-party op registration in v1; addressable later via `map[Kind]op` switch if needed.

### 7. FileHandler
- Modes: `write`, `preserve`, `present`, `diff`, `merge` — all in v1.
- `OsFS` and `MemFS` behind small `FS` interface (read+write+exists+stat+mkdirall+readdir).
- Path normalisation via `filepath.ToSlash`.
- `JOSTRACA_PROTECT` sentinel.
- `BuildMeta` JSON load/save under `<folder>/.jostraca/jostraca.meta.log` + `.gitignore` stub.
- `duplicateFolder` writes generated copy to `<folder>/.jostraca/generated/<rpath>` for merge baseline.

### 8. Diff & merge
- 2-way diff: `github.com/sergi/go-diff/diffmatchpatch` (line mode) rendered with TS's `<<<<<<< GENERATED:` / `>>>>>>> EXISTING:` markers.
- 3-way merge: hand-port `node-diff3` (~400 lines) into `merge.go`. Use TS `merge.test.ts` corpus as acceptance criteria.
- File output naming: `.old.`, `.new.`, `.diff.`, conflict-marker text.

### 9. Template — close TS gaps in `template.go`
List of features to add to the existing helper:
1. Custom delimiters (`Open`/`Close`/`Ref`).
2. Named-group rewriting in user-supplied regex keys.
3. `#Tag` and `#Tag-Name` matching (full TS regex synthesis).
4. `__JOSTRACA_REPLACE__` sentinel.
5. Quoted ref `$$"foo"$$`.
6. Function-valued model refs.
7. JSON-stringification for non-string values.
8. Custom `Handle` callback (used by Fragment streaming).
9. Eject regex variant (string or `*regexp.Regexp`).
10. Empty-match guard.
11. Regex LRU cache (cap 100) keyed by `open\0close\0ref\0sortedKeys`.
12. Eject regex cache.
13. Replace-key ordering matching TS exactly.
14. `indent()` helper in `util.go`.
- RE2-vs-PCRE caveat: document; reject lookbehind at compile time with a clear error.

### 10. Utilities to port
- Port: `each` (reflection-based for parity), `get`, `getx`, `camelify`, `snakify`, `kebabify`, `partify`, `lcf`, `ucf`, `names`, `escre`, `indent`, `isbinext`, `cmap`, `vmap`, `humanify`, `getdlog` (package-level locked slice instead of `global.__dlog__`), `deep`, `omap`.
- Defer to v2: `Point*` (not used by core; only re-exported as `PointUtil`).

### 11. Test strategy
- One Go test file per TS test file, same case names.
- `testdata/` folder with JSON fixtures embedded via `//go:embed` for merge corpus.
- `github.com/google/go-cmp/cmp` for deep-equal assertions.
- New regression test: 10 concurrent `Generate` calls each with own `MemFS` — proves receiver-shadowing isolates state.
- `merge_test.go` lands active (since merge ships in v1).

### 12. Phasing (v1 single milestone, ordered)
1. Skeleton: `Options`, `J`, `Node`, dispatch table, error type.
2. `OsFS` + `MemFS` + `FS` interface.
3. Template feature parity (close §9 gaps).
4. Utilities port (§10).
5. Components: `Project`/`Folder`/`File`/`Content`/`Line`/`Slot`/`None`.
6. `FileHandler` (write/preserve/present) + `BuildMeta`.
7. Concurrency regression test + happy-path tests pass.
8. `Inject`, `Fragment`, `List`.
9. `Copy` full feature set (directory walk, ignore, binary detect).
10. 2-way `diff` mode.
11. `node-diff3` port + 3-way `merge` mode.
12. Doc pass: `go/README.md` rewrite with full examples, deviation list.

### 13. File-by-file mapping (TS → Go)
Table mapping each `src/**/*.ts` and `test/**/*.ts` to its target `go/jostraca/*.go` file.

### 14. Deviations from TS (explicit, flagged)
1. Components are `*J` methods, not free functions.
2. `Generate` returns `(Result, error)` instead of throwing.
3. Options: struct + functional opts + `OptionsFromMap`.
4. `Node.Meta` stays `map[string]any` (op-private scratch).
5. Build phase fully synchronous.
6. `Log` is named-method interface (matches TS shape).
7. No global `__dlog__`; package-level locked slice.
8. `each` uses reflection.
9. Path semantics canonical-`/` internally; OS conversion only in `OsFS`.
10. RE2 vs JS regex: lookbehind unsupported, fail at compile.

### 15. Risks & mitigations
- `getx` parser subtlety → port test-first against `utility.test.ts` goldens.
- `each` reflection hot path → internal `iterChildren` helper used by core; reflection only on user path.
- Windows path semantics → `filepath.ToSlash` everywhere internal.
- node-diff3 port correctness → use TS merge corpus as oracle.

### 16. Critical files to modify / create
- Modify: `/home/user/jostraca/go/jostraca/template.go`, `/home/user/jostraca/go/jostraca/template_test.go`, `/home/user/jostraca/go/README.md`, `/home/user/jostraca/go/go.mod`.
- Create: every other file listed in §3.

### 17. Verification (end-to-end)
- `cd go && go build ./...`
- `cd go && go test ./... -race -count=1` — must include concurrency regression.
- Parity snapshot: run TS test fixtures through Go via a small `cmd/parity` driver; `cmp.Diff` against TS `vol.toJSON()` output stored under `testdata/parity/`.
- `go vet ./...` clean; `staticcheck ./...` clean.
- Manual smoke: README quick-start example translated to Go, generates the same `out/my-app/...` tree on disk.

---

*Status: outline. Sections will be expanded one at a time in subsequent commits.*
