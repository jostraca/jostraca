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
  back *unchanged*, and two came back different from what this document said.

Act on [verified] directly. Treat the [audit] tail as leads, not as a to-do list.

---

## Status

Every row re-probed at v0.34.1. "Holds" means the fix was re-measured, not that
the commit that made it is still in the log.

| § | item | status at v0.34.1 | how it was re-checked |
|---|---|---|---|
| 1.1 | global `control` discarded in TS | **fixed, holds** | global dryrun writes 0 files; per-call 0; no-dryrun baseline 4 |
| 1.2 | `exclude: true` inverted in Go | **fixed, holds** | live clock, two runs: regenerates its own 20/20, preserves user edits 40/40 |
| 2.1 | `error` field never populated | **half done** | field now recorded on all 1292 scenario and exclude rows; **0 rows set it** — see below |
| 2.2 | directory-only state invisible | **fixed, holds** | `Vol()` returns nil for an empty dir; dry run creates none; TS materialises the `Folder` |
| 2.3 | caller-side state | **2 of 3** | getx stamp swept (object and array); `Hunks` no longer aliases; **TS still mutates the caller's options object** |
| 2.4 | shared bugs invisible by construction | **unchanged, by design** | #26 and #32 both still live and still byte-identical across stacks |
| 3 | Go panic on nil-body Fragment | **fixed, holds** | no panic; emits `"A\n\nB\n"` |
| 3 | Fragment `eject` never read in Go | **fixed, holds** | Go `"KEEP\n"` == TS `"KEEP\n"` on the same source |
| 3 | chmod comparison narrower than chmod | **fixed, holds** | compares `chmodBits`, not `Perm()` |
| 3 | Copy inside File destroys the file (TS) | **fixed, holds** (#39) | `"BEFORE\nHELLO\nAFTER\n"`, and the copy still written to its own destination |
| 3 | `List` `{item}` macro absent in Go | **fixed, holds** (#40) | Go `"n=p\nn=q\n\n"` |
| 3 | `File{Mode: 0}`, per-call `Control` | documented as deviations | unchanged |
| 4 | deviations lists | **one line now stale** | the `Cmp`-in-`Fragment` note is right for one shape and wrong for the other — see §4 |
| — | Go template non-determinism (#42) | **fixed, holds** | identical output across 25 fresh processes |
| — | `Copy.exclude` (#28) | fixed, closed | **not re-probed** — closed before this pass, and nothing here touches it |
| — | `List` string child (TS) (#44) | **fixed, holds** | `"n=p\nn=q\n\n"` |
| — | txt/bin classification (#27) | **fixed in code, issue still open** | the two stacks now **agree**; see §3 |
| — | Fragment filter on non-Slot children (#29) | **live, and worse than filed** | side effects 0 vs 3 — plus an *output* divergence the issue does not record |
| — | binary compared against a string (#30) | **live** | TS writes `mod.old.wasm` for byte-identical content; Go does not |
| — | `WithMem`/`WithVol` inert (#37) | **live** | writes to the real filesystem, `Vol` nil, no error |
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

| surface | tracked | resolved | live | what is still live |
|---|---|---|---|---|
| components + op walker | 8 | 6 | 2 | #26 folder leak (shared), #29 Fragment filter |
| FileHandler + modes | 5 | 3 | 2 | #30 binary vs string, `File{Mode:0}` (deviation) |
| options surface | 5 | 1 | 4 | caller options mutated, #37 inert `WithMem`, #32 single-file `exclude` (shared), `mergeOptions` drops `Cmp`/`Name` (deviation) |
| parity machinery + docs | 6 | 4 | 2 | §2.1 rows never added, one stale deviation line |
| template + getx + utils | 4 | 3 | 1 | slash-wrapped string eject marker (deviation, untested both sides) |
| diff/merge + fs | 3 | 3 | 0 | — |
| **total** | **31** | **20** | **11** | |

Of the 11 live, **4 are recorded deviations** rather than defects, **2 are
bugs both stacks share** (so not parity breaks at all), and **5 are real
divergences**: the TS options mutation, #29, #30, #37, and §2.1's missing rows.

Three verdicts changed direction under re-probing, which is the argument for
re-probing rather than reading the log:

- **#27 is fixed and nobody closed it.** `save` now classifies by destination
  extension, so an `a.png` holding ASCII takes `existing.bin` on *both* sides.
  Measured: `bin.preserve` writes `a.old.png` in TS and in Go; `txt.preserve`
  writes no backup in either.
- **#29 is worse than filed.** The issue records matching output with only the
  side-effect count diverging. With a user component whose body emits nothing,
  TS aborts the whole build and Go writes `AS0BS1C\n` — an output divergence.
- **§2.1 is half done, not done.** The generator wrap landed and every scenario
  row now carries `error`; no row has ever set it, so the class it was built to
  catch is still unexercised.

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

**[re-verified v0.34.1]** Two of the three are now pinned (§2.2 fully, §2.3 for
two of its three instances) and the third, §2.1, has its machinery built and no
rows to run through it. The claim above that "nothing has been found since"
needs one correction: this re-score found two things without adding a single
pin — #27 fixed and left open, and #29 diverging in output rather than only in
side effects. Both were found by running the scenarios again. That is not an
argument against pins; it is the reason the pins are worth building, since a
gate would have reported both without anyone deciding to go and look.

### 2.1 Divergent failure modes — HALF DONE, and the top of the queue

**[re-verified v0.34.1]** The mechanism landed; the rows never did.

`ts/tools/extract-parity.js:45-50` now wraps the generate call, records
`error`, and still captures the volume so a partial write before the throw is
compared too. Every scenario row carries the field:

| corpus | rows | rows carrying `error` | `error` set |
|---|---|---|---|
| `scenario_corpus.json` | 1197 | 1197 | **0** |
| `copy_exclude_corpus.json` | 95 | 95 | **0** |
| `template_corpus.json` | 471 | 0 | — |

So the gate is live and still idle: no scenario in the corpus throws on either
side, which means the class "one stack throws, panics or aborts where the other
completes" remains unexercised. The plan's second half — *add rows for the known
members* — was never done, and the members are not hypothetical: the empty-body
`Cmp`-inside-`Fragment` shape measured for §3 below is exactly one of them, TS
aborting where Go writes a file.

**Remaining fix**: add scenarios that throw. One row per known member; the
machinery to compare them has been sitting ready since the wrap landed.

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

### 2.3 Caller-side state — 2 of 3 FIXED, one still live

**[re-verified v0.34.1]** Probed one instance at a time:

| instance | at v0.34.1 |
|---|---|
| getx's `?` filter stamps the caller's model | **fixed** — `key$`/`index$` swept from rejected children too, on object and array nodes |
| Go's `Hunks` returns slices aliasing the caller's arrays | **fixed** — mutating every returned hunk leaves the inputs untouched |
| TS mutates the caller's options object | **live** |

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
| #30 | Buffer compared against string | live; TS writes `mod.old.wasm` beside byte-identical content, Go writes nothing |
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

One trap, still live as written. `go/durability_test.go:124-137` pins the Go
side of the dry-run divergence, which is the case §1.1 flags as needing an
explicit exception to the TS-wins rule.

---

## 4. Record

The documented deviation lists are where a Go user actually looks. Both were
brought up to date; 22 bullets now, mirrored in `go/README.md` and
`docs/reference-go.md`.

**[re-verified v0.34.1]** One line in them is now wrong, and it is wrong in the
direction that flatters the port. Both lists say of a user component used as a
direct `Fragment` child:

> the "non-`Slot` child with no unnamed `<[SLOT]>` marker" error fires in TS and
> not in Go for that one shape

That holds only when the component's body emits nothing. When it emits content,
Go raises the same error TS does — measured in §3. The sentence needs the
distinction, because as written it reads as though Go never raises it.

The correction is a documentation fix, not a behaviour change, and it should not
be made by aligning either stack: the underlying divergence is #29.

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

Steps 1, 2, 4 (partly), and the §2.2/§2.3 pins are done. What is left, in the
order it is worth doing:

1. **§2.1's missing rows.** The wrap is in and the assertion is bidirectional;
   what is absent is a single scenario that throws. Start with the empty-body
   `Cmp`-inside-`Fragment` shape from §3, which is already measured on both
   sides and diverges in output. This is still where the compounding is, and it
   is still the step worth protecting from being deprioritised.
2. **Close #22, #24 and #27.** All three are fixed in the tree and open on the
   tracker. #27 in particular reads as a live inversion to anyone triaging from
   the issue list, and it is not one.
3. **Re-file #29** with the measured matrix. It is an output divergence, not a
   side-effect count, and today's title understates it.
4. **The TS options mutation** (§2.3). The one caller-side instance left, and
   the only one of the three that a user can hit without reaching for an
   internal.
5. **#30**, which writes a spurious `.old` sidecar on every regeneration of an
   unchanged binary.
6. **The §4 deviation line**, corrected rather than deleted.

#26, #32 and `File{Mode:0}` are deliberately not on this list: two are bugs both
stacks share (§2.4) and one is a recorded deviation. #37 stays where it is until
someone decides whether `WithMem` should work or should fail loudly; it is
documented either way, which is the part that mattered.
