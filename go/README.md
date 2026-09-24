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

This README is organised in four kinds of material:

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
The default ignore pattern is `(~|-jostraca-off)$` (editor backup files,
and anything switched off by suffix); add more via
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
j := jostraca.New(jostraca.WithMem(), jostraca.WithFolder("/out"))
res, _ := j.Generate(jostraca.Options{}, root)

vol := res.Vol() // map[string][]byte snapshot
```

To seed the volume by writing into it first, pass your own
`jostraca.NewMemFS()` with `WithFS` and read the output with
`mem.Vol()`: `res.Vol` is set only when `Mem` is on for the call. A
`nil` value in `WithVol` seeds an empty directory.

`Vol()` reports every file's content plus a **nil** entry for every EMPTY
directory — a directory appears only while it is empty, otherwise its
children stand for it, mirroring TS's `vol.toJSON()`. An empty FILE is a
non-nil zero-length slice, so filter on `v != nil` rather than
`len(v) > 0` when you want files alone.

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

The complete API reference is
**[`docs/reference-go.md`](../docs/reference-go.md)**, alongside the
component, options and utilities references it links. The Go shapes mirror
the TypeScript ones function for function, and the deviations below are
stated there in full.

### `Generate` result

`Generate` returns `(Result, error)`:

```go
type Result struct {
    When  int64                     // build timestamp (unix ms)
    Files Files                     // outcome lists per category
    Audit func() Audit              // ordered build action log
    Vol   func() map[string][]byte  // set when Mem is on for the call
    FS    func() FS                 // set when Mem is on for the call
}

// Every category is non-nil, and the JSON keys are the TS ones.
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
object. The label timestamp follows `Date.prototype.toISOString`,
extended years included, and an empty `Kind` or label means the default
in both stacks. `testdata/parity/diff_corpus.json` records TS's exact
output for 1,190 merge/diff cases; `TestDiffCorpusMatchesTS` replays
them through Go and asserts byte equality. `test/spec/diff.tsv` runs
`Merge`, `Diff` and `HasConflictsLabel` through both stacks for the
label rules. Both stacks hold `diff.go`/`diff.ts` at 100%
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
- A component called on the builder `New` returned, outside any
  `Generate`, panics at once with a message naming the component
  (`jostraca: component File called outside Generate(); ...`), where TS
  throws the same text naming `generate()`. It is a panic because
  component methods have no error return, and a later `Generate` on the
  same builder is unaffected.
- `Options` is a typed struct + functional options
  (`jostraca.WithFolder(...)`, etc.) plus `OptionsFromMap` for config
  sourced from JSON/YAML. `OptionsFromMap` validates against the
  TypeScript option schema, with the TypeScript error text.
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
- `Indent` walks the string with a `strings.Builder` rather than using a
  lookbehind, which RE2 does not have. (This bullet used to say
  `strings.ReplaceAll`; the function's own godoc has said "a manual walk"
  for longer than that claim was true.)
- The `Point*` orchestration utility is not ported (deferred to a future
  sub-package).
- **`mergeOptions` drops per-call `Cmp` and `Name`.** It copies `Folder`,
  `Meta`, `FS`, `Now`, `Log`, `Debug`, `Model`, `Build`, `Mem`, `Vol`,
  `Existing`, `Control` and `Exclude`, and there is no `WithCmp`, so the
  only route to `Options.Cmp.Copy.Ignore` is a hand-written option closure
  passed to `New`. TypeScript has no equivalent hole.
- A user component that *wraps* a `Slot` is broken in TS today (the slot
  name is never collected and the marker survives verbatim), and Go matches
  it: `J.Cmp` allocates a node and passes through the Fragment filter as
  TS's `cmp()` does, so a user component used as a direct `Fragment` child
  behaves identically on both sides. Until v0.35.0 Go ran the body inline
  with no node, so the filter never saw it -- three runs against TS's zero,
  and a silent body wrote the file where TS aborted.
- A **binary** single-file `Copy` nested inside a `File` splices its raw
  bytes into the enclosing file here; TS contributes nothing and logs it.
  A Go string is a byte string, so the bytes survive; TS's copy content is
  a `Buffer`, and joining one into a JS string UTF-8 decodes it, turning
  every byte that is not valid UTF-8 into U+FFFD. TS writes nothing rather
  than a corrupted approximation. The copy itself is written intact on both
  sides, and a TEXT copy splices identically. Pinned by
  `TestBinaryCopyInsideFileSplicesBytes` here and
  `binary-copy-inside-file-splices-nothing` in `ts/test/jostraca.test.ts`.
- `Deep` builds a new map or slice instead of mutating and returning its
  first argument the way TS `deep` does. Callers that use the return value
  see no difference; callers relying on the aliasing would. Merge semantics
  themselves match, nil/null included: nil is TS `null` at every
  position, so a nil *argument* replaces the accumulated base exactly as
  a nil member does, and `Deep(m, nil)` is nil. TS `undefined`, which Go
  does not have, is spelled by not passing the argument, and a typed nil
  map merges as an empty one. Only `[]any` merges index-by-index — a typed slice such as
  `[]string` takes the right-wins path, as does any other value carrying a
  type of its own (`*regexp.Regexp`, `time.Time`, a struct), which is TS's
  "custom constructor" rule. TS applied that rule in only one of its two
  branches until it was corrected — see the note on `deep` in
  `ts/src/util/basic.ts`; `TestDeepCustomTypeReplaces` is the anchor on
  this side.
- A template value that is an integer wider than 2^53 keeps its exact value
  in Go and loses precision in TS, whose numbers are all `float64`.
  Everything a `float64` can hold exactly formats identically on both
  stacks (`template_format_test.go` pins this); beyond that there is
  nothing to reconcile.

- A per-call `Control` flag cannot clear a global one. `Control`'s
  fields are plain `bool`s, so a per-call `false` is indistinguishable
  from "not supplied", and `mergeOptions` merges each flag as
  `global || call`. TS can express "globally dry, but write for THIS
  call" because `{dryrun: false}` is distinguishable from `{}`; the same
  holds for `version`, and for `duplicate: true` under a global
  `duplicate: false`. A per-call `Control` never discards an unrelated
  global flag: a global `Dryrun` survives a per-call `Version`. Closing
  the residue needs pointer fields on `Control`. Pinned by
  `TestPerCallCannotClearGlobalDryrun` and the
  `TestGlobal*SurvivesPerCall*` cases in `control_precedence_test.go`.
- A per-call `Exclude: false` cannot clear a global `Exclude: true`.
  `Options.Exclude` is a plain `bool`, so `false` means "not supplied"
  and the global stays in force; TS lets a per-call `exclude: false`
  win. A global `Build` or `Exclude` is honoured on both sides. Pinned
  by `TestPerCallCannotClearGlobalExclude`.
- An empty `Options.Folder` or `WithFolder("")` means "not supplied" and
  falls back to the global folder, then `"."`; TS refuses an empty
  `folder` and writes nothing. A Go `string` cannot tell "explicitly
  empty" from "unset". The map form can, so `OptionsFromMap` refuses
  `{"folder": ""}` with TS's message. Pinned by
  `TestEmptyFolderMeansUnset`.
- `FileProps.Mode` of `0` means "unset" here (`node.go`), so the target
  keeps the platform default (0666 less the umask). TS treats `mode: 0`
  as a real request and writes an unreadable `0o000` file. Same
  zero-value limitation as `Control` above.
- `TemplateSpec.Open`, `Close` and `Ref` use the default when empty,
  because Go cannot tell an empty string from an unset field. TS uses an
  explicit `''` as given. Pass the empty pattern `(?:)` for an empty
  delimiter; it yields the same regular expression as TS's `''`.
- Special permission bits use Go's encoding, not POSIX octal.
  `fs.FileMode` keeps setuid at `fs.ModeSetuid` (bit 23), not at `0o4000`,
  so a TS `mode: 0o4755` is spelled `0o755 | fs.ModeSetuid` here. The
  behaviour is identical; only the spelling differs. `0o4755` written
  literally is NOT setuid in Go and lands as `0755`.
  `mode_special_bits_test.go` pins both halves.
- A template macro resolving to a `[]byte` renders as Go's `[104 105]`,
  and to a pointer as `&{1 x}`. Every OTHER composite — maps, slices,
  arrays and structs, of any element type — JSONifies with keys in
  JavaScript's object key order at every depth (canonical array-index
  keys first in ascending numeric order, then the rest by UTF-16 code
  unit), matching TS. Strings are escaped exactly as `JSON.stringify`
  escapes them, so `&`, `<`, `>`, U+2028 and U+2029 are written raw;
  `-0` renders as `0`, and NaN or an infinity inside a composite renders
  as `null`. The meta log uses the same string escaping. Neither exception has an obvious right answer:
  `encoding/json` renders a byte slice as base64 where TS renders a
  `Buffer` through its `toJSON` as `{"type":"Buffer","data":[...]}`, and
  dereferencing a pointer raises its own questions about nil and about
  value-versus-reference. `format_composite_test.go` pins both.
- `List`'s body signature is `func(j *J, it ListItemProps)`, not TS's
  single props object, and `ListItemProps.Item` is the RAW item where TS's
  `props.item` is each-wrapped (a scalar arrives there as
  `{val$, index$}`). The `{item.path}` macro itself is byte-identical: the
  replace key is the same string on both sides, and `getx` cannot address a
  `$`-suffixed key on either, so `{item.val$}` and `{item.index$}` yield
  the empty string in TS as well. `ListProps` has no `Replace` field,
  matching TS, where `List`'s own `replace` prop is accepted and never
  used.
- An eject marker given as a slash-wrapped STRING (`"/START.*/"`) was
  compiled as a regex here and matched literally by TS, which always
  escapes (`ts/src/util/basic.ts` `getCachedEjectRE`). **Resolved
  2026-09-18**: Go matches it literally too, and both sides are pinned
  by `test/spec/template.tsv`
  (`template-eject-plain-string`, `template-eject-slash-wrapped-string`).
  A real `*regexp.Regexp` / `RegExp` value always behaved the same on
  both sides and remains the way to eject by pattern.
- `CmpTree` -- the data-driven define phase -- takes its inherited props
  as an explicit parameter and returns `(func(*J), error)`. TypeScript
  calls a child with the parent's arguments and merges them there; a Go
  component body is `func(*J)`, which carries nothing, so the inherited
  map is a parameter of the internal thunk type. The merge rule is the
  same on both sides: context first, the node's own props last. Extra
  components arrive as `CmpTreeOptions{Cmp: ...}` rather than a bare
  object. The TypeScript side additionally refuses a `cmp` naming an
  inherited property (`toString`, `constructor`); a Go map answers only
  for keys it holds, so there is nothing here to guard against.
- `Fragment` and `CopyFiles` check the TYPES of their props when the
  component is called, in the typed API and on the data path alike, as
  their TS twins do: `Fragment` `from` and `CopyFiles` `from`/`to` are
  strings, `replace` is an object, `Fragment` `indent` is a string or a
  number, `eject` a list of non-empty strings or regexps, and
  `CopyFiles` `exclude` a boolean, a non-empty string, a regexp, or a
  list of those (`[]any`, `[]string` or `[]*regexp.Regexp`). A wrong
  type stops the run before anything is written, with shape's message.
  `Content` and `Line` `indent` are not checked in either port.
- `CopyFilesProps` has no `Indent` field. It was set on the node and
  never read by the copy build step, so the only thing it did was accept
  a prop TypeScript refuses.
- `FragmentProps` has no `Exclude` field, and neither does the
  TypeScript `FragmentProps`. It was declared on both sides, validated,
  and read by neither. Now that each component's props are a type the
  package publishes, a declaration has to be a promise the code keeps.
- The props structs here and the props types in `ts/src/cmp/*.ts` carry
  the same fields, held field for field by `TestCmpPropsMatchTypeScript`
  rather than by review. Two differences are deliberate and are named in
  `propDeviation` in `cmp_props_test.go`: `ContentProps` has no `Arg`,
  because the positional form here is the `Content(src)` method rather
  than a prop, and `ListItemsProps.NoLine` inverts TypeScript's `line`
  so that Go's zero value matches its default. A third cannot appear
  without the test naming it.
- Neither port applies the closed check to a caller's override of
  `Fragment` or `CopyFiles` through `CmpTreeOptions.Cmp`: the prop set
  belongs to the built-in component, and an override replaces it. In
  TypeScript `FragmentShape` goes with the component it validates.
- `CmpTree` deep-copies each node's props on every invocation, the way
  the TypeScript twin does, so a component cannot write into the
  caller's tree and a tree generated twice is two identical
  generations. There is no cycle guard: decoded JSON cannot refer to
  itself, where a hand-built JavaScript object can.
- There is no `Arg` field on `ContentProps`: a positional
  `Content(src)` is the Go spelling. A component tree given as data may
  still state `arg`, which `CmpTree` reads with precedence over `src`
  and stringifies as JavaScript would, because the two ports have to
  produce the same bytes from the same tree.
- `j.Cmp` takes no props, so a component of your own cannot push a
  `name` onto the node path as a TypeScript component called with a
  `name` prop does. A `File` exclude inside such a component names the
  path without it.
- `Each` stamps `key$`/`index$` only onto a `map[string]any` item. TS
  also writes them onto an array (or any object) as a property JSON
  never shows; Go cannot stamp a slice or a typed map. `EachSpec.Sort`
  has no sort-by-property form.
- An absent source field in a `CMap`/`VMap` projection gives nil, since
  Go has no `undefined`: JSON then shows `null` where TS omits the key.
- A replayed warning's `dlogentry` is each port's own record. In TS it
  is the array `[tag, file, when, ...args, stack]`; here it is a struct
  with `Tag`, `File`, `When` and `Args`, with no stack, and `note` joins
  those fields with commas. The `args` (kind and message) are the same
  on both sides, except that an error message embedded in one (a JSON
  parse error in the unreadable-meta-log warning) is the text each
  runtime gives. Go also has one warning TS lacks, "baseline path escapes the
  duplicate folder", from a containment clamp TS does not have. When no
  `Log` is given the default here is silent, where TS's prints to the
  console.
- Errors are wrapped differently: TS prefixes `<ERROR:>?<Op>:<phase>: `
  and sets `err.step`; Go returns a `*NodeError` whose message starts
  `jostraca <step> @<path>: ` and whose `Err` matches the sentinels with
  `errors.Is`. The message body after either prefix is the same text,
  except that a wrapped filesystem failure embeds the error text Go
  gives (sometimes with a different error code than Node's), and TS's `CopyFiles`
  validation message carries a `(model: path)` prefix and a JavaScript
  call-site suffix. A Fragment or CopyFiles `From` of `""` is "not
  supplied" here, so it reads as the missing-property message; TS
  resolves `from: ''` to the output folder itself.
- Past the year 9007 the meta log's `hlast`/`hwhen` digit form exceeds
  2^53: TS's number result rounds (`253402300799999` gives
  `9999123123596000`) while Go's `int64` is exact
  (`9999123123595999`). Outside the years 0000..9999 the JavaScript ISO
  year format differs, and beyond ±8.64e15 ms TS throws a `RangeError`
  while Go formats.
- The `GetX` `~` operator compiles its pattern with RE2, so a pattern RE2
  rejects (a look-around assertion or a back-reference) is a non-match
  where TS would throw, and the two regular-expression dialects differ
  at their edges.
- The case helpers (`Camelify`, `Snakify`, `Kebabify`, `Names`, `UCF`,
  `LCF`) use JavaScript's case mapping, but Go's Unicode tables and
  Node's ICU can differ by Unicode version for newly assigned
  characters.

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
into parity.

## License

MIT. Copyright (c) Richard Rodger.
