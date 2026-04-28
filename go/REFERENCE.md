# jostraca-go reference

Per-symbol reference for the Go port. Companion to `README.md`.
For design notes see `PORT_PLAN.md`; for per-phase implementation
notes see `BUILD_LOG.md`.

## Entry points

### `New(opts ...Option) *J`

Construct a top-level builder seeded with global options. Component
methods on the returned `*J` must only be called inside a `Generate`
callback.

```go
j := jostraca.New(jostraca.WithFolder("./out"), jostraca.WithMem())
```

### `(*J).Generate(opts Options, root func(*J)) (Result, error)`

Run the define phase (synchronous walk of the user callback) then the
build phase. Returns a `Result` with the per-category file lists and
the audit log; or an error.

`opts` is merged on top of the global options seeded at `New` time.
Map-typed fields take the per-call value when non-nil.

### `OptionsFromMap(m map[string]any) (Options, error)`

Decode a typed `Options` from an untyped map. Useful when sourcing
configuration from JSON or YAML. Currently handles `folder`, `debug`,
`mem`, `model`, `meta`; unknown keys are ignored.

## Options

```go
type Options struct {
    Folder   string                  // output base; defaults to "."
    Meta     map[string]any
    FS       FS                       // OsFS or MemFS
    Now      func() int64             // unix-ms clock
    Log      Log                      // sink for diagnostics
    Debug    string                   // when set, callsite stacks are recorded
    Existing Existing                 // existing-file mode bits
    Model    map[string]any           // template model
    Build    *bool                    // tri-state; nil = true
    Mem      bool                     // shorthand: use a fresh MemFS
    Vol      map[string][]byte        // initial MemFS contents
    Cmp      CmpOptions               // per-component options
    Control  Control                  // build-time toggles
    Name     NameOptions              // file/folder name affixes
    Exclude  bool                     // skip files modified since last build
}
```

### Existing-file modes

```go
type Existing struct {
    Txt ExistingTxt
    Bin ExistingBin
}
type ExistingTxt struct {
    Write    *bool   // overwrite (default true)
    Preserve *bool   // back up to .old.<ext> before overwrite
    Present  *bool   // when Write=false: write .new.<ext> sidecar
    Diff     *bool   // overwrite with conflict-marker render
    Merge    *bool   // 3-way merge using .jostraca/generated/ baseline
}
```

Modes are conjunctive (multiple bits compose). The evaluation order:

1. `JOSTRACA_PROTECT` content sentinel — short-circuit, file untouched.
2. Equal content — record `unchanged`, refresh duplicate baseline.
3. `Merge` — 3-way merge if a baseline exists, else fall back to `Diff`.
4. `Diff` — overwrite with conflict-marker render.
5. `Preserve` — write `.old.<ext>` backup.
6. `Present` (when `Write=false`) — write `.new.<ext>` sidecar.
7. `Write` (default) — overwrite.

### Control

```go
type Control struct {
    Dryrun      bool   // skip filesystem writes
    NoDuplicate bool   // skip .jostraca/generated/ baseline copies
    Version     bool   // suppress .jostraca/.gitignore generation
}
```

`NoDuplicate` is inverted from TS so the Go zero value matches the
TS default of duplicate=on.

## Components

All components are methods on `*J`. Each accepts a body callback
that receives a fresh `*J` shadowing the outer one. The callback is
optional for leaf components (`Copy`, `Content`).

| Method | Short form | Full props | Notes |
|---|---|---|---|
| `Project(p ProjectProps, body)` | — | `Folder`, `Name` | Anchors the output tree |
| `Folder(name, body)` | ✓ | — | Sub-directory under the current folder |
| `File(name, body) / FileP(p, body)` | ✓ | `Name`, `Exclude` | Output file |
| `Content(src) / ContentP(p)` | ✓ | `Src`, `Name`, `Indent`, `Replace`, `Extra` | Text body for the surrounding File |
| `Line(src) / LineP(p)` | ✓ | (same as Content) | `Content` plus a trailing newline |
| `Slot(name, body) / SlotP(p, body)` | ✓ | `Name` | Placeholder consumed by an enclosing `Fragment` |
| `Inject(name, body) / InjectP(p, body)` | ✓ | `Name`, `Markers`, `Exclude` | Replace content between markers in an existing file |
| `Fragment(p, body) / FragmentP(p, body)` | — | `From`, `Indent`, `Replace`, `Exclude`, `Eject` | Read external template, replay slots |
| `Copy(p)` | — | `From`, `To`, `Replace`, `Exclude`, `Indent` | Copy file or directory tree |
| `List(items, body) / ListP(p, body)` | ✓ | `Item`, `NoLine`, `Indent` | Iterate, emitting trailing `Line('')` unless `NoLine` |
| `Cmp(name, fn)` | — | — | Run a user-authored component without allocating a node |

## Template engine

### `Template(src string, model any, spec *TemplateSpec) (string, error)`

Render `src` substituting `$$path$$` macros from `model` and applying
`spec.Replace` keyed substitutions.

```go
type TemplateSpec struct {
    Replace map[string]any  // string|TemplateReplaceFunc keyed by literal or /regex/
    Eject   any             // [2]string | [2]any{string|*regexp.Regexp}
    Open    string          // default `\$\$`
    Close   string          // default `\$\$`
    Ref     string          // default `[^$]+`
    Insert  *regexp.Regexp  // override the assembled regex
    Handle  func(string)    // streaming sink; when set, Template returns ""
}

type ReplaceFunc func(groups map[string]string, match string) string
```

User-supplied regex keys (`/.../`) support named groups. The callback
receives prefix-stripped names (`indent`, `TAG`, `<inner>`) plus
`groups["$&"]` for the full match.

`#Tag` and `#Tag-Name` keys synthesise comment-marker patterns:

- `#Foo` matches `// #Foo` (with optional indent), populates `g["TAG"]="Foo"`.
- `#Foo-Bar` matches `// #<dynamic>-Bar`, populates `g["Bar"]=<dynamic>`, `g["TAG"]="Bar"`.

`__JOSTRACA_REPLACE__` as a model ref returns the assembled regex
source (debug aid).

`ErrEmptyMatchRegex`, `ErrLookbehind`, `ErrInvalidPath`, `ErrMissingOp`,
`ErrMergeConflict`, `ErrNilRoot` are the sentinel errors.

## Filesystem

```go
type FS interface {
    ReadFile(path string) ([]byte, error)
    WriteFile(path string, data []byte) error
    Exists(path string) bool
    Stat(path string) (FileInfo, error)
    MkdirAll(path string) error
    ReadDir(path string) ([]DirEntry, error)
    Remove(path string) error
    Rename(oldpath, newpath string) error
}
```

Two implementations:

- `OsFS{}` — host filesystem; absolute paths supplied via `Options.Folder`.
- `*MemFS` from `NewMemFS()` — in-memory; `Vol()` returns a defensive copy.

Internal paths are canonical-`/`. `OsFS` converts to OS-native via
`filepath.FromSlash` at the boundary.

## Result

```go
type Result struct {
    When  int64                       // build timestamp (unix ms)
    Files Files                       // outcome lists per category
    Audit func() Audit                // ordered build action log
    Vol   func() map[string][]byte    // populated when MemFS is in use
    FS    func() FS                   // populated when MemFS is in use
}

type Files struct {
    Preserved, Written, Presented, Diffed, Merged, Conflicted, Unchanged []string
}

type AuditEntry struct {
    Tag  string  // save | preserve | present | diff | merge | protect | unchanged
    Data map[string]any
}
```

## Utilities

| Symbol | Description |
|---|---|
| `Each(subject, EachSpec, fn) []any` | Iterate a slice or map; default-wraps items in `{val$, index$}` / `{key$, val$}` unless `Raw=true` |
| `Get(root, path) any` | Simple dot-path lookup |
| `GetX(root, path) any` | Rich path with ancestry (`:`), filters (`=`, `!=`, `<`, `<=`, `>`, `>=`, `==`, `~`), array filter (`?`), array index, quoted segments |
| `Camelify`, `Snakify`, `Kebabify`, `Partify`, `LCF`, `UCF` | Name-form converters |
| `Names(base, name, prop?)` | Populate variant keys `<prop>__orig`, `<UCF(prop)>`, `<prop>_`, `<prop>-`, `<prop>`, `<UPPER(prop)>` |
| `EscRE(s)` | `regexp.QuoteMeta` |
| `Indent(src, n_or_str)` | Prepend indent to every line after the first |
| `IsBinExt(path)` | Curated extension set |
| `Humanify(when, HumanifyFlags)` | Format unix-ms as `YYYYMMDDhhmmssII` digits or named parts |
| `Deep(dst, srcs...)` | Recursive map merge with right-precedence |
| `CMap`, `VMap`, `OMap` | Object → object/slice projections (sentinel: `CMapCopy`/`CMapKey`/`CMapFilter`) |
| `NewDLog(tag, file)` | Tagged debug logger backed by a package-level locked buffer |

## Logging

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

`DefaultLog{ Out io.Writer }` writes ISO-8601 timestamped lines.

## Errors

```go
type NodeError struct {
    Step     string    // kind name: "file", "copy", ...
    Path     []string  // accumulated component path
    Callsite string    // when Options.Debug is set
    Err      error
}
```

`Generate` returns either an `error` from the define phase (component
methods set `j.st.err`) or a `*NodeError` from the build phase.

## Concurrency

Each `Generate` call constructs its own `*J` and `*jstate`; the package
exports zero mutable globals. Two goroutines calling `Generate`
simultaneously cannot interfere. Verified by
`concurrency_test.go` running under `-race -count=10`.
