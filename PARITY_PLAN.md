# Jostraca — TS/Go parity: findings and plan

Scope: the current level of behavioural parity between `ts/` (canonical) and
`go/` (port), what to do about it, and in what order.

Evidence is marked three ways, and the distinctions are deliberate:

- **[verified]** — reproduced here by running code, cited with file:line.
- **[audit]** — found by the parity audit (six surface passes, each with an
  independent adversarial verifier, then a cross-surface pass). Every
  high-severity item was executed by its finder and re-executed by its verifier,
  but it has not been re-run by hand for this document.
- **[re-verified v0.34.1]** — probed again at v0.34.1, both stacks, by running
  the scenario rather than by reading the diff or trusting the row above it.
  Every such verdict below was produced that way, including the ones that came
  back *unchanged*. Four came back different from what this document said, and
  a fifth came back different from what the re-verification pass itself first
  concluded: `Hunks` was marked fixed on a probe whose inputs never reached the
  aliasing path. A probe is evidence of what it exercised and nothing else.

Act on [verified] directly. Treat the [audit] tail as leads, not as a to-do list.

---

## Status

Every row re-probed at v0.34.1. "Holds" means the fix was re-measured, not that
the commit that made it is still in the log.

| § | item | status at v0.34.1 | how it was re-checked |
|---|---|---|---|
| 1.1 | global `control` discarded in TS | **fixed, holds** | global dryrun writes 0 files; per-call 0; no-dryrun baseline 4 |
| 1.2 | `exclude: true` inverted in Go | **fixed, holds** | live clock, two runs: regenerates its own 20/20, preserves user edits 40/40 |
| 2.1 | `error` field never populated | **done** | runners now compare the tree on error rows; two more both-fail scenarios added, one with a non-empty partial tree |
| 2.2 | directory-only state invisible | **fixed, holds** | `Vol()` returns nil for an empty dir; dry run creates none; TS materialises the `Folder` |
| 2.3 | caller-side state | **done** | getx stamp swept; `Hunks` copies its suffixes; `generate` validates a copy of the caller's options |
| 2.4 | shared bugs invisible by construction | **unchanged, by design** | #26 and #32 both still live and still byte-identical across stacks |
| 3 | Go panic on nil-body Fragment | **fixed, holds** | no panic; emits `"A\n\nB\n"` |
| 3 | Fragment `eject` never read in Go | **fixed, holds** | Go `"KEEP\n"` == TS `"KEEP\n"` on the same source |
| 3 | chmod comparison narrower than chmod | **fixed, holds** | compares `chmodBits`, not `Perm()` |
| 3 | Copy inside File destroys the file (TS) | **fixed, holds** (#39) | `"BEFORE\nHELLO\nAFTER\n"`, and the copy still written to its own destination |
| 3 | `List` `{item}` macro absent in Go | **fixed, holds** (#40) | Go `"n=p\nn=q\n\n"` |
| 3 | `File{Mode: 0}`, per-call `Control` | documented as deviations | unchanged |
| 4 | deviations lists | **done** | false claim deleted, `Cmp`-in-`Fragment` note corrected in both, grouping relationship stated — see §4 |
| — | Go template non-determinism (#42) | **fixed, holds** | identical output across 25 fresh processes |
| — | `Copy.exclude` (#28) | fixed, closed | **not re-probed** — closed before this pass, and nothing here touches it |
| — | `List` string child (TS) (#44) | **fixed, holds** | `"n=p\nn=q\n\n"` |
| — | txt/bin classification (#27) | **fixed in code, issue still open** | the two stacks now **agree**; see §3 |
| — | Fragment filter on non-Slot children (#29) | **fixed** | every node-allocating component goes through the filter — `Cmp` and `List` via a transparent node, `Content` before it renders; body runs 0 vs 0, and the output divergence is gone |
| — | binary compared against a string (#30) | **fixed** | `sameContent` compares bytes; pinned by `binary_copy_identical_no_backup` |
| — | `WithMem`/`WithVol` inert (#37) | **fixed** | `Mem` builds a MemFS, `Vol` seeds it (per-call merging over global), a global one persists across calls, and the handles come back from a define-only run too |
| — | Windows blind spot (#22) | **closed in CI, issue still open** | the matrix runs `go test -race` on `windows-latest` |
| — | corpus cannot express binary (#24) | **closed in code, issue still open** | b64 escape hatch; 1043 b64 values in the committed corpora |

Two items were found or settled after the plan was written. Go's template
output was **non-deterministic across processes** — `buildTemplateRE` ranged a
map and the stable sort then kept that random order for equal-length replace
keys, so identical input gave different output roughly 1 run in 20. Fixed via
`sortedKeys`, with the residual rule difference (Go alphabetical, TS declaration
order) documented rather than papered over. And issue #28 was re-measured on
both stacks and is genuinely resolved, so it is closed.

One audit finding was **refuted** by measurement while implementing §3, and it
is recorded here because the audit's own cross-surface pass had adjudicated it
the other way. Go does not "silently discard setuid": `fs.FileMode` keeps setuid
at `fs.ModeSetuid`, not at POSIX octal `0o4000`, so `0o4755` is not setuid in
Go's encoding, while `0o755 | fs.ModeSetuid` works and always did. The API
spelling differs from TS's octal; the behaviour does not. A real and separate
bug was found next to it, and fixed: the mode comparison in `chmodUnchanged` was
9 bits wide where chmod sets 12, so a special bit was never applied to a
byte-identical rewrite.

Two of the fixes above also justify the method. The `exclude` regression test
PASSED against the broken code on its first draft, because a one-file build
completes inside a millisecond and the stamp and the mtime collide; it needed
300 files and a direct invariant assertion to discriminate. And a test asserting
that a *named* slot renders empty with no body was wrong about TS, not about Go
— both stacks leave the marker verbatim. Neither would have been caught without
running the pre-fix code against every new test.

---

## 0. Summary

### The re-score, and why it is a different measurement

§5 says not to re-run the audit for a better number, and that still stands: the
original score estimated a population nobody can enumerate, so a second
estimate would differ by method as much as by progress. This re-score therefore
measures something narrower and checkable — **the items this document and the
issue tracker actually name**, each re-probed at v0.34.1 by running the
scenario on both stacks.

The two numbers are not comparable and the old one is kept below as history.
What follows is a count of tracked items, not an estimate of unknown ones.

A **tracked item** is one this document's §1-§4 names, or an open issue, or a
deviation this document calls out. Not all 22 recorded deviations — only the
ones argued about here. The ledger is written out so the totals can be checked
rather than taken:

| surface | item | at v0.34.1 |
|---|---|---|
| diff/merge + fs | chmod comparison width | resolved |
| | `MemFS.Vol()` reports directories | resolved |
| | `Hunks` aliases the caller's arrays | resolved |
| template + getx + utils | getx `?` filter stamps the model | resolved |
| | template non-determinism (#42) | resolved |
| | slash-wrapped string eject marker | **live** (deviation) |
| components + op walker | Go panic, nil-body Fragment | resolved |
| | Fragment `eject` never read | resolved |
| | `List` `{item}` macro (#40) | resolved |
| | Copy inside File destroys it (#39) | resolved |
| | `List` string child (#44) | resolved |
| | top-level siblings dropped (#21) | resolved |
| | `Project` folder leaks (#26) | **live** (shared) |
| | Fragment filter, non-Slot children (#29) | resolved |
| | Fragment error path leaves different trees | **live** (new) |
| FileHandler + modes | `exclude` timing in Go (§1.2) | resolved |
| | txt/bin classification (#27) | resolved |
| | `Copy.exclude` on directories (#28) | resolved (not re-probed) |
| | binary compared against string (#30) | resolved |
| | `File{Mode: 0}` | **live** (deviation) |
| options surface | global `control` discarded (§1.1) | resolved |
| | TS mutates the caller's options object | resolved |
| | `WithMem`/`WithVol` inert (#37) | resolved |
| | `Copy.exclude`, single-file (#32) | **live** (shared) |
| | `mergeOptions` drops `Cmp`/`Name` | **live** (deviation) |
| | per-call `Control` cannot clear a global | **live** (deviation) |
| parity machinery + docs | directory-only state (§2.2) | resolved |
| | corpus cannot express binary (#24) | resolved |
| | Windows blind spot (#22) | resolved |
| | divergent failure modes (§2.1) | resolved |
| | deviation lists accurate and grouped honestly (§4) | resolved |
| | shared bugs invisible by construction (§2.4) | structural |

| surface | tracked | resolved | live |
|---|---|---|---|
| components + op walker | 9 | 7 | 2 |
| options surface | 6 | 3 | 3 |
| parity machinery + docs | 6 | 5 | 0 (+1 structural) |
| FileHandler + modes | 5 | 4 | 1 |
| diff/merge + fs | 3 | 3 | 0 |
| template + getx + utils | 3 | 2 | 1 |
| **total** | **32** | **24** | **7** (+1 structural) |

Of the 7 live: **4 are recorded deviations** rather than defects, **2 are bugs
both stacks share** (so not parity breaks at all), and **1 is a real
divergence** — the partial-tree difference on the Fragment error path, found
while implementing §2.1.

Every divergence this document has listed is now closed except that one.
`Hunks` copies its suffixes, `generate` validates a copy of the caller's
options, `sameContent` compares binary by bytes, §2.1's runners compare the
tree on error rows, §4's documentation defects are corrected, `Cmp` allocates
a node and goes through the Fragment filter (#29), and `WithMem`/`WithVol`
build a real in-memory filesystem (#37). Each landed with a pin, because a fix
with no pin is how this list refills.

**The one that is left has a different root cause than the issue it came in
under.** When both stacks reject a Fragment with a non-Slot child, Go leaves
the project folder behind and TS leaves nothing — because TS renders the
fragment during the DEFINE phase and throws before any build runs, while Go
renders in `fragmentAfter`, by which time folders exist. It is render timing,
not the `Cmp` node question it was found next to, and closing it means moving
Go's fragment render into the define phase. Worth deciding on its own
evidence.

Four verdicts moved under re-probing, and one of those was this document's own
first answer:

- **#27 is fixed and nobody closed it.** `save` classifies by destination
  extension, so an `a.png` holding ASCII takes `existing.bin` on *both* sides.
  Measured: `bin.preserve` writes `a.old.png` in TS and in Go; `txt.preserve`
  writes no backup in either.
- **#29 is worse than filed.** The issue records matching output with only the
  side-effect count diverging. With a user component whose body emits nothing,
  TS aborts the whole build and Go writes `AS0BS1C\n` — an output divergence.
- **§2.1 is neither done nor idle.** One snapshot exercises the `error` field;
  the known divergent shapes are absent, and the bulk runners skip the volume
  comparison on error rows entirely. §2.1 has both halves.
- **`Hunks` is still live, and the first pass here said otherwise.** The probe
  used inputs that share a first and last line, so the trailing `flush` was
  empty and nothing aliased. Inputs with divergent tails alias every time. One
  probe shaped like the happy path is how a re-verification pass produces a
  wrong verdict, which is worth recording next to the method that produced it.

Two issues are closed by work that shipped without closing them: **#22**
(Windows now runs `go test -race` in the CI matrix) and **#24** (the corpus b64
escape hatch, 1043 values in the committed corpora).

### What the gates now reach

40 whole-scenario snapshots, 1,197 scenario rows, 1,200 diff rows, 471 template
rows, 95 exclude rows, 281 shared spec rows across 8 TSVs, and a
`knownParityGaps` that is still empty — a TS scenario with no Go runner is a
hard failure, not a skip. Everything the corpora reach agrees byte for byte, and
that was re-confirmed by running them, not by reading the last CI badge.

Outside that reach the original finding stands unchanged: drift is the default,
because nothing looks. Nothing in this re-score measures the unlooked-at space,
and the 20-of-31 above should not be read as though it did.

### The original estimate, kept as history

Parity was scored at roughly **66-70%**, against per-surface scores averaging
~74, with 116 divergences catalogued (plus ~39 from the verifiers and 10 from
the cross-surface pass, less double-counting), 14 of them high severity.

| surface | score | verified | verdict |
|---|---|---|---|
| diff/merge + fs | 88 | 83 | DRIFT |
| template + getx + utils | 82 | 78 | DRIFT |
| FileHandler + modes | 78 | 72 | DRIFT |
| components + op walker | 76 | 72 | DRIFT |
| parity machinery + docs | 72 | 68 | DRIFT |
| options surface | 70 | 65 | DRIFT |

The number that mattered most was never the score. It was that **108 of the 116
were caught by no test on either side** — and that ratio is the one this
re-score cannot update, because the tail it describes is exactly what nobody has
looked at since.

---

## 1. The two live data bugs — both fixed, both re-measured

Neither was issue material; both were small, and both were verified here rather
than taken from the audit. The diagnosis is kept because it is the record of
*why* the fix is shaped the way it is, and because §1.1 is the standing
exception to the TS-wins rule.

### 1.1 A global dry run overwrote the user's files (TS) — FIXED

**[re-verified v0.34.1]** `Jostraca({control: {dryrun: true}})` now writes
nothing.

```
GLOBAL dryrun:true      []                       <- was: every output file
PER-CALL dryrun:true    []
no dryrun (baseline)    4 files
```

`control` is declared with `Skip(Boolean)` at `ts/src/jostraca.ts:153-162` and
merged as `deep({}, CONTROL_DEFAULTS, gOpts.control, opts.control)`, so an
absent per-call value no longer outranks the global one. Go was correct
throughout and was not changed. **The original finding, for the record:**

**[verified]** `Jostraca({control: {dryrun: true}})` writes every output file.

```
GLOBAL dryrun:true      ["/out/a.txt","/out/.jostraca/generated/a.txt",
                         "/out/.jostraca/jostraca.meta.log","/out/.jostraca/.gitignore"]
PER-CALL dryrun:true    []
no dryrun (baseline)    ["/out/a.txt", ...identical to the global-dryrun case]
```

Cause: `control` is declared with literal defaults, not `Skip`, at
`ts/src/jostraca.ts:147-157`. shape therefore injects
`{dryrun: false, duplicate: true, version: false}` into **every** per-call
options object, including one the caller left empty. The merge at
`ts/src/jostraca.ts:258` is `deep({}, gOpts.control, opts.control)`, so the
injected per-call defaults always win over the global setting.

This is the worst finding in the audit. A dry run is the thing a user reaches
for precisely to avoid touching their files, it is in the canonical stack, and
it fails silently and completely.

**Fix**: make the per-call `control` distinguish absent from default, so the
global survives. `Skip` on the three keys is the smallest change, but note §1.3
before choosing it. Add a regression test asserting a global dry run writes
nothing, in both stacks.

**Consequence for the rule**: `CLAUDE.md` says TS wins when the two disagree.
Here TS is the dangerous one and Go is correct. Go must not be aligned to TS on
this. Record the exception in `CLAUDE.md` rather than leaving it to be
rediscovered.

### 1.2 `exclude: true` was inverted in Go — FIXED

**[re-verified v0.34.1]** Under a live clock, two runs, 20 files: Go regenerates
its own output 20/20 (the bug made it skip its own files), and with the files
edited between runs it preserves the edits 40/40. `last` is stamped in `done()`
at `go/buildmeta.go:159`, at the end of the build, with the reason recorded at
`go/buildmeta.go:46-48`. **The original finding, for the record:**

**[verified]** by reading both sides; the 400-file two-run probe is **[audit]**.

The two stacks stamp meta `last` at opposite ends of the build:

- TS at build **end** — `ts/src/build/BuildMeta.ts:77-79`, inside `done()`.
- Go at buildMeta **construction**, before any file is written —
  `go/buildmeta.go:40-49`, `last: fh.now()` in the `newBuildMeta` literal.

Both then ask the same question of the previous run's value:
`stat.mtimeMs > last` at `ts/src/op/FileOp.ts:59-68`, `fi.ModTime > last` at
`go/build.go:281-289`.

Under TS's ordering, generated files carry an mtime earlier than `last`, so they
do not trip the window and only genuine user edits are skipped. That is the
documented behaviour. Under Go's ordering, generated files carry an mtime
*later* than `last`, so on the next run Go skips the files it wrote itself. The
audit measured 1 of 400 files regenerated where TS regenerated 400 of 400.

`exclude: true` in Go therefore means "stop regenerating after the first build".

**Fix**: stamp `last` at build end in Go, matching TS. The test needs a live
clock, because every existing snapshot freezes it
(`ts/tools/extract-parity.js:28,36`), which is exactly why nothing caught this.

**Second consequence**: the same value feeds the conflict-marker label
(`ts/src/build/FileHandler.ts:647,662` and `go/filehandler.go:480,518`), so
under a real clock the two stacks' merge markers are offset by the previous
build's duration.

### 1.3 The caution that shaped §1.1's fix — still standing

§1.1's fix moved `control` from injected-default to Skip-like, and stopped
there deliberately. Injected defaults are structural in this codebase: a
validator that checks without injecting crashes on `existing` and silently
produces a wrong output tree on `control` (established in `DEPENDENCY_PLAN.md`
§3.2). The rule was, and remains: change the precedence, not the injection.

It is worth re-reading next to §2.3, where the one surviving caller-side
instance is the injection writing shape's defaults into the caller's own options
object. That is the same mechanism seen from the other end, and whatever is done
about it has to leave this constraint intact.

---

## 2. Close the blind spots

Worth more than any individual bug, because it is what stops the class from
regenerating.

The pattern in this project's own history is unambiguous. Every time a pin was
added, it immediately found bugs: the shared corpus exposed four unknown
divergences and 17 failing cases on its first run (`6e28d8b`), Windows CI found
`fbd03ec`, the exclude corpus and the `existing.bin` axis each found more. All
~30 known divergences were fixed inside one six-day window in July, and nothing
has been found since — not because nothing is there, but because nothing has
looked. Issue #37 was filed on 30 August and is still open.

So the response to "108 of 116 are untested" is not to fix 108 bugs. It is to
add pins where they would catch the classes that matter, and let the pins say
what to fix. Three classes are invisible to every piece of machinery at once.

**[re-verified v0.34.1]** One of the three is fully pinned (§2.2). §2.3 has one
of its three instances fixed, and §2.1 has its machinery built, one row through
it, and no comparison of output when that row fires.

The claim above that "nothing has been found since" needs correcting: the
re-score found #27 fixed and left open, and #29 diverging in output rather than
only in side effects — both by running the scenarios again, neither by a pin.

And then a review of the re-score found a wrong verdict in it, which is the same
lesson one turn further out. `Hunks` was probed with inputs sharing a first and
last line, so the trailing flush was empty and the aliasing never appeared. The
probe was real, ran, and proved nothing about the path that matters. A gate
would have carried the shapes a hand-written probe forgets, which is the whole
argument of this section, now demonstrated at the expense of its own author.

### 2.1 Divergent failure modes — DONE, and it found something

**[re-verified v0.34.1]** The mechanism landed and one row uses it. The
known divergent shapes are still absent, and the comparison is thinner than it
looks.

`ts/tools/extract-parity.js:45-50` wraps the generate call and records `error`.
Coverage as it stands:

| corpus | rows | rows carrying `error` | `error` set |
|---|---|---|---|
| `scenario_corpus.json` | 1197 | 1197 | 0 |
| `copy_exclude_corpus.json` | 95 | 95 | 0 |
| `template_corpus.json` | 471 | 0 | — |
| whole-scenario snapshots | 40 | 40 | **1** |

That one is `go/testdata/parity/fragment_missing_from_errors.json`, generated
expressly to exercise the field and checked by `runParityCase`. So the gate is
**not idle** — it has a single row proving it works, which is exactly the
argument for adding more.

Two things are still missing, and the second is the one that would quietly
weaken the first:

1. **The known divergent shapes are not represented.** They are not
   hypothetical: the empty-body `Cmp`-inside-`Fragment` shape measured in §3 is
   one, TS aborting where Go writes a file.
2. **The bulk runners do not compare the volume on an error row.**
   `go/scenario_corpus_test.go:234-241` and `go/copy_exclude_corpus_test.go:157-164`
   both `continue` as soon as the expected error matches. The generator captures
   the partial tree, and nothing reads it — so two stacks that both throw while
   leaving *different* partial output pass. Adding throwing rows without fixing
   this buys an assertion that both sides threw, and no more.

**Both halves are now done.**

`go/scenario_corpus_test.go` and `go/copy_exclude_corpus_test.go` fall through
to the same tree comparison every other row gets instead of `continue`-ing on
a matched error. Two more both-stacks-fail scenarios are in the corpus:
`copy_missing_source_errors` (nothing written) and
`inject_missing_target_errors`, which fails in its after-hook with the project
folder already made — so it pins a NON-EMPTY tree on an error path, which is
the shape the `continue` used to hide.

**And the pin immediately earned itself.** A third candidate was measured and
deliberately not committed: a `Fragment` with a non-Slot child and no unnamed
marker fails in both stacks, but leaves `/out/app` behind in Go and nothing in
TS. Both throw; the partial trees differ. That is a live divergence of exactly
the class this section exists to catch, found within an hour of building the
gate for it, and it is not in the corpus yet because a knowingly-red row is not
a gate. It is adjacent to #29 but distinct: #29 is about which children run,
this is about what survives when the build stops.

**The original finding, for the record.** Across the four corpora, the `error`
field was never set:

| corpus | rows | rows carrying `error` | `error: true` |
|---|---|---|---|
| `scenario_corpus.json` | 1197 | 1197 | **0** |
| `copy_exclude_corpus.json` | 95 | 95 | **0** |
| `template_corpus.json` | 471 | 0 | **0** |
| `diff_corpus.json` | 1200 | no such field | — |

Go already asserts the field bidirectionally where it exists
(`go/scenario_corpus_test.go:234-246`), so the assertion machinery is built and
idle. The generator cannot populate it: `ts/tools/extract-parity.js:39` calls
`await j.generate(...)` unguarded, so a TS-throwing scenario crashes the
generator instead of being recorded.

The class "one stack throws, panics or aborts where the other completes" already
has at least eight known members, including a Go panic on a two-line program
(`go/build.go:810`, nil func call for a Fragment with a nil body over an unnamed
`<[SLOT]>` marker) and two whole-build aborts in TS.

**Fix**: wrap the generate call, record the error, and add rows for the known
eight. This turns an entire invisible class into a gated one.

### 2.2 Directory-only state — FIXED, re-measured

**[re-verified v0.34.1]** Go's `Vol()` returns a nil value for an empty
directory (so a directory can never match an empty file), a dry run creates no
directories, and TS materialises an empty `Folder` — `/out/p/empty` comes back
as `null` in the volume. All three were probed directly.

**[audit]** No snapshot can contain a directory-only difference. Go's
`MemFS.Vol()` copied files only, so there was nothing on that side to compare a
recorded directory against. Zero `null` entries existed across all 38 JSONs.

The audit put the blame in the wrong place, and the correction matters because
it changes what had to be fixed. It read `volOf(mfs, nulls)` at
`ts/tools/corpus-bytes.js:59-68` as recording an empty directory "only when
asked", with none of the call sites asking. The default is the opposite:
`nulls` undefined fails the `'empty' === nulls` test and the `null` is kept. The
generator was never the problem. Zero `null` entries existed because no fixture
had an empty directory — and none could be written usefully while the Go side
had no way to see one.

This one gap hid two separately-filed findings: TS materialises an empty
`Folder` where Go does not, and Go creates output directories during a dry run.

**Fixed.** `Vol()` now reports an empty directory as a nil value, matching TS's
`toJSON`. That made both findings visible immediately — three Go tests failed
the moment the change landed, the dry-run ones among them — and both are fixed:
`folderBefore` materialises the folder as TS's `FolderOp` does, and
`ensureFolder` is a no-op under a dry run as TS's is. The `empty_folder`
snapshot carries the first `null` entries the corpus has ever held, and
`assertVol` compares kinds before bytes, so a directory can never match an empty
file.

### 2.3 Caller-side state — ALL THREE FIXED

**[re-verified v0.34.1]** Probed one instance at a time:

| instance | at v0.34.1 |
|---|---|
| getx's `?` filter stamps the caller's model | **fixed** — `key$`/`index$` swept from rejected children too, on object and array nodes |
| Go's `Hunks` returns slices aliasing the caller's arrays | **fixed** — the trailing flush copies, as canonical TS always did |
| TS mutates the caller's options object | **fixed** — `generate` validates a copy |

The class is closed, and each fix carries a pin: `TestHunksDoesNotAliasCallerSlices`
runs every input shape that reaches the trailing flush,
`generate-does-not-mutate-the-caller-options` asserts the caller's object is
untouched, and `TestGenerateDoesNotMutateCallerOptions` holds the Go side over
the maps its value-struct Options carries. Both new tests were run against the
pre-fix code first; both fail there.

**`Hunks` still aliases, and the first probe of it here was wrong.** The
in-loop hunks are built with `append` onto nil slices, so those are fresh. The
trailing `flush(generated[gi:], existing[ei:])` at `go/diff.go:593` hands the
caller's own backing array straight into the returned `Hunk`, and `flush` does
not copy. Whether a caller can observe it depends entirely on the input shape,
which is why one probe was not enough:

| input | trailing flush | caller's arrays |
|---|---|---|
| `[a b c]` vs `[a X c]` | empty | untouched |
| `[a]` vs `[b]` (no common line) | both sides | **mutated** |
| `[a b c]` vs `[a X Y]` (divergent tails) | both sides | **mutated** |
| `[a b c d]` vs `[a]` | generated side | **mutated** |

The fix is to copy the suffixes in that last `flush`, the way the loop already
does by construction.

The live one, measured: passing `{folder: '/out'}` to `generate` and reading the
same object back afterwards yields
`{folder, name, meta, exclude, existing, build, cmp, control}` — shape's
injected defaults, written into the caller's own object. A caller who reuses one
options object across two `generate` calls is not passing what they think they
are passing on the second.

**The original finding, for the record.**

**[audit]** All four corpora record output only, never the model, the options
object, or returned slices. Three instances were each found independently and
none named the class: TS mutates the caller's options object, getx's `?` filter
mutates the model, and Go's exported `Hunks` returns slices aliasing the
caller's arrays. The getx one demonstrably reaches generated bytes, so this is
a latent output-divergence class, not an API wart.

### 2.4 The gap the machinery cannot close by design

Every corpus is TS-generated and Go-replayed, so a bug **shared** by both stacks
is invisible by construction. Issues #26 and #32 are exactly that: identical
behaviour, both wrong. They are not parity defects, and they are proof of the
limit. Worse, `copy_exclude_corpus` currently freezes #32 as the expected
answer, so the suite defends the bug.

No pin fixes this. It needs the occasional review against the docs rather than
against the other stack.

**[re-verified v0.34.1]** Both examples still behave identically on both sides,
which is what makes them invisible: #26 writes a following top-level sibling
into the project's folder (`/out/p/b.txt`) in TS and in Go alike, and #32 copies
a single file whose name is in `exclude` in TS and in Go alike. The corpus still
records #32's behaviour as expected output, so the suite still defends the bug —
by design, and worth re-reading as a decision rather than rediscovering as a
surprise.

---

## 3. The filed list, re-probed

All six original rows are resolved. **[re-verified v0.34.1]**, one probe each:

| item | at v0.34.1 | measured |
|---|---|---|
| Go panic on nil-body Fragment + unnamed slot | fixed | no panic; emits `"A\n\nB\n"` |
| Fragment `eject` ignored | fixed | Go `"KEEP\n"`, TS `"KEEP\n"`, same source |
| setuid dropped | refuted, and a real neighbour fixed | `chmodUnchanged` compares `chmodBits`, not `Perm()` |
| `File({mode: 0})` | deviation, unchanged | documented on both sides |
| List `{item.path}` macro absent | fixed (#40) | Go `"n=p\nn=q\n\n"` |
| Nested `File`/`Copy` clobbers parent | fixed (#39) | `"BEFORE\nHELLO\nAFTER\n"`, copy also written to its own destination |

### The open issues, re-probed

The tracker is now the larger half of this document's live surface, so it is
measured here rather than trusted.

| issue | filed as | at v0.34.1 |
|---|---|---|
| #22 | Windows blind spot no CI gate closes | **closed by CI**; the matrix runs `go test ./... -race` on `windows-latest`. Close the issue. |
| #24 | corpus format cannot express binary | **closed by the b64 escape hatch**; 1043 b64 values in the committed corpora, 26 rows in `test/spec/binary.tsv`. Close the issue. |
| #26 | `Project` folder leaks to a following sibling | live, and identical on both sides — §2.4's example, not a parity break |
| #27 | txt/bin chosen by different criteria | **fixed in code, issue still open.** `save` classifies by destination extension now (`ts/src/build/FileHandler.ts:290-291`, with the reasoning at `:278-289` naming this exact scenario), so both stacks give an ASCII-holding `a.png` to `existing.bin`. Measured both ways round. Close the issue. |
| #29 | Fragment filter skipped for non-Slot children | **live, and worse than filed** — see below |
| #30 | Buffer compared against string | **fixed**; `sameContent` compares bytes, and `binary_copy_identical_no_backup` pins it. The fix changed no existing corpus row, which is why the pin was added |
| #32 | `exclude` ignored for a single-file `Copy` | live, identical on both sides, and still frozen as expected output by the corpus |
| #37 | `WithMem`/`WithVol` inert | live; writes to the real filesystem, returns `Vol` nil and no error |

**#29 needs its issue updated, not just its fix.** It is filed as a side-effect
divergence with matching output. The full matrix, measured on the same fragment
source with two named slots and one user component as a non-Slot child:

| the component's body | TS | Go |
|---|---|---|
| emits content | errors, body runs **0** times | errors, body runs **3** times |
| emits nothing | errors, body runs **0** times | **no error**, writes `AS0BS1C\n`, body runs **3** times |

The second row is an **output divergence**: TS aborts the build and writes
nothing, Go writes the file. That is a different and larger claim than the one
on the issue, and it is also a ready-made row for §2.1.

**The trap this section used to carry is gone**, and saying so matters because
it was pointing future work at a test that needs nothing.
`go/durability_test.go` `TestDryrunWritesNothing` supplies a *global*
`WithControl(Control{Dryrun: true})` and asserts that Go writes nothing at all,
baseline included. That is the behaviour §1.1 brought TypeScript to, so the test
pins agreement rather than a divergence and no rewrite is owed. The standing
exception to the TS-wins rule in `CLAUDE.md` is unaffected: it records why TS
was fixed toward Go, which is still the reason it reads the way it does.

---

## 4. Record

The documented deviation lists are where a Go user actually looks.
**[re-verified v0.34.1]** Three defects were found and all three are fixed.

**The counts differ, and that one turned out to be fine.** `go/README.md`
carries 22 deviation bullets, `docs/reference-go.md` 20. Checked
topic-by-topic rather than by counting: every item in one has a home in the
other. `reference-go.md` merges the inert `WithMem`/`WithVol` with the dropped
`Cmp`/`Name` into a single bullet, and covers `Each.Raw` (`:287`) and
`PointUtil` (`:364`) in its own sections rather than as deviation bullets.
Nothing is missing either way, so the lists are left grouped as they are and
`reference-go.md` now says so, instead of a future reader deriving it again.

**`docs/reference-go.md` stated something false about `go/README.md`.** At
`:314-316` it said of the inert `WithMem`/`WithVol` and the dropped per-call
`Cmp`/`Name`:

> Neither is in `go/README.md`'s own deviations list.

Both are in it. Whatever was true when that sentence was written, it sent a
reader looking for a gap that is not there and implied the README was less
complete than it is. **Deleted.**

**And one line in both was wrong about behaviour**, again flattering the port.
Both lists said of a user component used as a direct `Fragment` child:

> the "non-`Slot` child with no unnamed `<[SLOT]>` marker" error fires in TS and
> not in Go for that one shape

That holds only when the component's body emits nothing. When it emits content,
Go raises the same error TS does — measured in §3. The sentence needs the
distinction, because as written it reads as though Go never raises it.

**Corrected in both**, with the measured matrix rather than a single claim, and
without aligning either stack: the underlying divergence is #29, which is a
decision this document does not make on its own.

All three were done together, since anyone opening these files to fix one is
looking straight at the others.

---

## 5. What not to do

**Do not work the 150-item list.** Most of the tail is low severity and
unpinned, and the low-severity findings are the least independently verified
part of the audit. Fix §1, close §2, file §3, and let the new pins report what
is left.

**Do not re-run the audit to get a better number.** The score is an estimate
over an unbounded space. The actionable output is the classes, not the total.

This still holds, and the re-score in §0 is not an exception to it: it counts
named items, each re-probed, and says so. A count of what is tracked is not an
estimate of what exists. If the two are ever quoted side by side as though the
second replaced the first, the sentence above is the one that is right.

**Do not align Go to TS mechanically.** The rule holds nearly everywhere and
fails exactly where it matters most (§1.1).

---

## 6. Sequence

Everything this document set out is done except one item, and that one is a
decision rather than a backlog entry.

1. **The Fragment error-path divergence.** Both stacks reject a Fragment with
   a non-Slot child; Go leaves the project folder behind, TS leaves nothing.
   TS renders the fragment in the DEFINE phase and throws before the build
   starts; Go renders in `fragmentAfter`, after folders are made. Closing it
   means moving Go's fragment render into the define phase, which changes when
   the model is resolved for every Fragment — so it wants measuring before it
   is attempted, not a quick alignment.

   Note what it is NOT: it was found next to #29 and looks like a facet of it,
   but #29 was about which children run, and this is about when the render
   happens. Fixing #29 did not touch it.

2. **#26 and #32 stay open on purpose.** Both stacks behave identically, so
   neither is a parity break (§2.4), and the corpus records #32's behaviour as
   expected output. They are semantic warts to fix against the docs, on their
   own schedule.

That is the whole of it. The tracker is down to those, the four recorded
deviations, and nothing else.

---

## 7. What this exercise actually taught

Worth keeping, because it is the part that generalises.

**The gate found something the day it was built.** §2.1's runners had compared
the tree on error rows for about an hour when the Fragment error path turned
up — a real divergence, in the exact class the section was written to catch,
that nobody had gone looking for.

**A probe is evidence of what it exercised, and nothing else.** Three times on
this branch a check passed against code it was meant to catch:

- `Hunks` was marked fixed on inputs sharing a first and last line, which
  leave the trailing flush empty and alias nothing.
- The caller-options test passed a `cmp.Copy` that already carried `ignore`,
  so shape's injection had nothing to add.
- The re-score's own "one level of copying is enough" came from measuring two
  option subtrees and generalising.

Each was caught by running the PRE-FIX code against the new test, and by an
adversarial reader asking which inputs reach the path. Neither step is
optional; the first is cheap and mechanical, and it is the one that keeps
being worth its cost.

**Fixing one member of a family is not fixing the family.** #29 was filed
against `Cmp`, so `Cmp` is what got the node, the filter call and the pin —
and the pin passed. Review then found `Content` still rendering its template
before asking, and `List` never allocating a node at all, both of them the
same divergence under a different component. The pin was honest about `Cmp`
and said nothing about its siblings. When a fix is "route X through the
check", the next question is which other X there are; here the answer was
every component that allocates a node, which is a list the code can be
grepped for rather than recalled.

**A fix with no pin is how this list refills.** #30 changed no existing corpus
row — that is why it survived so long, and why the fix shipped with a new row
rather than on its own.
