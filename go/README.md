# jostraca-go

A Go port of [Jostraca](https://github.com/jostraca/jostraca), the
React-style code- and project-generator framework. Compose file trees with
components — `Project`, `Folder`, `File`, `Content`, `Fragment`, `Slot`,
`Inject`, `Copy`, `List` — and Jostraca walks the tree to write your
output.

This module is a maintained **port** of the canonical TypeScript package
([`jostraca`](https://www.npmjs.com/package/jostraca)). It aims for
byte-identical output for the same logical input; where Go idiom requires a
different surface, the differences are listed under
[Explanation → Deviations](#deviations-from-the-typescript-original).

```bash
go get github.com/jostraca/jostraca/go
```

---

This README is organised along the four [Diátaxis](https://diataxis.fr)
documentation modes:

- **[Tutorial](#tutorial)** — learning-oriented. Your first generator.
- **[How-to guides](#how-to-guides)** — task-oriented. Specific recipes.
- **[Reference](#reference)** — information-oriented. Types and API.
- **[Explanation](#explanation)** — understanding-oriented. The port's
  design, concurrency model, and deviations from TypeScript.

---

## Tutorial

*A short lesson. Follow it top to bottom.*

Construct a generator with `New`, then describe a component tree. Each
callback receives a `*J` that shadows the outer one — nest the calls to
mirror the folders and files you want.

```go
package main

import jostraca "github.com/jostraca/jostraca/go"

func main() {
    j := jostraca.New(jostraca.WithFolder("./out"))
    _, err := j.Generate(jostraca.Options{}, func(j *jostraca.J) {
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
    })
    if err != nil {
        panic(err)
    }
}
```

Generates:

```
out/
  my-app/
    src/
      index.js       -> console.log("hello world")
    package.json     -> { "name": "my-app" }
```

You declared a tree; Jostraca built it. To insert data, add a model:

```go
j := jostraca.New(jostraca.WithModel(map[string]any{
    "app": map[string]any{"name": "Acme", "version": "1.0.0"},
}))
j.Generate(jostraca.Options{}, func(j *jostraca.J) {
    j.File("config.txt", func(j *jostraca.J) {
        j.Content("App: $$app.name$$ v$$app.version$$\n")
    })
})
// config.txt -> App: Acme v1.0.0
```

The **How-to guides** below cover each capability; the **Explanation**
section covers *why* components are methods on `*J`.

## How-to guides

*Practical recipes. Read only the one you need.*

### Read a template file and fill its slots

```go
j.File("index.html", func(j *jostraca.J) {
    j.Fragment(jostraca.FragmentProps{From: "/templates/page.html"}, func(j *jostraca.J) {
        j.Slot("head", func(j *jostraca.J) {
            j.Content("<title>X</title>")
        })
        j.Slot("body", func(j *jostraca.J) {
            j.Content("<h1>Hello</h1>")
        })
    })
})
```

The fragment file is read from the FS, `<[SLOT:name]>` markers are replaced
with the matching `Slot` body, and an unnamed `<[SLOT]>` captures all
non-`Slot` children.

### Edit an existing file in place

```go
j.Inject("foo.txt", func(j *jostraca.J) {
    j.Content("new content")
})
```

Default markers are `#--START--#\n` / `\n#--END--#`. Override via
`InjectP{Markers: [2]string{"<<begin>>", "<<end>>"}}`.

### Copy files and directories

```go
j.Folder("static", func(j *jostraca.J) {
    j.Copy(jostraca.CopyProps{From: "/templates/assets"})
    j.Copy(jostraca.CopyProps{From: "/templates/readme.txt", To: "README.txt"})
})
```

Binary files (extension-detected via `IsBinExt`) pass through untouched.
The default ignore pattern is `~$` (editor backup files); add more via
`Options.Cmp.Copy.Ignore`.

### Regenerate without clobbering hand edits

```go
diffTrue := true
opts := jostraca.Options{
    Existing: jostraca.Existing{
        Txt: jostraca.ExistingTxt{Diff: &diffTrue},
    },
}
```

Modes: `Write` (overwrite), `Preserve` (back up to `.old.<ext>`),
`Present` (write `.new.<ext>`, leave original), `Diff` (write a 2-way
conflict-marker render), `Merge` (3-way merge using the duplicate baseline
maintained at `.jostraca/generated/`). Files containing `JOSTRACA_PROTECT`
are never overwritten, regardless of mode.

### Set file permissions

```go
j.FileP(jostraca.FileProps{Name: "run.sh", Mode: 0o755}, func(j *jostraca.J) {
    j.Content("#!/bin/sh\n...")
})
```

`Mode` sets POSIX permission bits on the generated file; zero leaves the
provider default. An explicit mode wins over the existing file's mode on
regeneration, and applies to the target only — not the `.old`/`.new`
sidecars or the merge baseline. It is preserved across the atomic
write-then-rename via the optional `Chmod` capability on the `FS` interface
(`OsFS` implements it; `MemFS` does not track modes). **Windows** has no
POSIX permission bits: a `Mode` is accepted but only toggles the read-only
attribute, so `0o755` has no execute-bit effect and nothing errors.

### Generate in memory

```go
mem := jostraca.NewMemFS()
j := jostraca.New(jostraca.WithFS(mem), jostraca.WithFolder("/out"))
res, _ := j.Generate(jostraca.Options{}, root)

vol := res.Vol() // map[string][]byte snapshot
```

### Make a reusable component

Define a plain function taking `*J` and call it directly — that is the
idiomatic component. The `Cmp` wrapper exists mainly for debug call-site
attribution when `Options.Debug` is set:

```go
func GoStruct(j *jostraca.J, name string, fields []string) {
    j.Line("type " + name + " struct {")
    for _, f := range fields {
        j.Line("  " + f)
    }
    j.Line("}")
}

j.File("models.go", func(j *jostraca.J) {
    j.Cmp("GoStruct", func(j *jostraca.J) {
        GoStruct(j, "User", []string{"ID int", "Name string"})
    })
})
```

## Reference

*Information-oriented. Look things up here.*

The complete API reference is **[REFERENCE.md](./REFERENCE.md)**; the Go
shapes mirror the TypeScript reference function-for-function.

### `Generate` result

`Generate` returns `(Result, error)`:

```go
type Result struct {
    When  int64                     // build timestamp (unix ms)
    Files Files                     // outcome lists per category
    Audit func() Audit              // ordered build action log
    Vol   func() map[string][]byte  // populated when MemFS is in use
    FS    func() FS                 // populated when MemFS is in use
}

type Files struct {
    Preserved, Written, Presented, Diffed, Merged, Conflicted, Unchanged []string
}
```

### Template surface

Use `$$path$$` for model substitution. The full surface (custom
delimiters, regex replace keys, function-valued model refs, `#Tag` comment
markers, eject regions, the streaming `Handle` callback, the
`__JOSTRACA_REPLACE__` debug sentinel) matches the TS engine. RE2 caveats
apply: no lookbehind/lookahead — violations are rejected at compile time
with `ErrLookbehind`.

### Diff and merge

`Diff`, `Merge`, `HasConflicts`, `Lines`, `LCS`, `AlignLCS`, and `Hunks` in
`diff.go` are jostraca's own engine, mirroring `ts/src/diff.ts`
function-for-function so both stacks produce byte-identical output. The Go
shape uses `DiffSpec{When, Last, Kind, Labels}` in place of the options
object. `testdata/parity/diff_corpus.json` records TS's exact output for
1,190 merge/diff cases; `TestDiffCorpusMatchesTS` replays them through Go
and asserts byte equality. Both stacks hold `diff.go`/`diff.ts` at 100%
coverage, gated by `./check_diff_coverage.sh` and `npm run
test-diff-coverage`.

## Explanation

*Understanding-oriented. Background and design decisions.*

### Receiver-shadowing closures (instead of AsyncLocalStorage)

The TypeScript original uses Node's `AsyncLocalStorage` to keep component
nesting noise-free — child components discover their parent implicitly:

```typescript
generate({...}, () => {
  Project({ folder: 'sdk' }, () => {
    Folder({ name: 'src' }, () => File({ name: 'main.ts' }, () => Content('...')))
  })
})
```

Go has no idiomatic equivalent, and goroutine-local storage hacks are
non-idiomatic. The port uses **receiver-shadowing closures** instead: each
callback takes a `*J` parameter that shadows the outer one.

```go
j.Generate(opts, func(j *jostraca.J) {                 // outer j shadowed
    j.Project(P{Folder: "sdk"}, func(j *jostraca.J) {  // shadowed again
        j.Folder("src", func(j *jostraca.J) {
            j.File("main.go", func(j *jostraca.J) {
                j.Content("// hi\n")
            })
        })
    })
})
```

Because each `j` shadows the one above, you can never accidentally use the
wrong frame. The cost, compared to TS, is one identifier per call site.

### Concurrency — a parity *gain*

Each `Generate` call has its own `*J`; the package exports zero mutable
globals. Two goroutines calling `Generate` simultaneously cannot collide
(proven by the 10-goroutine race-checked regression in
`concurrency_test.go`). This is stronger than the TS original, which relies
on Node single-threading JS.

### Deviations from the TypeScript original

Intentional ergonomic differences, on top of byte-equal output for the
same logical input:

- Components are methods on `*J`, not free functions (receiver-shadowing
  closures replace `AsyncLocalStorage`).
- `Generate` returns `(Result, error)` instead of throwing.
- `Options` is a typed struct + functional options
  (`jostraca.WithFolder(...)`, etc.) plus `OptionsFromMap` for config
  sourced from JSON/YAML.
- `Each.OVal` is renamed to `Each.Raw` with inverted semantics so Go's
  zero-value default matches TS's `oval=true` annotation default. The TS
  overloaded callback shapes are reachable through narrower Go variants:
  `EachI(items, func(val, idx))`, `EachKV(m, func(val, key, idx))`,
  `EachKVRaw(m, ...)`, `EachF(items, func(val))`.
- `ListProps.NoLine` inverts TS's `props.line === false` opt-out so the Go
  zero value matches the TS default of always emitting a trailing
  `Line('')`.
- `Control.Duplicate` is renamed to `Control.NoDuplicate` with inverted
  semantics; the TS default (duplicate baselines on) is Go's zero value.
- RE2 (Go's `regexp`) has no lookbehind; user-supplied regex keys
  containing `(?<=...)` etc. are rejected at compile time.
- `Indent` uses `strings.ReplaceAll` (no JS lookbehind needed).
- The `Point*` orchestration utility is not ported (deferred to a future
  sub-package).
- `J.Cmp` runs its body inline without allocating a node, where TS's
  `cmp()` allocates one and routes it through the Fragment filter. A user
  component used as a direct Fragment child is therefore a non-`Slot` child
  in TS but invisible in Go, so the "non-`Slot` child with no unnamed
  `<[SLOT]>` marker" error fires in TS and not in Go for that one shape. A
  user component that *wraps* a `Slot` is already broken in TS today (the
  slot name is never collected and the marker survives verbatim); Go
  handles it. Not reconciled: aligning it means giving `Cmp` a node, which
  changes the shape of every Go component tree.
- `Deep` builds a new map or slice instead of mutating and returning its
  first argument the way TS `deep` does. Callers that use the return value
  see no difference; callers relying on the aliasing would. Merge semantics
  themselves match, nil/null included: a nil *argument* is skipped (TS
  `undefined`), while a nil map value or slice element overwrites (TS
  `null`). Only `[]any` merges index-by-index — a typed slice such as
  `[]string` takes the right-wins path.
- A template value that is an integer wider than 2^53 keeps its exact value
  in Go and loses precision in TS, whose numbers are all `float64`.
  Everything a `float64` can hold exactly formats identically on both
  stacks (`template_format_test.go` pins this); beyond that there is
  nothing to reconcile.

Design background lives in [`PORT_PLAN.md`](./PORT_PLAN.md);
per-phase implementation notes in [`BUILD_LOG.md`](./BUILD_LOG.md).

### Status

The port is feature-complete for v1: all 9 components, all 5 existing-file
modes (including 3-way merge), the full template engine, the must-have
utilities, BuildMeta persistence, and concurrent `Generate` isolation.

---

## Build and test

```bash
cd go && go build ./... && go test ./...
```

From the repo root, `make all` builds and tests both the Go and TypeScript
stacks. TypeScript is the source of truth: change it first, then bring Go
into parity. See the top-level [`CLAUDE.md`](../CLAUDE.md).

## License

MIT. Copyright (c) Richard Rodger.
