# Jostraca — TS/Go parity: findings and plan

Scope: the current level of behavioural parity between `ts/` (canonical) and
`go/` (port), what to do about it, and in what order.

Evidence is marked two ways, and the distinction is deliberate:

- **[verified]** — reproduced here by running code, cited with file:line.
- **[audit]** — found by the parity audit (six surface passes, each with an
  independent adversarial verifier, then a cross-surface pass). Every
  high-severity item was executed by its finder and re-executed by its verifier,
  but it has not been re-run by hand for this document.

Act on [verified] directly. Treat the [audit] tail as leads, not as a to-do list.

---

## Status

Worked through on this branch. Items marked **filed** need a decision this plan
should not make unilaterally.

| § | item | status |
|---|---|---|
| 1.1 | global `control` discarded in TS | **fixed**, 6 TS + 7 Go tests |
| 1.2 | `exclude: true` inverted in Go | **fixed**, 4 Go tests |
| 2.1 | `error` field never populated | **fixed**, gate live and exercised |
| 3 | Go panic on nil-body Fragment | **fixed**, 4 Go tests |
| 3 | Fragment `eject` never read in Go | **fixed**, cross-stack snapshot |
| 3 | chmod comparison narrower than chmod | **fixed**, 4 Go tests |
| 3 | Copy inside File destroys the file (TS) | filed, #39 |
| 3 | `List` `{item}` macro absent in Go | filed, #40 |
| 2.2 | directory-only state invisible | filed, #41 |
| 3 | `File{Mode: 0}`, per-call `Control` | documented as deviations |
| 4 | deviations lists | **updated**, both files |
| 2.3 | caller-side state | **fixed**, 3 TS + 3 Go tests |

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

Parity sits at roughly **66-70%**, against per-surface scores that average ~74.
The composite is lower than its parts because the worst behaviours live in the
joins between surfaces that are each well pinned on their own.

| surface | score | verified | verdict |
|---|---|---|---|
| diff/merge + fs | 88 | 83 | DRIFT |
| template + getx + utils | 82 | 78 | DRIFT |
| FileHandler + modes | 78 | 72 | DRIFT |
| components + op walker | 76 | 72 | DRIFT |
| parity machinery + docs | 72 | 68 | DRIFT |
| options surface | 70 | 65 | DRIFT |

116 divergences catalogued, plus roughly 39 more from the verifiers and 10 from
the cross-surface pass, less some double-counting. 14 are high severity.

The number that matters most is not the score. It is that **108 of the 116 are
caught by no test on either side**.

Two things are true at once, and the plan follows from holding both. The
mainline is genuinely solid: 28 single-`Generate` snapshots plus 5 multi-phase,
1,197 scenario rows, 1,200 diff rows, 471 template rows, 95 exclude rows, an
empty `knownParityGaps`, and everything the corpora reach agrees byte for byte.
Outside that reach, drift is the default state, because nothing looks.

---

## 1. Fix now

Two live data bugs. Neither is issue material; both are small, and both are
verified here rather than taken from the audit.

### 1.1 A global dry run overwrites the user's files (TS)

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

### 1.2 `exclude: true` is inverted in Go

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

### 1.3 One caution before touching options defaults

§1.1's fix moves `control` from injected-default to Skip-like. Injected defaults
are structural in this codebase: a validator that checks without injecting
crashes on `existing` and silently produces a wrong output tree on `control`
(established in `DEPENDENCY_PLAN.md` §3.2). Change the precedence, not the
injection, and keep the regression test for both.

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

### 2.1 Divergent failure modes — the fix that pays for itself fastest

**[verified]** Across the four corpora, the `error` field is never set:

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

### 2.2 Directory-only state

**[audit]** No snapshot can contain a directory-only difference. `volOf(mfs,
nulls)` at `ts/tools/corpus-bytes.js:59-68` records an empty directory as `null`
only when asked, and none of the seven call sites in `extract-parity.js` passes
the argument; Go's `MemFS.Vol()` copies files only. Zero `null` entries exist
across all 38 JSONs.

This one gap hides two separately-filed findings: TS materialises an empty
`Folder` where Go does not, and Go creates output directories during a dry run.

### 2.3 Caller-side state

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

---

## 3. File, then fix

Real bugs, none data-destroying. Issues first so they are not lost.

| item | where | note |
|---|---|---|
| Go panic on nil-body Fragment + unnamed slot | `go/build.go:810` | crashes the caller's goroutine |
| Fragment `eject` ignored | `go/builder.go:244` | declared, never read; emits whole file |
| setuid dropped | `go/filehandler.go:697` | TS writes 4755, Go writes 755 |
| `File({mode: 0})` | `ts/.../FileHandler.ts:256` | TS writes unreadable 0o000, Go 0o644 |
| List `{item.path}` macro absent | `go/builder.go:382-392` | macro emitted verbatim |
| Nested `File`/`Copy` clobbers parent | `ts/src/op/CopyOp.ts:38` | enclosing file never written |

Two triage corrections for the existing issues: **#28 reads as fixed** on both
counts, and **#29 is live and worse than filed** — an output divergence now, not
only a side-effect one.

One trap. `go/durability_test.go:124-137` currently pins the Go side of the
dry-run divergence, so §1.1 means rewriting a passing test. That is correct
here, and it is the case §1.1 flags as needing an explicit exception to the
TS-wins rule.

---

## 4. Record

The documented deviation lists are where a Go user actually looks, and both are
incomplete. Fold the confirmed items into `go/README.md:299` and
`docs/reference-go.md:243`, and correct the stale claims in `go/PORT_PLAN.md`
and `go/BUILD_LOG.md` that the audit flagged.

---

## 5. What not to do

**Do not work the 150-item list.** Most of the tail is low severity and
unpinned, and the low-severity findings are the least independently verified
part of the audit. Fix §1, close §2, file §3, and let the new pins report what
is left.

**Do not re-run the audit to get a better number.** The score is an estimate
over an unbounded space. The actionable output is the classes, not the total.

**Do not align Go to TS mechanically.** The rule holds nearly everywhere and
fails exactly where it matters most (§1.1).

---

## 6. Sequence

1. §1.1 dry run, both stacks, with the regression test and the `CLAUDE.md`
   exception. Small, and it is the one shipping to users now.
2. §1.2 `exclude` timing in Go, with a live-clock test.
3. §2.1 the `error` field, plus rows for the eight known failure-mode members.
   This is where the compounding is.
4. §3 issues filed, then fixed in severity order.
5. §2.2 and §2.3 pins, which will find more.
6. §4 documentation.

Steps 1 and 2 are the same afternoon. Step 3 is the one worth protecting from
being deprioritised, because without it this document has to be written again.
