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
wins and Go is the one that changes—see the
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
`*J` passed **into** the `Generate` callback, while that `Generate` runs,
and not on the value `New` returned. Calling one on that value, or on a
`*J` kept from a callback after its `Generate` has returned, panics at
once with a message naming the component:

```
jostraca: component File called outside Generate(); components can only be used inside the callback passed to Generate()
```

It is a panic rather than an error because component methods have no
error return, and this is a mistake in the calling code. A later
`Generate` on the same builder is unaffected.

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
| `Folder(name, body)` |—|—|
| `File(name, body)` / `FileP(FileProps, body)` | `FileProps` | `Name`, `Exclude any`, `Mode fs.FileMode` |
| `Content(src)` / `ContentP(ContentProps)` | `ContentProps` | `Src`, `Name`, `Indent any`, `Replace map[string]any`, `Extra map[string]any`, `Raw bool` |
| `Line(src)` / `LineP(ContentProps)` | as `Content` | |
| `Fragment(FragmentProps, body)` / `FragmentP` | `FragmentProps` | `From`, `Indent`, `Replace`, `Eject` |
| `Slot(name, body)` / `SlotP(SlotProps, body)` | `SlotProps` | `Name` |
| `Inject(name, body)` / `InjectP(InjectProps, body)` | `InjectProps` | `Name`, `Markers`, `Exclude` |
| `Copy(CopyProps)` | `CopyProps` | `From`, `To`, `Exclude any`, `Replace` |
| `List(items, body)` / `ListP(ListProps, body)` | `ListProps` | `Item`, `Indent`, `NoLine` |
| `Cmp(name, fn)` |—| a user component |

`List`'s body signature is `func(j *J, it ListItemProps)`, mirroring the
`{item, indent, replace}` object TypeScript hands each child.
`ListItemProps` carries `Item any`, `Indent any` and
`Replace map[string]any`. The last two are meant to be passed straight
through—neither does anything on its own:

<!-- test: skip a Go sample; the body signature is pinned by go/list_item_test.go and the list_item_macro parity snapshot -->
```go
j.ListP(ListProps{Item: items, Indent: "  "}, func(j *J, it ListItemProps) {
    j.ContentP(ContentProps{
        Src:     "{item.name}: {item.role}\n",
        Indent:  it.Indent,
        Replace: it.Replace,
    })
})
```

`{item.path}` resolves with `GetX`, so nested paths work. The three quiet
limits are the same as TypeScript's: a bare `{item}`, a `$`-suffixed key
(`{item.index$}`), and an unresolved path all yield the empty string,
unlike `$$path$$`, which is left in place.

`ListProps` has no `Replace` field, matching TypeScript, where `List`'s
own `replace` prop is accepted and never used.

`ContentProps.Raw` skips the render, so the bytes go through as given:
no model substitution, and `Replace` and `Extra` are not read. `Indent`
still applies. It is `false` by default in both ports, and the
[component reference](reference-components.md#raw) has the reasoning.

`Line` and `LineP` append their newline unconditionally, so
`Line("a\n")` writes `a\n\n` exactly as TypeScript does. There is no
`Arg` field: a positional `Content(src)` is the Go spelling of the same
thing, and a component tree given as data may state `arg` as a key on
either component.

`CopyProps.Exclude` takes a `bool`, a non-empty `string`, a
`*regexp.Regexp`, or a list of strings and regular expressions as
`[]any`, `[]string` or `[]*regexp.Regexp`. `Fragment` and `CopyFiles`
check the types of their props when the component is called, on the
typed API and in a [component tree](#a-component-tree-as-data) alike:
`From` and `To` are strings, `Replace` a map, `Fragment`'s `Indent` a
string or a number, `Eject` a list of non-empty strings or regular
expressions, and `Exclude` one of the forms just listed. A wrong type stops the run before
anything is written, with the message TypeScript gives. `Content` and
`Line` `Indent` are not checked in either port.

Semantics follow the [component reference](reference-components.md)
unless the deviations below say otherwise.

## `Check`

```
Check(Options, root) => (CheckResult, error)
```

The twin of TypeScript's [`check`](reference-options.md#check): generate
into memory, compare with a folder, and answer with the difference as
data. It takes the same `Options` as `Generate`, and `Folder` is the
folder checked; `FS` is the filesystem holding the committed tree, so a
test can hold one in-memory tree against another. Both fall back to the
value given to `New`, then to `"."` and `OsFS`, as they do in
TypeScript.

<!-- test: skip a Go sample; the behaviour is pinned by go/check_test.go and the TypeScript twin's suite -->
```go
res, err := jostraca.New().Check(jostraca.Options{Folder: "app"}, root)
if err != nil {
    return err
}
for _, d := range res.Drift {
    fmt.Printf("%s: %s
", d.Kind, d.Path)
}
```

`CheckResult` carries `Folder`, `Checked`, `Drift` and `Files`.
`Files` is the run report of the generate behind the comparison, with
paths in the form a plain `Generate` reports for the folder as given: a
relative `Folder` gives relative paths, as in TypeScript. A
`Drift` is `Path`, `Kind` (`DriftMissing`, `DriftContent` or
`DriftMode`), the `Generated` and `Existing` bytes, and `Mode` with
`ExistingMode` on a mode difference. What is compared, and what the
shadowed folder refuses to let influence the answer, is the same on
both sides and documented on that page.

## A component tree as data

`CmpTree` is the twin of TypeScript's
[`cmpTree`](reference-components.md#cmptree): a tree of decoded JSON in,
a define-phase callback out, generated by the same components a
hand-written generator calls.

<!-- test: skip a Go sample; the behaviour is pinned by go/tree_test.go and the TypeScript twin's suite -->
```go
var tree any
if err := json.Unmarshal(b, &tree); err != nil {
    return err
}
root, err := jostraca.CmpTree(tree, jostraca.CmpTreeOptions{Raw: true})
if err != nil {
    return err
}
res, err := jostraca.New(jostraca.WithFolder("out")).Generate(jostraca.Options{}, root)
```

`CmpTree` returns `(func(*J), error)` rather than throwing, and walks
the whole tree before returning, so a malformed node is reported by the
call that reads it. `CmpTreeOptions` carries `Cmp map[string]CmpTreeCmp`
for components of your own and `Raw bool` for a tree whose text is
already final. The node vocabulary, the refusals, and the option
semantics are the ones on that page; both ports generate the same bytes
from the same tree. A component name resolves as in TypeScript: a
`CmpTreeOptions.Cmp` entry under the name as written, then the
built-in, then the deprecated alias, and an unknown name is refused
before the node's props are read.

Two differences the language forces:

- A child thunk takes the inherited props as a parameter, because a Go
  component body is `func(*J)` and carries nothing of its own.
- There is no inherited-name hazard to guard: a Go map answers only for
  keys it holds, so `toString` was never a component here.

## Options

`Options` is a struct, and `New` also takes functional options:

```
WithFolder(string)   WithModel(map[string]any)   WithMeta(map[string]any)
WithLog(Log)         WithDebug(string)           WithMem()
WithoutMem()         WithVol(map[string][]byte)  WithFS(FS)
WithNow(func() int64)                            WithExisting(Existing)
WithControl(Control) WithBuild(bool)
```

With no `Log`, a run prints through `DefaultLog`, which splits the
levels as the TypeScript console logger does: `Trace`, `Debug` and
`Info` to standard output, `Warn`, `Error` and `Fatal` to standard
error, each as one `<ISO time> LEVEL <args>` line. `DefaultLog{Out: w}`
sends every level to `w`.

`OptionsFromMap` builds an `Options` from a decoded JSON or YAML map,
for configuration that arrives as data. The map is validated by the
same closed schema as the TypeScript options, through the Go port of
`shape`, so an unknown key at any depth or a mistyped value is an error
with the TypeScript message text: `{"control": {"dryrun": "yes"}}` is
refused rather than read as no dry run. A `vol` value is a string or
`[]byte` (a file) or `nil` (an empty directory). The map form can tell
`""` from an absent key, so it refuses `{"folder": ""}` as TypeScript
does.

A `fs`, `now` or `log` entry must hold an `FS`, a `func() int64` or a
`Log`. A JSON value in one of those places is refused with the
TypeScript text, `fs: nil` included; `now: nil` and `log: nil` mean
"not supplied", as `null` does there. A Go value of the wrong type,
which JSON cannot hold, is refused with a Go message. A
`cmp.Copy.ignore` string is a regular expression source, compiled with
Go's `regexp`, so a pattern only JavaScript accepts, such as a
lookbehind, is refused here alone, and an invalid pattern reports the
engine's own message after `Jostraca Options: property "cmp.Copy.ignore": `.
An object value rendered inside a message lists its keys sorted, since
a decoded Go map keeps no insertion order.

### `WithMem` and `WithVol`

`Mem` switches an in-memory filesystem on and `Vol` seeds it, matching
TypeScript's `{mem: true}` and `vol`:

<!-- test: skip a Go sample; the behaviour is stated from a compiled probe -->
```go
j := jostraca.New(
	jostraca.WithMem(),
	jostraca.WithVol(map[string][]byte{"/tpl/x.txt": []byte("hi")}),
	jostraca.WithFolder("/out"),
)
res, err := j.Generate(jostraca.Options{}, root)
// nothing touched the real filesystem;
// res.Vol() holds the generated tree, res.FS() the provider.
```

Four rules, all shared with TypeScript:

- **`Vol` without `Mem` does nothing.** `Mem` is the switch.
- **The provider is chosen per call**: the per-call `FS`, else the
  in-memory volume when `Mem` is on for the call, else the global `FS`
  (`WithFS`), else `OsFS`. So `New(WithMem(), WithFS(x))` writes to
  memory, and only `Options{FS: x}` on the call beats `Mem`.
- **A global `Mem` is reused across `Generate` calls**, so a second run
  regenerates over the first run's output—unless that call passes its
  own `Vol`, which seeds a fresh volume from the global seed merged with
  the call's. A per-call `Mem` pointing at `false`, which is what
  `WithoutMem()` sets, turns it off for that call.
- **`Result.Vol` and `Result.FS` are set exactly when `Mem` is on for
  the call**: `Vol` is the in-memory volume and `FS` the provider used.
  A provider you supply, even a `MemFS`, gets neither.

A `nil` value in `Vol` seeds an empty directory, the same convention
`Result.Vol()` reports one with; an empty file is a non-nil empty slice.

Supplying your own `MemFS` is still the right choice when a test wants
to seed the filesystem by writing into it. Read the output from that
`MemFS` directly, since `Result.Vol` is nil for a supplied provider:

<!-- test: skip a Go sample; the explicit-provider route -->
```go
mem := jostraca.NewMemFS()
j := jostraca.New(jostraca.WithFS(mem), jostraca.WithFolder("/out"))

res, err := j.Generate(jostraca.Options{}, root)
// mem.ReadFile("/out/a.txt") returns the generated bytes.
```

Until v0.35.0 both options were inert: `WithMem()` ran against the real
filesystem and returned `Vol` and `FS` as `nil` with no error, so a
TypeScript in-memory test translated across by keeping `mem` and `vol`
passed while writing to the working directory. See #37.

### Per-call `Cmp` and `Name` are dropped

The option merge copies `Folder`, `Meta`, `FS`, `Now`, `Log`, `Debug`,
`Model`, `Build`, `Mem`, `Vol`, `Existing`, `Control` and `Exclude` from
the `Generate` call. It does **not** copy `Cmp` or `Name`, and there is
no `WithCmp`. Verified with a `Copy` and an ignore pattern:

| where the ignore list was set | what was copied |
|---|---|
| `Generate(Options{Cmp: …})` | `keep.txt` **and** `skip.log`—ignored |
| a global option on `New` | `keep.txt` only—honoured |

So the only route to `Options.Cmp.Copy.Ignore` today is a hand-written
option closure passed to `New`:

<!-- test: skip a Go sample; the workaround for the missing WithCmp, from the same probe -->
```go
j := jostraca.New(
	jostraca.WithFolder("./out"),
	func(o *jostraca.Options) { o.Cmp = cmp },
)
```

TypeScript has no equivalent hole: `cmp` is an ordinary option and the
per-call value reaches the copy operation.

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

A per-call `Existing` overlays the global one flag by flag: a `nil`
per-call pointer inherits the global flag, and a non-`nil` one replaces
it, including an explicit `false`.

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

Every `Files` category is a list, empty rather than `nil`, on every run
including a define-only or empty one, and `Files` carries TypeScript's
lowercase JSON keys, so `json.Marshal(res.Files)` has the TypeScript
shape.

`Audit` is `[]AuditEntry`, each `{Tag string; Data map[string]any}`, with
the tags, fields and order of the TypeScript
[audit](reference-options.md#audit). `Audit()` returns an empty, non-nil
slice when nothing was recorded. An `err` value is a Go error whose text
is Go's, not Node's.

`Vol`, when `Mem` is on, snapshots the volume: every file's content, plus a **nil** entry for
every empty directory. A directory appears only while it is empty—otherwise
its children stand for it—mirroring TypeScript's
`vol.toJSON()`, which records one as `null`. An empty *file* is a non-nil
zero-length slice, so a caller that wants files alone should test
`v != nil` rather than `len(v) > 0`.

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
object keys on **both** sides: sorted by UTF-16 code unit, which is
JavaScript's default string order, is the only order the two stacks can
agree on. It differs from byte order only when a character outside the
Basic Multilingual Plane is compared with one in U+E000 to U+FFFF, and
the directory walk of a `Copy` follows the same order.

`Get` and `GetX` step through any Go map with string-like keys and any
slice or array, as TypeScript steps through its one object type. A step
is an own property: a map key that is present (a key holding `nil`
counts as present), a canonical array index (`0` to `4294967294`, with
no sign, leading zero or padding) or `length` on a slice, and `length`
or a canonical index on a string, in UTF-16 units. A map with integer
keys resolves a canonical decimal key; any other key type is absent.
`Get(m, "")` reads the key `""`, as TypeScript does. The `GetX`
comparison operators have the JavaScript semantics the
[utilities reference](reference-utilities.md#operators) states.

A `$$ref$$` in a template resolves with `GetX`, with the whole `getx`
grammar, exactly as TypeScript resolves it with `getx`; an unresolved
ref (`nil`, or a NaN number) leaves the macro in place. A plain replace
value formats as a replace function's return does: `nil` inserts
nothing, a `float64` prints as JavaScript prints a number, an integer in
decimal, and a composite through the JSON emitter. A `func() any`
returning `nil` inserts nothing, as TypeScript's `() => null` does.

`Eject` applies only when both markers are present: a `nil`, or a typed
nil `*regexp.Regexp`, in either slot leaves the source unchanged. An
empty-string marker is a real literal marker.

`NamesP(base, name, "")` uses the empty prop as given and sets the keys
`__orig`, `""`, `_` and `-`; only an omitted prop defaults to `name`.

`EachSpec.NoMark` is TypeScript's `mark: false` and suppresses every
stamp, `index$` on a wrapped scalar included; `Raw` is `oval: false`.
Without `Raw` only a scalar is wrapped, and a slice, array, map or
struct passes through unwrapped, as a JavaScript object does. `Sort` on
a slice is JavaScript's default sort: stable, by `String(item)` in
UTF-16 order. `Sort` on a map sorts its entries by value when the first
value is not object-like.

`CMapFilter` keeps the field when it is truthy in the JavaScript sense
and drops the entry otherwise, and `CMapFilterFn(fn)` is TypeScript's
`FILTER(fn)`, including the `[flag, value]` rule. A `nil` or scalar
child projects `nil` fields.

`Indent` takes every numeric kind as a count, `int64`, `uint8` and
`float32` as well as `int` and `float64`; NaN, an infinity, zero, and a
negative count add nothing. `Camelify`, `Snakify`, `Kebabify`, `Names`,
`UCF` and `LCF` use JavaScript's case mapping, and a non-string input
stringifies as `String()` does there (`1000000`, not `1e+06`). `IsBinExt`
follows Node's `path.extname` on the running platform: on POSIX a
backslash is an ordinary character in a name, while on Windows both `/`
and `\` separate.

## Deviations from TypeScript

Every difference below is deliberate, and each is either Go idiom or a
consequence of the language.

`go/README.md` carries the same set for a reader who is already in the
repository. The two lists are not line-for-line: this one groups a few
items that one keeps separate, and covers others in the preceding sections
rather than as bullets. Neither omits anything the other has.

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

- Go's `regexp` is RE2, which has no look-around and no back-references.
  A user-supplied regular expression key holding a lookahead or a
  lookbehind (`(?=…)`, `(?!…)`, `(?<=…)`, `(?<!…)`) is rejected at compile
  time with `ErrLookbehind`, whose message names look-around, and one
  holding a back-reference fails to compile. TypeScript evaluates both.
- A template value that is an integer wider than 2^53 keeps its exact
  value in Go and loses precision in TypeScript, where every number is a
  `float64`. Everything a `float64` holds exactly formats identically on
  both stacks, and that is pinned by a test.
- The meta log's `hlast` and `hwhen` digit form passes 2^53 after the
  year 9007: TypeScript's number rounds (`253402300799999` gives
  `9999123123596000`) where Go's `int64` is exact
  (`9999123123595999`). Outside the years 0000 to 9999 the JavaScript
  ISO year format differs, and beyond ±8.64e15 ms TypeScript throws a
  `RangeError` while Go formats.
- The `GetX` `~` operator compiles its pattern with RE2. A pattern that
  JavaScript evaluates and RE2 rejects, a look-around assertion or a
  back-reference, never matches in Go, where TypeScript tests it. A
  pattern invalid in both, such as `(`, throws in TypeScript and is a
  silent non-match in Go. The two dialects also differ at their edges.
- Go's Unicode tables and Node's ICU can differ by Unicode version for
  newly assigned characters, so a case helper can map one of those
  differently.

**Behavioural differences worth knowing**

- `Deep` builds a new map or slice instead of mutating and returning its
  first argument. Callers that use the return value see no difference;
  callers relying on the aliasing would. The merge semantics themselves
  match, `nil` included: `nil` is TypeScript's `null` at every position,
  so a `nil` argument replaces the accumulated base exactly as a `nil`
  member does, `Deep(m, nil)` is `nil` and `Deep(m, nil, x)` is `x`.
  TypeScript's `undefined`, which Go does not have, is spelled by not
  passing the argument, and a typed nil map is still a map that merges
  as an empty one. Only `[]any` merges by index; a typed slice such as
  `[]string` takes the right-wins path, as does any value carrying a type
  of its own—which is TypeScript's custom-constructor rule.
- **The option merge drops per-call `Cmp` and `Name`**, so
  `cmp.Copy.ignore` has to be set on `New`. Described earlier, with what to
  do instead, and in `go/README.md`'s deviations list too.
- A user component that *wraps* a `Slot` is broken in TypeScript—the
  slot name is never collected and the marker survives verbatim—and Go
  matches it. `J.Cmp` allocates a `kind: 'none'` node and passes through
  the Fragment filter, as TypeScript's `cmp()` does, so a user component
  used as a direct `Fragment` child behaves identically on both sides: the
  filter rejects it on the scan, an unnamed `<[SLOT]>` marker accepts it
  once, and without such a marker the build fails on both. Until v0.35.0
  Go ran the body inline with no node, so the filter never saw it—three
  runs against TypeScript's zero, and a silent body wrote the file where
  TypeScript aborted. See #29.
- A **binary** single-file `Copy` nested inside a `File` splices its raw
  bytes into the enclosing file here; TypeScript contributes nothing and
  logs it. A Go string is a byte string; TypeScript's copy content is a
  `Buffer`, and joining one into a JS string UTF-8 decodes it, so every
  byte that is not valid UTF-8 would become U+FFFD. TypeScript writes
  nothing rather than a corrupted approximation. A **text** copy splices
  identically on both sides, and the copy itself is written intact either
  way.
- A template macro resolving to a **`[]byte`** renders as Go's
  `[104 105]`, and to a **pointer** as `&{1 x}`. Every other composite—maps,
  slices, arrays and structs, of any element type—JSONifies with
  keys in JavaScript's object key order at every depth (canonical
  array-index keys first in ascending numeric order, then the rest by
  UTF-16 code unit), matching TypeScript. Strings are escaped exactly as
  `JSON.stringify` escapes them, so `&`, `<`, `>`, U+2028 and U+2029 are
  written raw, `-0` renders as `0`, and NaN or an infinity inside a
  composite renders as `null`. The meta log uses the same string
  escaping, and keeps its keys in insertion order. Neither exception has
  an obvious right answer: `encoding/json` renders a byte slice as base64
  while TypeScript renders a `Buffer` through its `toJSON` as
  `{"type":"Buffer","data":[…]}`, and dereferencing a pointer raises its
  own questions about nil and about value-versus-reference. Both are
  pinned so they cannot change by accident.
- `Each` stamps `key$` and `index$` only onto a `map[string]any` item.
  TypeScript also writes them onto an array, or any object, as a
  property JSON never shows; Go cannot stamp a slice or a typed map.
- A `CMap` or `VMap` projection of a source field that is absent gives
  `nil`, since Go has no `undefined`, so JSON shows `null` where
  TypeScript omits the key.
- `j.Cmp` takes no props, so a component of your own cannot push a
  `name` onto the node path as a TypeScript component called with a
  `name` prop does. A `File` exclude inside such a component names the
  path without it.
- The `Log` option receives the same warnings as TypeScript, replayed
  to `Debug` after a successful run with the payload
  `{"point": "jostraca-warning", "dlogentry": …, "note": …}`. The
  `dlogentry` is each port's own record: a struct with `Tag`, `File`,
  `When` and `Args` here, an array with a stack trace there. The kind
  and message in `Args` match, apart from an embedded runtime error
  message. Go also warns when a baseline path escapes the duplicate
  folder, from a containment check TypeScript does not make. With no
  `Log`, both print each warning as a `<ISO time> DEBUG <payload>` line
  on standard output. The payload prints as each runtime renders it: a
  Go map here, an inspected object there.
- Errors wrap differently: `err.step` and an `<Op>:<phase>:` prefix in
  TypeScript, a `*NodeError` with `Step`, `Path` and a sentinel-matchable
  `Err` here. The message body after the wrapper is the same text. An
  embedded filesystem error carries the host's own text, and can report
  a different error code for the same condition, so match on the step, the
  sentinel or the body, not on that tail. TypeScript's `CopyFiles`
  validation message also carries a `(model: path)` prefix and a
  JavaScript call-site suffix. A `Fragment` or `CopyFiles` `From` of
  `""` is "not supplied" here, so it reads as the missing-property
  message, where TypeScript resolves `from: ''` to the output folder.
- `ListItemProps.Item` is the **raw** item; TypeScript's `props.item` is
  each-wrapped, so a scalar arrives there as `{val$, index$}`. `List`
  iterates with `Raw` here and with `each`'s default annotation in
  TypeScript. The `{item.path}` macro is unaffected: `getx` cannot address
  a `$`-suffixed key on either stack, so `{item.val$}` and `{item.index$}`
  yield the empty string in TypeScript too, and the item argument is the
  documented route to a scalar on both sides.
- `PointUtil` is not ported.

**Consequences of Go's zero values**

- A per-call `Control` flag cannot clear a global one. The fields are
  plain `bool`s, so a per-call `false` is indistinguishable from "not
  supplied", and each flag merges as global OR per-call. TypeScript can
  express "globally dry, but write for this call". A per-call `Control`
  never discards an unrelated global flag, so a global `Dryrun` survives
  a per-call `Version`. Closing the residue needs pointer fields.
- A per-call `Exclude: false` cannot clear a global `Exclude: true`, for
  the same reason: `Options.Exclude` is a plain `bool`. TypeScript lets
  the per-call `false` win.
- An empty `Folder` means "not supplied" and falls back to the global
  folder, then `"."`, where TypeScript refuses it. `OptionsFromMap`
  refuses `{"folder": ""}` as TypeScript does.
- `FileProps.Mode` of `0` means "unset", so the file keeps the platform
  default (0666 less the umask). TypeScript treats `mode: 0` as a
  request and writes an unreadable `0o000` file.
- A `Slot` with no name has `Name: ""`, so it fills a `<[SLOT:]>` marker
  as TypeScript's `Slot({name: ''})` does. TypeScript's `Slot({})` has an
  undefined name, drops its content, and blanks a `<[SLOT:undefined]>`
  marker instead.
- `TemplateSpec.Open`, `Close` and `Ref` use the default when empty,
  because Go cannot tell an empty string from an unset field. TypeScript
  uses an explicit `''` as given. Pass the empty pattern `(?:)` for an
  empty delimiter; it gives the same regular expression as TypeScript's
  `''`.

**Permission bits**

- Special bits use Go's encoding rather than POSIX octal. `fs.FileMode`
  keeps setuid at `fs.ModeSetuid`, not at `0o4000`, so TypeScript's
  `mode: 0o4755` is written `0o755 | fs.ModeSetuid` here. The resulting
  file is identical; a literal `0o4755` is not setuid in Go and lands as
  `0755`.

**Known gaps, tracked**

- An eject marker given as a slash-wrapped string (`"/START.*/"`) is matched
  literally, as TypeScript matches it: the slashes are characters in the
  marker, not a pattern delimiter. Go compiled it as a regular expression
  until 2026-09-18. To eject by pattern, pass a real regular-expression
  value, which behaves the same on both sides.

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
[`test/spec/`](https://github.com/jostraca/jostraca/tree/HEAD/test/spec):
language-neutral TSV cases that `ts/test/spec.test.ts` and
`go/spec_test.go` both read. An unknown case
is a hard failure on both sides, so a row cannot be silently skipped by
one.

Beyond that, `go/testdata/parity/` holds whole-scenario fixtures
generated from canonical TypeScript, and CI regenerates them and fails
on any diff—so a TypeScript change cannot leave the Go expectations
stale.

## Build and test

<!-- test: skip environment setup; the go toolchain is outside the scenario vocabulary -->
```sh
cd go
go build ./...
go test ./...
```

From the repository root, `make all` builds and tests both stacks.
