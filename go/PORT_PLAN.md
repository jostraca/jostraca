# Refactor the Go version to full TS parity

## Outline

### 1. Context

**Current state.** The Go module under `go/` is a 184-line `Template()` helper plus a 65-line test (`template.go` and `template_test.go`). It exposes one function (`Template`) and one helper (`ParseTemplateSpec`) — no components, no node tree, no build pipeline, no file handling, no context machinery. The directory's own `go/README.md` is honest about scope: *"This folder contains a Go implementation of Jostraca's template utility."* That is roughly 12% of the TypeScript surface in `src/`.

By contrast, the TS package in `src/` is a code-and-project generator:

- **Core entry** (`src/jostraca.ts`, 498 lines) — `Jostraca()` factory and `generate()` driver.
- **9 components** (`src/cmp/`) — `Project`, `Folder`, `File`, `Copy`, `Inject`, `Fragment`, `Slot`, `Content`, `Line`, `List` (plus internal `None`).
- **9 ops** (`src/op/`) — one per component, with `before()`/`after()` hooks driven by a recursive `step()` walker.
- **Build pipeline** (`src/build/`) — `BuildContext` (119 lines), `BuildMeta` (107 lines), `FileHandler` (746 lines) with five existing-file modes: `write`, `preserve`, `present`, `diff`, `merge`.
- **Utilities** (`src/util/basic.ts`, 750 lines) — `each`, `get`, `getx`, `camelify`, `snakify`, `kebabify`, `partify`, `lcf`, `ucf`, `names`, `escre`, `indent`, `isbinext`, `cmap`, `vmap`, `template`, `getdlog`, plus point/orchestration in `point.ts`.
- **Tests** (`test/`) — `jostraca.test.ts`, `template.test.ts`, `utility.test.ts`, `merge.test.ts`, `control.test.ts`, `point.test.ts`.

**Why now.** The README at the repo root advertises a Go port (`README.md:281-283`); the actual Go module covers only the template engine. Anyone reaching for `import "github.com/jostraca/jostraca/go"` to *generate code projects* in Go gets nothing. Closing the gap unblocks Go consumers and prevents the README from being misleading.

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

**Decision: single `jostraca` package** at the existing import path `github.com/jostraca/jostraca/go`. No sub-packages in v1.

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

**Deferred to v2.** A `point` sub-package (`go/point/`) for the `Point*` orchestration utility from `src/util/point.ts`. It is not used by core in TS — only re-exported as `PointUtil` — and porting it has no impact on parity for the generator workflow. Splitting it into a sub-package isolates the dependency surface (it would otherwise pull in unrelated logging/runner concerns).

**Why this matters for §4–§9.** Subsequent sections assume:
- All types (Node, J, Options, Result, FS, Log, NodeError, Kind) live in the same package and refer to each other directly without import qualifiers.
- Internal helpers (`step`, `op`, `iterChildren`, regex caches, `newDLog`) are unexported but reachable from any file in the package.
- Tests sit alongside production code in `jostraca_test` and friends, using internal access where it simplifies assertions.

### 4. Core types

This section enumerates every type the rest of the plan references. Field semantics map back to `src/types.ts` and the option shapes at `src/jostraca.ts:99-153, 156-172`.

#### 4.1 `Node` and `Kind`

`Kind` is a small enum used as the dispatch index in §6. Untagged-union via `Kind` keeps a single `Node` struct (matches TS `Node` in `src/types.ts`).

```go
type Kind uint8

const (
    KindNone Kind = iota
    KindProject
    KindFolder
    KindFile
    KindContent
    KindCopy
    KindInject
    KindFragment
    KindSlot
    kindCount  // unexported sentinel for fixed-size dispatch table
)

type Node struct {
    Kind     Kind
    Name     string                    // user-supplied, may be empty
    Path     []string                  // accumulated path segments from root
    FullPath string                    // resolved during build (FileOp before())
    Folder   string                    // Project/Folder
    From     string                    // Copy.from / Fragment.from
    Indent   any                       // string | int | nil
    Exclude  any                       // bool | string | *regexp.Regexp | []any
    Replace  map[string]any            // for Copy/Fragment template overrides
    Markers  [2]string                 // Inject {start, end}
    Filter   func(props, children, component any) bool
    Children []*Node
    Content  []string                  // accumulated text during build
    Meta     map[string]any            // op-private scratch (callsite, fragment_file, debug)
    After    *AfterRef                 // CopyOp queues a post-walk step here
}

type AfterRef struct{ Kind string }
```

**Rationale.** TS lets `node.meta`, `node.indent`, and `node.exclude` carry heterogeneous values. Go's strongly-typed analogue is `any` plus runtime checks at the few op sites that consume them. Every other field has a stable Go type. `Meta` stays `map[string]any` because it's op-private scratch (callsite stack, parent-file restore, debug payload) and typing it would push private fields into the public surface.

#### 4.2 `J` and `jstate`

The receiver-shadowing carrier from §2:

```go
type J struct {
    st  *jstate
    cur *Node
}

type jstate struct {
    opts   Options
    fs     FS
    now    func() int64
    folder string
    model  map[string]any
    log    Log
    meta   map[string]any   // user-provided meta merged from global+per-call
    debug  string

    root *Node
    err  error              // first define-phase error; halts subsequent components
    bctx *buildCtx          // populated before build phase, see §6
}
```

Concurrency: `*jstate` is never shared across `Generate` calls. Inside one call the define phase is single-goroutine (it's a synchronous walk of the user's callbacks), and the build phase is also synchronous (§6). No mutex required on `jstate.err` or `jstate.root`.

#### 4.3 `Options` and constituents

Public option struct mirrors `OptionsShape` at `src/jostraca.ts:99-153`. Pointer-typed bools express the TS tri-state (unset / true / false) the same way `Skip(Boolean)` does.

```go
type Options struct {
    Folder   string
    Meta     map[string]any
    FS       FS
    Now      func() int64
    Log      Log
    Debug    string
    Existing Existing
    Model    map[string]any
    Build    *bool                  // tri-state; nil → default true
    Mem      bool
    Vol      map[string][]byte
    Cmp      CmpOptions
    Control  Control
    Name     NameOptions
}

type Existing struct {
    Txt ExistingTxt
    Bin ExistingBin
}

type ExistingTxt struct {
    Write    *bool                  // default true
    Preserve *bool                  // default false
    Present  *bool
    Diff     *bool
    Merge    *bool
}

type ExistingBin struct {
    Write    *bool
    Preserve *bool
    Present  *bool
}

type Control struct {
    Dryrun      bool
    NoDuplicate bool   // inverted from TS so Go zero value = TS default (duplicate=true)
    Version     bool
}
// Control.Duplicate() helper returns !NoDuplicate.

type CmpOptions struct {
    Copy CopyCmpOptions
}

type CopyCmpOptions struct {
    Ignore []*regexp.Regexp        // default []{ ~$ }
}

type NameOptions struct {
    File   NameAffix
    Folder NameAffix
    // Files excluded from prefix/suffix application:
    Exclude []NameMatcher           // string | *regexp.Regexp
}

type NameAffix struct {
    Prefix string
    Suffix string
}

type NameMatcher struct {
    Literal string
    RE      *regexp.Regexp
}
```

**Functional options.** Constructors for the common cases:

```go
type Option func(*Options)

func WithFolder(s string) Option        { return func(o *Options) { o.Folder = s } }
func WithModel(m map[string]any) Option { return func(o *Options) { o.Model = m } }
func WithMeta(m map[string]any) Option  { return func(o *Options) { o.Meta = m } }
func WithLog(l Log) Option               { return func(o *Options) { o.Log = l } }
func WithDebug(s string) Option          { return func(o *Options) { o.Debug = s } }
func WithMem() Option                    { return func(o *Options) { o.Mem = true } }
func WithVol(v map[string][]byte) Option { return func(o *Options) { o.Vol = v } }
func WithFS(fs FS) Option                { return func(o *Options) { o.FS = fs } }
func WithNow(f func() int64) Option      { return func(o *Options) { o.Now = f } }
func WithExisting(e Existing) Option     { return func(o *Options) { o.Existing = e } }
func WithControl(c Control) Option       { return func(o *Options) { o.Control = c } }
func WithBuild(b bool) Option            { return func(o *Options) { o.Build = &b } }
```

Used at the package entry: `New(WithMem(), WithModel(m))` returns `*J`.

**`OptionsFromMap`.** Validated via `shape`, mirroring TS. Useful when callers source config from JSON/YAML/CLI:

```go
func OptionsFromMap(m map[string]any) (Options, error)
```

Implementation: a `shape.MustShape(...)` schema with the same field set as `OptionsShape` at `src/jostraca.ts:99-153`, validated, then assembled into the typed `Options`.

**Phasing note.** Phase 1 ships a narrowed implementation that handles
`folder`, `debug`, `mem`, `model`, `meta` directly and silently ignores
unknown keys, because the nested option structs (`Existing`, `Control`,
`Cmp`, `Name`) need a stable surface before a single shape schema can
validate them all. The full shape-validated `OptionsFromMap` lands in
the Phase 12 doc pass once the option surface is final.

**Per-call vs global merge.** `New(opts...)` stores baseline options on the `*J`. `Generate(callOpts, root)` applies `callOpts` over the baseline using deep-merge semantics matching TS `deep(...)` from jsonic — same precedence as `src/jostraca.ts:208-256`. The `deep` helper is ported in §10.

#### 4.4 `Log`

Interface mirroring TS `Log` at `src/types.ts`:

```go
type Log interface {
    Trace(args ...any)
    Debug(args ...any)
    Info(args ...any)
    Warn(args ...any)
    Error(args ...any)
    Fatal(args ...any)
}
```

`DefaultLog{ Out io.Writer }` writes ISO-8601-prefixed lines with the level tag, matching `DEFAULT_LOGGER` at `src/jostraca.ts:85-92`. Future-proof note: a thin `slog.Handler` adapter is trivial to add but not in v1.

`dLog` (unexported) is the `getdlog`-equivalent collector — a package-level `[]dlogEntry` guarded by `sync.Mutex`. See §10.

#### 4.5 `Result` and audit types

Mirrors `JostracaResult` at `src/types.ts`:

```go
type Result struct {
    When  int64
    Files Files
    Audit func() Audit
    Vol   func() map[string][]byte   // nil unless Mem
    FS    func() FS                   // nil unless Mem
}

type Files struct {
    Preserved  []string
    Written    []string
    Presented  []string
    Diffed     []string
    Merged     []string
    Conflicted []string
    Unchanged  []string
}

type Audit []AuditEntry

type AuditEntry struct {
    Tag  string
    Data map[string]any
}
```

Filed paths in `Files.*` are normalised to forward slashes (see §7).

#### 4.6 `NodeError`

Single error type wrapping every build-phase failure with the kind, path, and (when debug is on) callsite:

```go
type NodeError struct {
    Step     string   // e.g. "file", "copy"
    Path     []string
    Callsite string   // populated when Options.Debug is set
    Err      error
}

func (e *NodeError) Error() string { ... }
func (e *NodeError) Unwrap() error { return e.Err }
```

Sentinels:

```go
var (
    ErrMissingOp        = errors.New("jostraca: missing op for node kind")
    ErrInvalidPath      = errors.New("jostraca: invalid path")
    ErrEmptyMatchRegex  = errors.New("jostraca: regex matches empty string")
    ErrLookbehind       = errors.New("jostraca: lookbehind not supported (RE2)")
    ErrMergeConflict    = errors.New("jostraca: 3-way merge produced conflicts")
    ErrNilRoot          = errors.New("jostraca: Generate root callback is nil")
)
```

`ErrNilRoot` was added in Phase 1 to distinguish a nil callback (programmer
error) from a callback that builds zero components (valid empty generation).

`Generate` returns the first define-phase error if `j.st.err != nil` after the user `root()` callback returns; otherwise it returns the first build-phase error wrapped in `NodeError`, or `nil`.

#### 4.7 `FS`, `FileInfo`, `DirEntry`

Defined in §7 (filesystem layer) but referenced from `Options` and `Result`. Not in `io/fs` because Jostraca needs writes; the small dedicated interface is documented in §7.1.

#### 4.8 Cross-references

- `Node.Kind` indexes the dispatch table in §6.1.
- `Options.Existing` drives FileHandler mode logic in §7.2.
- `Options.Mem` + `Options.Vol` flip the FS factory in §7.3.
- `jstate.err` + `NodeError` implement the error policy from §2.

### 5. Component implementation pattern

Every component is a method on `*J`. They all follow the same 5-step template — the Go equivalent of TS `cmp()` at `src/jostraca.ts:376-437`. Differences from TS are flagged inline.

#### 5.1 The 5-step template

```go
func (j *J) Foo(name string, body func(*J)) {
    // 1. Error short-circuit: stop building if a prior call failed.
    if j.st.err != nil { return }

    // 2. Allocate the new node, with the kind/name/indent specific to this component.
    n := &Node{
        Kind: KindFoo,
        Name: name,
        Path: childPath(j.cur, name),
        Meta: map[string]any{},
    }

    // 3. Append to the parent's children list.
    j.cur.Children = append(j.cur.Children, n)

    // 4. Set root on first call.
    if j.st.root == nil { j.st.root = n }

    // 5. Recurse with a child *J bound to the new node.
    if body != nil {
        body(&J{st: j.st, cur: n})
    }
}
```

The `&J{st: j.st, cur: n}` construction is the Go analogue of TS's:

```ts
ctx$.children = node.children
ctx$.node = node
let out = component(props, children)
ctx$.children = siblings
ctx$.node = parent
```

— a single allocation in place of explicit push/pop. Restoration is implicit: when `body(...)` returns, the child `*J` is discarded and the parent's `*J` is unchanged.

`childPath` is a small helper:

```go
func childPath(parent *Node, name string) []string {
    p := append([]string(nil), parent.Path...)
    if name != "" { p = append(p, name) }
    return p
}
```

The `j.st.err` short-circuit ensures define-phase errors don't snowball — once one component records an error, every subsequent call (and every nested callback) silently no-ops, and `Generate` returns the error to the caller.

#### 5.2 Short form vs `…P(props)` form

Every component has two entry points. The short form covers the common case with positional args:

```go
func (j *J) File(name string, body func(*J))
```

The `…P` form takes the full props struct for less common options:

```go
type FileProps struct {
    Name    string
    Exclude any                  // bool | string | *regexp.Regexp | []any
}
func (j *J) FileP(p FileProps, body func(*J))
```

`File` calls `FileP` internally. This avoids forcing struct literals on common code:

```go
j.File("foo.go", func(j *J) { j.Content("// hi\n") })

// vs
j.FileP(FileProps{Name: "foo.go", Exclude: true}, func(j *J) { ... })
```

#### 5.3 Sketches

##### Project (`src/cmp/Project.ts`)

```go
type ProjectProps struct {
    Name   string
    Folder string
}

func (j *J) Project(p ProjectProps, body func(*J)) {
    if j.st.err != nil { return }
    n := &Node{
        Kind:   KindProject,
        Name:   p.Name,
        Folder: p.Folder,
        Path:   []string{},                      // Phase 5 update: seed with Folder so
        Meta:   map[string]any{},                // Folder/File children sit below the
    }                                            // project's output directory.
    if p.Folder != "" {
        n.Path = append(n.Path, p.Folder)
    }
    j.cur.Children = append(j.cur.Children, n)
    if j.st.root == nil { j.st.root = n }
    if body != nil { body(&J{st: j.st, cur: n}) }
}
```

(Convenience: no positional short form — `Project` is always called with at least `Folder`.)

##### Folder (`src/cmp/Folder.ts`)

```go
func (j *J) Folder(name string, body func(*J)) {
    if j.st.err != nil { return }
    n := &Node{Kind: KindFolder, Name: name, Path: childPath(j.cur, name), Meta: map[string]any{}}
    j.cur.Children = append(j.cur.Children, n)
    if j.st.root == nil { j.st.root = n }
    if body != nil { body(&J{st: j.st, cur: n}) }
}
```

##### File (`src/cmp/File.ts`)

```go
type FileProps struct {
    Name    string
    Exclude any
}

func (j *J) File(name string, body func(*J)) {
    j.FileP(FileProps{Name: name}, body)
}

func (j *J) FileP(p FileProps, body func(*J)) {
    if j.st.err != nil { return }
    n := &Node{
        Kind: KindFile, Name: p.Name, Exclude: p.Exclude,
        Path: childPath(j.cur, p.Name), Meta: map[string]any{},
    }
    j.cur.Children = append(j.cur.Children, n)
    if j.st.root == nil { j.st.root = n }
    if body != nil { body(&J{st: j.st, cur: n}) }
}
```

##### Content (`src/cmp/Content.ts`)

Content has no children-callback (it's a leaf). It runs `Template` synchronously and stashes the rendered string. Template gaps from §9 are required for full parity here.

```go
type ContentProps struct {
    Src     string
    Name    string
    Indent  any
    Replace map[string]any
    Extra   map[string]any
}

func (j *J) Content(src string) {
    j.ContentP(ContentProps{Src: src})
}

func (j *J) ContentP(p ContentProps) {
    if j.st.err != nil { return }
    model := mergeMaps(j.st.model, p.Extra)
    rendered, err := Template(p.Src, model, &TemplateSpec{Replace: p.Replace})
    if err != nil { j.st.err = err; return }
    n := &Node{
        Kind: KindContent, Name: p.Name, Indent: p.Indent,
        Content: []string{rendered},
        Path: childPath(j.cur, p.Name), Meta: map[string]any{},
    }
    j.cur.Children = append(j.cur.Children, n)
    if j.st.root == nil { j.st.root = n }
}
```

##### Line (`src/cmp/Line.ts`)

`Line` is `Content` plus a trailing `\n`:

```go
func (j *J) Line(src string) {
    if !strings.HasSuffix(src, "\n") { src += "\n" }
    j.ContentP(ContentProps{Src: src})
}

func (j *J) LineP(p ContentProps) {
    if !strings.HasSuffix(p.Src, "\n") { p.Src += "\n" }
    j.ContentP(p)
}
```

##### Slot (`src/cmp/Slot.ts`)

A `Slot` is a placeholder that is filtered out by its parent `Fragment` unless the fragment's filter matches its name. Its body is captured for later replay during the fragment's template processing.

```go
type SlotProps struct{ Name string }

func (j *J) Slot(name string, body func(*J)) {
    j.SlotP(SlotProps{Name: name}, body)
}

func (j *J) SlotP(p SlotProps, body func(*J)) {
    if j.st.err != nil { return }
    if j.cur.Filter != nil && !j.cur.Filter("slot", p.Name) {
        return                          // Fragment said: skip this slot.
    }
    n := &Node{
        Kind: KindSlot, Name: p.Name,
        Path: childPath(j.cur, p.Name), Meta: map[string]any{},
    }
    j.cur.Children = append(j.cur.Children, n)
    if body != nil { body(&J{st: j.st, cur: n}) }
}
```

The TS `Filter` callback signature is generalised; the Go version uses a small `filterFn func(componentKind, name string) bool` field on `Node`. (Type updated in §4.1: `Filter func(componentKind, name string) bool` instead of the loose TS form.)

##### Inject (`src/cmp/Inject.ts`)

Inject runs in two phases: define-time it captures children content, build-time it locates an existing file and replaces content between markers.

```go
type InjectProps struct {
    Name    string
    Markers [2]string                   // {start, end}; defaults match TS
    Exclude any
}

func (j *J) Inject(name string, body func(*J)) {
    j.InjectP(InjectProps{Name: name}, body)
}

func (j *J) InjectP(p InjectProps, body func(*J)) {
    if j.st.err != nil { return }
    if p.Markers == [2]string{} { p.Markers = defaultInjectMarkers }
    n := &Node{
        Kind: KindInject, Name: p.Name, Markers: p.Markers, Exclude: p.Exclude,
        Path: childPath(j.cur, p.Name), Meta: map[string]any{},
    }
    j.cur.Children = append(j.cur.Children, n)
    if body != nil { body(&J{st: j.st, cur: n}) }
}
```

##### Fragment (`src/cmp/Fragment.ts`)

Fragment is the most subtle: at define time it walks its children twice with two different filters to (1) collect Slot names and (2) replay slots back into the template `<[SLOT:name]>` markers. The template invocation streams parts via the `Handle` callback (§9 gap #8).

```go
type FragmentProps struct {
    From    string
    Indent  any
    Replace map[string]any
    Exclude any
    Eject   any                          // string | *regexp.Regexp | [2]any
}

func (j *J) Fragment(p FragmentProps, body func(*J)) {
    if j.st.err != nil { return }
    p.Replace = p.Replace                 // ensure non-nil if used below
    if p.Replace == nil { p.Replace = map[string]any{} }

    n := &Node{
        Kind: KindFragment, From: p.From, Indent: p.Indent, Exclude: p.Exclude,
        Replace: p.Replace,
        Path: childPath(j.cur, ""), Meta: map[string]any{},
    }
    j.cur.Children = append(j.cur.Children, n)

    // First pass: collect slot names by setting a slot-name-collecting filter.
    slotNames := map[string]bool{}
    n.Filter = func(kind, name string) bool {
        if kind == "slot" { slotNames[name] = true }
        return false                      // never actually emit during scan
    }
    if body != nil { body(&J{st: j.st, cur: n}) }
    n.Filter = nil

    // Build replace entries that, when triggered by a <[SLOT:name]> match in the
    // template, replay the relevant child callback. See §9 for the regex format.
    for slot := range slotNames {
        slot := slot
        key := slotReplaceKey(slot)
        p.Replace[key] = TemplateReplaceFunc(func(_ map[string]string, _ string) string {
            n.Filter = func(kind, name string) bool {
                return kind == "slot" && name == slot
            }
            if body != nil { body(&J{st: j.st, cur: n}) }
            n.Filter = nil
            return ""                     // streamed via Handle below
        })
    }
    // Default <[SLOT]> matches non-Slot children.
    p.Replace[defaultSlotReplaceKey] = TemplateReplaceFunc(func(_ map[string]string, _ string) string {
        n.Filter = func(kind, _ string) bool { return kind != "slot" }
        if body != nil { body(&J{st: j.st, cur: n}) }
        n.Filter = nil
        return ""
    })

    // Read the fragment file and stream-template into Content children.
    src, err := readFragmentSrc(j, n)
    if err != nil { j.st.err = err; return }

    _, err = Template(src, j.st.model, &TemplateSpec{
        Replace: p.Replace,
        Eject:   ejectAsAny(p.Eject),
        Handle: func(s string) {
            if s != "" { (&J{st: j.st, cur: n}).Content(s) }
        },
    })
    if err != nil { j.st.err = err; return }

    if j.st.root == nil { j.st.root = n }
}
```

The `defaultSlotReplaceKey` and `slotReplaceKey(name)` helpers produce the same regexes as TS lines 56 and 64-67 — see §9 for the regex format.

##### Copy (`src/cmp/Copy.ts`)

Copy is a leaf at define-time; the heavy lifting (directory walk, exclude filtering, binary detection) happens in `CopyOp.after()` during build:

```go
type CopyProps struct {
    From    string
    To      string
    Replace map[string]any
    Exclude any
    Indent  any
}

func (j *J) Copy(p CopyProps) {
    if j.st.err != nil { return }
    n := &Node{
        Kind: KindCopy, From: p.From, Name: p.To, Replace: p.Replace,
        Exclude: p.Exclude, Indent: p.Indent,
        Path: childPath(j.cur, p.To), Meta: map[string]any{},
    }
    j.cur.Children = append(j.cur.Children, n)
    if j.st.root == nil { j.st.root = n }
}
```

##### List (`src/cmp/List.ts`)

`List` iterates a slice/map and calls a body once per item, exposing the item via a fresh `Cmp`-style scope. In TS the user accesses `item` via `props.ctx$`; in Go we pass it as the second callback argument:

```go
type ListProps struct {
    Item   any                            // any iterable accepted by Each
    Line   string                         // optional separator line, mirrors TS prop
    Indent any
}

func (j *J) List(items any, body func(j *J, item any)) {
    j.ListP(ListProps{Item: items}, body)
}

func (j *J) ListP(p ListProps, body func(j *J, item any)) {
    if j.st.err != nil { return }
    Each(p.Item, EachSpec{}, func(item any) {
        body(j, item)                     // body uses j as normal; item is in scope
        if p.Line != "" { j.Line(p.Line) }
    })
}
```

This deviates from TS in the small way that `List` doesn't allocate its own node — children attach to the surrounding parent, which matches TS observed behaviour where `List` simply `each`-iterates its children.

#### 5.4 The `cmp()` analogue: `J.Cmp` and free-standing custom components

TS exports `cmp(component)` (`src/jostraca.ts:376`) so users can build reusable components:

```ts
const FunctionDef = cmp(function FunctionDef(props, children) {
  Content('function ' + props.name + '(...)')
})
```

The Go form is a method that runs the user function inside the current frame:

```go
func (j *J) Cmp(name string, fn func(j *J)) {
    if j.st.err != nil { return }
    if j.st.opts.Debug != "" {
        j.cur.Meta["callsite"] = captureStack(name)
    }
    fn(j)                                 // current frame; no new node
}
```

For users who want a named, reusable component, the idiom is a plain function:

```go
func FunctionDef(j *J, name string, params []string) {
    j.Content("function " + name + "(" + strings.Join(params, ", ") + ") {\n")
    // ...
    j.Content("}\n")
}

// Use:
j.File("utils.go", func(j *J) {
    FunctionDef(j, "greet", []string{"name"})
})
```

That's the cleanest Go equivalent of `cmp()`. It does not allocate a wrapper node — neither does TS unless the user explicitly creates one via a child component call. Users who want a node-tree boundary inside their custom component just call `j.Folder` / `j.File` from inside the function.

#### 5.5 Shared helpers

`builder.go` defines a few lowercase helpers used across the components:

```go
func childPath(parent *Node, name string) []string
func mergeMaps(base, over map[string]any) map[string]any
func defaultInjectMarkers() [2]string         // mirrors TS Inject default markers
func readFragmentSrc(j *J, n *Node) (string, error)  // resolves From relative to folder/path
func slotReplaceKey(name string) string       // regex with TS comment-marker tolerance
const defaultSlotReplaceKey = `/[ \t]*[-<!/#*]*[ \t]*<\[SLOT]>[ \t]*[->/#*]*[ \t]*/`
```

Each helper has a unit test in `builder_test.go`.

#### 5.6 Cross-references

- §6 consumes `Node.Kind` for op dispatch and reads `Node.Filter`, `Node.Children`, `Node.Content`, `Node.From`, `Node.Markers`.
- §9 owns the template substitution — every component that calls `Template` (`Content`, `Fragment`) inherits its full feature set once §9 is implemented.
- §11 lists test cases per component, mirroring the TS suite.

### 6. Op pipeline

#### 6.1 Decision: fold ops onto a Kind-keyed dispatch table

TS keeps components and ops in separate files (`src/cmp/*.ts` and `src/op/*.ts`) and routes via `opmap[node.kind]` at `src/jostraca.ts:358-367`. The split exists because TS resolves cyclic imports lazily and because `op.before/after` are async. In Go neither matters: components only fill the node, ops only walk it, and the build phase is synchronous file I/O. Inlining ops next to the walker eliminates a layer.

Implementation: a fixed-size array indexed by `Kind`. `kindCount` from §4.1 sizes it.

```go
type op struct {
    before func(n *Node, st *jstate, b *buildCtx) error
    after  func(n *Node, st *jstate, b *buildCtx) error
}

var ops = [kindCount]op{
    KindNone:     {noopOp, noopOp},
    KindProject:  {projectBefore, noopOp},
    KindFolder:   {folderBefore, folderAfter},
    KindFile:     {fileBefore, fileAfter},
    KindContent:  {contentBefore, noopOp},
    KindCopy:     {copyBefore, copyAfter},
    KindInject:   {injectBefore, injectAfter},
    KindFragment: {fragmentBefore, fragmentAfter},
    KindSlot:     {slotBefore, slotAfter},
}

func noopOp(*Node, *jstate, *buildCtx) error { return nil }
```

Trade-off accepted: third-party packages cannot register a new `Kind` in v1. If extensibility becomes a v2 requirement, swap the array for `map[Kind]op` and expose `RegisterOp(Kind, op)`. The change is mechanical.

#### 6.2 The walker

A single function in `build.go`:

```go
func step(n *Node, st *jstate, b *buildCtx) error {
    if int(n.Kind) >= len(ops) {
        return wrap(n, fmt.Errorf("%w: %d", ErrMissingOp, n.Kind))
    }
    o := ops[n.Kind]
    if err := o.before(n, st, b); err != nil { return wrap(n, err) }
    for _, c := range n.Children {
        if err := step(c, st, b); err != nil { return wrap(c, err) }
    }
    return wrap(n, o.after(n, st, b))
}

func wrap(n *Node, err error) error {
    if err == nil { return nil }
    var ne *NodeError
    if errors.As(err, &ne) { return err }       // already wrapped
    return &NodeError{
        Step:     kindName(n.Kind),
        Path:     append([]string(nil), n.Path...),
        Callsite: callsiteFrom(n),
        Err:      err,
    }
}

func callsiteFrom(n *Node) string {
    if v, ok := n.Meta["callsite"].(string); ok { return v }
    return ""
}
```

`Generate` drives this:

```go
func (j *J) Generate(opts Options, root func(*J)) (Result, error) {
    st := newJstate(j.st, opts)                     // merge with global
    rootNode := &Node{Kind: KindNone, Meta: map[string]any{}}
    cj := &J{st: st, cur: rootNode}

    root(cj)                                        // define phase, sync
    if st.err != nil { return Result{}, st.err }

    if !buildEnabled(st) { return packResult(st), nil }

    st.bctx = newBuildCtx(st)
    if st.root == nil {
        // No top-level component; nothing to build.
        return packResult(st), nil
    }
    if err := step(st.root, st, st.bctx); err != nil {
        return packResult(st), err
    }
    if err := st.bctx.bmeta.done(); err != nil {
        return packResult(st), err
    }
    return packResult(st), nil
}
```

The build phase is fully synchronous. TS uses `await` only because Node fs is callback/Promise; Go's `os` is blocking and cheap. Removing async simplifies error propagation: a single linear `error` return, no Promise rejection.

#### 6.3 Op responsibilities (per-kind summary)

Each op is a pair of small functions in `build.go` (or a peer file when it grows). Behaviour follows the TS originals; line refs point at the source:

| Kind | `before` | `after` | Reads | Writes |
|---|---|---|---|---|
| Project | normalise folder, set `bctx.current.project`, `ensureFolder` (`src/op/ProjectOp.ts:6-28`) | — | `st.folder` | filesystem (mkdir) |
| Folder | append name to `bctx.current.folder.path`, `ensureFolder` (`src/op/FolderOp.ts:9-22`) | pop name from `bctx.current.folder.path` (`:25-28`) | — | filesystem (mkdir) |
| File | set `bctx.current.file = node`, compute `fullpath`, init content slice (`src/op/FileOp.ts:11-18`) | join content, apply exclude rules, call `bctx.fh.save(...)` (`:21-74`) | `st.fs`, `st.opts.Exclude` | filesystem (write) |
| Content | append rendered string to `bctx.current.file.content` (with `Indent` applied) | — | — | in-memory |
| Copy | resolve from-path; for files call `FileOp.before`, for dirs walk and queue per-entry actions (`src/op/CopyOp.ts:18-...`) | call `bctx.fh.copy(...)` per entry; apply replace/template; respect `Exclude` and `CopyCmpOptions.Ignore` | `st.fs`, `st.opts.Cmp.Copy.Ignore` | filesystem (copy/write) |
| Inject | set `bctx.current.file = node` to a pseudo-file with the target path (`src/op/InjectOp.ts:?`) | read existing file; replace content between `Markers`; `bctx.fh.save(...)` | `st.fs` | filesystem (write) |
| Fragment | save parent file ctx, init fragment file ctx (`src/op/FragmentOp.ts:?`) | apply `Indent`, restore parent, append fragment content to parent file | — | in-memory accumulation |
| Slot | save parent file ctx, init slot pseudo-file (`src/op/SlotOp.ts:?`) | restore parent, append slot content to parent | — | in-memory accumulation |
| None | — | — | — | — |

Each `before`/`after` function is small (10–60 lines); none uses concurrency. Detailed implementation lands during phase 5/6/8/9 of §12.

#### 6.4 Error wrapping

Every error returned by an op is wrapped once in `NodeError` (§4.6). `wrap` is idempotent — it checks via `errors.As(...)` so re-wrapping during the recursion doesn't grow chains. The `Step` field uses `kindName(Kind)` (e.g. `"file"`, `"copy"`) to match TS's `err.step = node.kind` pattern from `src/jostraca.ts:353`.

When `Options.Debug != ""`, components stash a callsite string into `node.Meta["callsite"]` (similar to TS `err.callsite` at `:339-341`). `wrap` reads it and surfaces it via `NodeError.Callsite`. Without debug, the field stays empty.

#### 6.5 `buildCtx`

The Go peer of TS `BuildContext`:

```go
type buildCtx struct {
    fh      *fileHandler
    bmeta   *buildMeta
    when    int64
    audit   Audit
    current currentRefs
    log     *buildLog
}

type currentRefs struct {
    project *Node
    folder  folderRef
    file    *Node          // current open file during build
}

type folderRef struct {
    node   *Node
    path   []string        // current segments below project root
    parent string
}

type buildLog struct {
    exclude []string       // paths excluded from rewrite
    last    int64          // mtime of last build (from BuildMeta)
}
```

`buildCtx` is created by `newBuildCtx(st)` once per `Generate` call before the walk starts. It owns the `fileHandler` (§7) and `buildMeta` (§7.4), and accumulates `audit` entries that surface via `Result.Audit()`.

#### 6.6 Synchronous, not concurrent

Inside one `Generate` call the walk is single-goroutine. Two parallel `Generate`s each have their own `*jstate` and `*buildCtx`; collision is impossible. There is no goroutine pool, no worker channel, no fan-out — file I/O dominates wall time and is bound to the single walker. If a future workload demands parallel file writes, the cleanest extension point is `step()` calling `o.after` on independent subtrees concurrently, gated by a flag in `Options.Control`. Out of scope for v1.

#### 6.7 Cross-references

- §4.1 owns the `Kind` enum and `kindCount` sentinel that sizes the dispatch table.
- §4.6 owns `NodeError` and the sentinels `wrap` may surface.
- §7 owns `fileHandler` and the actual filesystem mutation logic; ops only call `bctx.fh.save/copy/...`.
- §11 specifies regression tests asserting op order and audit content.

### 7. FileHandler

The `fileHandler` (lowercase, internal) is the only place that touches the filesystem. Ops in §6 push content through `bctx.fh.save(...)` and `bctx.fh.copy(...)`; nothing else writes. This concentrates the existing-file-mode logic and makes `MemFS` testable.

#### 7.1 `FS` interface

Defined in `fs.go`:

```go
type FS interface {
    ReadFile(path string) ([]byte, error)
    WriteFile(path string, data []byte) error
    Exists(path string) bool
    Stat(path string) (FileInfo, error)
    MkdirAll(path string) error
    ReadDir(path string) ([]DirEntry, error)
    Remove(path string) error           // for .old. cleanup on overwrite
    Rename(oldpath, newpath string) error
}

type FileInfo struct {
    Name    string
    Size    int64
    Mode    fs.FileMode
    ModTime int64                       // unix millis
    IsDir   bool
}

type DirEntry struct {
    Name  string
    IsDir bool
}
```

Why not `io/fs.FS`. `io/fs.FS` is read-only. `testing/fstest.MapFS` is also read-only. Jostraca's whole point is *writing* generated files, so we need a read+write interface. The dedicated interface is small and easy for users to mock or wrap (an `OsFS` adapter and a `MemFS` come in-package).

##### `OsFS`

Thin wrapper around `os` and `path/filepath`, normalising input paths from forward slashes to OS-native via `filepath.FromSlash` at the boundary:

```go
type OsFS struct{}

func (OsFS) ReadFile(p string) ([]byte, error) { return os.ReadFile(filepath.FromSlash(p)) }
func (OsFS) WriteFile(p string, b []byte) error {
    return os.WriteFile(filepath.FromSlash(p), b, 0o644)
}
// ...
```

Inside the package every path is canonical-`/`. Conversion happens only inside `OsFS`.

##### `MemFS`

A `map[string][]byte` guarded by `sync.RWMutex`, with synthesised `FileInfo` (mtime from a sibling map). `MkdirAll` records the path (and every prefix) in an explicit `map[string]bool` directory set so empty directories are visible to `Stat` and `ReadDir`; `WriteFile` also marks parent prefixes implicitly. `ReadDir` aggregates entries from both maps and returns synthetic `DirEntry` values. `Vol()` exposes the underlying map for `Result.Vol`:

```go
type MemFS struct {
    mu    sync.RWMutex
    files map[string][]byte
    times map[string]int64
}

func (m *MemFS) Vol() map[string][]byte { ... }   // copy under RLock
```

Two callers can safely share a `*MemFS` across goroutines because of the mutex; the §2 concurrency test exercises this.

#### 7.2 The five existing-file modes

Mirrors `ExistingShape` at `src/jostraca.ts:156-172`. Only the *first* applicable mode runs — TS evaluates them in this exact order; the Go port matches:

| Mode | Trigger | Behaviour | Output paths |
|---|---|---|---|
| `write` | default | overwrite existing path with new content | `target` |
| `preserve` | new content differs from existing | rename existing to `name.old.ext`, then write new to `target` | `target`, `name.old.ext` |
| `present` | new content differs from existing | leave existing untouched, write new to `name.new.ext` | `name.new.ext` |
| `diff` | new content differs from existing (text only) | render conflict-marker text from old vs new (§8.1), write to `name.diff.ext` | `name.diff.ext` |
| `merge` | new differs from existing AND a duplicate baseline exists in `.jostraca/generated/` | run 3-way merge (§8.2); on success write merged to `target`; on conflicts append conflict markers and write to `target` plus track in `Files.Conflicted` | `target` |

Equality short-circuit: when new content equals existing, the file is recorded in `Files.Unchanged` and nothing is written. Matches TS behaviour at `FileHandler.save`.

`JOSTRACA_PROTECT` sentinel: if the *existing* file contains the literal `# JOSTRACA_PROTECT` (or a comment-flavour equivalent), `save` no-ops and the path is added to `Files.Preserved`. Constant `protectMarker = "JOSTRACA_PROTECT"`. This implements the README "Protected Files" guarantee.

Binary vs text routing: `isbinext(path)` (§10) decides which `Existing.{Txt,Bin}` modes apply. Binary files do not support `diff` or `merge` regardless of options.

#### 7.3 `fileHandler` shape

```go
type fileHandler struct {
    fs       FS
    now      func() int64
    folder   string                    // canonical-/ output base
    when     int64
    audit    *Audit                    // shared with buildCtx
    existing Existing
    control  Control

    files       Files                  // accumulated outcome lists
    createdDirs map[string]struct{}    // mkdir dedupe

    bmeta           *buildMeta
    duplicateFolder func() string
    maxDepth        int                // path-depth safety cap
}

func newFileHandler(b *buildCtx, ex Existing, c Control) *fileHandler
```

Public surface (still lowercase — internal):

```go
func (fh *fileHandler) save(path string, content []byte, whence string) error
func (fh *fileHandler) copy(from, to string, whence string) error
func (fh *fileHandler) loadFile(path string, whence string) ([]byte, error)
func (fh *fileHandler) saveFile(path string, content []byte, whence string) error
func (fh *fileHandler) loadJSON(path string, v any) error
func (fh *fileHandler) saveJSON(path string, v any) error
func (fh *fileHandler) ensureFolder(path string) error
func (fh *fileHandler) ensureDir(dir string) error
func (fh *fileHandler) relative(path, whence string) string
func (fh *fileHandler) filelog(kind fileKind, path string)
```

`whence` strings (e.g. `"FileOp:after"`, `"CopyOp:before"`) appear in audit and error messages, matching `ON + FN` patterns at `src/op/FileOp.ts:7,22`. `relative` strips `fh.folder` prefix and forces forward slashes (matches TS `relative` and `fwd` at lines 24-26 and 110-124).

Path safety: `validPath(p)` checks `maxDepth` (default 22, matches TS line 84) and rejects empty paths. Returns `ErrInvalidPath` if violated.

#### 7.4 `buildMeta`

Mirrors `src/build/BuildMeta.ts` (107 lines):

```go
type buildMeta struct {
    fh    *fileHandler

    prev metaSnapshot
    next metaSnapshot
}

type metaSnapshot struct {
    Foldername string                        // ".jostraca"
    Filename   string                        // "jostraca.meta.log"
    Last       int64                         // epoch ms
    HLast      string                        // human-readable
    Files      map[string]map[string]any     // per-output-path metadata
}

func (m *buildMeta) load() error
func (m *buildMeta) add(file string, meta map[string]any)
func (m *buildMeta) done() error             // saves next; called at end of Generate
func (m *buildMeta) last() int64             // returns prev.Last for incremental builds
```

Persists JSON to `<folder>/.jostraca/jostraca.meta.log`. `done()` also writes `<folder>/.jostraca/.gitignore` containing `*` so the generator artifacts don't get committed accidentally — matches TS `BuildMeta.done` behaviour.

#### 7.5 `duplicateFolder`

When `Options.Control.Duplicate == true` (default), `fileHandler.save` writes a side-copy of every successful generation to:

```
<folder>/.jostraca/generated/<rpath>
```

These copies are the baseline for the *next* run's 3-way merge: `existing` is the user's current file on disk, `prev` is the duplicate from the last run, `new` is what we're about to generate. See §8.2.

`duplicateFolder()` is a small accessor on `buildCtx` returning `filepath.Join(fh.folder, ".jostraca", "generated")`.

#### 7.6 `save` algorithm sketch

```go
func (fh *fileHandler) save(path string, content []byte, whence string) error {
    p := fwd(filepath.Clean(path))
    if err := validPath(p); err != nil { return err }

    rpath := fh.relative(p, whence)
    isText := isTextContent(content, p)
    modes := fh.modesFor(isText)

    if !fh.fs.Exists(p) {
        return fh.write(p, content, rpath, whence)        // new file, simple write
    }

    existing, err := fh.fs.ReadFile(p)
    if err != nil { return err }

    if bytes.Contains(existing, []byte(protectMarker)) {
        fh.filelog(kindPreserved, rpath); return nil
    }

    if bytes.Equal(existing, content) {
        fh.filelog(kindUnchanged, rpath); return nil
    }

    switch {
    case modes.Merge && isText && fh.hasDuplicate(rpath):
        return fh.saveMerge(p, content, existing, rpath, whence)
    case modes.Diff && isText:
        return fh.saveDiff(p, content, existing, rpath, whence)
    case modes.Present:
        return fh.savePresent(p, content, rpath, whence)
    case modes.Preserve:
        return fh.savePreserve(p, content, existing, rpath, whence)
    case modes.Write:
        return fh.write(p, content, rpath, whence)
    default:
        fh.filelog(kindUnchanged, rpath); return nil
    }
}
```

`fh.write` also performs the duplicate-folder side-write when `Control.Duplicate` is on.

#### 7.7 Audit

Every action records `(tag, payload)` to `audit`:

```go
fh.audit.append("save", map[string]any{
    "path": rpath, "kind": "written", "size": len(content), "whence": whence,
})
```

Surfaced via `Result.Audit()`. Tag set: `save`, `copy`, `mkdir`, `preserve`, `present`, `diff`, `merge`, `conflict`, `protect`, `unchanged`.

#### 7.8 Cross-references

- §8 owns the diff and merge content rendering — `saveDiff` and `saveMerge` call into `diff.go` / `merge.go`.
- §9 has no direct interaction with FileHandler; `Content` rendering happens before content reaches the handler.
- §11 lists `filehandler_test.go` cases per mode plus a `MemFS` round-trip.

### 8. Diff & merge

Two distinct algorithms are needed: 2-way diff (rendering an annotated comparison file) and 3-way merge (combining a previous-generated baseline, a current-on-disk version, and a new generation). TS pulls these from `diff` and `node-diff3` (`src/build/FileHandler.ts:2-3`); the Go port uses one external library and one hand-port.

#### 8.1 2-way diff (`diff.go`)

**Library: `github.com/sergi/go-diff/diffmatchpatch`** in line mode. Stable, maintained, used widely (kubernetes, hashicorp).

The TS render format uses git-style conflict markers:

```
<<<<<<< GENERATED:
new content
=======
existing content
>>>>>>> EXISTING:
```

— wrapped per hunk. Equal lines pass through unchanged. The Go renderer produces byte-identical output for the same inputs. Implementation:

```go
func renderDiff(newContent, existing []byte) []byte {
    dmp := diffmatchpatch.New()
    a, b, lineArr := dmp.DiffLinesToChars(string(newContent), string(existing))
    diffs := dmp.DiffMain(a, b, false)
    diffs = dmp.DiffCharsToLines(diffs, lineArr)

    var buf bytes.Buffer
    for i := 0; i < len(diffs); {
        d := diffs[i]
        if d.Type == diffmatchpatch.DiffEqual {
            buf.WriteString(d.Text)
            i++
            continue
        }
        // Pair adjacent insert+delete into a conflict block.
        nIns, nDel := collectAdjacent(diffs, i)
        buf.WriteString("<<<<<<< GENERATED:\n")
        buf.WriteString(joinInserts(diffs[i : i+nIns+nDel]))
        buf.WriteString("=======\n")
        buf.WriteString(joinDeletes(diffs[i : i+nIns+nDel]))
        buf.WriteString(">>>>>>> EXISTING:\n")
        i += nIns + nDel
    }
    return buf.Bytes()
}
```

`saveDiff` (called from `fileHandler.save` per §7.6) writes the rendered output to `<base>.diff.<ext>` and records `Files.Diffed`. If the rendered content differs from the new content (i.e. a hunk was emitted), the file is also recorded in `Files.Conflicted`. Matches TS at `FileHandler.ts:257-262`.

Output naming follows TS:
- `.old.` — existing file backed up under `preserve` mode.
- `.new.` — new content written under `present` mode (existing left alone).
- `.diff.` — annotated diff under `diff` mode.
- Target path itself — written under `write` and `merge` modes.

The naming helper:

```go
func annotatedPath(target, kind string) string {
    // target=foo/bar.txt, kind=".old."  →  foo/bar.old.txt
    dir, base := filepath.Split(target)
    ext := filepath.Ext(base)
    name := base[:len(base)-len(ext)]
    return dir + name + "." + kind + ext[1:]
}
```

#### 8.2 3-way merge (`merge.go`) — hand-ported `node-diff3`

The TS source uses `node-diff3` which implements Hunt–McIlroy LCS plus the diff3 reconciliation algorithm. No actively maintained Go diff3 library exists (`dsnet/diff3` is unmaintained and pre-modules; sergi's library is 2-way only). The user accepted "Port node-diff3 in v1" — so we hand-port it.

##### Scope

`node-diff3`'s public surface used by jostraca is `diff3Merge(a, o, b)` (called at `FileHandler.ts:300-304` as `this.merge(newContent, prevGenContent, currentContent, why)`). Internally that consumes:

- `LCS` — longest common subsequence (Hunt–McIlroy).
- `diffPatch` — patch model on top of LCS.
- `diff3MergeRegions` — three-way region splitter (the algorithm proper).
- `diff3Merge` — wraps regions into a `{ok, conflict}[]` array.

Token model: line-based by default (newline-split). For text files this matches TS behaviour.

##### Layout

```go
// merge.go

type mergeResult struct {
    Content  []byte
    Conflict bool
}

func merge3(newContent, prevGen, existing []byte) mergeResult {
    aLines := splitLines(string(newContent))
    oLines := splitLines(string(prevGen))
    bLines := splitLines(string(existing))

    regions := diff3Regions(aLines, oLines, bLines)
    return assembleRegions(regions, aLines, bLines)
}

// Internal:
type region struct {
    Ok       []string             // non-conflict region (from a or b, identical)
    Conflict *conflictRegion      // populated only when ok == nil
}
type conflictRegion struct {
    A []string                    // "GENERATED" side
    O []string                    // baseline (prev gen)
    B []string                    // "EXISTING" on-disk side
}

func diff3Regions(a, o, b []string) []region {
    aPatches := patchFrom(lcs(o, a))
    bPatches := patchFrom(lcs(o, b))
    return reconcile(aPatches, bPatches, a, o, b)
}

func lcs(x, y []string) lcsTable      { ... }    // Hunt-McIlroy
func patchFrom(t lcsTable) []hunk     { ... }
func reconcile(a, b []hunk, ...) []region { ... }
```

Total expected size: ~400 lines. Pure stdlib (`strings`, `slices`).

##### Conflict assembly

Non-conflict regions concatenate verbatim. Conflict regions emit:

```
<<<<<<< GENERATED:
{a-side lines}
||||||| BASELINE:
{o-side lines}
=======
{b-side lines}
>>>>>>> EXISTING:
```

Three-way markers (with `|||||||` baseline) match the format TS produces. Tests in §8.4 verify byte-equality.

##### Acceptance criteria

The `test/merge.test.ts` file in the TS repo encodes the corpus. Each case is a 4-tuple `(new, prev, existing, expected)` plus a `conflict bool`. Port these as JSON files under `go/testdata/merge/`:

```
testdata/merge/
  basic_clean.json          # no conflicts
  basic_conflict.json       # both sides changed same line
  insertion_a.json          # only A inserted
  insertion_b.json          # only B inserted
  deletion_both.json        # both sides deleted same line
  shared_change.json        # A == B != O
  ...
```

`merge_test.go` loads each file, runs `merge3`, and asserts byte-equal output and conflict flag. Goal: every TS `merge.test.ts` case passes.

##### Implementation order

1. `splitLines` + `lcs` (Hunt–McIlroy table) — testable in isolation against goldens.
2. `patchFrom` (turn LCS into a list of `(insert, delete, range)` hunks).
3. `reconcile` (the three-way region algorithm).
4. `assembleRegions` (region → bytes with conflict markers).
5. `merge3` thin wrapper.
6. Wire into `fileHandler.saveMerge`.

Risk control: each step lands behind unit tests against fixtures from the TS corpus before the next step starts. The §15 risks section flags this as the largest correctness risk.

#### 8.3 Wiring into `fileHandler`

`saveDiff` and `saveMerge` are called from §7.6's `save` switch:

```go
func (fh *fileHandler) saveDiff(p string, newContent, existing []byte, rpath, whence string) error {
    rendered := renderDiff(newContent, existing)
    out := annotatedPath(p, "diff")
    if err := fh.fs.WriteFile(out, rendered); err != nil { return err }
    fh.filelog(kindDiffed, fh.relative(out, whence))
    if !bytes.Equal(rendered, newContent) {
        fh.filelog(kindConflicted, rpath)
    }
    fh.audit.append("diff", map[string]any{"path": rpath, "out": fh.relative(out, whence)})
    return nil
}

func (fh *fileHandler) saveMerge(p string, newContent, existing []byte, rpath, whence string) error {
    dpath := filepath.Join(fh.duplicateFolder(), rpath)
    if !fh.fs.Exists(dpath) {
        return nil                          // no baseline → skip merge silently (matches TS)
    }
    prev, err := fh.fs.ReadFile(dpath)
    if err != nil { return err }

    res := merge3(newContent, prev, existing)
    if err := fh.fs.WriteFile(p, res.Content); err != nil { return err }
    fh.filelog(kindMerged, rpath)
    if res.Conflict { fh.filelog(kindConflicted, rpath) }
    fh.audit.append("merge", map[string]any{"path": rpath, "conflict": res.Conflict})
    return nil
}
```

Both side-write a duplicate to `.jostraca/generated/<rpath>` when `Control.Duplicate` is true.

#### 8.4 Tests

- `diff_test.go` — fixtures `testdata/diff/case_*.txt` containing `--- new` / `--- existing` / `--- expected` blocks. Round-trip `renderDiff` and assert byte-equal expected.
- `merge_test.go` — load every `testdata/merge/*.json`, call `merge3`, assert `bytes.Equal(out.Content, want.Content)` and `out.Conflict == want.Conflict`. Active in v1 (the user opted into porting diff3).
- Both files use `//go:embed testdata` so the corpus travels with the package.

#### 8.5 Cross-references

- §7.6's `save` switch dispatches `Diff` and `Merge` to `saveDiff` / `saveMerge` here.
- §11 enumerates the test cases mirrored from `test/merge.test.ts`.
- §15 calls out diff3 correctness as the highest-risk porting subtask.

### 9. Template — close TS gaps in `template.go`

The current Go `Template()` covers the basic `$$path$$` substitution + simple replace + literal eject. TS's `template()` (`src/util/basic.ts:360-581`, ~220 lines) is much richer. This section enumerates each missing feature with the source of truth in TS and the Go-specific implementation note.

#### 9.1 Updated `TemplateSpec`

```go
type TemplateSpec struct {
    // Existing fields (kept).
    Replace map[string]any                  // string|TemplateReplaceFunc|literal regex /.../
    Eject   any                              // [2]string | [2]any{string|*regexp.Regexp}

    // New fields (this section).
    Open   string                            // default `\$\$`
    Close  string                            // default `\$\$`
    Ref    string                            // default `[^$]+`
    Insert *regexp.Regexp                    // pre-compiled override of the assembled regex
    Handle func(string)                      // streaming callback; if set, Template returns ""
}

type TemplateReplaceFunc = ReplaceFunc       // existing alias kept for back-compat
```

`ParseTemplateSpec` (existing, `template.go:30-57`) extends to validate all new fields against an updated `shape` schema.

#### 9.2 Feature gaps — one entry per missing capability

##### 1. Custom delimiters (`Open`/`Close`/`Ref`)

TS at `src/util/basic.ts:404-406`:
```ts
let open  = null == spec?.open  ? '\\$\\$'  : spec.open
let close = null == spec?.close ? '\\$\\$'  : spec.close
let ref   = null == spec?.ref   ? '[^$]+'   : spec.ref
```

Go: thread these into the regex builder. Use named capture groups `(?P<J_O>open)(?P<J_R>ref)(?P<J_C>close)` exactly mirroring TS lines 431-433. Group names are RE2-compatible (`(?P<...>)` is the Go syntax; rewrite TS's `(?<...>)` form when accepting user regexes).

##### 2. Named-group rewriting in user-supplied regex keys

TS at `:454`:
```ts
.replace(/\(\?<([\w\d_]+)>/g, (_, p1) => `(?<J_N${ngI++}_${p1}>`)
```

When a user provides a key like `/(?<foo>\w+)/`, the inner group name `foo` is renamed to `J_N{n}_foo` to avoid collisions with template-internal names. Go uses `(?P<...>)` so the rewrite regex differs:

```go
var userGroupRE = regexp.MustCompile(`\(\?P<([\w\d_]+)>`)
func renameUserGroups(src string, counter *int) (string, []string)
```

The function returns rewritten regex source plus the list of original→rewritten name pairs so `groups` exposed to the `ReplaceFunc` callback can be presented under their original names.

**`groups["$&"]` for full match** (Phase 3 implementation note). Before
invoking the user callback, every internal group name (`J_K<n>_x`,
`J_T<n>_x`, `J_N<n>_x`) is stripped to its bare form, and an extra
`groups["$&"]` is added holding the full match. This matches TS test
fixtures that use `g['$&']` (a JS regex-replace convention).

##### 3. `#Tag` and `#Tag-Name` matching

TS at `:460-468` parses `#Foo` and `#Foo-Bar` keys and synthesises a regex of the form:

```
(?P<J_N{n}_indent>[ \t]*)//[ \t]*#(?P<J_T{n}_TAG>[A-Za-z0-9]+)(-(?P<J_N{n}_TAG>...))?[ \t]*\n?
```

Go regex string built by `buildTagRegex(key string, counter *int) string`. The replace function receives:
- `groups["indent"]` — leading whitespace
- `groups["TAG"]` — tag identifier (or full match)
- `groups["name"]` — alias to the inner identifier when `#Tag-Name` form is used

**Internal-group naming convention** (Phase 3 implementation note).
The synthesised regex distinguishes two prefixes:
- `J_T<n>_<canon>` — the **outer wrapper** group; matching it triggers
  the user's `ReplaceFunc` for `<canon>`.
- `J_N<n>_<name>` — **informational** subgroups (`indent`, `TAG`, the
  identifier capture for `#Foo-Bar`). These never trigger dispatch.
This split keeps dispatch deterministic when both wrapper and inner
match simultaneously.

##### 4. `__JOSTRACA_REPLACE__` sentinel

TS at `:512-514`:
```ts
else if ('__JOSTRACA_REPLACE__' === ref) {
  insert = '' + insertRE
}
```

When `ref` (the captured `J_R` group) equals `__JOSTRACA_REPLACE__`, return the literal source of the compiled regex. Used for debugging/inspection. Go: stash the compiled regex's `String()` into the substitution path.

##### 5. Quoted ref `$$"foo"$$`

TS at `:508-511`:
```ts
const qm = ref.match(/^"(.+)"$/)
if (qm) { insert = qm[1] }
```

Go already has this for the literal-quoted form; extend the existing implementation in `template.go:85-87` to recognise the same pattern when delimiters are customised.

##### 6. Function-valued model refs

TS allows `getx(model, 'foo.bar')` to resolve to a function and call it. Go's existing `lookup` returns the value as-is; extend to detect `func() any` and invoke it:

```go
case func() any: return v(), true
case func() string: return v(), true
```

##### 7. JSON-stringification for non-string values

TS coerces objects/arrays via `String(value)` which JSON-stringifies for plain objects. Go's existing `default: return fmt.Sprintf("%v", v)` produces Go-syntax output that won't round-trip. Replace with:

```go
default:
    b, err := json.Marshal(v)
    if err != nil { return fmt.Sprintf("%v", v) }
    return string(b)
```

##### 8. Custom `Handle` callback

TS at `:485-491`:
```ts
const hasCustomHandle = null != spec?.handle
let handle = hasCustomHandle ? spec!.handle! : ((s: string) => parts.push(...))
```

When `Handle` is set, the engine streams each segment (text-between-matches and replacement-output) to the callback and returns `""`. Used by `Fragment` (§5) to intercept output and route into child `Content` nodes.

Go: branch the writer:

```go
var out strings.Builder
write := func(s string) { out.WriteString(s) }
if spec != nil && spec.Handle != nil {
    write = spec.Handle
}
// ... loop emits via write(...)
if spec != nil && spec.Handle != nil { return "", nil }
return out.String(), nil
```

##### 9. Eject regex variant

TS at `:379-401` accepts either string or `RegExp` for both eject markers. Go currently only accepts `[2]string`. Update `Eject` to `any` and dispatch:

```go
func compileEject(v any) (*regexp.Regexp, error)   // string → cached compile, *regexp.Regexp → return
```

`TemplateSpec.Eject` becomes `any` (covering `[2]string`, `[2]any{string,string}`, `[2]any{string,*regexp.Regexp}`, etc.).

##### 10. Empty-match guard

TS at `:537`:
```ts
if ('' === ref) {
  throw new Error('Regular expression matches empty string: ' + insertRE)
}
```

Critical for not entering an infinite loop when a user-supplied regex matches empty. Go: detect when `ReplaceAllStringFunc`'s match is the empty string and `r.err = ErrEmptyMatchRegex` (per §4.6 sentinel), abort.

##### 11. Regex LRU cache (cap 100)

TS at `:351-352`:
```ts
const templateRECache = new Map<string, { re: RegExp, canonKeys: [string, string][] }>()
const TEMPLATE_RE_CACHE_MAX = 100
```

Go: `package`-level `sync.Map` plus an LRU bound. The simplest-correct implementation:

```go
type templateCacheEntry struct {
    re        *regexp.Regexp
    canonKeys [][2]string
}
var (
    templateCacheMu  sync.Mutex
    templateCache    = make(map[string]*templateCacheEntry, templateCacheMax)
)
const templateCacheMax = 100

func cachedTemplateRE(key string, build func() *templateCacheEntry) *templateCacheEntry {
    templateCacheMu.Lock(); defer templateCacheMu.Unlock()
    if e, ok := templateCache[key]; ok { return e }
    if len(templateCache) >= templateCacheMax {
        for k := range templateCache { delete(templateCache, k); break }   // FIFO eviction; matches TS clear-all
    }
    e := build()
    templateCache[key] = e
    return e
}
```

Cache key matches TS at `:415-416`: `open + "\x00" + close + "\x00" + ref + "\x00" + strings.Join(sortedReplaceKeys, "\x00")`.

##### 12. Eject regex cache

TS at `:355`:
```ts
const ejectRECache = new Map<string, RegExp>()
```

Same shape as 11; smaller (no replace-key sorting needed).

##### 13. Replace-key ordering

TS at `:437-439`:
```ts
.sort((a, b) => a.startsWith('#') ?
  (a.includes('-') ? b.includes('-') ? b.length - a.length : -1 : b.length - a.length) :
  b.length - a.length)
```

Tag-prefixed keys (`#Foo`) come first, then by descending length. Without this, multi-key patterns produce non-deterministic output. Go: a custom `sort.Slice` matching the comparator exactly.

##### 14. `indent()` helper

TS at `src/util/basic.ts:594-601`:
```ts
function indent(src: string, indent: any) {
  const ind = 'number' === typeof indent ? ' '.repeat(indent) : '' + (indent || '')
  return src.replace(/(?<=\n)/g, ind)
}
```

The lookbehind `(?<=\n)` is JS-style — RE2 doesn't support lookbehind. Go equivalent is a simple replace:

```go
func Indent(src string, indent any) string {
    var ind string
    switch v := indent.(type) {
    case nil:    return src
    case int:    ind = strings.Repeat(" ", v)
    case string: ind = v
    default:     ind = fmt.Sprint(v)
    }
    if ind == "" || src == "" { return src }
    return strings.ReplaceAll(src, "\n", "\n"+ind)
}
```

Lives in `util.go` (§10), referenced by `Content`, `Fragment`, and `Line`.

#### 9.3 RE2-vs-PCRE caveat

Go's `regexp` package is RE2: no backreferences, no lookahead, no lookbehind. Almost all of TS's template regex usage is RE2-compatible (linear, non-recursive). The two exceptions:

- The `indent` lookbehind — replaced with `strings.ReplaceAll` (above).
- User-supplied regex keys may contain `(?=...)` or `(?<=...)`. Detect at compile time and return `ErrLookbehind` (§4.6) with a clear message:
  ```
  jostraca: lookbehind not supported (RE2): /(?<=foo)bar/
  ```

The detection regex:
```go
var unsupportedLookRE = regexp.MustCompile(`\(\?<?[=!]`)
```
Run on the source before passing to `regexp.Compile`. Document the constraint in `template.go` doc comments and `go/README.md`.

#### 9.4 `template_test.go` corpus

The TS `test/template.test.ts` has 35+ cases covering every feature above. Port each as a row in a Go table-driven test:

```go
var templateCases = []struct {
    name    string
    src     string
    model   any
    spec    *TemplateSpec
    want    string
    wantErr error
}{
    {"basic", "a$$b.c$$d", map[string]any{"b": map[string]any{"c": "X"}}, nil, "aXd", nil},
    {"quoted", "$$\"hi\"$$", nil, nil, "hi", nil},
    {"tag #Foo", "  // #Foo\n", ..., specWithTagReplace, "...", nil},
    {"empty regex", "x", nil, &TemplateSpec{Replace: map[string]any{"/Q*/": "z"}}, "", ErrEmptyMatchRegex},
    {"lookbehind reject", "x", nil, &TemplateSpec{Replace: map[string]any{"/(?<=a)b/": "Z"}}, "", ErrLookbehind},
    // ...
}
```

Existing tests in `template_test.go` stay (basic, replace+eject, ParseTemplateSpec); new cases append.

#### 9.5 Cross-references

- §5 `Content` and `Fragment` consume `Template`; their feature parity hinges on this section.
- §10 `Indent` ports to `util.go`.
- §4.6 owns `ErrEmptyMatchRegex` and `ErrLookbehind`.

### 10. Utilities to port

Most utilities live in `util.go` and have direct Go equivalents. The exceptions (`each`, `getx`, `humanify`, `dlog`, `deep`) need careful design because they straddle TS's value-polymorphism in ways Go's type system doesn't support natively.

#### 10.1 Port table

| TS name | Go name | TS source | Strategy |
|---|---|---|---|
| `each` | `Each` | `basic.ts:7-107` | Reflection-based; see §10.2 |
| `get` | `Get` | `:271-278` | Direct: dot-path lookup over `map[string]any`/`[]any` |
| `getx` | `GetX` | `:128-268` | Hand-port the parser (160 LoC); see §10.3 |
| `camelify` | `Camelify` | `:281-286` | Direct: parts → join with capitalisation |
| `snakify` | `Snakify` | `:297-302` | Direct |
| `kebabify` | `Kebabify` | `:289-294` | Direct |
| `partify` | `Partify` | `:316-326` | Direct: regex-split on `[-_]` and camelCase boundaries |
| `lcf` | `LCF` | `:310-313` | One-liner |
| `ucf` | `UCF` | `:304-307` | One-liner |
| `names` | `Names` | `:329-342` | Mutate input map, populate `name`/`Name`/`name__` variants |
| `escre` | `EscRE` | `:345` | `regexp.QuoteMeta` |
| `idenstr` | `idenstr` (unexported) | `:346` | Internal helper for template engine |
| `indent` | `Indent` | `:594-601` | See §9 #14 (lookbehind workaround) |
| `isbinext` | `IsBinExt` | `:716-721` | Constant set + `filepath.Ext` |
| `cmap` | `CMap` | `:605-623` | Reflection-based map transform; see §10.4 |
| `vmap` | `VMap` | `:627-645` | Reflection; flattens to slice |
| `humanify` | `Humanify` | `:648-682` | Direct port using `time.Time`; see §10.5 |
| `getdlog` | `newDLog` (unexported) → `DLog` (exported entry) | `:685-704` | Package-level slice + mutex; see §10.6 |
| `template` | `Template` | `:360-581` | Owned by §9 |
| `deep` (jsonic) | `Deep` | jsonic util | ~30 LoC port; see §10.7 |
| `omap` (jsonic) | `OMap` | jsonic util | Small port; see §10.7 |

Deferred:

| TS name | Reason | Future home |
|---|---|---|
| `Point` / `RootPoint` / `SerialPoint` / `ParallelPoint` / `FuncPoint` / `PrintPoint` | Not used by core (`grep PointUtil` shows only re-export and a single test reference) — orchestration utility piggybacking on the package | `go/point/` sub-package, post-v1 |
| `select` | Trivial helper not used inside core | Skip; users can write `if`/`switch` |
| `getCachedEjectRE` | Internal to template; folded into §9 cache | n/a |

#### 10.2 `Each` (reflection-based)

TS `each` accepts arrays, plain objects, or scalars and produces a transformed array. Spec includes `mark` (add `index$`/`key$` annotations), `oval` (wrap scalars), `sort`, `call` (invoke if function), `args` (passed to call). Mirror via reflection so the user-facing API doesn't fragment into 4 functions:

```go
type EachSpec struct {
    Mark bool   // reserved for future TS parity; not consumed in v1
    Raw  bool   // default false → annotated; explicit true → raw items
    Sort bool
    Args any
}

func Each(subject any, spec EachSpec, apply func(any) any) []any
```

**Phase 4 implementation note.** The plan originally listed `OVal bool`
matching TS's default `oval: true`. Go's zero-value semantics make it
impossible to distinguish "OVal unset" from "OVal=false" without
`*bool`, so the field was inverted to `Raw` — default zero means
annotated (matches TS default), explicit `Raw: true` means pass-through.
Behaviour for end users is identical to TS; the field name differs.

**TS overload coverage via narrower Go variants.** Go has no function
overloading, so the TS overloaded callback shapes (`each(items, fn)`,
`each(items, (val, key, idx) => ...)`, etc.) are reachable through
named variants that wrap `Each`:

- `EachF(items, func(val any) any)` — pure transform, no annotation.
- `EachI(items, func(val any, idx int) any)` — slice with index.
- `EachKV(m, func(val any, key string, idx int) any)` — map with
  wrapped value, key, and 0-based index. Mirrors the
  `test/utility.test.ts:55-58` corpus row.
- `EachKVRaw(m, ...)` — same shape, raw value instead of wrapper.

Pattern applied to other TS-overloaded entry points:

- `GetXS(root, path string)` and `GetXPath(root, tokens []string)`
  alongside the polymorphic `GetX(root, path any)`.
- `TemplateF(src, model)` and `TemplateR(src, replace)` alongside
  the full `Template(src, model, spec)`.
- `NamesP(base, name, prop)` alongside `Names(base, name, prop ...string)`.
- `HumanifyDigits(when)`, `HumanifyParts(when)`, `HumanifyTerse(when)`
  alongside `Humanify(when, HumanifyFlags{...})` — typed return shapes
  remove the `.(int64)` / `.(map[string]any)` assertions.

Implementation (sketch):

```go
func Each(subject any, spec EachSpec, apply func(any) any) []any {
    if subject == nil { return nil }
    out := make([]any, 0)
    rv := reflect.ValueOf(subject)
    switch rv.Kind() {
    case reflect.Slice, reflect.Array:
        for i := 0; i < rv.Len(); i++ {
            item := rv.Index(i).Interface()
            if spec.Mark { item = annotateIndex(item, i) }
            out = append(out, applyOne(item, spec, apply))
        }
    case reflect.Map:
        keys := mapKeys(rv, spec.Sort)
        for _, k := range keys {
            v := rv.MapIndex(k).Interface()
            if spec.Mark { v = annotateKey(v, k.String()) }
            out = append(out, applyOne(v, spec, apply))
        }
    default:
        // Scalars: optionally wrap (oval), then apply once.
        item := subject
        if spec.OVal { item = map[string]any{"val$": subject} }
        out = append(out, applyOne(item, spec, apply))
    }
    return out
}
```

Performance note flagged in §15: reflection is slow vs. typed iteration. Hot internal callsites (op loops walking `Node.Children`) use a typed helper `iterChildren(*Node, func(*Node))` directly — reflection-based `Each` is only on the user-facing API.

#### 10.3 `GetX`

The trickiest util: 140 lines of parser implementing dot navigation, ancestry (`a:b`), filters (`a = value`, `a ~ /regex/`, `? filter`). The TS implementation has `GETX_TOKEN_RE` at `:120` and a hand-rolled state machine.

Strategy: port test-first against the `utility.test.ts` corpus. Each TS test case becomes a Go test row, and the parser is built incrementally until all rows pass. The expected hand-port size is ~180 LoC of Go.

Public surface:

```go
func GetX(root any, path string) any
```

Returns `nil` on miss. Operators supported (matching TS):
- `a.b` and `a b` — navigation
- `a:b` — ancestry (skip-up)
- `a = value` — filter equality
- `a ~ /regex/` — filter regex match
- `? expr` — array filter

#### 10.4 `CMap` and `VMap`

TS `cmap`/`vmap` have sentinel constants `cmap.COPY`, `cmap.FILTER`, `cmap.KEY`. Replicate via a small set of typed sentinels:

```go
type cmapSentinel int

const (
    CMapCopy   cmapSentinel = iota   // pass-through unchanged
    CMapFilter                        // drop entry
    CMapKey                           // current key (used in transform fn)
)

func CMap(o any, p func(key string, val any) any) map[string]any
func VMap(o any, p func(key string, val any) any) []any
```

Lower-priority — used only by downstream consumers, never by core. Lands in v1 because cost is small (~40 LoC each).

#### 10.5 `Humanify`

TS `humanify(when, {parts, sep})` formats an epoch ms into `YYYY-MM-DDTHH:MM:SS.mmmZ` or returns parts. Direct Go port using `time.Time`:

```go
type HumanifyFlags struct {
    Parts bool
    Sep   string
}

func Humanify(when int64, flags HumanifyFlags) any
```

Returns either a `string` or a `map[string]string` of named parts (`year`, `month`, ..., `tz`) depending on `flags.Parts`. ~40 LoC.

#### 10.6 `DLog`

TS `getdlog` stores entries on `global.__dlog__` so multiple modules share a single log. Go uses a package-level slice with a mutex:

```go
type dLogEntry struct {
    Tag      string
    File     string
    When     int64
    Args     []any
    Stack    string
}

var (
    dLogMu      sync.Mutex
    dLogEntries []dLogEntry
)

type dLog struct {
    tag, file string
}

func newDLog(tag, file string) *dLog
func (d *dLog) Log(args ...any)                         // append entry
func (d *dLog) Entries(filterFile string) []dLogEntry   // read filtered
```

The single-package-scope log replaces `global.__dlog__` from `basic.ts:686-688`. Internal callers use `newDLog`; `Generate` flushes the log at end-of-call into `Options.Log.Debug`, mirroring the TS pattern at `src/jostraca.ts:301-306`.

#### 10.7 `Deep` and `OMap` (jsonic ports)

TS uses `jsonic.util.deep` for deep-merge of plain maps/slices and `jsonic.util.omap` for ordered-map operations.

`Deep`: ~30 LoC, recursive merge with right-precedence:

```go
func Deep(dst any, srcs ...any) any
```

Used in `src/jostraca.ts:208-256` to merge global vs per-call options. Go port handles `map[string]any` and `[]any` heterogeneously; non-map/slice values right-wins.

**Phasing note.** Phase 1's `mergeOptions` ships as a shallow scalar merge
(call-side non-zero overrides global, maps are wholesale-replaced).
Once `Deep` lands here in Phase 4, `mergeOptions` switches to using it
for `Model` and `Meta` deep-merging, matching TS `deep(...)` behaviour
at `src/jostraca.ts:208-256`.

`OMap`: small order-preserving map helper used by some downstream consumers. Skip if unused after `grep` confirms — but the cost of porting is ~15 LoC, so include for parity.

#### 10.8 `util.go` layout

```go
// util.go (alphabetic ordering preferred, but related helpers cluster)

func Camelify(input any) string
func Deep(dst any, srcs ...any) any
func Each(subject any, spec EachSpec, apply func(any) any) []any
func EscRE(s string) string
func Get(root any, path string) any
func GetX(root any, path string) any
func Humanify(when int64, flags HumanifyFlags) any
func Indent(src string, indent any) string
func IsBinExt(path string) bool
func Kebabify(input any) string
func LCF(s string) string
func Names(base map[string]any, name, prop string) map[string]any
func OMap(...) ...
func Partify(input any) []string
func Snakify(input any) string
func UCF(s string) string
func CMap(o any, p func(key string, val any) any) map[string]any
func VMap(o any, p func(key string, val any) any) []any

// Internal:
var binaryExts map[string]struct{}
func idenstr(s string) string
type dLog struct{...}
var ( dLogMu sync.Mutex; dLogEntries []dLogEntry )
```

Each public utility has a unit-test row in `util_test.go` ported from `test/utility.test.ts`.

#### 10.9 Cross-references

- §5 components rely on `Each` (List), `Indent` (Content/Fragment/Line).
- §7 file handling uses `IsBinExt`, `Humanify` (BuildMeta `hlast`).
- §9 template engine uses `idenstr`, `EscRE`, regex caches share the locking pattern from §10.6.

### 11. Test strategy

#### 11.1 Principles

- **Mirror, don't transliterate.** Each TS test file maps to a Go test file with the same case names; the *cases* port row-by-row, but the harness uses Go idioms (`testing.T`, table-driven, `go-cmp`) instead of recreating the TS `expect.ts` helper.
- **Black-box where possible.** Tests live in `package jostraca` so they can access internals when it simplifies assertions, but every public-API test treats the package as a black box and exercises behaviour through `New(...).Generate(...)`.
- **Goldens travel with the package.** Multi-line/multi-byte fixtures (templates, fragments, merge corpus) live under `go/testdata/` and are loaded via `//go:embed`. Avoids retyping kilobyte string literals and keeps diffs reviewable.
- **No flaky time/log assertions.** Tests inject `WithNow(func() int64 { return 1700000000_000 })` and a buffered `Log`; never depend on wall-clock or stderr ordering.

#### 11.2 Test file layout

| TS source | Go destination | Cases | Active in v1? |
|---|---|---|---|
| `test/jostraca.test.ts` | `jostraca_test.go` | end-to-end, Project/Folder/File trees, MemFS, vol JSON snapshot | yes |
| `test/template.test.ts` | `template_test.go` (extends existing) | 35+ rows for §9 features | yes |
| `test/utility.test.ts` | `util_test.go` | every utility from §10 | yes |
| `test/control.test.ts` | `control_test.go` | dryrun, version, exclude | yes |
| `test/merge.test.ts` | `merge_test.go` | every merge case | yes (merge ships in v1) |
| `test/point.test.ts` | — | Point omitted | no |
| `test/expect.ts` | — | replaced by `go-cmp` | no |
| (none) | `concurrency_test.go` | new — 10-goroutine isolation | yes |
| (none) | `filehandler_test.go` | per-mode isolation tests | yes |
| (none) | `diff_test.go` | 2-way render goldens | yes |
| (none) | `fs_test.go` | OsFS + MemFS sanity | yes |
| (none) | `builder_test.go` | per-component node-tree shape assertions | yes |

#### 11.3 Tooling

- **Stdlib `testing`** for the runner; `go test ./...`.
- **`github.com/google/go-cmp/cmp`** for deep-equal assertions. Replaces TS `expect`. Test-only dependency.
- **`testing/iotest`** where streaming is involved.
- **`//go:embed testdata/...`** for fixture loading.
- **`-race`** is mandatory for `concurrency_test.go`; CI runs `go test ./... -race -count=1`.

No `testify`, no `gomega`. The stdlib + `go-cmp` is enough.

#### 11.4 Table-driven pattern

Every Go test file uses table rows where TS uses `it("...", () => ...)`:

```go
func TestTemplate(t *testing.T) {
    cases := []struct {
        name    string
        src     string
        model   any
        spec    *TemplateSpec
        want    string
        wantErr error
    }{
        {"basic", "a$$b.c$$d", map[string]any{"b": map[string]any{"c": "X"}}, nil, "aXd", nil},
        {"quoted", `$$"hi"$$`, nil, nil, "hi", nil},
        // ... ~35 rows
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got, err := Template(tc.src, tc.model, tc.spec)
            if tc.wantErr != nil {
                if !errors.Is(err, tc.wantErr) {
                    t.Fatalf("err = %v, want %v", err, tc.wantErr)
                }
                return
            }
            if err != nil { t.Fatal(err) }
            if diff := cmp.Diff(tc.want, got); diff != "" {
                t.Errorf("(-want +got):\n%s", diff)
            }
        })
    }
}
```

Case names match TS test names verbatim where possible — this makes it obvious which TS case maps to which Go subtest when debugging.

#### 11.5 `testdata/` layout

```
go/testdata/
  merge/                                        # JSON corpus from test/merge.test.ts
    basic_clean.json                            # {new, prev, existing, want, conflict:false}
    basic_conflict.json
    insertion_a.json
    ...                                         # one per TS case
  diff/                                         # 2-way diff goldens
    case_simple.txt                             # multi-section (--- new / --- existing / --- expected)
    ...
  fixtures/                                     # files used by Fragment, Copy
    template.html
    snippet.go
    assets/                                     # directory copied by CopyOp tests
      a.txt
      ~b.tmp                                    # confirms Ignore default ignores ~$
  parity/                                       # vol.toJSON snapshots from TS happy paths
    quickstart.json
    ...
```

JSON corpus loader:

```go
//go:embed testdata
var testFS embed.FS

func loadMergeCase(name string) mergeCase {
    b, err := testFS.ReadFile("testdata/merge/" + name)
    if err != nil { panic(err) }
    var c mergeCase
    if err := json.Unmarshal(b, &c); err != nil { panic(err) }
    return c
}
```

#### 11.6 The headline concurrency regression

`concurrency_test.go` proves the receiver-shadowing approach (§2) isolates state across goroutines:

```go
func TestGenerateConcurrent(t *testing.T) {
    const N = 10
    var wg sync.WaitGroup
    results := make([]Result, N)
    errs := make([]error, N)

    for i := 0; i < N; i++ {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            j := New(WithMem())
            results[i], errs[i] = j.Generate(Options{}, func(j *J) {
                j.Project(ProjectProps{Folder: fmt.Sprintf("p%d", i)}, func(j *J) {
                    j.File(fmt.Sprintf("f%d.txt", i), func(j *J) {
                        j.Content(fmt.Sprintf("body-%d\n", i))
                    })
                })
            })
        }()
    }
    wg.Wait()

    for i := 0; i < N; i++ {
        if errs[i] != nil { t.Errorf("[%d] err: %v", i, errs[i]) }
        vol := results[i].Vol()
        wantPath := fmt.Sprintf("p%d/f%d.txt", i, i)
        wantBody := fmt.Sprintf("body-%d\n", i)
        if string(vol[wantPath]) != wantBody {
            t.Errorf("[%d] vol[%q] = %q, want %q", i, wantPath, vol[wantPath], wantBody)
        }
        // Crucially: verify no cross-contamination from other goroutines.
        for j := 0; j < N; j++ {
            if i == j { continue }
            otherPath := fmt.Sprintf("p%d/f%d.txt", j, j)
            if _, leaked := vol[otherPath]; leaked {
                t.Errorf("[%d] saw foreign path %q", i, otherPath)
            }
        }
    }
}
```

Run with `-race`. The TS suite has no analogue because Node single-threads JS; this is a parity *gain*, not a parity match.

#### 11.7 Per-component test files

`builder_test.go` validates the node tree shape produced by each component without running the build phase:

```go
func TestBuilderProjectShape(t *testing.T) {
    j := New()
    var got *Node
    _, _ = j.Generate(Options{Build: ptr(false)}, func(j *J) {
        j.Project(ProjectProps{Folder: "x"}, func(j *J) {
            j.Folder("a", func(j *J) { j.File("b.txt", func(j *J) { j.Content("hi") }) })
        })
        got = j.st.root      // accessible because test in same package
    })

    want := &Node{Kind: KindProject, Folder: "x", Children: []*Node{
        {Kind: KindFolder, Name: "a", Children: []*Node{
            {Kind: KindFile, Name: "b.txt", Children: []*Node{
                {Kind: KindContent, Content: []string{"hi"}},
            }},
        }},
    }}
    if diff := cmp.Diff(want, got, ignoreNoiseFields); diff != "" {
        t.Errorf("(-want +got):\n%s", diff)
    }
}
```

`ignoreNoiseFields` is a `cmp.Option` filtering out `Path`, `Meta`, `FullPath` so the test asserts only the structural shape.

#### 11.8 `filehandler_test.go` cases (one per mode)

- `write` — overwrites existing file, records in `Files.Written`.
- `preserve` — backs up to `.old.`, writes new, both lists populated.
- `present` — leaves existing alone, writes `.new.`.
- `diff` — produces `.diff.` with conflict markers; `Files.Diffed` and `Files.Conflicted` populated when content differs.
- `merge` — when duplicate baseline exists, runs `merge3` and writes target; conflict cases populate `Files.Conflicted`.
- `protect` — `JOSTRACA_PROTECT` content prevents overwrite.
- `unchanged` — equal new/existing leaves file alone, populates `Files.Unchanged`.

Each case uses `MemFS` to set up the existing state, then asserts the post-state and `Files.*` outcome lists.

#### 11.9 Parity snapshots

The TS test suite has happy-path scenarios that produce a known `vol.toJSON()`. We capture those as `testdata/parity/*.json`:

```json
{
  "name": "quickstart",
  "options": {"folder": "/out", "mem": true},
  "scenario": "quickstart",
  "want": {
    "/out/my-app/src/index.js": "console.log(\"hello world\")\n",
    "/out/my-app/package.json": "{ \"name\": \"my-app\" }\n"
  }
}
```

Each scenario name maps to a Go test function (`scenarioQuickstart(j *J)`) that constructs the equivalent component tree. The test runs `Generate`, snapshots `vol.toJSON()`, and `cmp.Diff`s against `want`. Adding a new scenario is one JSON file plus one Go function.

This is the strongest parity test we have: byte-equal output for the same logical input.

#### 11.10 CI

```yaml
# .github/workflows/go-test.yml (added in phase 12 doc pass; sketch only)
- run: cd go && go vet ./...
- run: cd go && go test ./... -race -count=1
- run: cd go && go test ./... -run TestGenerateConcurrent -race -count=10
```

Repeat-run on the concurrency test (`-count=10`) to flush out any rare races. `staticcheck` is desirable but optional.

#### 11.11 Cross-references

- §2 mandates the concurrency regression.
- §8 corpus drives `merge_test.go`.
- §9 case list drives `template_test.go` extension.
- §17 verification commands run these tests.

### 12. Phasing (v1 single milestone, ordered)

V1 ships full TS parity (including 3-way merge — user opted into the diff3 hand-port). Steps are ordered so each lands on top of compiled-and-tested predecessors. Earlier steps unblock later steps; no step requires later code to compile.

#### Step 1 — Skeleton
**Lands.** `jostraca.go`, `options.go`, `node.go`, `errors.go`, `log.go`, empty `build.go` with the dispatch table sized but `noopOp` everywhere.

- `Options` struct + functional `WithX` + `OptionsFromMap` (§4.3) using existing `shape` dependency.
- `Kind` enum + `Node` struct (§4.1). `kindCount` sentinel set.
- `J` + `jstate` (§4.2). `New(opts...) *J` and `(*J).Generate(opts, root) (Result, error)`.
- `Log` interface, `DefaultLog` writing to `io.Writer` with ISO-8601 timestamp (§4.4).
- `NodeError` + sentinels `ErrMissingOp`, `ErrInvalidPath`, `ErrEmptyMatchRegex`, `ErrLookbehind`, `ErrMergeConflict` (§4.6).
- `Result`/`Files`/`Audit`/`AuditEntry` (§4.5).

**Tests.** `errors_test.go` (sentinel matching), basic `New().Generate({}, func(j *J){})` returns empty Result.

**Done when.** `go build ./...` succeeds; trivial test passes.

#### Step 2 — Filesystem layer
**Lands.** `fs.go`.

- `FS`, `FileInfo`, `DirEntry` (§7.1).
- `OsFS` adapter; `MemFS` with `sync.RWMutex` + `Vol()`.

**Tests.** `fs_test.go` round-trips bytes through both implementations; `MkdirAll` + `ReadDir` shape on `MemFS`; concurrent reads/writes on `MemFS` under `-race`.

**Done when.** Both implementations satisfy the `FS` interface and pass round-trip tests.

#### Step 3 — Template feature parity
**Lands.** Rewrite `template.go` to close all 14 gaps from §9.

- Extended `TemplateSpec` fields: `Open`, `Close`, `Ref`, `Insert`, `Handle`.
- Tag matching (#Tag / #Tag-Name regex synthesis).
- Custom regex with named-group rewriting.
- `__JOSTRACA_REPLACE__` sentinel; quoted ref; function refs; JSON stringification.
- `Handle` streaming; eject regex variant; empty-match guard.
- LRU caches for template and eject regexes.
- Replace-key ordering matching TS exactly.
- `Indent` lands here (used by Content/Fragment) but is exported from `util.go`.

**Tests.** `template_test.go` extends to ~35 rows mirroring `test/template.test.ts` (§9.4).

**Done when.** Every TS template case produces byte-equal output via the table runner.

#### Step 4 — Utilities (must-have core)
**Lands.** `util.go`.

- `Each` (reflection), `Get`, `Camelify`/`Snakify`/`Kebabify`/`Partify`/`LCF`/`UCF`/`Names`, `EscRE`, `Indent`, `IsBinExt`, `Deep`.

**Deferred to Phase 12 polish (no consumer in Phases 5-11).**

- `GetX` — hardest port; PORT_PLAN §15 R2 flags it as the highest-risk
  parser port. No core consumer.
- `CMap`/`VMap` — sentinel-typed map transforms; downstream consumer only.
- `Humanify` — cosmetic time formatting; only used by `BuildMeta.HLast`
  (stubbed in Phase 6 with ISO-8601 if needed).
- `DLog` — debug log flushed at end of `Generate`; lands with
  `Generate`'s log surface in Phase 6 or 12.
- `OMap` — small, but no consumer in v1.

**Tests.** `util_test.go` ports the must-have rows from
`test/utility.test.ts`.

**Done when.** Phase 4 must-have rows pass.

#### Step 5 — Leaf components and basic ops
**Lands.** First half of `builder.go` and `build.go`.

- `*J.Project`, `*J.Folder`, `*J.File`, `*J.Content`, `*J.Line`, `*J.Slot`, `*J.Cmp` from §5.
- Ops: `projectBefore`, `folderBefore`/`folderAfter`, `fileBefore`/`fileAfter`, `contentBefore`, `slotBefore`/`slotAfter`, `noopOp`.
- `buildCtx` skeleton in `buildctx.go` with `currentRefs`.
- `step()` walker in `build.go` dispatching against the table.

**Tests.** `builder_test.go` validates node-tree shape for Project/Folder/File/Content. Build phase still no-ops on `FileOp.after` because `fileHandler` not yet wired (Step 6).

**Done when.** Compiles; `Generate` builds a tree of the right shape; build phase runs without errors but produces no output.

#### Step 6 — FileHandler core (write/preserve/present) + BuildMeta
**Lands.** `filehandler.go`, `buildmeta.go`, finalises `buildctx.go`.

- `fileHandler` (§7.3) with `save`, `loadFile`, `saveFile`, `ensureFolder`, `ensureDir`, `relative`, `filelog`, `validPath`.
- Modes implemented: `write`, `preserve`, `present`. (Diff/merge stubbed to no-op + `nil` error; wired in Step 10/11.)
- `JOSTRACA_PROTECT` sentinel.
- `buildMeta` JSON load/save under `<folder>/.jostraca/jostraca.meta.log` + `.gitignore` stub. `done()` called from `Generate` end.
- `duplicateFolder` produces side-copies when `Control.Duplicate` is on (used as merge baseline in Step 11).
- Wire ops to `fh.save(...)`. `FileOp.after` actually writes now.

**Tests.** `filehandler_test.go` per-mode (write/preserve/present/protect/unchanged); `jostraca_test.go` happy paths from `test/jostraca.test.ts`. Parity snapshots from `testdata/parity/quickstart.json`.

**Done when.** Quick-start example from README produces byte-equal output to TS via parity snapshot; preserve/present modes verified.

#### Step 7 — Concurrency regression
**Lands.** `concurrency_test.go`.

- 10-goroutine isolation test from §11.6.
- Run with `-race -count=10` in CI.

**Done when.** `go test -race -count=10 -run TestGenerateConcurrent` is green over 10 iterations.

#### Step 8 — Inject, Fragment, List
**Lands.** Second half of `builder.go`, op handlers in `build.go`.

- `*J.Inject` + `*J.InjectP` + `injectBefore`/`injectAfter`. After-op: read existing, replace between markers, `fh.save`.
- `*J.Fragment` + `*J.FragmentP` + `fragmentBefore`/`fragmentAfter`. Streaming via Template `Handle` per §5.
- `*J.List` + `*J.ListP`.

**Tests.** Subtests under `builder_test.go` for inject markers, fragment slot replay, list iteration order. Use `testdata/fixtures/template.html` and `snippet.go` for Fragment cases.

**Done when.** README "Fragments and Slots" + "Inject" examples produce byte-equal output via parity snapshots.

#### Step 9 — Copy full feature set
**Lands.** `*J.Copy` + `copyBefore`/`copyAfter` in `build.go`.

- Single-file mode (calls `fh.copy`).
- Directory walk: enumerate via `fs.ReadDir`, recurse, route through `fh.save`/`fh.copy` per entry.
- Apply `Replace` template substitution to text files; binary files copied verbatim (`IsBinExt`).
- Honor `Exclude` (bool/string/regexp/list) and `Options.Cmp.Copy.Ignore` (default `[~$]`).
- `Inject.Exclude` accepts the same forms (string, []any of strings/regexps); Phase 8 shipped only the `bool` shorthand and the rest landed during the parity push.

**Tests.** `testdata/fixtures/assets/` with mixed text/binary entries and a `~b.tmp` confirming default ignore. Round-trip into MemFS and assert resulting `Vol()`.

**Done when.** README "Copy" example matches TS output byte-for-byte.

#### Step 10 — 2-way diff mode
**Lands.** `diff.go`, wires `saveDiff` into `fileHandler.save` switch.

- `renderDiff(new, existing)` using `sergi/go-diff/diffmatchpatch` line mode (§8.1).
- `annotatedPath(target, "diff")` helper.
- `fileHandler.saveDiff` writes to `.diff.<ext>` and updates `Files.Diffed`/`Files.Conflicted`.

**Tests.** `diff_test.go` with multi-section golden files in `testdata/diff/case_*.txt`.

**Done when.** Conflict-marker output is byte-equal to TS for every shared corpus case.

#### Step 11 — node-diff3 port + 3-way merge mode
**Lands.** `merge.go`, wires `saveMerge` into `fileHandler.save` switch.

- `splitLines` + `lcs` (Hunt–McIlroy) — unit-tested in isolation against goldens (§8.2 implementation order step 1).
- `patchFrom` (LCS → hunks) — unit-tested.
- `reconcile` (three-way region splitter) — unit-tested.
- `assembleRegions` (regions → bytes with conflict markers).
- `merge3(new, prev, existing) mergeResult`.
- `fileHandler.saveMerge` reads duplicate baseline from `<folder>/.jostraca/generated/<rpath>` and runs `merge3`.

**Tests.** `merge_test.go` loads every JSON corpus file under `testdata/merge/` (one per `test/merge.test.ts` case) and asserts byte-equal output and conflict flag.

**Done when.** Every TS merge case passes; `Files.Merged`/`Files.Conflicted` populated correctly.

#### Step 12 — Documentation pass
**Lands.** Rewrite `go/README.md`; add doc.go; update root `README.md` Go-port section.

- Replace template-only README with a full quick-start mirroring the JS quick-start.
- Document the `*J` receiver-shadowing pattern with a side-by-side TS-vs-Go example (cribs §2).
- List public API, deviations from TS (§14), RE2 caveat, lookbehind rejection.
- Code samples for: quickstart, fragments+slots, copy, inject, custom components, mem mode, all five existing-file modes.
- `doc.go` with the package-level godoc summary.

**Done when.** New README compiles its examples (extracted via `_test.go` Example funcs) and passes `go vet ./...`.

#### Sequencing rationale

- Steps 1–4 are foundation: nothing else compiles without them. Independent of each other within reason — Template (3) and Utilities (4) can be parallelised by two implementers.
- Steps 5–6 are the minimum end-to-end skeleton; Step 7 immediately *proves* the §2 design once the skeleton exists.
- Steps 8–9 add the rest of the components without touching the file-handler modes.
- Steps 10–11 add the existing-file modes; ordered so 2-way diff (cheaper, library-backed) lands before the harder 3-way merge port.
- Step 12 is the consumer-facing surface — leaves until the API is stable.

#### Definition of done for v1

- `go build ./...` clean.
- `go vet ./...` clean.
- `go test ./... -race -count=1` green; concurrency test passes 10× consecutive.
- All TS test files (except `point.test.ts`) ported; every parity snapshot byte-equal.
- `go/README.md` covers every component and option.
- The repo-root `README.md` Go-port section advertises full parity (not "template utility port").

### 13. File-by-file mapping (TS → Go)

Authoritative list. Each TS file maps to one or more Go files; the rightmost column points to the phase from §12 that delivers the port.

#### 13.1 Source code mapping (`src/` → `go/`)

| TS file | LoC | Go destination | Phase |
|---|---|---|---|
| `src/jostraca.ts` | 498 | `jostraca.go` (entry, `New`, `Generate`, glue), `options.go` (Options + WithX + OptionsFromMap) | 1, 6 |
| `src/types.ts` | — | `node.go` (Node/Kind), `jostraca.go` (Result/Files/Audit), `errors.go` (NodeError) | 1 |
| `src/build/BuildContext.ts` | 119 | `buildctx.go` | 5–6 |
| `src/build/BuildMeta.ts` | 107 | `buildmeta.go` | 6 |
| `src/build/FileHandler.ts` | 746 | `filehandler.go` (write/preserve/present/protect/unchanged), `diff.go` (diff mode), `merge.go` (merge mode + diff3 port) | 6, 10, 11 |
| `src/cmp/Project.ts` | 22 | `builder.go` — `*J.Project` / `*J.ProjectP` | 5 |
| `src/cmp/Folder.ts` | 22 | `builder.go` — `*J.Folder` | 5 |
| `src/cmp/File.ts` | 21 | `builder.go` — `*J.File` / `*J.FileP` | 5 |
| `src/cmp/Content.ts` | 34 | `builder.go` — `*J.Content` / `*J.ContentP` | 5 |
| `src/cmp/Line.ts` | — | `builder.go` — `*J.Line` / `*J.LineP` | 5 |
| `src/cmp/Slot.ts` | — | `builder.go` — `*J.Slot` / `*J.SlotP` | 5 |
| `src/cmp/None.ts` | — | not needed — `KindNone` is the zero `Kind` value | — |
| `src/cmp/Inject.ts` | — | `builder.go` — `*J.Inject` / `*J.InjectP` | 8 |
| `src/cmp/Fragment.ts` | 87 | `builder.go` — `*J.Fragment` / `*J.FragmentP` (uses Template `Handle`) | 8 |
| `src/cmp/Copy.ts` | — | `builder.go` — `*J.Copy` (define-time leaf) | 9 |
| `src/cmp/List.ts` | — | `builder.go` — `*J.List` / `*J.ListP` | 8 |
| `src/op/ProjectOp.ts` | — | `build.go` — `projectBefore` | 5 |
| `src/op/FolderOp.ts` | 35 | `build.go` — `folderBefore`, `folderAfter` | 5 |
| `src/op/FileOp.ts` | 81 | `build.go` — `fileBefore`, `fileAfter` | 5–6 |
| `src/op/ContentOp.ts` | — | `build.go` — `contentBefore` | 5 |
| `src/op/InjectOp.ts` | — | `build.go` — `injectBefore`, `injectAfter` | 8 |
| `src/op/FragmentOp.ts` | — | `build.go` — `fragmentBefore`, `fragmentAfter` | 8 |
| `src/op/SlotOp.ts` | — | `build.go` — `slotBefore`, `slotAfter` | 5/8 |
| `src/op/CopyOp.ts` | — | `build.go` — `copyBefore`, `copyAfter` | 9 |
| `src/op/NoneOp.ts` | — | `build.go` — `noopOp` | 1 |
| `src/util/basic.ts` | 750 | `util.go` (every utility from §10), `template.go` (template engine) | 3, 4 |
| `src/util/point.ts` | — | **deferred** to `go/point/` post-v1 | — |

#### 13.2 Test mapping (`test/` → `go/`)

| TS test file | Go test file | Phase |
|---|---|---|
| `test/jostraca.test.ts` | `jostraca_test.go` | 6 |
| `test/template.test.ts` | `template_test.go` (extends existing) | 3 |
| `test/utility.test.ts` | `util_test.go` | 4 |
| `test/control.test.ts` | `control_test.go` | 6 |
| `test/merge.test.ts` | `merge_test.go` | 11 |
| `test/point.test.ts` | not ported | — |
| `test/expect.ts` | replaced by `github.com/google/go-cmp/cmp` | — |

#### 13.3 New tests with no TS counterpart

| Go test file | Reason | Phase |
|---|---|---|
| `concurrency_test.go` | Receiver-shadowing isolation regression — Node has no goroutine concurrency to test | 7 |
| `filehandler_test.go` | Per-mode unit tests outside the end-to-end suite | 6 |
| `diff_test.go` | 2-way diff render goldens | 10 |
| `fs_test.go` | OsFS + MemFS sanity | 2 |
| `builder_test.go` | Per-component node-tree shape | 5 |

#### 13.4 Documentation files

| TS / repo-root file | Go destination | Phase |
|---|---|---|
| `README.md` (repo root) | update Go-port section to claim full parity (§12 Step 12) | 12 |
| `REFERENCE.md` (repo root) | `go/REFERENCE.md` (verbatim per-component reference, Go signatures) | 12 |
| `go/README.md` (current "template utility" stub) | full quick-start + API surface (replaces stub) | 12 |
| (none) | `go/doc.go` package godoc | 12 |
| `go/PORT_PLAN.md` | this document; closes when v1 ships | — |

#### 13.5 Module / build files

| File | Action | Phase |
|---|---|---|
| `go/go.mod` | add `github.com/sergi/go-diff` (runtime), `github.com/google/go-cmp` (test) | 10, 11 |
| `go/go.sum` | regenerate via `go mod tidy` | per-step |
| `.github/workflows/go-test.yml` (new) | CI: `go vet`, `go test -race -count=1`, repeat-run concurrency case | 12 |

#### 13.6 Cross-references

- §3 enumerates the file tree this section maps to.
- §12 phases reference these files in delivery order.
- §16 lists the critical files to modify *now* (vs. create later).

### 14. Deviations from TS (explicit, flagged)

Each deviation is intentional and documented in `go/README.md` and `doc.go`. Where TS code samples won't translate verbatim, the README provides a Go counterpart.

#### D1. Components are `*J` methods, not free functions
**TS.** `Project(...)`, `Folder(...)`, `File(...)` are package-level functions reading `ctx$` from `AsyncLocalStorage`.
**Go.** Methods on `*J`: `j.Project(...)`, `j.Folder(...)`, `j.File(...)`. Each callback shadows `j` to bind a child frame.
**Reason.** Concurrent-safe define phase without globals (§2). Goroutine-local storage was rejected as non-idiomatic; `context.Context` would force an extra parameter into every component call.
**Mitigation.** §2 quantifies the noise budget at one identifier (`j`) per call site. §12 Step 12 documents the pattern with a side-by-side example in `go/README.md`.

#### D2. `Generate` returns `(Result, error)` instead of throwing
**TS.** `await jostraca.generate(opts, root)` rejects on error.
**Go.** `result, err := j.Generate(opts, root)`.
**Reason.** Idiomatic Go; `panic` is reserved for true programmer errors (nil dereferences). Define-phase errors accumulate on `j.st.err` and are returned after the user callback completes (§2).
**Mitigation.** Component methods early-return when `j.st.err != nil`, so a single error stops a long callback cleanly without checks at every call site.

#### D3. Options: struct + functional opts + `OptionsFromMap`
**TS.** Single `OptionsShape`-validated map at `src/jostraca.ts:99-153`.
**Go.** Typed `Options` struct + `WithX(...) Option` constructors + `OptionsFromMap(map[string]any) (Options, error)` (validated by `shape`).
**Reason.** Type safety, IDE auto-complete, compile-time field checking. The map-based form is preserved for callers loading config from JSON/YAML.
**Mitigation.** None needed; the typed surface is strictly nicer.

#### D4. `Node.Meta` stays `map[string]any` (op-private scratch)
**TS.** `node.meta` is a `Record<string, any>` carrying `callsite`, `fragment_file`, `debug` keys, etc.
**Go.** Same: `Meta map[string]any` on `Node`.
**Reason.** Op-private scratch space; typing it would force fragile internal fields onto the public surface and break per-op evolution.
**Mitigation.** Internal helper accessors (`callsiteFrom(n)`, etc.) keep the access pattern centralised — not a free-for-all.

#### D5. Build phase fully synchronous
**TS.** `step()` is `async`; ops `await` file I/O.
**Go.** `step()` returns `error` synchronously; file I/O is blocking.
**Reason.** Go file I/O is sync-friendly; making it async with goroutines would add concurrency cost without throughput benefit (single walker, file-bound). Removes Promise machinery from error propagation.
**Mitigation.** None needed; if parallel writes become a goal in v2, the cleanest extension is `step()` calling `o.after` on independent subtrees concurrently behind a flag in `Options.Control`.

#### D6. `Log` is a named-method interface
**TS.** `{ trace, debug, info, warn, error, fatal }` plain object.
**Go.** Interface with the same six methods, each `func(args ...any)`.
**Reason.** Matches TS shape exactly so users can implement easily; idiomatic Go interface.
**Mitigation.** A `slog.Handler`-backed adapter (~30 LoC) is trivial to add; not in v1 to avoid adding a stdlib dep that may shift before Go 1.22 minimum is bumped.

#### D7. No global `__dlog__`; package-level locked slice
**TS.** `global.__dlog__` array shared across modules; `getdlog()` returns a logger appending to it.
**Go.** Package-level `[]dLogEntry` guarded by `sync.Mutex`. `newDLog(tag, file)` returns a struct with `Log` / `Entries` methods.
**Reason.** Avoid hidden process-global state. Multiple `Generate` calls (concurrent or sequential) share the buffer — same surface for end-of-call flush via `Options.Log.Debug`, no cross-package leak.
**Mitigation.** §10.6 documents the API; consumer-facing behaviour matches TS (debug entries flush at end-of-`Generate`).

#### D8. `Each` uses reflection
**TS.** Naturally polymorphic via JS dynamic typing.
**Go.** Reflection-based to preserve user-facing parity (one function name, accepts arrays/maps/scalars).
**Reason.** Forcing users to pick `EachSlice` / `EachMap` / `EachScalar` would fragment the API. Reflection is acceptable for the user-facing surface.
**Mitigation.** Internal hot paths (op walks over `Node.Children`) use a typed helper `iterChildren(*Node, func(*Node))` directly — reflection is opt-in for end users.

#### D9. Canonical-`/` internal paths; OS conversion only in `OsFS`
**TS.** Uses `fwd()` helper to normalise to forward slashes (`src/build/FileHandler.ts:24-26`).
**Go.** Same policy: every internal path is canonical-`/`. Conversion via `filepath.FromSlash` happens only at the OS boundary inside `OsFS`.
**Reason.** Cross-platform stability; matches existing TS contract.
**Mitigation.** A single chokepoint (`OsFS`) for the conversion makes Windows-specific bugs easy to localise.

#### D10. RE2 vs JS regex: lookbehind unsupported, fail at compile
**TS.** Uses JS regex with lookbehind in places (`(?<=\n)` in `indent`).
**Go.** RE2 has no lookbehind, no backreferences, no possessive quantifiers.
**Reason.** Hard limit of `regexp` package; switching to a PCRE library (`regexp2`, etc.) adds a heavy dependency and slower performance.
**Mitigation.** `Indent` uses `strings.ReplaceAll` instead of regex. User-supplied regex keys are scanned for `(?<=...)`, `(?<!...)`, `(?=...)`, `(?!...)` patterns and rejected with `ErrLookbehind` (§4.6) at template-compile time, before any infinite-loop risk. Documented in `template.go` doc comments and `go/README.md`.

#### D11. `Filter` callback signature simplified
**TS.** `node.filter` accepts a loosely-typed object (`{ props, children, component }`).
**Go.** `Filter func(componentKind, name string) bool`.
**Reason.** TS only ever uses `component.name` and `props.name` from the callback (`src/cmp/Fragment.ts:51, 58, 69`); the simpler signature captures actual usage and avoids exposing component reflection.
**Mitigation.** §5.3's `Slot` and `Fragment` sketches illustrate usage. `J.Cmp` users who want a richer filter can pass any closure that captures local context.

#### D12. `JOSTRACA_PROTECT` semantics narrowed to substring match
**TS.** Detects the marker via a substring check on file contents.
**Go.** Same: `bytes.Contains(existing, []byte("JOSTRACA_PROTECT"))`.
**Reason.** Identical behaviour; just flagging that the *implementation* uses byte search rather than line-aware search. If someone embeds the marker in non-comment context (e.g., a string literal), both TS and Go protect the file.
**Mitigation.** None — behaviour is unchanged from TS.

#### D13. Time source uses `int64` epoch ms throughout
**TS.** Mix of `Date.now()` and `Date` objects.
**Go.** Single `func() int64` returning epoch ms; matches `Options.Now`. `Humanify` converts on demand.
**Reason.** Avoids timezone confusion; serialises cleanly to/from JSON.
**Mitigation.** `Humanify(now, ...)` provides the human-readable form when needed (e.g., `BuildMeta.HLast`).

#### D14. Component prop structs have explicit `…P` variants
**TS.** Optional positional/object overloads inferred from runtime type checks (`null == props || 'object' !== typeof props ? props = {arg: props} : props`, `src/jostraca.ts:387-388`).
**Go.** Two methods per component: `j.File(name, body)` for the common case, `j.FileP(FileProps{...}, body)` for the full props.
**Reason.** Go has no overloading; conditional struct literals are noisy. The pair pattern keeps the common case clean.
**Mitigation.** The pattern is uniform across components, so once a user sees `FileP`, they predict `ProjectP`, `ContentP`, etc.

#### D15. `Point*` orchestration utility deferred
**TS.** Re-exports `PointUtil` from `src/util/point.ts`.
**Go.** Not in v1; will land as `go/point/` sub-package post-v1.
**Reason.** Not used by core; only re-exported. Splitting into a sub-package isolates its dependencies (logging, runner) from the generator.
**Mitigation.** README calls out the omission with a forward reference; users who need orchestration can stay on TS until v2.

#### Surface that *doesn't* deviate (parity guarantee)

To avoid surprise: these stay identical to TS, byte-equivalent where it makes sense:
- Output file contents for the quickstart, fragments, copy, inject scenarios.
- Existing-file mode markers (`<<<<<<< GENERATED:`, `||||||| BASELINE:`, `=======`, `>>>>>>> EXISTING:`).
- `BuildMeta` JSON file format (so a TS-generated `.jostraca/jostraca.meta.log` is readable by Go and vice versa).
- Audit tag set (`save`, `copy`, `mkdir`, `preserve`, `present`, `diff`, `merge`, `conflict`, `protect`, `unchanged`).
- File outcome categories (`Files.Written`, `.Preserved`, `.Presented`, `.Diffed`, `.Merged`, `.Conflicted`, `.Unchanged`).
- Default options (`folder = "."`, `Control.Duplicate = true`, ignore-pattern `~$` for Copy, marker pair for Inject).
- Template syntax (`$$path$$`, `#Tag` markers, eject regions, replace keys).

### 15. Risks & mitigations

Sorted by severity (impact × likelihood). Each risk lists the trigger, what fails if unmitigated, and the concrete mitigation.

#### R1. node-diff3 port correctness — **Highest**
**Trigger.** The hand-port of LCS + reconcile + region assembly (§8.2) ships with subtle bugs on multi-hunk or interleaved-edit cases, producing different conflict markers than TS or losing changes silently.
**Impact if unmitigated.** Users on `merge` mode get incorrect output — silently wrong code. Conflict-recovery flow becomes untrustworthy.
**Mitigation.**
- Test-first port: every TS `merge.test.ts` case is in `testdata/merge/*.json` *before* the algorithm exists.
- Stage the implementation in §8.2 Implementation order: each stage (LCS → patch → reconcile → assembly) lands behind unit tests.
- `merge_test.go` asserts byte-equality with the TS expected output, not just "no conflict" — bytes are the contract.
- A single-source quick-add: when a TS bug fix lands in `node-diff3`, copy the new test case into `testdata/merge/` and re-port the relevant routine. The corpus is the oracle.

#### R2. `getx` parser subtlety
**Trigger.** Hand-porting a 160-LoC parser with operators (`a:b`, `a = v`, `a ~ /re/`, `? expr`) drops or misinterprets a token boundary. Existing TS tests still pass because users of `getx` are sparse, but downstream behaviour silently breaks.
**Impact.** Components that use `getx` (Content `extra`, downstream user code via `props.ctx$.model`) read the wrong value.
**Mitigation.**
- Port test-first: every row of `test/utility.test.ts` for `getx` becomes a Go subtest before the parser is written.
- Implement the parser incrementally — each operator gated by a passing test.
- Cap PR scope at "this many getx tests pass"; merge stepwise rather than all at once.

#### R3. RE2 vs JS regex behaviour drift in user-supplied keys
**Trigger.** Users supply a regex key with JS-only features (lookbehind, backreferences, possessive quantifiers). Go's `regexp.Compile` returns an error or, worse, silently parses something different.
**Impact.** Templates that work in TS produce errors or incorrect output in Go.
**Mitigation.**
- Pre-scan user regex strings for `(?<=`, `(?<!`, `(?=`, `(?!`, and `\1..\9` backreferences (§9.3).
- Reject with `ErrLookbehind` (§4.6) at template-compile time — clear error, not a silent drift.
- Document the constraint in `template.go` doc comment, `go/README.md`, and the deviation list (§14 D10).
- Detect early: do the scan before running into infinite-loop territory.

#### R4. `Each` reflection hot path
**Trigger.** Generators run thousands of `Each` calls (List components, child walks). Reflection-based `Each` becomes a measurable hot spot.
**Impact.** Large generation runs are noticeably slower than TS.
**Mitigation.**
- Internal core never calls user-facing `Each` for hot iteration — it uses `iterChildren(*Node, func(*Node))` (§10.2).
- Reflection is only on the `Each` user-facing surface, where users explicitly opted in.
- Benchmark `BenchmarkGenerateLargeProject` in `jostraca_test.go` to track regressions; if regression > 2× TS, revisit.
- Future option (v2): add typed variants `EachSlice` / `EachMap` / `EachAny` so callers can opt out of reflection.

#### R5. Windows path semantics
**Trigger.** Go's `filepath.Join` produces backslashes on Windows; `filepath.Ext` is `\\` separator-aware; `os.WriteFile` accepts either. Code that mixes `filepath.Join` and string concat with `/` produces inconsistent paths.
**Impact.** Output files in wrong locations on Windows; `Files.Written` containing mixed separators; merge baseline lookups fail because canonical-`/` keys don't match canonical-`\` paths.
**Mitigation.**
- Single rule: every internal path is canonical-`/`. Only `OsFS` calls `filepath.FromSlash`/`filepath.ToSlash` at the boundary.
- `fwd(p)` helper used everywhere we need to be sure: `path.Clean(filepath.ToSlash(p))`.
- Optional CI matrix entry: `windows-latest` running `go test ./...` once basic tests pass. Even if not in v1 CI, cross-compile check (`GOOS=windows go vet ./...`) lands in §17.
- Cross-platform test fixtures use only `/`; never embed OS-specific paths.

#### R6. Concurrency test flakiness
**Trigger.** The 10-goroutine test (§11.6) is timing-sensitive on slow CI runners; race detector occasionally flags ABA on `*MemFS` shared state.
**Impact.** Spurious CI failures undermine confidence in the design.
**Mitigation.**
- Each goroutine constructs its own `*MemFS` (no sharing) — reduces racing surface.
- `-race -count=10` in CI catches real races without depending on schedule timing.
- The test asserts vol contents per-goroutine; no time-based assertions.
- If flakes appear, the contract is to investigate, not retry — a flake here means a real bug in §2.

#### R7. `shape` library mismatch with new fields
**Trigger.** `OptionsFromMap` validates against a `shape.MustShape(...)` schema. If the schema drifts from `Options` struct fields (e.g., new `Mem` field added to struct but not schema), map-loaded callers silently miss the new option.
**Impact.** Map-config users can't use new features added struct-side.
**Mitigation.**
- Single source of truth: a code-gen check in `options_test.go` that asserts every `Options` field appears in the shape schema. Catches drift in CI.
- `OptionsFromMap` returns an error on unknown keys (shape default), not silent acceptance — prevents users from typoing keys.

#### R8. 2-way diff library divergence from TS `diff` package
**Trigger.** `sergi/go-diff/diffmatchpatch` line-mode produces hunk boundaries that differ from `kpdecker/jsdiff` (the TS `diff` package). Conflict-marker output drifts from TS byte-for-byte.
**Impact.** Failing parity snapshots for `diff` mode; users can't trust diff mode output across stacks.
**Mitigation.**
- Test against the TS corpus: every `diff_test.go` case asserts byte-equal output to the recorded TS expected.
- If divergence is unfixable, normalise via post-processing (e.g., merge adjacent hunks until output matches TS).
- Worst case: the TS expected files become *the* contract, and we document that diff mode output may differ from `kpdecker/jsdiff` exactly because we use a different (but equally valid) line-diff library — but that lands as a deviation in §14, not silently.

#### R9. `template.go` cache eviction strategy
**Trigger.** TS clears the entire cache when full (`templateRECache.clear()` at `:476`). The Go port's FIFO eviction picks an arbitrary entry, which may evict a hot regex.
**Impact.** Performance regression on long-running generators that exceed the 100-entry cap.
**Mitigation.**
- Match TS exactly: clear all entries when full (§9 #11). Trades worst-case-rebuild for guaranteed parity.
- Add a benchmark `BenchmarkTemplateCacheChurn` to detect regressions if eviction becomes a bottleneck (post-v1).

#### R10. `BuildMeta` JSON drift between TS and Go
**Trigger.** Go's `encoding/json` produces fields in struct-declaration order; TS's `JSON.stringify` produces them in insertion order. A meta file written by TS may not round-trip identically through Go.
**Impact.** `.jostraca/jostraca.meta.log` files committed by mixed-stack users differ on every run; meaningless diffs in version control.
**Mitigation.**
- Use a stable output order (alphabetical) in Go's serialisation. Either declare the struct fields alphabetically, or marshal through a `map[string]any` with sorted keys.
- Test: `buildmeta_test.go` round-trips a known TS-produced JSON file and asserts byte-equality.

#### R11. Memory growth under large `Vol` in `MemFS`
**Trigger.** Generation that produces many large files (e.g., copying a multi-megabyte assets folder) holds everything in `MemFS.files` map. Memory pressure on consumers using `WithMem`.
**Impact.** OOM on small CI runners.
**Mitigation.**
- Lazy: don't optimise in v1. Document `WithMem` as suitable for testing/small jobs.
- Future: `MemFS` with disk-backed overflow (out of scope for v1).

#### R12. User callbacks panic during define phase
**Trigger.** A user's component callback panics (nil deref, type assertion failure).
**Impact.** Without protection, the panic propagates out of `Generate` — matches TS `throw` behaviour, but Go convention prefers errors.
**Mitigation.**
- Decision (matches TS): let panics propagate. `Generate` does not `recover()`; user code is expected to use errors via the design (D2).
- If a v2 use case demands recovery (e.g., long-running daemon servicing untrusted templates), add an option `WithRecoverPanics(true)` that converts panic to error. Not in v1.

#### R13. Backwards compatibility of existing `Template()` signature
**Trigger.** External users of the current Go module call `jostraca.Template(src, model, spec)`. We extend `TemplateSpec` with new fields — fine if additive — but if we change the signature or rename any existing field, callers break.
**Impact.** Breaking change between `v0.1.x` and v1.
**Mitigation.**
- All §9 changes to `TemplateSpec` are *additive* — `Replace` and `Eject` keep their existing types (`Eject` widens from `[2]string` to `any` but `[2]string` continues to be accepted via the `compileEject` dispatch).
- Cut a `v0.x` tag before this work begins so existing pinned consumers can stay on it.
- `template_test.go` keeps the existing test cases unchanged; new cases append.

#### Risk-tracking convention

Each risk has a one-line entry in `go/PORT_PLAN.md` (this section). When a mitigation actually fires (e.g., a flaky concurrency test gets investigated), append the resolution to that risk's entry rather than starting a new doc — keeps the trail with the plan.

### 16. Critical files to modify / create

#### 16.1 Files modified (existing today, edited during the port)

| File | Why | First-touched in phase |
|---|---|---|
| `go/template.go` | Replace 184-line stub with the full §9 implementation; keep `Template`/`ParseTemplateSpec` signatures additive (R13). | 3 |
| `go/template_test.go` | Extend the 65-line file with the §9.4 case table mirroring `test/template.test.ts`. Existing rows stay. | 3 |
| `go/README.md` | Replace "template utility port" wording with full quick-start, API, deviations (§14). | 12 |
| `go/go.mod` | Add `github.com/sergi/go-diff` (runtime), `github.com/google/go-cmp` (test-only). | 10–11 |
| `go/go.sum` | Regenerate via `go mod tidy` after each new dep lands. | per-step |
| `README.md` (repo root) | Update Go-port section (currently lines 281-283) to advertise full parity, not template-only. | 12 |

#### 16.2 Files created (new in this port)

Grouped by phase from §12. Every file lives under `go/` unless noted.

**Phase 1 (skeleton).**
- `jostraca.go` — `New`, `Generate`, glue
- `options.go` — `Options`, `WithX` constructors, `OptionsFromMap`, shape schema
- `node.go` — `Node`, `Kind` enum, `kindCount`
- `errors.go` — `NodeError`, sentinels
- `log.go` — `Log` interface, `DefaultLog`
- `doc.go` — package godoc

**Phase 2 (filesystem).**
- `fs.go` — `FS`, `OsFS`, `MemFS`, `FileInfo`, `DirEntry`
- `fs_test.go`

**Phase 3 (template).**
- (existing `template.go` rewritten — see 16.1)
- `testdata/fixtures/` directory created for Fragment goldens (populated phase 8)

**Phase 4 (utilities).**
- `util.go` — every utility from §10
- `util_test.go` — port of `test/utility.test.ts`

**Phase 5 (leaf components, basic ops).**
- `builder.go` — first half: `*J.Project`, `*J.Folder`, `*J.File`, `*J.Content`, `*J.Line`, `*J.Slot`, `*J.Cmp`
- `build.go` — `step()`, dispatch table (initially mostly `noopOp`), `projectBefore`, `folder*`, `file*`, `content*`, `slot*`, `noopOp`
- `buildctx.go` — `buildCtx` struct
- `builder_test.go`

**Phase 6 (file handling).**
- `filehandler.go` — `fileHandler` with `write`/`preserve`/`present`/`protect`/`unchanged` modes
- `buildmeta.go` — `buildMeta` JSON load/save + .gitignore stub
- `filehandler_test.go`
- `jostraca_test.go` — port of `test/jostraca.test.ts`
- `control_test.go` — port of `test/control.test.ts`
- `testdata/parity/quickstart.json` (and friends)

**Phase 7 (concurrency).**
- `concurrency_test.go`

**Phase 8 (Inject, Fragment, List).**
- (extends `builder.go` and `build.go`)
- `testdata/fixtures/template.html`
- `testdata/fixtures/snippet.go`

**Phase 9 (Copy).**
- (extends `build.go`)
- `testdata/fixtures/assets/` populated

**Phase 10 (2-way diff).**
- `diff.go`
- `diff_test.go`
- `testdata/diff/case_*.txt`

**Phase 11 (3-way merge).**
- `merge.go` — diff3 hand-port
- `merge_test.go`
- `testdata/merge/*.json` — corpus from `test/merge.test.ts`

**Phase 12 (docs).**
- `go/REFERENCE.md` — Go-API reference mirroring repo-root `REFERENCE.md`
- `.github/workflows/go-test.yml` — CI

#### 16.3 Files deleted

None. Every existing file in `go/` either survives unchanged or is rewritten in place. The `go/` directory contents at v1 ship time are a strict superset of today's directory plus the new files in 16.2.

#### 16.4 Files explicitly NOT created in v1

- `go/point/` sub-package — deferred (D15).
- A separate `go/cmd/` directory — no v1 binary; this is a library.
- A `Makefile` — Go's `go test`/`go build` is enough.

#### 16.5 Cross-references

- §3 specifies the file tree this section enumerates as critical.
- §13 maps each file to its TS source and phase.
- §17 verification commands assume these files exist.

### 17. Verification (end-to-end)

The commands below are the gate every phase must pass before merge. They run from the repo root unless noted; `(cd go && ...)` is used where the working directory matters.

#### 17.1 Build

```bash
(cd go && go build ./...)
```

**Expected.** Exit 0. No output. Compiles every package in the Go module.
**Fails when.** A type error, missing import, or unresolved symbol breaks the build. Should never reach review.

#### 17.2 Vet

```bash
(cd go && go vet ./...)
```

**Expected.** Exit 0. No warnings.
**Fails when.** `go vet` flags suspicious constructs (printf format mismatch, unreachable code, lock copying, etc.). Treat as blocker.

#### 17.3 Cross-platform vet (Windows path mitigation, R5)

```bash
(cd go && GOOS=windows go vet ./...)
(cd go && GOOS=darwin go vet ./...)
```

**Expected.** Exit 0 on both. Catches obvious cross-compilation breakage before runtime.
**Fails when.** Code uses linux-only `syscall` constants or assumes a path separator; both should be impossible if §7's `OsFS` boundary discipline is followed.

#### 17.4 Tests

```bash
(cd go && go test ./... -race -count=1)
```

**Expected.** All tests pass. Covers:
- `template_test.go` (§9 cases)
- `util_test.go` (§10 utilities)
- `jostraca_test.go` (end-to-end happy paths from `test/jostraca.test.ts`)
- `builder_test.go` (per-component shape)
- `filehandler_test.go` (write/preserve/present/protect/unchanged)
- `control_test.go` (dryrun, version)
- `diff_test.go` (2-way render)
- `merge_test.go` (3-way merge corpus from `test/merge.test.ts`)
- `concurrency_test.go` (10-goroutine isolation)
- `fs_test.go` (OsFS + MemFS round-trip)

**Fails when.** Any individual case fails or the race detector reports a data race.

#### 17.5 Concurrency stress

```bash
(cd go && go test ./... -run TestGenerateConcurrent -race -count=10)
```

**Expected.** Pass 10 consecutive iterations.
**Fails when.** Any iteration trips the race detector or asserts cross-goroutine state contamination — direct evidence the §2 design has a hole.

#### 17.6 Parity snapshots

```bash
(cd go && go test ./... -run TestParity -v)
```

Reads every `testdata/parity/*.json`, runs the corresponding Go scenario, snapshots `Result.Vol().toJSON()` equivalent, and asserts byte-equal to the recorded TS output.

**Expected.** All scenarios pass. Output formatting via `cmp.Diff` for any miss.
**Fails when.** A single byte differs from TS — investigate (often a path normalisation slip, occasionally a real semantic divergence).

Initial scenarios (added in their respective phases):
- `quickstart.json` — README quick-start (phase 6)
- `fragment_slot.json` — README "Fragments and Slots" (phase 8)
- `inject_basic.json` — README "Inject" (phase 8)
- `copy_assets.json` — README "Copy" (phase 9)
- `existing_diff.json` — README "Existing File Handling" with `diff: true` (phase 10)
- `existing_merge.json` — same with `merge: true` (phase 11)
- `mem_vol.json` — README "In-Memory Generation" (phase 6)

#### 17.7 Manual smoke (golden file)

After phase 12, the README quick-start translated to Go runs end-to-end on disk:

```bash
(cd /tmp && rm -rf jostraca-smoke && mkdir jostraca-smoke && cd jostraca-smoke && \
  go mod init smoke && go mod edit -replace github.com/jostraca/jostraca/go=$REPO/go && \
  cat > main.go <<'EOF'
package main
import "github.com/jostraca/jostraca/go"
func main() {
    j := jostraca.New(jostraca.WithFolder("./out"))
    if _, err := j.Generate(jostraca.Options{}, func(j *jostraca.J) {
        j.Project(jostraca.ProjectProps{Folder: "my-app"}, func(j *jostraca.J) {
            j.Folder("src", func(j *jostraca.J) {
                j.File("index.js", func(j *jostraca.J) {
                    j.Content("console.log(\"hello world\")\n")
                })
            })
            j.File("package.json", func(j *jostraca.J) {
                j.Content("{ \"name\": \"my-app\" }\n")
            })
        })
    }); err != nil { panic(err) }
}
EOF
  go run . && \
  diff -ruN out/my-app expected-tree/)
```

**Expected.** Files produced match the README's expected tree. The `diff` exits 0.
**Fails when.** A file is missing, has wrong content, or a permissions bit differs — usually a `fileHandler` bug.

The expected tree lives under `go/testdata/smoke/expected-tree/` and travels with the package.

#### 17.8 Optional: staticcheck

```bash
(cd go && staticcheck ./...)
```

**Expected.** Empty output.
**Fails when.** Idiomatic Go nits flagged (unused functions, redundant type conversions, etc.).
**Status.** Optional — not blocking for v1 but recommended.

#### 17.9 Optional: dependency audit

```bash
(cd go && go mod verify && go list -m -mod=readonly all)
```

**Expected.** All checksums verify; only `github.com/rjrodger/shape/go`, `github.com/sergi/go-diff`, and `github.com/google/go-cmp` (test-only) appear as direct deps.

#### 17.10 Definition of "v1 ships"

All of the following hold:
1. §17.1 (`go build`) — green.
2. §17.2 (`go vet`) — green.
3. §17.3 (cross-platform vet) — green for `linux`/`darwin`/`windows`.
4. §17.4 (`go test -race`) — green.
5. §17.5 (concurrency stress) — green over 10 iterations.
6. §17.6 (parity snapshots) — every scenario byte-equal to TS.
7. §17.7 (manual smoke) — README quick-start produces the documented tree.
8. `go/README.md` updated (D15 noted, full quick-start, deviation list).
9. Repo-root `README.md` Go-port section updated to claim full parity.
10. CI workflow committed and green on the merge commit.

#### 17.11 Cross-references

- §11 owns the test strategy these commands execute.
- §12's "Done when" criteria for each phase are subsets of these commands.
- §15 risks call out which command catches each risk.

---

*Plan complete. v1 ships when §17.10 holds.*

---

*Status: outline. Sections will be expanded one at a time in subsequent commits.*
