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
