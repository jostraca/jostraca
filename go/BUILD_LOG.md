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
