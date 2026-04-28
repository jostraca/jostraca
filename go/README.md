# jostraca-go

A Go port of [Jostraca](https://github.com/jostraca/jostraca), the
React-style code- and project-generator framework. Compose file trees
with components — `Project`, `Folder`, `File`, `Content`, `Fragment`,
`Slot`, `Inject`, `Copy`, `List` — and Jostraca walks the tree to
write your output.

## Install

```bash
go get github.com/jostraca/jostraca/go/jostraca
```

## Quick start

```go
package main

import "github.com/jostraca/jostraca/go/jostraca"

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

## How it works — receiver-shadowing closures

The TypeScript original uses Node's `AsyncLocalStorage` to keep the
component nesting noise-free:

```typescript
generate({...}, () => {
  Project({ folder: 'sdk' }, () => {
    Folder({ name: 'src' }, () => File({ name: 'main.ts' }, () => Content('...')))
  })
})
```

Go has no idiomatic equivalent of `AsyncLocalStorage`, and goroutine-
local storage hacks are non-idiomatic. The Go port uses
**receiver-shadowing closures** instead:

```go
j.Generate(opts, func(j *jostraca.J) {                  // outer j shadowed
    j.Project(P{Folder: "sdk"}, func(j *jostraca.J) {  // shadowed again
        j.Folder("src", func(j *jostraca.J) {
            j.File("main.go", func(j *jostraca.J) {
                j.Content("// hi\n")
            })
        })
    })
})
```

Each callback parameter `j` shadows the outer one, so users can never
accidentally use the wrong frame. Compared to the TS version the cost
is one identifier per call site.

**Concurrency.** Each `Generate` call has its own `*J`; the package
exports zero mutable globals. Two goroutines calling `Generate`
simultaneously cannot collide (proven by the 10-goroutine race-checked
regression at `concurrency_test.go`). This is a parity *gain* over
TS — Node single-threads JS.

## Template substitution

Use `$$path$$` syntax to insert values from the model:

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

The full template surface (custom delimiters, regex replace keys,
function-valued model refs, `#Tag` comment markers, eject regions,
streaming `Handle` callback, `__JOSTRACA_REPLACE__` debug sentinel)
matches the TS engine. RE2 caveats apply (no lookbehind/lookahead;
violations are rejected at compile time with `ErrLookbehind`).

## Fragments and slots

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

The fragment file is read from the FS, `<[SLOT:name]>` markers are
replaced with the matching `Slot` body, and an unnamed `<[SLOT]>`
captures all non-Slot children.

## Inject

Replace content between markers in an existing file:

```go
j.Inject("foo.txt", func(j *jostraca.J) {
    j.Content("new content")
})
```

Default markers are `#--START--#\n` / `\n#--END--#`. Override via
`InjectP{Markers: [2]string{"<<begin>>", "<<end>>"}}`.

## Copy

Copy single files or directory trees, applying template substitution
to text files:

```go
j.Folder("static", func(j *jostraca.J) {
    j.Copy(jostraca.CopyProps{From: "/templates/assets"})
    j.Copy(jostraca.CopyProps{From: "/templates/readme.txt", To: "README.txt"})
})
```

Binary files (extension-detected via `IsBinExt`) pass through
untouched. Default ignore pattern is `~$` (matches editor backup
files); configure additional patterns via `Options.Cmp.Copy.Ignore`.

## Existing-file modes

Control how generation interacts with files that already exist:

```go
diffTrue := true
opts := jostraca.Options{
    Existing: jostraca.Existing{
        Txt: jostraca.ExistingTxt{Diff: &diffTrue},
    },
}
```

Modes: `Write` (overwrite), `Preserve` (back up to `.old.<ext>`),
`Present` (write `.new.<ext>`, leave original), `Diff` (write a
2-way conflict-marker render), `Merge` (3-way merge using the
duplicate baseline maintained at `.jostraca/generated/`).

Files containing `JOSTRACA_PROTECT` are never overwritten,
regardless of mode.

## Custom components

Use `Cmp` for reusable component blocks:

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

Or, more idiomatically: define a plain function taking `*J` and call
it directly — the `Cmp` wrapper exists mainly for debug callsite
attribution when `Options.Debug` is set.

## In-memory generation

```go
mem := jostraca.NewMemFS()
j := jostraca.New(jostraca.WithFS(mem), jostraca.WithFolder("/out"))
res, _ := j.Generate(jostraca.Options{}, root)

vol := res.Vol() // map[string][]byte snapshot
```

## Result

`Generate` returns `(Result, error)`:

```go
type Result struct {
    When  int64                       // build timestamp (unix ms)
    Files Files                       // outcome lists per category
    Audit func() Audit                // ordered build action log
    Vol   func() map[string][]byte   // populated when MemFS is in use
    FS    func() FS                   // populated when MemFS is in use
}

type Files struct {
    Preserved, Written, Presented, Diffed, Merged, Conflicted, Unchanged []string
}
```

## Deviations from the TypeScript original

The Go port aims for byte-equal output for the same logical input,
with these intentional ergonomic differences:

- Components are methods on `*J`, not free functions
  (receiver-shadowing closures replace `AsyncLocalStorage`).
- `Generate` returns `(Result, error)` instead of throwing.
- `Options` is a typed struct + functional options
  (`jostraca.WithFolder(...)`, etc.) plus `OptionsFromMap` for
  config sourced from JSON/YAML.
- `Each.OVal` is renamed to `Each.Raw` with inverted semantics so
  Go's zero-value default matches TS's `oval=true` annotation
  default. The TS overloaded callback shapes are reachable through
  narrower Go variants: `EachI(items, func(val, idx))`,
  `EachKV(m, func(val, key, idx))`, `EachKVRaw(m, ...)`,
  `EachF(items, func(val))`.
- `ListProps.NoLine` inverts TS's `props.line === false` opt-out so
  Go zero-value matches the TS default of always emitting a
  trailing `Line('')`.
- `Control.Duplicate` is renamed to `Control.NoDuplicate` with
  inverted semantics; the TS default (duplicate baselines on) is
  Go's zero value.
- RE2 (Go's `regexp`) has no lookbehind; user-supplied regex keys
  containing `(?<=...)` etc. are rejected at compile time.
- `Indent` uses `strings.ReplaceAll` (no JS lookbehind needed).
- The `Point*` orchestration utility is not ported (deferred to a
  future sub-package).
- 2-way diff render uses a unified GENERATED/EXISTING block
  instead of TS's paired-per-region markers (under review for v1.1).

A full deviation list lives in `PORT_PLAN.md` §14.

## Status

The port is feature-complete for v1: all 9 components, all 5
existing-file modes (including 3-way merge), the full template
engine, the must-have utilities, BuildMeta persistence, and
concurrent `Generate` isolation. See `BUILD_LOG.md` for per-phase
implementation notes.

## License

MIT. Copyright (c) Richard Rodger.
