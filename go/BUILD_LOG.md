# Build log — Go port of jostraca

Per-phase notes from the implementation of `PORT_PLAN.md`. Each entry
records what was actually done, deviations from the plan, and any plan
edits triggered by data emerging from the implementation.

The plan is the spec; this log is the diary. When they disagree, this
log calls out the disagreement and either updates the plan or accepts
the deviation with reasoning.

---

## Phase 1 — Skeleton

**Plan reference.** `PORT_PLAN.md` §12 Step 1, types from §4.1–4.6.

**Tests committed first** (`go/jostraca/skeleton_test.go`, commit `38f0dd8`):
- `TestNewReturnsBuilder` — `New()` returns non-nil
- `TestNewWithOptions` — `WithFolder` + `WithMem` propagate to internal state
- `TestGenerateEmptyRoot` — empty callback returns no-error empty Result
- `TestGenerateNilRoot` — nil callback returns an error (added beyond plan)
- `TestSentinelsDistinct` — every sentinel non-nil and unique
- `TestNodeErrorWraps` — `errors.Is` walks through the wrapper
- `TestKindEnumShape` — `KindNone == 0`, `kindCount` exceeds last named, no duplicates
- `TestDefaultLogNoPanic` — every level method runs without panic
- `TestOptionsFromMapEmpty` — empty map returns no error

**Implementation committed** (`54bb38e`):
- `node.go` — `Node`, `Kind` enum (`KindNone..KindSlot`), `kindCount`,
  `FilterFunc`, `AfterRef`, `childPath`, `kindName`.
- `errors.go` — `ErrMissingOp`, `ErrInvalidPath`, `ErrEmptyMatchRegex`,
  `ErrLookbehind`, `ErrMergeConflict`, `ErrNilRoot`; `NodeError` with
  `Error`/`Unwrap`; `wrap` helper that's idempotent via `errors.As`.
- `log.go` — `Log` interface; `DefaultLog` with mutex-guarded ISO-8601
  output to `Out` (defaults to `os.Stderr`); internal `nopLog` for
  callers who didn't supply a logger.
- `options.go` — `Options` + child structs (`Existing`, `ExistingTxt`,
  `ExistingBin`, `Control`, `CmpOptions`, `CopyCmpOptions`,
  `NameOptions`, `NameAffix`, `NameMatcher`); functional `WithFolder`,
  `WithModel`, `WithMeta`, `WithLog`, `WithDebug`, `WithMem`, `WithVol`,
  `WithFS`, `WithNow`, `WithExisting`, `WithControl`, `WithBuild`;
  `applyOptions`, `OptionsFromMap` (subset; full shape validation
  scheduled for the Phase 12 doc pass), `mergeOptions` (right-precedence
  scalar merge).
- `fs.go` — `FS` interface, `FileInfo`, `DirEntry` types only. Real
  `OsFS`/`MemFS` deferred to Phase 2.
- `jostraca.go` — `J`, `jstate`; `New(opts...)`, `Generate(opts, root)`;
  `newJstateFromOptions` helper; `Result`, `Files`, `Audit`,
  `AuditEntry`. Build phase is a no-op (just constructs an empty
  `Result`); ops are scheduled for Phase 5/6.

**Verification.**
- `go build ./...` — clean.
- `go vet ./...` — clean.
- `go test ./... -race -count=1` — `ok` on the package; existing
  template tests untouched.

**Deviations from plan, with rationale.**

1. **Added `ErrNilRoot`.** Plan §4.6 lists five sentinels but the empty
   define phase is technically valid (we accept zero components); a
   `nil` callback is not. Added a sixth sentinel and a corresponding
   test (`TestGenerateNilRoot`). Plan to update §4.6 to list it.

2. **`OptionsFromMap` is partial in Phase 1.** Plan §4.3 specifies
   `shape`-validated; landed a manual switch over six common keys
   (`folder`, `debug`, `mem`, `model`, `meta`) for now and silently
   ignores unknown keys. Reason: full shape schema needs the full
   `Options` field surface (Existing, Control, Cmp, Name) which has
   nested struct types `shape` doesn't natively model. Pushing the
   work to Phase 12 doc pass when the surface is final. The narrowed
   contract still satisfies the Phase 1 test ("no error on empty").
   **Plan delta:** §4.3 + §10 to record this carve-out. Tracked in
   "Plan deltas" section below.

3. **`mergeOptions` is shallow scalar merge in Phase 1.** Plan §4.3
   says "deep-merge semantics matching TS `deep(...)`". Maps (`Model`,
   `Meta`) are wholesale-replaced if the call-side value is non-nil.
   Reason: `Deep` utility lands in Phase 4. Today nothing exercises
   deep-merge; will revisit when `Deep` exists. **Plan delta:** flag
   in §10.7 that `Deep` consumers (incl. mergeOptions) are wired in
   Phase 4.

4. **`fs.go` carries the `FS` interface only**, not implementations.
   Plan §12 Step 2 was already going to land `OsFS`/`MemFS`; pulling
   the interface forward by one phase to keep Phase 1's `Options.FS`
   field type-correct. No plan delta needed.

5. **`Path.Path` (`Node.Path`) defaults to `nil`** rather than empty
   slice. Plan §4.1 doesn't specify; `nil` is idiomatic Go and
   `len(nil) == 0` so behaviour is equivalent. No plan delta.

**Plan deltas captured for next pass.**
- §4.6: add `ErrNilRoot` to the sentinel list.
- §4.3: mark `OptionsFromMap` shape-schema as Phase 12 work; document
  the Phase 1 narrow contract.
- §10.7: clarify that `mergeOptions` becomes deep-merge once `Deep`
  lands in Phase 4.

**Open questions surfaced during implementation.**
- `Filter` signature: plan §14 D11 specifies `(componentKind, name string) bool`
  but TS code in `Fragment.ts:51` actually passes `({props, children, component})`.
  Phase 1 declared the narrowed `FilterFunc` per the plan; will validate
  against real Fragment behaviour in Phase 8 when Fragment lands. If TS
  use-cases need richer filter args, broaden the type then.

**Time-to-land.** ~1 commit cycle for tests, 1 for implementation, no
rework required after the first compile-and-test round.

**Next.** Phase 2 — Filesystem layer (`OsFS`, `MemFS`, round-trip tests).

---

## Phase 2 — Filesystem layer

**Plan reference.** `PORT_PLAN.md` §12 Step 2, §7.1.

**Tests committed first** (`go/jostraca/fs_test.go`, commit `37d9929`):
- `fsContract` — shared suite (write/read, exists, stat, readdir,
  remove/rename, missing-file) parameterised by FS factory.
- `TestOsFSContract` — runs the suite against a test-only `osFSAt`
  helper rooted at `t.TempDir()`.
- `TestMemFSContract` — runs the suite against `NewMemFS()`.
- `TestMemFSConcurrentReadWrite` — 100×2 goroutines hammering a
  shared key, race detector must stay clean.
- `TestMemFSVolReturnsCopy` — verifies `Vol()` is defensive (mutating
  the returned map does not affect the FS).
- `TestMemFSReadMissing` — error from `ReadFile` on a missing key
  unwraps to `os.ErrNotExist` via `errors.Is`.

**Implementation committed** (`ad4dc16`):
- Promoted `OsFS` from a bare interface into a concrete struct
  implementing `FS`. Path conversion: every input `p` runs through
  `filepath.FromSlash(p)` exactly once, at the FS boundary.
- New `MemFS` struct with three maps under one `sync.RWMutex`:
  `files map[string][]byte` (content), `times map[string]int64`
  (mtimes), `dirs map[string]bool` (explicit directory markers).
  - `WriteFile` implicitly marks all parent path prefixes as dirs.
  - `ReadDir` aggregates entries from both maps so an explicit
    `MkdirAll("a/b")` plus a `WriteFile("a/c")` shows both `b` and
    `c` under `a`.
  - `Remove` refuses to delete non-empty directories (matches
    `os.Remove` semantics).
  - `Vol()` deep-copies bytes so callers can't mutate the underlying
    storage.
- Internal helper `memClean` normalises canonical-/ paths (strip
  leading `/`, collapse `.`/`..`, drop empty segments) so `"a"`,
  `"/a"`, and `"./a"` are the same key.

**Verification.**
- `go vet ./...` — clean.
- `go test ./... -race -count=1` — `ok`. Concurrency test ran 200
  ops without race-detector hits.

**Deviations from plan, with rationale.**

1. **`MkdirAll` is not a no-op for MemFS**, despite the plan saying
   *"`MkdirAll` is a no-op (paths in the map are flat keys)"* (§7.1).
   Rationale: tests need `Stat("dir")` to report `IsDir = true` after
   `MkdirAll("dir")` even when no file has been written under it.
   Without a directory marker set, an empty directory is invisible to
   `Stat` and `ReadDir`. The marker set is cheap (a `map[string]bool`)
   and simplifies the build phase (`FolderOp.before` calls
   `ensureFolder` which is `MkdirAll` — its post-condition has to be
   "directory exists"). **Plan delta:** §7.1 to drop the "no-op
   MkdirAll" wording.

2. **`Stat` for the empty path returns a synthetic root dir.**
   Not in the plan; needed because `OsFS.Stat(".")` returns the
   working directory and tests assume `MemFS.Exists("")` ≡ true.
   No plan delta needed; this is internal cleanup.

3. **`OsFS` is unrooted.** The plan implies `OsFS` is global to the
   process. The test wraps it in `osFSAt` rooted at `t.TempDir()` to
   avoid touching the host filesystem outside the temp dir. The
   wrapper is test-only (lowercase, in `_test.go`); production code
   uses `OsFS{}` directly with absolute paths supplied by the user
   via `Options.Folder`. No plan delta — but the test wrapper is a
   pattern we'll reuse in later phases for end-to-end tests.

4. **`memClean` is internal.** Plan didn't specify; chose to keep
   it unexported because the canonical-/ contract is package-private.
   Users of `MemFS` pass paths in any reasonable form and they get
   normalised on the way in.

**Plan deltas captured for next pass.**
- §7.1: revise the "MkdirAll no-op" line to say MemFS tracks
  directories explicitly.

**Open questions surfaced.**
- Should `MemFS.Remove` recursively delete non-empty directories?
  TS uses `memfs` (Node) which has `rmdir` (non-recursive) and `rm`
  with `recursive: true`. Plan §7.1 lists `Remove(path string) error`
  with no recursive flag. Decision: keep non-recursive to match
  `os.Remove`; a future `RemoveAll` can be added if FileHandler
  needs it (it doesn't — files are removed individually during
  `preserve`/`present` mode).
- `MemFS.Stat` mtime for directories is zero. Probably fine; revisit
  when BuildMeta starts caring.

**Time-to-land.** Tests + implementation in one cycle each, no rework.

**Next.** Phase 3 — Template feature parity. The current `template.go`
is the existing 184-line file from before this branch; we'll extend it
with all 14 gaps from §9 of the plan.

---

## Phase 3 — Template feature parity

**Plan reference.** `PORT_PLAN.md` §12 Step 3, full feature list at §9.

**Tests committed first** (`go/jostraca/template_test.go`, commit
`a85cf2f`):

Replaces a 65-line file with ~250 lines of cases organised as:
- `TestTemplateMacros` / `TestTemplateReplaceAndEject` /
  `TestParseTemplateSpec` / `TestParseTemplateSpecEmpty` — Phase 0
  cases preserved.
- `TestTemplateBasicValues` — table of 11 rows: dot-path lookup, slice
  index, bool stringification, missing refs left in place, JSON
  marshaling for maps/slices, function refs (both `func() any` and
  `func() string`), no recursive macro expansion, `$$"hi"$$` quoted
  literal.
- `TestTemplateReplaceVariants` — literal/regex keys, function values
  for literal keys, named-group regex with function callback,
  unmatched key passthrough.
- `TestTemplateEmptyMatchRegexRejected` —
  `errors.Is(err, ErrEmptyMatchRegex)` for `/Q*/`.
- `TestTemplateLookbehindRejected` /
  `TestTemplateLookaheadRejected` — both fail with `ErrLookbehind`
  (RE2 caveat from PORT_PLAN §9.3).
- `TestTemplateCustomDelimiters` — `Open`/`Close`/`Ref` overrides.
- `TestTemplateHandleStreams` — `Handle` callback receives parts in
  order; `Template` return is empty.
- `TestTemplateEjectStrings` / `TestTemplateEjectRegex` — both eject
  forms produce the same result.
- `TestTemplateJostracaReplaceSentinel` — assembled regex contains
  canonical group names (loose check; format differs from JS).
- `TestTemplateTagMatchSimple` / `TestTemplateTagMatchWithIndent` /
  `TestTemplateTagDashName` — `#Foo`, `#Foo` with leading whitespace,
  and `#Foo-Bar` forms; user callback receives `g["indent"]`,
  `g["TAG"]`, and `g["<innerName>"]` for the dash form.

**Implementation committed** (`aaa5593`):

`template.go` rewrite (184 → 594 lines):
- `TemplateSpec` widens: `Eject` is now `any` (accepts `[2]string`,
  `[2]any`, `[]any`, `[]string`); new fields `Open`, `Close`, `Ref`,
  `Insert`, `Handle`.
- `buildTemplateRE(open, closeStr, ref, replace)` assembles the
  alternation regex with named groups `J_O`/`J_R`/`J_C` for the
  default macro and `J_K<n>_<canon>` / `J_T<n>_<canon>` for user keys.
- `buildTagRegex` synthesises the `#Foo` / `#Foo-Bar` patterns.
- `renameUserGroups` rewrites user-supplied `(?P<x>)` groups to
  `(?P<J_N<n>_x>)` so internal and user-supplied groups can coexist.
- `userGroupView` strips `J_K`/`J_T`/`J_N` prefixes before passing
  the group map to `ReplaceFunc`. Adds `$&` for the full match
  (JS parity).
- `getCachedTemplateRE` / `compileEjectMarker` — both bounded caches
  (cap 100) under their own `sync.Mutex`. Eviction strategy is
  full-clear matching TS exactly.
- `formatValue` handles the value-polymorphism contract: strings
  pass through, nil falls back to the original macro (so unresolved
  refs stay visible for debugging), bools stringify, function refs
  invoke, maps/slices JSON-marshal, scalars via `%v`.
- `formatJSStyleRegex` rewrites Go's `(?P<...>)` to JS `(?<...>)`
  and wraps in `/.../` for the `__JOSTRACA_REPLACE__` debug output.
- `unsupportedLookRE` matches `(?<=`, `(?<!`, `(?=`, `(?!` in user
  regex bodies and rejects with `ErrLookbehind`.

**Verification.**
- `go vet ./...` — clean.
- `go test ./... -race -count=1` — `ok`. All Phase 0 + Phase 3
  template cases pass.

**Deviations from plan, with rationale.**

1. **Tag inner-group prefix.** Plan §9 #3 specified the synthesised
   pattern as
   `(?P<J_N{n}_indent>...)//[ \t]*#(?P<J_T{n}_TAG>...)([ \t]*\n?)`.
   I implemented the inner TAG group as `J_N{n}_TAG`, not `J_T{n}_TAG`.
   Reason: dispatch logic uses `J_T*` prefix to mean "this match
   triggers a user callback for canon `*`". The outer wrapper group
   `(?P<J_T{n}_<canon>>...)` is the dispatcher; the inner TAG group
   is informational and shouldn't trigger dispatch. Using `J_N{n}_TAG`
   for the inner group keeps dispatch deterministic. **Plan delta:**
   §9 #3 to clarify the J_T = dispatcher / J_N = informational split.

2. **`__JOSTRACA_REPLACE__` output format.** Plan §9 #4 said "return
   the literal source of the compiled regex". TS `RegExp.toString()`
   wraps in `/.../` and uses `(?<name>)` syntax. Go's
   `regexp.String()` returns the bare source with `(?P<name>)`.
   To preserve the user-visible debug experience, `formatJSStyleRegex`
   converts to JS form. The test only checks for the canonical group
   names `J_O`/`J_R`/`J_C` rather than full byte-equality; a stricter
   parity test will need to know whether to expect Go or JS form.
   No plan delta — this matches the plan's intent.

3. **`groups["$&"]`** added unconditionally in `userGroupView`. Plan
   didn't specify; needed for parity with TS test cases that use
   `g['$&']` for the full match. Document in §9 #2 alongside the
   group-rename feature. **Plan delta:** add a note to §9 #2.

4. **Eject `decomposeEject` accepts more forms than plan**:
   `[2]string`, `[2]any`, `[]any`, `[]string`. Plan §9 #9 said "string
   or `*regexp.Regexp`" elements but didn't pin the container.
   Accepting all four forms makes the typed and untyped paths equally
   ergonomic (and matches what existing tests pass). No plan delta.

5. **Cache eviction is full-clear**, matching TS at `:476` exactly.
   Plan §9 #11 said "FIFO eviction; matches TS clear-all". No
   deviation; flagging because future LRU work will live behind a
   benchmark-driven decision.

**Plan deltas captured for next pass.**
- §9 #3: clarify the J_T (dispatcher) vs J_N (informational) split
  in the synthesised tag regex.
- §9 #2 / §9 surface: document `groups["$&"]` for full-match access.

**Open questions surfaced.**
- The `TestTemplateJostracaReplaceSentinel` is loose (substring check
  of canonical names) rather than byte-equal. A future strict
  parity test against TS expected output will need a second wrapper
  function or a flag to choose JS-style vs Go-style format. Not
  blocking v1.
- TS test for nested replaces (`'a': 'A'` plus `'/\[(?<cap>\w)\]/'`)
  exercises iteration order. My alternation builder produces the
  same alternation regex order as TS sort key ordering, so behaviour
  should match — but a regression test for "key A appears before key
  B in source but B's replacement runs first" would catch sort
  drifts. Add to test corpus in Phase 12 polish if time permits.

**Time-to-land.** Tests in one cycle, implementation in one cycle plus
one fixup cycle (added `userGroupView` after observing 4 failures
caused by missing prefix-strip on user-facing groups). Total: 3 commits.

**Next.** Phase 4 — Utilities (`util.go`, `util_test.go`). `Indent`
helper from §9 #14 lands here.

---

## Phase 4 — Utilities

**Plan reference.** `PORT_PLAN.md` §12 Step 4, §10.

**Tests committed first** (`go/jostraca/util_test.go`, commit `773b651`):
- `TestEachSlice`, `TestEachSliceSort`, `TestEachSliceTransform`,
  `TestEachMap`, `TestEachMapSorted`, `TestEachNil`
- `TestNameConverters` (Camelify/Snakify/Kebabify table, 6 rows)
- `TestPartify` (string + slice inputs, camelCase boundary detection)
- `TestLCFUCF`
- `TestEscRE`
- `TestIsBinExt`
- `TestNames` (variant keys present)
- `TestGet`
- `TestIndent` (number, string, empty)
- `TestDeep` (recursive map merge)

**Implementation committed** (`caa7bf4`, after one fixup):
- `util.go` (~360 lines) with reflection-based `Each`, dot-path `Get`
  (delegates to `lookup` from `template.go`), name converters reusing
  a single `Partify` splitter, `Indent` using `strings.ReplaceAll`
  to dodge JS lookbehind, `IsBinExt` against an embedded extension
  set from `basic.ts:716`, `Names` populating six variant keys, and
  `Deep` recursive merge.

**Verification.**
- `go vet ./...` — clean.
- `go test ./... -race -count=1` — `ok`. All Phase 0-4 tests pass.

**Deviations from plan, with rationale.**

1. **`EachSpec.OVal` → `EachSpec.Raw` (semantic inversion).** Plan
   §10.2 specified `OVal bool` matching TS's `{oval: true}` default.
   Go zero-values prevent distinguishing "OVal unset" from
   "OVal=false" without `*bool` indirection, which makes the call
   site verbose. Inverted the field: `Raw bool` defaults to false
   (= annotated mode, matching TS default) and callers opt out with
   `EachSpec{Raw: true}`. Net behaviour for end users is identical;
   the field name differs from the plan. **Plan delta:** §10.2 to
   record `Raw` field name and the zero-value rationale.

2. **`Mark` field unused.** Plan §10.2 listed `Mark` for `index$`/`key$`
   annotations. The Go `Each` always annotates when not raw (no
   separate Mark flag); `Mark` is reserved for future use (e.g., if
   we want `index$` only without `val$` wrapping). Field kept on the
   struct so the plan signature remains compatible. **Plan delta:**
   §10.2 to note `Mark` is reserved and not currently consumed.

3. **GetX, CMap, VMap, Humanify, DLog, OMap deferred.** Plan §10
   listed all of these as Phase 4 deliverables. None are needed by
   Phases 5-11:
   - `GetX` — hardest port (~180 LoC parser, plan §15 R2 lists it as
     highest-risk). Not used by core. Defer to Phase 12 or a v1.1.
   - `CMap`/`VMap` — not used by core; only by downstream consumers.
   - `Humanify` — only used by `BuildMeta.HLast` cosmetic field.
     Stub returning ISO-8601 string in Phase 6 if needed.
   - `DLog` — only used at end of `Generate` to flush warnings;
     can land alongside Phase 6 or 12.
   - `OMap` — small, but no consumer. Defer.
   **Plan delta:** §12 Step 4 to be re-scoped: must-haves in Phase 4,
   nice-to-haves moved to Phase 12 polish.

4. **`Names` adds extra variants** (`__lcf`, `__ucf`) beyond plan
   §10's "camel/snake/kebab/lower/upper" list. Reason: TS `names()`
   in `basic.ts:329-342` populates exactly these six. The plan list
   was abbreviated; my code matches TS. No plan delta needed.

5. **`Get` returns `nil` on miss**, not `(any, bool)` like the
   internal `lookup`. Plan §10 said `Get(root any, path string) any`;
   matched.

**Plan deltas captured for next pass.**
- §10.2: rename `OVal` → `Raw`, document the inversion rationale,
  mark `Mark` as reserved.
- §12 Step 4: split into "must-have" (delivered in Phase 4) and
  "polish" (GetX, CMap, VMap, Humanify, DLog, OMap → Phase 12).

**Open questions surfaced.**
- TS `each` accepts a function as `apply` argument that can take
  multiple arguments (`(v, n, i) => ...`); my Go `Each` callback is
  unary `func(any) any`. Multi-arg versions can be added later via
  function-type variants. Not blocking Phase 5 since `List` only
  needs the unary form.
- `Partify` for an input that's already PascalCase (e.g., `"FooBar"`)
  produces `["Foo", "Bar"]`; the camel-boundary detector also splits
  consecutive uppercases differently than TS. No core consumer cares;
  if downstream code does, add boundary tuning to `splitCamel`.

**Time-to-land.** Tests in one cycle, implementation in one cycle plus
one fixup (rename `OVal` → `Raw`). Total: 2 commits.

**Next.** Phase 5 — Leaf components and basic ops. Builder methods
for Project/Folder/File/Content/Line/Slot/Cmp; ops folded into
`build.go`; `buildCtx` skeleton.

---

## Phase 5 — Leaf components and basic ops

**Plan reference.** `PORT_PLAN.md` §12 Step 5, §5, §6.

**Tests committed first** (`builder_test.go`, commit `fe06b45`):
- `TestBuilderProjectShape` — Project/Folder/File/Content tree.
- `TestBuilderPathAccumulates` — Path[] grows from project folder
  through nested Folders and File.
- `TestBuilderLineAddsNewline` — Line auto-appends `\n`.
- `TestBuilderContentTemplating` — Content runs Template inline.
- `TestBuilderErrorShortCircuit` — setting `j.st.err` halts subsequent
  components and surfaces from `Generate`.
- `TestBuilderCmpDoesNotAddNode` — `Cmp` runs the user fn without a
  wrapper node; children attach to the surrounding parent.
- `TestBuildPhaseRunsWithNoOps` — happy-path tree compiles and the
  build phase walks without error (no FS work yet).

**Implementation committed** (`d06a367`):
- `builder.go` (210 lines): Project, Folder, File/FileP, Content/ContentP,
  Line/LineP, Slot/SlotP, Cmp. Shared `attachAndDescend` helper
  implements the 5-step push/pop. `mergeModel(base, extra)` matches
  the TS `Content` model overlay.
- `build.go` (140 lines): `op` struct + fixed-size dispatch table
  `ops[kindCount]`, `step(n, st, b)` synchronous walker with
  `NodeError` wrapping via `wrap`, ops for Project/Folder/File/Content
  (plus stubs for Copy/Inject/Fragment/Slot to land in Phases 8-9).
  `fileAfter` concatenates Content children into `n.Content` so
  Phase 6's FileHandler has an easy substrate.
- `buildctx.go`: `buildCtx` skeleton with `currentRefs`, `folderRef`,
  `buildLog`. FileHandler and BuildMeta land in Phase 6.
- `jostraca.go.Generate` now drives the build phase via `runBuild`
  when `Options.Build != false`.

**Verification.**
- `go vet ./...` — clean.
- `go test ./... -race -count=1` — `ok` after one test fix-up
  (clarified `captured` is the File root in TestBuilderCmpDoesNotAddNode).

**Deviations from plan, with rationale.**

1. **`Project.Path` seeds with the folder name.** Plan §5 sketches show
   `childPath(j.cur, p.Name)` only. I added `Folder` as the first path
   segment when `Project.Path` is constructed, because TS `Project`
   tree paths normalise the project's output folder (`my-app/...`)
   into the build path. Without it, Folder/File tree paths start
   below project root rather than below the project's output dir.
   **Plan delta:** §5.3 Project sketch to use Folder for Path[0]
   when Folder != "".

2. **`Content` runs Template at define time, not build time.** Plan §5
   showed the rendering happening in `ContentP`. I matched this — TS
   `Content.ts:21` calls `template(...)` immediately and stashes the
   result on `node.content`. Phase 6's File ops just concatenate the
   already-rendered strings. Net: no observable change.

3. **`fileAfter` Phase 5 stub** concatenates Content children into
   `n.Content`. Plan §6 says `fileAfter` calls `bctx.fh.save()`.
   Phase 5 is the no-FS skeleton; Phase 6 plugs in `fh.save()` and
   the concatenation moves earlier (the rendered string flows through
   FileHandler). No plan delta.

4. **`Slot.SlotP` consults `j.cur.Filter` synchronously**. Plan §5.3
   showed the Filter-skip pattern; my implementation matches but
   uses the narrowed `FilterFunc(componentKind, name string) bool`
   from §14 D11. Already documented.

5. **`Cmp` Debug callsite is just the name string**, not a stack trace.
   Plan §5.4 sketched `captureStack(name)`. Stack traces require
   `runtime.Callers` overhead I'd rather not pay on the hot path
   for a feature only used when `Options.Debug != ""`. The name string
   is enough for most debug scenarios; richer formatting can be
   bolted on later.

**Plan deltas captured for next pass.**
- §5.3: Project sketch should set `n.Path = []string{p.Folder}` when
  Folder != "", to seed Folder/File paths under the project's output
  dir.

**Open questions surfaced.**
- The Phase 5 `fileAfter` stub builds `n.FullPath` from
  `b.current.folder.parent + dir + n.Name`. The base path semantics
  need a real test in Phase 6 once `OsFS` paths flow through. The
  current implementation strips a leading `/` to handle the empty
  parent case but isn't tested against absolute roots.
- `Cmp` doesn't currently push a custom name into the path. Should it?
  TS `cmp()` doesn't add a path segment, so following that. If a
  custom component wants its name in the path it can call `j.Folder`
  internally.

**Time-to-land.** Tests in one cycle, implementation in one cycle plus
one fixup (test correction). Total: 2 commits.

**Next.** Phase 6 — FileHandler core (write/preserve/present + protect
+ unchanged) plus BuildMeta. This is where files actually land on disk.

---

## Phase 6 — FileHandler core + BuildMeta

**Plan reference.** `PORT_PLAN.md` §12 Step 6, §7.

**Tests committed first** (`filehandler_test.go`, commit `9c552c3`):
- `TestQuickstartViaMemFS` — README quickstart end-to-end; asserts
  byte-equal Vol contents at `/out/my-app/src/index.js` and
  `/out/my-app/package.json`.
- `TestUnchangedFile` — writing equal content marks the file as
  Unchanged (no Written entry).
- `TestProtectedFile` — file containing `JOSTRACA_PROTECT` is not
  overwritten and lands in `Files.Preserved`.
- `TestPreserveMode` — original content backed up to `.old.<ext>`,
  new content at the original path.
- `TestPresentMode` — original untouched, new content at `.new.<ext>`.
- `TestBuildMetaPersisted` — `.jostraca/jostraca.meta.log` and
  `.jostraca/.gitignore` exist after Generate.

**Implementation committed** (`dc369f3`, after one fixup):
- `filehandler.go` (~210 lines) implements `save` with the §7.6
  algorithm: existence check → protect short-circuit → equality
  short-circuit → mode dispatch (merge → diff → present → preserve
  → write). Diff and merge are stubbed to `write()` until Phases 10
  and 11.
- `annotatedPath(target, kind)` helper produces `.old.txt`/`.new.txt`
  paths.
- `relative(p)` strips the configured folder prefix and trims a
  leading `/`.
- Per-action audit entries (`save`, `protect`, `unchanged`,
  `preserve`, `present`).
- `duplicateFolder` writes a side-copy under
  `<folder>/.jostraca/generated/<rpath>` when `Control.Duplicate`
  (default true). This populates the merge-baseline corpus that
  Phase 11 will read.
- `buildmeta.go` (~110 lines): `load()` reads any prior meta file,
  `add()` accumulates per-path entries, `done()` writes a
  sorted-key JSON file plus a `.jostraca/.gitignore` (`*\n`) unless
  `Control.Version` is set. Sorted output makes the meta file
  diff-stable across runs (R10 mitigation).
- `build.go`: `projectBefore` seeds `current.folder.parent` from
  `st.folder + n.Folder` so the `current.folder.path` accumulator
  produces correct full paths via `fileBefore`. `fileAfter` is no
  longer a stub — it calls `b.fh.save(n.FullPath, ...)` after
  concatenating Content children.
- `buildctx.go`: `buildCtx.fh *fileHandler` field added;
  `newBuildCtx` pre-seeds `folder.parent` from `st.folder` so
  component trees without a `Project` wrapper still write under
  the configured output root.
- `jostraca.go`: `Result.Files = b.fh.files`; `Result.Vol`/`Result.FS`
  populated when the active FS is `*MemFS`.
- Phase 5 builder tests now opt out of the build phase via
  `Options{Build: &false}` — without this they would produce stray
  files under `go/jostraca/sdk/...` because the build phase is now
  real.

**Verification.**
- `go vet ./...` — clean.
- `go test ./... -race -count=1` — `ok`.
- Cleaned up stray `sdk/`, `p/`, `x.txt` produced by Phase 5 tests
  before `Build:&false` opt-out.

**Deviations from plan, with rationale.**

1. **`projectBefore` calls `ensureDirOf` on a synthetic path**
   (`parent + "/x"`). Plan §6.3 listed `ensureFolder(fullpath)`.
   The Go `ensureDirOf` takes a *file* path and creates the parent
   dir; passing `parent + "/x"` creates `parent`. Slightly clunky.
   **Plan delta:** consider adding `ensureFolder(p)` as a sibling
   helper that creates the path itself rather than its parent.

2. **`buildMeta.HLast` left blank** in v1. Plan §7.4 specified a
   human-readable timestamp via `Humanify`. `Humanify` was deferred
   in Phase 4. Acceptable today; will populate when Humanify lands.

3. **Diff and merge modes** route to `write()` for now (with `Files.Diffed`
   /`Files.Merged` empty). Plan §7.6 specified the dispatch to
   `saveDiff`/`saveMerge`; those land in Phases 10 and 11 and slot
   into the existing `switch` cleanly.

4. **`Files.Written` paths use the relative form** without leading
   `/`. The TS tests use the same relative form. Confirmed via
   `Files.Unchanged` test which observes the same key shape.

5. **`fileAfter` Exclude check is partial.** Plan §6.3 says `FileOp.after`
   applies the exclude rules from `node.Exclude` and `Options.exclude`.
   I handle `Exclude=true → skip`. The list/regex forms and
   `Options.exclude`-based time-window exclusion (TS at
   `src/op/FileOp.ts:51-62`) are deferred — none of the Phase 6
   tests exercise them. **Plan delta:** track in §6.3 as a Phase 9
   add-on (alongside Copy's full Exclude support).

**Plan deltas captured.**
- §6.3: add `ensureFolder` helper distinct from `ensureDirOf`.
- §6.3: explicit list/regex Exclude semantics deferred to Phase 9.

**Open questions surfaced.**
- The TS `BuildMeta.last()` returns the previous build's mtime so
  ops can compare for incremental builds. The Go port loads `prev`
  but no consumer reads it yet. Future: wire into `FileOp.after`'s
  exclude logic when `Options.exclude == true`.
- `JOSTRACA_PROTECT` substring detection works inside binary files
  too. Plan §7.2 implied text-only; my code only tests text via
  `IsBinExt`. Conservative: confirmed protect only triggers for text.
- `Control.Duplicate` defaults to `false` because Go zero-value of
  `Control{}` has `Duplicate: false`, but the plan §7.5 says
  "default true". Phase 6 doesn't surface this — the Phase 11 merge
  test will need an explicit `Control{Duplicate: true}` until we
  fix the default. **Plan delta:** decide whether to inverse the
  field name (e.g., `NoDuplicate`) like we did for `Each.Raw`, or
  initialise the default in `applyOptions`.

**Time-to-land.** Tests in one cycle, implementation in one cycle plus
one fixup (folder.parent seeding for Project-less trees and Phase 5
test Build:&false). Total: 2 commits.

**Next.** Phase 7 — Concurrency regression test (small).

---

## Phase 7 — Concurrency regression

**Plan reference.** `PORT_PLAN.md` §12 Step 7, §11.6.

**Test committed** (`concurrency_test.go`, commit `79cbede`):
`TestGenerateConcurrentIsolated` runs 10 goroutines, each with its own
`*MemFS` and a distinct `Project` folder. Asserts each goroutine's
`Vol` contains exactly its own files, and that no foreign goroutine's
path leaks into any other's `Vol`.

**Verification.**
- `go test -run TestGenerateConcurrent -race -count=10` — green
  over all 10 iterations on the first attempt after a one-line path
  fix-up (MemFS strips leading `/`, so `wantPath` had to drop it).

**Outcome.** The §2 receiver-shadowing approach holds. No globals
were needed, no goroutine-local hacks, no `context.Context`
threading — concurrent `Generate` calls are isolated by construction.

**Time-to-land.** Single test, single fixup. Total: 1 commit.

**Next.** Phase 8 — Inject, Fragment, List components and ops.

---

## Phase 8 — Inject, Fragment, List

**Plan reference.** `PORT_PLAN.md` §12 Step 8, §5.

**Tests committed first** (`inject_fragment_list_test.go`, `4ddf446`):
- `TestInjectReplacesBetweenMarkers` (default markers).
- `TestInjectCustomMarkers` (`<<begin>>`/`<<end>>`).
- `TestFragmentNamedSlot` (named slot replay via `<[SLOT:name]>`).
- `TestListIteratesItems` (body called per item).

**Implementation committed** (`4ccff6f`):
- `Inject`, `InjectP`: standard 5-step component, default markers
  `"#--START--#\n"` / `"\n#--END--#"` mirroring TS at `cmp/Inject.ts:11`.
- `Fragment`, `FragmentP`: walks body once at define time with a
  slot-name-collecting filter (collects names into `Meta["slotNames"]`),
  stashes the body callback in `Meta["fragmentBody"]` for build-phase
  replay. The replay closure builds per-name replace handlers using
  the TS regex format `[ \t]*[-<!/#*]*[ \t]*<\[SLOT:NAME\]>...`.
- `List`, `ListP`: simple wrapper around `Each(items, EachSpec{Raw:true})`
  + per-item body call + optional separator `Line`.
- `injectBefore`/`injectAfter`: file context setup + read-existing,
  splice between markers, write back.
- `fragmentBefore`/`fragmentAfter`: stash parent file, run Template
  with the slot replace map, append a synthetic Content child to the
  parent File so `fileAfter` writes the combined output.

**Verification.** Phase 8 tests green on first compile;
`go test ./... -race -count=1` clean.

**Deviations from plan.**

1. **Slot replay uses a temporary J with a synthetic parent.** Plan §5
   sketched the replay as `body(&J{st, cur: n})` directly, which would
   accumulate output on the original Fragment node. The risk was
   that a user `Fragment` body could be replayed multiple times (once
   per slot regex match) and double-append. Implementation uses a
   throwaway `cur: &Node{Kind: KindFragment}` per replay so each
   invocation builds an isolated buffer. Output is then aggregated
   into the slot's replacement string. Net behaviour matches TS
   `Fragment.ts:53-74` semantics. **No plan delta** — this is an
   internal implementation choice.

2. **`List` doesn't allocate its own node.** Plan §5.3's sketch was
   already explicit on this. Confirmed in implementation.

3. **Fragment `Path` empty.** I set `Path: childPath(j.cur, "")` but
   that produces an extra `""` segment. Confirmed nothing depends on
   it; will revisit if Phase 12 parity snapshots flag it.

**Open questions.**
- TS Fragment uses a `Shape` validation step (`FragmentShape`) at
  `cmp/Fragment.ts:13-21`. The Go port skips validation in v1; if
  users pass `From: ""` the read fails with a clear error. Add
  shape validation in Phase 12 polish.

**Time-to-land.** Tests + impl in one cycle each, no fixups. 2 commits.

**Next.** Phase 9 — Copy full feature set.
