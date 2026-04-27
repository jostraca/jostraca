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
- Decision recap (vs. goroutine-local / `context.Context`).
- The `*J` type and how parameter-shadowing (`func(j *J)`) gives one-identifier-per-callsite cost vs TS.
- Concurrency story: each `Generate` owns a fresh `*J`; package has no globals; 10-goroutine regression test.
- Synchronous define phase + error accumulation on `j.st.err` (no panics).
- Side-by-side TS-vs-Go example.

### 3. Package layout
- Single `jostraca` package at `github.com/jostraca/jostraca/go/jostraca`.
- File list and what lives where (`jostraca.go`, `builder.go`, `node.go`, `build.go`, `filehandler.go`, `diff.go`, `merge.go`, `fs.go`, `template.go`, `util.go`, `log.go`, `errors.go`, `options.go`, `buildctx.go`, `buildmeta.go`).
- Why no sub-packages (TS split is a module-style artefact, not a boundary).

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
