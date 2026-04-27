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
    Dryrun    bool
    Duplicate bool                  // default true (per TS line 145)
    Version   bool
}

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
)
```

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
        Path:   childPath(j.cur, p.Name),
        Meta:   map[string]any{},
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

A `map[string][]byte` guarded by `sync.RWMutex`, with synthesised `FileInfo` (mtime from a sibling map). `MkdirAll` is a no-op (paths in the map are flat keys); `ReadDir` walks keys with the prefix and returns synthetic entries. `Vol()` exposes the underlying map for `Result.Vol`:

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
