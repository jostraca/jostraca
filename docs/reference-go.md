# Reference: the Go port

`github.com/jostraca/jostraca/go` is a maintained port of the canonical
TypeScript package. It aims at byte-identical output for the same
logical input, and where Go idiom forced a different surface, this page
says so.

<!-- test: skip environment setup; the go toolchain is outside the scenario vocabulary -->
```bash
go get github.com/jostraca/jostraca/go
```

TypeScript is the source of truth. When the two disagree, TypeScript
wins and Go is the one that changes — see the
[explanation](explanation.md#two-implementations) for why that rule and
not a better-looking one.

The Go snippets on this page are not executed by the documentation
suite, which runs JavaScript; each carries a skip naming the Go test
that pins it instead. The first one below was compiled and run to
produce the output shown.

## Constructing and generating

```
New(...Option) *J
(*J).Generate(Options, func(*J)) (Result, error)
```

`New` seeds global options. Component methods must be called on the
`*J` passed **into** the `Generate` callback, not on the value `New`
returned.

<!-- test: skip a Go sample; the API is pinned by go/builder_test.go and go/jostraca_test.go -->
```go
package main

import (
	"fmt"

	jostraca "github.com/jostraca/jostraca/go"
)

func main() {
	j := jostraca.New(
		jostraca.WithFolder("./out"),
		jostraca.WithModel(map[string]any{
			"app": map[string]any{"name": "acme"},
		}),
	)

	res, err := j.Generate(jostraca.Options{}, func(j *jostraca.J) {
		j.Project(jostraca.ProjectProps{Folder: "acme"}, func(j *jostraca.J) {
			j.File("package.json", func(j *jostraca.J) {
				j.Content("{ \"name\": \"$$app.name$$\" }\n")
			})
			j.Folder("src", func(j *jostraca.J) {
				j.File("index.js", func(j *jostraca.J) {
					j.Content("console.log(\"$$app.name$$\")\n")
				})
			})
		})
	})
	if err != nil {
		panic(err)
	}
	fmt.Println("written:", res.Files.Written)
}
```

It prints `written: [out/acme/package.json out/acme/src/index.js]`, and
`out/acme/package.json` holds `{ "name": "acme" }`.

Note the shadowing: each callback receives a `*J` bound to the node it
is inside. That is what replaces the ambient `AsyncLocalStorage` the
TypeScript components use, and it is why the parameter is named `j`
again in every closure.

## Components

Each component has a positional convenience method and, where there is
more than one prop, a `…P` variant taking a props struct.

| method | props struct | fields |
|---|---|---|
| `Project(ProjectProps, body)` | `ProjectProps` | `Name`, `Folder` |
| `Folder(name, body)` | — | — |
| `File(name, body)` / `FileP(FileProps, body)` | `FileProps` | `Name`, `Exclude any`, `Mode fs.FileMode` |
| `Content(src)` / `ContentP(ContentProps)` | `ContentProps` | `Src`, `Name`, `Indent any`, `Replace map[string]any`, `Extra map[string]any` |
| `Line(src)` / `LineP(ContentProps)` | as `Content` | |
| `Fragment(FragmentProps, body)` / `FragmentP` | `FragmentProps` | `From`, `Indent`, `Replace`, `Eject` |
| `Slot(name, body)` / `SlotP(SlotProps, body)` | `SlotProps` | `Name` |
| `Inject(name, body)` / `InjectP(InjectProps, body)` | `InjectProps` | `Name`, `Markers`, `Exclude` |
| `Copy(CopyProps)` | `CopyProps` | `From`, `To`, `Exclude`, `Replace` |
| `List(items, body)` / `ListP(ListProps, body)` | `ListProps` | `Item`, `Indent`, `NoLine`, `Replace` |
| `Cmp(name, fn)` | — | a user component |

`List`'s body signature is `func(j *J, item any)`, so the item arrives
as a parameter rather than through a props object.

Semantics follow the [component reference](reference-components.md)
unless the deviations below say otherwise.

## Options

`Options` is a struct, and `New` also takes functional options:

```
WithFolder(string)   WithModel(map[string]any)   WithMeta(map[string]any)
WithLog(Log)         WithDebug(string)           WithMem()
WithVol(map[string][]byte)                       WithFS(FS)
WithNow(func() int64)                            WithExisting(Existing)
WithControl(Control) WithBuild(bool)
```

`OptionsFromMap` builds an `Options` from a decoded JSON or YAML map,
for configuration that arrives as data.

Two fields invert their TypeScript counterparts so that Go's zero value
matches the TypeScript default:

- `Control.NoDuplicate` inverts `control.duplicate`.
- `ListProps.NoLine` inverts `props.line === false`.

The `existing` flags are pointers (`*bool`) so that "unset" and
"explicitly false" stay distinguishable through the option merge:

```
type ExistingTxt struct { Write, Preserve, Present, Diff, Merge *bool }
type ExistingBin struct { Write, Preserve, Present *bool }
```

## The result

```
type Result struct {
	When  int64
	Files Files
	Audit func() Audit
	Vol   func() map[string][]byte
	FS    func() FS
}

type Files struct {
	Preserved, Written, Presented, Diffed, Merged, Conflicted, Unchanged []string
}
```

`Audit` is `[]AuditEntry`, each `{Tag string; Data map[string]any}`.

## Utilities

The same helper surface, capitalised, plus narrower variants where Go
cannot overload:

| TypeScript | Go |
|---|---|
| `each` | `Each(subject, EachSpec, apply)`, plus `EachF`, `EachI`, `EachKV`, `EachKVRaw` |
| `get` | `Get(root, path)` |
| `getx` | `GetX(root, path any)`, `GetXS(root, string)`, `GetXPath(root, []string)` |
| `camelify` / `snakify` / `kebabify` / `partify` | `Camelify`, `Snakify`, `Kebabify`, `Partify` |
| `names` | `Names(base, name, prop...)`, `NamesP(base, name, prop)` |
| `template` | `Template(src, model, *TemplateSpec)`, `TemplateF`, `TemplateR` |
| `indent` | `Indent(src, ind any)` |
| `isbinext` / `isbincontent` | `IsBinExt`, `IsBinContent` |
| `deep` | `Deep(dst, srcs...)` |
| `omap` | `OMap(m) [][2]any` |
| `cmap` / `vmap` | `CMap`, `VMap` |
| `DiffUtil.merge` | `Merge(generated, baseline, existing, DiffSpec) MergeResult` |
| `DiffUtil.diff` | `Diff(generated, existing, DiffSpec) DiffResult` |
| `DiffUtil.hasConflicts` | `HasConflicts`, `HasConflictsLabel` |
| `DiffUtil.lines` / `lcs` / `alignLcs` / `hunks` | `Lines`, `LCS`, `AlignLCS`, `Hunks` |

`OMap` returns an ordered pair list rather than a map, because a Go map
has no order to return. That is also why `Each`, `CMap` and `VMap` sort
object keys on **both** sides: sorted is the only order the two stacks
can agree on.

## Deviations from TypeScript

Every difference below is deliberate, and each is either Go idiom or a
consequence of the language.

**Shape of the API**

- Components are methods on `*J`, not free functions. Receiver-shadowing
  closures replace `AsyncLocalStorage`.
- `Generate` returns `(Result, error)` rather than throwing.
- `Options` is a typed struct with functional options, plus
  `OptionsFromMap`.

**Inverted flags, so the Go zero value is the TypeScript default**

- `EachSpec.Raw` inverts `oval`; `EachSpec.NoMark` inverts `mark`.
- `ListProps.NoLine` inverts `line`.
- `Control.NoDuplicate` inverts `duplicate`.

`EachSpec` also has no `call` flag, and its `Sort` is a boolean: there
is no sort-by-property in Go.

**Language limits**

- Go's `regexp` is RE2 and has no lookbehind, so a user-supplied regex
  key containing `(?<=…)` is rejected at compile time.
- A template value that is an integer wider than 2^53 keeps its exact
  value in Go and loses precision in TypeScript, where every number is a
  `float64`. Everything a `float64` holds exactly formats identically on
  both stacks, and that is pinned by a test.

**Behavioural differences worth knowing**

- `Deep` builds a new map or slice instead of mutating and returning its
  first argument. Callers that use the return value see no difference;
  callers relying on the aliasing would. The merge semantics themselves
  match, `nil` included: a `nil` **argument** is skipped, as TypeScript
  skips `undefined`, while a `nil` map value or slice element
  overwrites, as TypeScript's `null` does. Only `[]any` merges by index;
  a typed slice such as `[]string` takes the right-wins path, as does
  any value carrying a type of its own — which is TypeScript's
  custom-constructor rule.
- `J.Cmp` runs its body inline without allocating a node, where the
  TypeScript `cmp()` allocates one and routes it through the fragment
  filter. So a user component used as a direct `Fragment` child is a
  non-`Slot` child in TypeScript and invisible in Go, and the
  "non-`Slot` child with no unnamed marker" error fires in TypeScript
  only. A component that *wraps* a `Slot` is broken in TypeScript today
  — the slot name is never collected and the marker survives verbatim —
  and Go handles it. Reconciling means giving `Cmp` a node, which
  changes the shape of every Go component tree, so it stands.
- `PointUtil` is not ported.

## Concurrency

`Generate` calls are isolated from one another: the builder state hangs
off the `*J` handed to the callback rather than off any process-global,
so two generates can run at once without seeing each other's trees.
`go/concurrency_test.go` pins that.

This is the one place the Go design is plainly better than the
TypeScript one, which keeps its `AsyncLocalStorage` on `global` so that
two copies of the package interoperate.

## Parity, and where it is pinned

Behaviour shared by both stacks lives in
[`../test/spec/`](../test/spec/): language-neutral TSV cases that
`ts/test/spec.test.ts` and `go/spec_test.go` both read. An unknown case
is a hard failure on both sides, so a row cannot be silently skipped by
one.

Beyond that, `go/testdata/parity/` holds whole-scenario fixtures
generated from canonical TypeScript, and CI regenerates them and fails
on any diff — so a TypeScript change cannot leave the Go expectations
stale.

Design background is in [`../go/PORT_PLAN.md`](../go/PORT_PLAN.md), and
the per-phase implementation notes in
[`../go/BUILD_LOG.md`](../go/BUILD_LOG.md).

## Build and test

<!-- test: skip environment setup; the go toolchain is outside the scenario vocabulary -->
```sh
cd go
go build ./...
go test ./...
```

From the repository root, `make all` builds and tests both stacks.
