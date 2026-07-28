# Jostraca — Code Review

Scope: independent review of `ts/` (canonical) and `go/` (port), then reconciliation,
plus an assessment of the parity-checking machinery.

Baseline: both implementations build and test green at review time
(TS 36 tests pass; Go `go test ./...` and `go vet ./...` clean).

Findings marked **[verified]** were reproduced by running code, not inferred from reading.
Reproductions were run against `ts/dist` and a scratch copy of the Go module.

---

## 0. Status

Fixed on this branch, each with regression tests in both stacks:

| id | fix |
|---|---|
| §5.1 | both CI workflows now run (`working-directory: ts`; `./...` not `./jostraca`) |
| §5.2 | `go-test.yml` also triggers on `ts/**` |
| §5.3 | CI regenerates the parity corpus and fails on any diff |
| §5.4 | a missing Go runner now fails instead of skipping (`knownParityGaps` carries exemptions) |
| §5.6 | the tautological `expect(found \|\| true).true()` now asserts real behaviour |
| T1 | a top-level `File` resolves under the output folder, not `/` |
| T2 / G-shared | `..` in a `File`/`Folder`/`Inject`/`Copy(to)` name is rejected in both stacks |
| T3 / G6 | dotfile backups keep their name (`.env` → `.env.old`), so two dotfiles no longer collide |
| **T0** | **`Jostraca()` with no `fs`/`mem` could not write to the real filesystem at all** (see §2.0) |
| T4 / G3 | writes are atomic (temp + rename), with the target's mode preserved |
| G2 | merge-baseline write errors propagate instead of being discarded |
| T9 | `dryrun` no longer creates directories in `copyFile` |
| G11 (part) | dead `savePreserve` removed |
| G1 | Go LCS rewritten: prefix/suffix trim + Hirschberg. Output byte-identical (pinned against the old algorithm over randomised inputs); memory now two rows, O(M), instead of a full table |
| G4, G5, T12 | Inject: every marker pair rewritten, end marker searched after the start marker, missing target errors in both stacks, missing markers warn |
| T8 | byte-identical files are no longer rewritten (no mtime churn); duplicate-save detection made robust |
| G7 | Go mode dispatch mirrors TS's block order — `preserve` fires alongside `diff`/`merge`, `present` fires under protect |
| T14, G9, G16 | path prefixes matched on a separator boundary; Go's baseline write gained TS's `withinFolder` + metafile guard |
| T5 | binary detection sniffs content (NUL in first 8 KB), so `.wasm`-class files survive `Copy` intact |
| T6 | a corrupt meta log no longer blocks generation |
| T10 | copy walk detects symlink cycles (and Go now follows directory symlinks, as TS does) |
| T11 | `-jostraca-off` / `~` ignore rules now apply to text files, not only binaries |
| T22 | `isbinext` uses a Set |
| T17 | one shared `AsyncLocalStorage` instead of one replaced per `Jostraca()`; clear error when a component is used outside `generate()` |
| T18 | the define callback is awaited, so an async one no longer yields a partial tree |
| T19 | `cmp()` restores the tree cursor in a `finally` |
| T13 | debug-log buffer bounded; its file filter compared the wrong field; each `generate()` reports only its own warnings |
| T7 | `Options.exclude` (skip files modified since the last build) actually works in TS, matching Go |
| T20, T21 | unreachable merge fast-path documented; `camelify` no longer throws on an array with an empty element |
| G8 | Go collects replayed content at any depth — a `Fragment` inside a `Slot` was silently dropped |
| G10 | Go's unresolved-conflict guard keys on the end marker alone, as TS's does |
| G11 | dead `writeConflict` removed |
| T16 | a relative Fragment `from` works at all — it used to throw, because the shape check stat'd the raw relative path against the process CWD |
| G15 | Go's package-global dlog buffer is capped, matching TS |
| G12 | `File` takes a `mode` prop in both stacks, so a generated script can be executable |
| **G17 / T24** | **resolved** — both stacks now run one shared diff/merge engine (`ts/src/diff.ts` ↔ `go/diff.go`), held byte-identical by a 1 200-case differential corpus, at 100% coverage on both sides, with `node-diff3` and `diff` dropped |
| **T25 / G18** | **the template engine is now under the same differential corpus** — 471 cases, and it found six real divergences on the way in: inverted `eject` markers, JS number formatting, HTML escaping, object key order |
| T26 | mode assertions skip on Windows, which has no execute bit — found the moment CI ran there for the first time (see §2.1) |
| **R1–R9** | **nine defects an automated reviewer found on the PR, all verified with reproductions and all real** (see §2.2) |
| **R10–R14** | **a second review round on the fixes themselves: four more real defects, one refuted** (see §2.3) |

Also corrected: `extract-parity.js`'s default output path (stale after the module
flatten), and a stale "deviation" note in `go/README.md` claiming the Go 2-way diff render
differed from TS — it does not, and `diff_mode` asserts that byte-for-byte.

New parity scenarios cover behaviours the corpus previously missed — `no_project_file`,
`dotfile_preserve`, `preserve_and_diff`, `protect_and_present`, `inject_two_blocks`,
`inject_stray_end_marker`, `inject_no_markers`, `fragment_nested_in_slot`,
`copy_ignore_text`. The suite is now 32 scenarios, plus the two generated corpora
(`diff_corpus`, `template_corpus`).

**A parity-harness limitation found while adding coverage:** the corpus cannot express
binary content. Values are JSON strings, so a byte above 0x7F round-trips as its UTF-8
encoding — `0xFF 0xFE` reaches the Go side as `0xC3 0xBF 0xC3 0xBE`. A binary scenario
would fail spuriously, or worse, be "fixed" by making one stack wrong. Binary behaviour is
therefore covered by per-stack unit tests (`ts/test/robustness.test.ts`,
`go/robustness_test.go`), and the corpus carries only the text half. Adding binary
scenarios needs a base64 escape hatch in the format.

**Still open**, each deliberately left alone rather than patched:

- **T15** — `Fragment` re-runs its children once per slot marker plus once to collect slot
  names. Collapsing that to a single pass is possible but would change the semantics of
  side-effecting children in the most intricate component here, to buy CPU on a define
  phase that is not the bottleneck. Not worth the risk without a reported problem.

That leaves T15 as the only item from this review not acted on. Directory modes are still
fixed at 0755 and there is no global default-mode option; both are straightforward
additions if a need appears, and neither blocks anything today.

### G17 / T24 — RESOLVED: one shared diff/merge engine

Both stacks now run the same algorithm, in `ts/src/diff.ts` and `go/diff.go`, mirrored
function for function. `node-diff3` and `diff` are gone; the TS package has no runtime
dependencies left.

**Why this was necessary.** The two stacks previously ran different algorithms and
disagreed on ~72% of non-trivial merges and ~21% of diffs — both producing valid but
different output. Every parity scenario passed anyway, because all six merge/diff
scenarios had one changed region and distinct lines, exactly the shape where the two
algorithms agree. And `node-diff3` was unusable on the workload this project has: 62 s on
a 10 000-line repeated-vocabulary merge, effectively unbounded beyond.

**What holds it together now.**

- `go/testdata/parity/diff_corpus.json` — 1 200 cases (600 merge, 476 of them
  conflicting; 600 diff, 545 of them conflicting), generated from TS, replayed
  through Go, asserted byte-equal. `TestDiffCorpusMatchesTS` fails the build on any
  drift.
- 100% coverage on both `diff.ts` (line, branch and function) and `diff.go` (statement),
  gated in CI by `npm run test-diff-coverage` and `go/check_diff_coverage.sh`, and
  available locally as `make coverage`.
- Mirrored unit suites (`ts/test/diff.test.ts` ↔ `go/diff_engine_test.go`) plus property
  tests: the LCS is a common subsequence and matches a full-table oracle; a merge never
  invents content; a reported conflict always carries both markers; every marker starts
  its own line.

**Behaviour changes.** The six existing merge/diff parity fixtures are byte-identical, so
simple merges are unaffected. One real fix: when the last line of a changed region had no
trailing newline, the old jsdiff render emitted `Z9>>>>>>> EXISTING: ...`, gluing the
closing marker onto the content. A marker that does not start its own line cannot be
parsed by any tool or human. Markers now always start at column 0.

**Two things the tests encode that are easy to get wrong.**

- *Exactly one tie-break is load-bearing.* Several subsequences can be equally long but
  different, and the choice changes the bytes written into a user's file. The rule is:
  on a tie, take the largest split point. Flipping that one `>=` to `>` changes the
  merged content on 658 of the 1 200 corpus cases.

  I first wrote that *three* rules were load-bearing. Two of them are not, and mutating
  them proves it: the `>=` in `lcsRow` picks between two numbers already known to be
  equal, and the single-row base case appends the same string whichever position in `b`
  matched. Both are unobservable by construction — worth knowing, because a comment
  claiming a line is load-bearing when it isn't makes the next person afraid to touch it.

- *Fuzzing picks the inputs I would not have.* Every corpus here shares one shape — lines
  from a small vocabulary joined with `\n` — which is precisely the distribution that let
  the two merge engines agree on the tests and disagree on ~72% of real inputs.
  `go/fuzz_test.go` adds five targets (`FuzzMerge`, `FuzzDiff`, `FuzzLines`, `FuzzLCS`,
  `FuzzTemplate`) asserting the invariants that hold for *any* input: invents nothing,
  a reported conflict carries both markers, `Lines` round-trips, the LCS is a common
  subsequence of both inputs and is deterministic.

  In under a second it found that one of my invariants was wrong. `Merge("0", "0",
  "0<<<<<<< ")` — the user's file contains conflict-marker text and the generator changed
  nothing, so their text is kept verbatim. "Every marker starts its own line" holds only
  for markers *the engine emitted*; it cannot rewrite a marker it never wrote, and git
  does not either. The property is now scoped that way, both discovered inputs are
  permanent seeds in `go/testdata/fuzz/`, and — this is the part that matters — they are
  also pinned in `diff_corpus.json`, so the TypeScript side is held to the same handling
  rather than only the stack that happened to have a fuzzer.

- *Coverage says the corpus reached every line; it does not say the corpus would notice a
  change.* `ts/tools/mutate-diff.js` closes that gap: it breaks the engine in four named
  ways and asserts the corpus reacts as documented — the split tie-break must be killed,
  and the two decorative lines plus the prefix-trim optimisation must survive. A
  `kills: false` mutant that starts getting killed is as much a failure as the reverse:
  it means a refactor quietly gave a decorative line real consequences. Runs in about a
  second (`make mutation`), gated in CI.
- *A three-way merge can drop content, correctly.* If the user deleted a region the
  generator did not touch, the deletion wins. The obvious-looking property "every
  generated line survives" is FALSE, and asserting it would be asserting a bug. (I wrote
  it, watched it fail, and traced the failure to the property rather than the code.)

---

### T25 / G18 — the template engine, differentially tested

The diff engine was the *first* place two independent implementations had to agree
byte-for-byte. The template engine is the other one: `go/template.go` is 746 lines
against a TS engine in `ts/src/util/basic.ts`, and its only cross-stack check was
`go/template_corpus_test.go` — Go expectations **hand-transcribed** from the TS test file.
That covers the cases someone thought to write, and nothing checks it still matches TS.
It is the same setup that let the merge engines disagree on ~72% of non-trivial inputs
while every test passed.

`ts/tools/template-corpus.js` now generates 471 cases — model substitution, custom
delimiters, plain / regex / `#Tag` / function replaces, eject, and value formatting, plus
400 randomised ones — recording TS's exact output *or its exact failure*. Go replays them
and asserts byte equality (`TestTemplateCorpusMatchesTS`), gated in CI alongside the diff
corpus. Function-valued replaces travel as `{"$fn":"upper"}` against a fixed set both
stacks implement by name, so that path is covered too despite JSON not carrying closures.

**It found six divergences in two rounds.** Every one of them was live in released code.

*Round 1 — `eject` with the markers inverted (3/446).* When the end marker resolves
before the start marker, TS reached `src.substring(start, end)`, which **swaps its
arguments** when `start > end` — so the source came back reversed-region, purely as an
accident of the JS built-in. Go guarded the case and returned `''`. Neither was designed;
both were what the code happened to do. Fixed both to leave the source unchanged, which is
what already happened when neither marker was found, and pinned it with named
`eject-inverted` cases on both sides.

*Round 2 — value formatting (3/471).* Three separate defects in one line of Go:

| case | Go | TS |
|---|---|---|
| `num-tiny` | `1e-07` | `1e-7` |
| `num-huge` | `9.007199254740992e+15` | `9007199254740992` |
| `shape-objkeys` | `{"a":2,"m":3,"z":1}` | `{"z":1,"a":2,"m":3}` |

1. **Number formatting.** Go's `%v` zero-pads exponents and switches to exponential
   notation at a different threshold than ECMAScript. TS is canonical and every number
   there is a `float64`, so `formatJSNumber` now reproduces `Number::toString`:
   positional while `1e-6 <= |v| < 1e21`, exponential outside it, no exponent padding,
   and `String(-0) === "0"`.
2. **HTML escaping.** Go's `encoding/json` escapes `<`, `>` and `&` to `\u003c`, `\u003e`
   and `\u0026` by default; `JSON.stringify` does not. Generated code is full of angle
   brackets, so a model value carrying markup came out mangled on the Go side only.
3. **Key ordering.** `JSON.stringify` emits keys in insertion order and `json.Marshal`
   emits them sorted. This one is **fixed in TS, not Go** — a Go map has no insertion
   order to reproduce, so sorting is the only order both stacks can agree on. It is also
   the convention the project already follows: `each`, `cmap` and `vmap` all sort
   explicitly for exactly this reason. `jsonify` in `ts/src/util/basic.ts` sorts on the
   way out, honouring `toJSON` so `Date` still serializes as it always did, and rejecting
   cycles the way `JSON.stringify` rejects them rather than recursing until the stack
   blows.

**What the corpus structurally cannot reach.** Cases travel as JSON, so every number
arrives in Go as a `float64` — which is what a user gets from JSON or YAML config, and the
path most worth covering, but not the only one. A Go caller building a model in code can
pass a native `int`, `uint` or `float32`, which takes a different branch. Nothing on the TS
side can pin that branch, so `go/template_format_test.go` does: every value both an `int`
and a `float64` hold exactly must format identically. Beyond 2^53 the two genuinely differ
— Go keeps the value, TS cannot — and that is now written down in `go/README.md` rather
than left to be discovered.

---

## 2.0 T0 — a plain `Jostraca()` had no filesystem [verified]

`ts/src/jostraca.ts:198`

```ts
function get_gMemFs() { return gMemFs ? gMemFs.fs : undefined }
const gGetFs = gOpts.fs || get_gMemFs || undefined
```

`get_gMemFs` is a function declaration, so it is always truthy and `gGetFs` was always
set. In `generate`:

```ts
const fs = (opts.fs || (memfs && (() => memfs.fs)) || gGetFs || sysFs)()
```

`gGetFs` therefore short-circuited the `sysFs` fallback and returned `undefined` whenever
memfs was off. The README quick start — `Jostraca()` then `generate({folder:'./out'}, …)`
— failed with `Cannot read properties of undefined (reading 'existsSync')`.

This is the library's primary documented use case. It survived because **every** test in
the suite injects a memfs provider explicitly, so no test ever exercised the default. It
surfaced only when a new test wrote to a real temp directory to check mode preservation.

The Go port defaults correctly (`newFileHandler`: `if fs == nil { fs = OsFS{} }`), so this
is TS-only. Fixed by installing the memfs provider globally only when memfs is actually in
use, plus two regression tests that use the real filesystem.

The wider lesson for the suite: a test double used universally hides defects in the
production path it stands in for.

**Acted on:** `ts/test/provider.test.ts` and `go/provider_test.go` run the same eight
scenarios — fresh generate, regenerate, preserve, merge, diff, inject, copy, nested
folders — through *both* providers and assert the output trees are byte-identical. The
assertion is differential, so no expected output is transcribed and a new scenario covers
both paths by construction; a `produces` list guards against a scenario passing by
producing nothing on both sides. Mode preservation gets a separate real-filesystem test,
since mode bits do not exist on the doubles.

I checked the suite is not decorative by breaking each stack's real-filesystem write and
confirming it fails: appending a byte in TS's `saveFile` when the path is under the temp
dir fails 8/8 scenarios, and the same injection in Go's `OsFS.WriteFile` fails 8/8. That
is the shape of defect T0 was, and it is now caught.

---

## 2.1 T26 — the first Windows run

Fixing the CI workflows (§5.1) meant the TS matrix ran on Windows and macOS for the
first time since the repo was restructured. macOS was clean. Windows failed four
assertions, all one root cause: **Windows has no POSIX permission bits.** `fs.chmod`
there only toggles the read-only attribute, and `fs.stat` always reports `0o666` —
so a file created with `mode: 0o755` comes back as `0o666` (`438 !== 493` in the log),
and nothing is wrong.

Two of the four were pre-existing tests (`atomic-write-preserves-mode`,
`file-mode-is-applied`) that had simply never executed on Windows. The other two were
mine, added this branch.

The `mode` feature itself degrades correctly — `chmod` does not error, it just has
nothing to do — so the fix is in the tests, not the library. The narrowest thing that is
untestable is the mode *assertion*, so that is what is guarded (`POSIX_MODES` in
`ts/test/expect.ts`, `posixModes` in `go/platform_test.go`); the tests still run, and
everything around the assertion — content written, atomic rename completed, no temp file
left behind — is checked on every platform. Where a guarded test had no content
assertion, I added one, so skipping the mode check does not leave it vacuous. Verified
by forcing the flag false on Linux: 105 TS and 216 Go tests still pass, so the remaining
assertions are real.

Go's CI runs Linux only, but it had the same latent failure in six places and
`GOOS=windows go vet` is already part of the build, so it is guarded symmetrically rather
than left to be discovered. The platform limitation is now documented in
`ts/REFERENCE.md` and `go/README.md` — `mode` was previously undocumented on the TS side
entirely.

This is the same lesson as T0 one level out: **a platform never exercised is a platform
where anything may be true.** The suite was green on Linux for the entire review.

---

## 2.2 R1–R9 — what an automated reviewer found

A Codex bot reviewed the PR and left nine comments. I verified each one adversarially —
one agent per claim, each required to build a runnable reproduction, default posture that
the claim was wrong, plus an independent second opinion on the high-severity ones.

**All nine were real, and eight were regressions introduced by this branch.** That is a
worse hit rate than my own review achieved on the original code, and it is worth being
plain about why: these are defects in the *fixes*, and the fixes were the part with the
least adversarial attention on it.

| id | defect | stacks |
|---|---|---|
| R1 | `Copy`'s symlink-cycle `visited` set was never unwound, so a real directory plus a sibling symlink to it were treated as a cycle and the second one's subtree was silently dropped — and sort order decides which, so it could be the *real* directory | both |
| R2 | an explicit `mode` was never applied when the file's bytes already matched, so making an existing script executable did nothing from the second run onward | both |
| R3 | Go's merge and diff paths called `writeAtomic` instead of `writeAtomicMode`, dropping an explicit `mode` — a parity break, since TS forwards it | Go |
| R4 | the per-run warning cursor was the length of a *bounded* buffer, so once it hit the 1 000-entry cap every subsequent warning stopped reaching the configured logger | TS |
| R5 | with the **default** folder `.`, `relative()` cut one character off every path — `a.txt` and `b.txt` both became `.txt`, collapsing their merge baselines and meta keys onto one entry so a later merge loaded the wrong ancestor | TS |
| R6 | the atomic write used a *fixed* temp name, so a user file at `<target>.jostraca-tmp` was destroyed, and two runs sharing an output folder could publish each other's bytes | both |
| R7 | an empty `Inject` start marker spun the scan loop forever, hanging the generator | Go |
| R8 | `Fragment`'s relative `from` was resolved twice, so a relative output folder other than `.` read `generated/generated/frag.txt` and failed | Go |
| R9 | the diff engine's documented `O(min(N,M))` space was wrong — the rows are sized by the second argument, so it is `O(M)` | docs |

**R9 is the one where the bot's diagnosis was right and its remedy was wrong.** It proposed
swapping the inputs so the shorter side backs the rows. Measuring that showed it changes
merge output on ~11% of random inputs and diff output on ~9%, because the split tie-break
is order-sensitive — and the 1 200-case corpus would not have caught it, since every case
is generated by the same stack that would have changed. The code was right; my complexity
claim was wrong, in four places. Corrected rather than "fixed".

**R5 deserves singling out.** It is a data-integrity defect on the *default* configuration
— and every test in the suite passes an explicit `folder`, so nothing exercised it. Same
shape as T0 and T26: a default nobody tested, a platform nobody ran. Three instances of one
lesson in one branch.

**R7's first fix was incomplete, and my own self-check caught it.** Stopping the hang was
not the same as making the stacks agree: a differential probe over degenerate markers found
them differing on 4 of 5 inputs. TS's behaviour there was regex fallout — an empty marker
pair interleaved the injected body between *every character* of the file — which no scan
loop would ever reproduce, and the commit message claimed the rune-advance "reproduces what
JS does". It did not. Both stacks now reject a half-specified marker pair up front and treat
a fully empty one as "not supplied", which is the only reading that lets them agree; the
progress guard stays as a backstop, because a hang is the worst failure mode a generator
has. Pinned by a shared table in both suites.

Each fix carries a regression test in both stacks, and I verified every test in both
directions — reverting each fix in isolation and confirming the corresponding test fails.
Two of them initially did *not* fail on revert, because a second layer of the same fix
rescued them (the `wx` exclusive-create flag, and Go's `Exists` retry); those needed both
halves reverted to demonstrate the catch, which is itself worth knowing.

**Found while writing the R5 test, and NOT fixed here:** two bare top-level `File`
components with no `Project` or `Folder` wrapper silently drop everything after the first
— `ctx$.root = (ctx$.root || node)` makes the first component the tree root and orphans its
siblings. This is pre-existing (byte-identical at the branch base), architecturally
significant, and outside this PR's scope. The test uses the documented `Folder({}, ...)`
grouping form instead, with a comment pointing at the issue.

---

## 2.3 R10–R14 — reviewing the fixes to the fixes

Rather than merge on green, I asked for a second review pass over `dc6434a` — the commit
fixing R1–R9. The reasoning was actuarial: eight of the previous nine defects had been in
the fixes, and `dc6434a` had been reviewed by nobody but its author.

Five more findings came back. Four were real.

| id | defect | origin |
|---|---|---|
| R10 | with folder `.`, the prefix strip matched as a raw string, so `.env` lost its leading dot and shared a merge baseline and meta key with a sibling `env` — each then merged against the *other's* ancestor, writing whole-file conflict markers into the user's real `.env` | **pre-existing** |
| R11 | Go's temp-path retry loop exited with the candidate still known to exist and fell through to a truncating write — the one path meant to protect an occupied file was the path that destroyed it | this branch |
| R12 | on `wx` exhaustion, the cleanup unlinked a temp path this invocation never created — deleting exactly the file the exclusive flag had just protected | this branch |
| R13 | *refuted* — the marker validation in `98b34bf` already made it unreachable, and its stated mechanism (`[2]string{}` reaching `injectAfter` in Go) was never accurate at any commit | — |
| R14 | `chmodUnchanged` sat inside `if (write)`, but the diff and merge branches clear `write` first — so an explicit `mode` was still dropped in exactly the configurations most likely to carry one | this branch |

**R10 corrects something I asserted earlier.** I reported this round as "all five in code I
wrote". That was wrong: R10 reproduces byte-for-byte at the branch base, so it is a
pre-existing defect that my R5 fix failed to fix — while its comment claimed the prefix was
"only stripped when it is ACTUALLY there". The comment was more wrong than the code.

**R11 and R12 are the same shape and worth naming.** Both are *safety mechanisms whose
failure path does the damage they exist to prevent*. R11: a retry loop guarding an occupied
path, which on exhaustion writes to it. R12: an exclusive-create flag that refuses to
clobber a colliding file, followed by a `catch` that unlinks it. In both cases the happy
path is correct and the guard inverts on the edge. That is a category worth checking for
directly, not just testing into.

Go now carries an `exclusiveFS` optional capability (`WriteFileExcl`, alongside the existing
`realpathFS`/`chmodFS` pattern) so `OsFS` gets a real `O_EXCL` and `MemFS` an atomic
check-and-store under one lock — matching TS's `wx` rather than approximating it with a
check-then-act pair.

**Adding that capability silently disarmed a test double.** `failFS` in the Go durability
suite embeds `*MemFS`, so it inherited `WriteFileExcl` — and because the atomic write now
prefers the exclusive path, the double stopped intercepting and two durability tests went
green against a write that could no longer fail. A double that quietly stops intercepting is
worse than no double, because it still reads as coverage. It now overrides both methods.

---

## 1. Executive summary

The architecture is sound: a declarative define phase producing a node tree, a
dispatch-table walk producing side effects, and a single `FileHandler` chokepoint for
all filesystem mutation. The existing-file modes (write / preserve / present / diff /
merge) are a genuinely good idea and the `why` breadcrumb audit trail is excellent
design for a tool whose failure mode is "it ate my edits".

The problems cluster in three places:

1. **Output-path containment.** Nothing constrains a generated path to the output
   folder. Two distinct escapes are reachable today, one of them with no user error
   required.
2. **Write durability.** Every write is truncate-then-write over the user's file, and
   the merge baseline — the thing that makes edit-preservation work at all — is written
   with its error discarded in the Go port.
3. **Parity is not actually being enforced.** Both CI workflows are broken and have been
   since the repo was restructured, so the parity gate has not run. The corpus is also a
   committed snapshot with no freshness check.

The parity harness design is better than most ports get. Its weakness is not the
comparison logic, it is that nothing runs it and nothing fails when a scenario is
missing.

---

## 2. TypeScript (canonical)

### 2.1 Critical

**T1. A top-level `File` writes to the filesystem root. [verified]**
`ts/src/op/FileOp.ts:16`

```ts
cfile.fullpath = buildctx.current.folder.path.join('/') + '/' + name
```

`BuildContext` initialises `current.folder.path` to `[]`
(`ts/src/build/BuildContext.ts:91`). With no enclosing `Project`, `[].join('/')` is `''`,
so `fullpath` becomes `/x.txt` — an absolute path at the filesystem root, ignoring the
configured `folder` entirely.

```js
await Jostraca({mem:true}).generate({folder:'out'}, () => {
  File({name:'x.txt'}, () => Content('hello\n'))
})
// vol keys: [ '/x.txt', ... ]     <-- not out/x.txt
```

`Folder` is unaffected because `FolderOp.before` seeds the path with the base folder.
The Go port does not have this bug (`newBuildCtx` sets `parent: folder`), so it is a
TS-only defect.

Fix: seed `current.folder.path`/`parent` from the base folder in `BuildContext`, exactly
as `newBuildCtx` does, and make `Project` optional rather than implicitly required.

**T2. `../` in a component name escapes the output root. [verified]**
`ts/src/build/FileHandler.ts:773-795`

`validPath` checks only path *depth*; it never checks containment.

```js
await j.generate({ folder: '/out/deep/nest' }, () =>
  Project({folder:'p'}, () =>
    File({name:'../../../../../../etc/pwned.txt'}, () => Content('OWNED\n'))))
// vol keys: [ '/out/deep/nest/p', '/etc/pwned.txt' ]
```

Jostraca's whole purpose is generating files from a *model*, and models routinely come
from JSON/YAML that the developer did not author. That makes a model-derived filename an
arbitrary-file-write primitive. The Go port has the same hole.

Fix: after normalisation, assert the resolved path is inside the output root (and inside
the project folder) and throw otherwise. Add it in `validPath` so every FS entry point
inherits it.

**T3. `preserve` mode destroys dotfile backups. [verified]**
`ts/src/build/FileHandler.ts:191-193` (and the `.new` variant at `:217-219`)

```ts
Path.basename(path).replace(/\.[^.]+$/, '') + '.old' + Path.extname(path)
```

For `.env`, Node's `Path.extname('.env')` is `''` and the regex strips the whole name, so
the backup path is `dir/.old`. Verified: TS writes `/out/p/.old`; Go writes
`/out/p/.old.env`. Two dotfiles in the same folder therefore overwrite each other's
backup — in the one mode whose entire job is not losing the user's content.

Fix: split on the last dot only when there is a stem, mirroring Go's `annotatedPath`.

**T4. Writes are not atomic.** `ts/src/build/FileHandler.ts:733`

`fs.writeFileSync` truncates then writes. A crash, ENOSPC, or a SIGINT mid-write leaves
the user's file truncated or empty — and in `merge`/`diff` mode the file being written
*is* the file containing the user's hand edits. There is no temp-file + rename anywhere.

Fix: write to `path + '.jostraca-tmp'`, then `renameSync` over the target. Rename is
atomic within a filesystem and turns the worst case from "file destroyed" into "stray
temp file".

**T5. Binaries outside the extension list are corrupted by `Copy`.**
`ts/src/op/CopyOp.ts:142-144`, `ts/src/util/basic.ts:755-760`

`isTemplate(name)` is `!isbinext(name)`, and `copyFile` then does
`fs.readFileSync(frompath, 'utf8')` followed by `template(...)`. Binary detection is a
hardcoded ~250-entry extension list. Anything not on it — `.wasm`, `.zst`, `.br`,
`.sqlite`, `.parquet`, or any extensionless binary — is round-tripped through UTF-8
decode/encode, replacing invalid sequences with U+FFFD. The file is silently corrupted.

Fix: sniff content (NUL byte in the first 8 KB) in addition to the extension list, and
copy bytes when in doubt.

### 2.2 Medium

**T6. A corrupt meta file aborts the entire build.** `ts/src/build/BuildMeta.ts:97`
`loadMetaData` calls `fh.loadJSON` unguarded from the `BuildMeta` constructor. A
truncated or hand-edited `.jostraca/jostraca.meta.log` throws before any work happens,
with an error that points at JSON parsing rather than at the recovery action. Catch it,
warn, and continue with empty `prev` state.

**T7. `opts.exclude` is unreachable dead code.** `ts/src/op/FileOp.ts:31-62`
`exclude` is assigned a boolean (`true === node.exclude`, or `false` in the `else`)
before the guard `if (log && null == exclude)`, so `null == exclude` is never true. The
documented mtime-based exclusion feature never runs. The Go port implements it
(`go/build.go:179-186`) — a rare case of the port being ahead.

**T8. Byte-identical files are rewritten on every run. [verified]**
`ts/src/build/FileHandler.ts:207-210` then `:340`

With default modes, `existing.write && !protect` sets `write = true` unconditionally —
there is no content comparison on that path. Two consecutive identical generations:

```
run1 files: {"written":["/out/p/a.txt"], "unchanged":[]}
run2 files: {"written":["/out/p/a.txt"], "unchanged":[]}
```

Every file's mtime is bumped every run, which re-triggers every watcher, bundler, and
incremental compiler downstream, and costs N full writes. `files.unchanged` is only ever
populated in diff/merge modes, so callers cannot detect a no-op build. Go already
compares and skips.

**T9. `dryrun` still creates directories.** `ts/src/build/FileHandler.ts:564`
In `copyFile`, `this.ensureDir(...)` sits outside the `if (!this.control.dryrun)` guard
(unlike `saveFile`, where it is correctly inside). A dry run mutates the tree.

**T10. The `Copy` directory walk has no cycle or depth guard.**
`ts/src/op/CopyOp.ts:99-137`
`walk` recurses on `fs.statSync` (which follows symlinks) with no visited set and no
depth cap. A symlink pointing at an ancestor directory recurses until the stack blows.

**T11. `-jostraca-off` is only honoured for binary files.** `ts/src/op/CopyOp.ts:118-135`
`isTemplateFile` is tested before `!isIgnored`, so `IGNORED_RE` (`/(~|-jostraca-off)$/`)
never applies to text files — i.e. to almost everything. Verified: a
`c-jostraca-off` file is copied. (`~` backups survive only because
`opts.cmp.Copy.ignore` catches them on a different path.) Go has the same gap.

**T12. `Inject` fails loudly on one error and silently on the other. [verified]**
`ts/src/op/InjectOp.ts:43-53`
Missing target → raw `ENOENT` from a bare `fs.readFileSync`, bypassing `FileHandler`'s
error decoration entirely. Missing markers → `src.replace` matches nothing, the file is
written back byte-identical, and the user gets no signal that the injection did not
happen. Both deserve a `JostracaError` naming the file and the markers.

**T13. The debug-log global grows without bound and re-reports. [verified]**
`ts/src/util/basic.ts:724-743`, consumed at `ts/src/jostraca.ts:301`
`getdlog` appends to `global.__dlog__`, which is never drained. `dlog.log()` filters by
tag only, so **every `generate()` re-emits every warning recorded earlier in the
process** — verified by seeing one duplicate-write warning printed twice across two
generations. Separately, the filter at `:741` compares `n[2]` (a `Date.now()` timestamp)
against a basename, so `dlog.log(filepath)` can never match; the file is at `n[1]`.

**T14. `relative()` matches on a string prefix, not a path boundary.**
`ts/src/build/FileHandler.ts:119`
`path.startsWith(this.folder)` treats `/output/x.txt` as being inside `/out`, yielding
the relative path `put/x.txt` and thus a wrong duplicate-baseline and meta key. Go has
the identical bug at `go/filehandler.go:453`. Compare on `folder + '/'`.

**T15. `Fragment` re-runs its children N+2 times.** `ts/src/cmp/Fragment.ts:51-80`
The children thunk is invoked once to collect slot names, once per named slot, and once
for the default `<[SLOT]>` handler, each time with a different `node.filter`. Any
side-effecting child runs repeatedly, and cost scales with slot count.

**T16. `Fragment`'s relative `from` resolves under the enclosing *file* name.**
`ts/src/cmp/Fragment.ts:43-45`
`Path.join(folder, ...node.path, frompath)` — but `cmp()` pushes every named ancestor
onto `node.path`, including the enclosing `File`. So a `Fragment` inside
`File({name:'x.ts'})` looks for its source under `<folder>/…/x.ts/<from>`, treating a
file as a directory. Every `Fragment` test uses an absolute path, so this is entirely
untested.

**T17. `Jostraca()` mutates a process-global `AsyncLocalStorage`.**
`ts/src/jostraca.ts:189`, `:378`
Each construction replaces `GLOBAL.jostraca`, and `cmp()` resolves it at call time. This
happens to work today only because the define phase is fully synchronous. It also means
calling a component outside `generate()` throws
`Cannot read properties of undefined (reading 'getStore')` rather than anything
diagnostic. Create the ALS once per module and store the instance on the closure.

**T18. `root()` is not awaited.** `ts/src/jostraca.ts:273`
An `async` define callback returns a promise that is dropped; the build phase then runs
against a partially built tree with no error. Either await it or reject async callbacks
explicitly.

**T19. `cmp()` restores the tree cursor without `try/finally`.**
`ts/src/jostraca.ts:428-432`
If `component(props, children)` throws, `ctx$.children` and `ctx$.node` are never
restored. Wrap in `try/finally`.

### 2.3 Minor

- **T20.** `merge()` fast-path 1 (`editA === editB`, `FileHandler.ts:427`) is
  unreachable — the caller only enters the merge branch when the contents already
  differ. Dead code; fast-path 2 is the one doing the work.
- **T21.** `camelify(['', 'x'])` throws (`p[0].toUpperCase()` on `''`) because the array
  branch of `partify` does not filter empties. Also `camelify` produces PascalCase,
  which is worth a doc note.
- **T22.** `isbinext` does a linear `Array.includes` over ~250 entries per call, on every
  copied file. Make it a `Set`.
- **T23.** `template()`'s `out` variable is dead when `spec.handle` is supplied — the
  function returns `''`. Intentional, but confusing enough to warrant a comment.

**Not defects** (checked and cleared): `strict: true` is on in both `ts/src/tsconfig.json`
and `ts/test/tsconfig.json`, so the `any` usage is deliberate rather than implicit;
`template()` is linear, not quadratic — the scan is amortised O(n) and substituted values
are never re-scanned, so there is no injection or blowup; the `#Tag` replace alternate
consumes its full match correctly (the `J_K` group wraps the whole alternate).

---

## 3. Go (port)

### 3.1 High

**G1. The LCS is O(N·M) in memory, not just time. [verified — measured]**
`go/diff.go:145-186`

```go
dp := make([][]int, n+1)
for i := range dp { dp[i] = make([]int, m+1) }
```

Measured on this machine:

| lines | time | allocated |
|------:|-----:|----------:|
| 500   | 4 ms | 1 MB |
| 1 000 | 11 ms | 7 MB |
| 2 000 | 31 ms | 31 MB |
| 4 000 | 164 ms | 125 MB |
| 8 000 | 1.85 s | 500 MB |

Clean quadratic growth: ~2 GB at 16k lines, OOM beyond. `merge3` calls `alignLCS`
twice. This matters precisely because commit 4a59f4e added the TS fast-paths after
observing that the LCS "effectively never terminates" on 500 KB+ regenerated files — the
Go port inherits the same workload, and its failure mode is a hard OOM rather than a
slowdown.

**FIXED.** `lcsLines` now trims the common prefix and suffix, then runs Hirschberg's
algorithm on the remainder — same time complexity, two-row O(M) space. Measured after:

| lines | before (time / alloc) | after (time / alloc) |
|------:|----------------------:|---------------------:|
| 4 000 | 164 ms / 125 MB | 97 ms / 1.4 MB |
| 8 000 | 1.85 s / 500 MB | 473 ms / 3.1 MB |
| 16 000 | ~2 GB (OOM territory) | 1.47 s / 6.8 MB |

And the case that actually matters — regenerating a file where ~2 % of lines changed —
is now dominated by the affix trim: **50 000 lines in 10 ms and 1.0 MB**, where the old
table would have needed ~20 GB.

The risk in this rewrite is not correctness of the LCS *length* but *which* of several
equally-long subsequences is returned, since that changes real merge and diff bytes. The
first attempt did diverge. `TestLCSMatchesReferenceDP` keeps the original full-table
algorithm as an oracle and compares over randomised inputs — deliberately including a
small line vocabulary, so duplicate lines (the `}`/blank-line case) are well covered. The
matching rule turned out to be: prefer the *largest* split point on a tie, and take the
*last* occurrence in the single-row base case.

A size guard that degrades to a whole-file conflict is still worth considering, but it
would be a behaviour change and so needs to land in both stacks together.

**G2. Merge-baseline write errors are discarded.** `go/filehandler.go:145, 200, 226, 289, 344`

```go
_ = fh.ensureDirOf(dup)
_ = fh.fs.WriteFile(dup, content)
```

Five sites, all dropping the error. The duplicate baseline is what makes
edit-preservation possible: if it fails to write (permissions, ENOSPC, read-only mount),
the *next* run finds no baseline, takes the `no-baseline-0` fall-through, and overwrites
the user's edits with generated content. A silent failure now becomes data loss later,
with nothing in the audit trail connecting the two.

**G3. Writes are not atomic, and the primitive is already there — unused.**
`go/fs.go:25`, `:57`, `go/filehandler.go:218`
`Rename` is declared on the `FS` interface and implemented on both `OsFS` and `MemFS`,
but nothing calls it. Wiring temp-write + rename into `fileHandler.write` is a small
change with a large payoff.

### 3.2 Medium

**G4. `Inject` replaces only the first marker block. [verified]** `go/build.go:421-436`
TS builds a global regex and replaces every marker pair; Go does a single
`strings.Index` for each marker and splices once. Verified divergence on a two-block
target:

```
TS: A\n#--START--#\nNEW\n#--END--#\nB\n#--START--#\nNEW\n#--END--#\nC\n
Go: A\n#--START--#\nNEW\n#--END--#\nB\n#--START--#\nold2\n#--END--#\nC\n
```

Also `endIdx` is searched from offset 0 rather than from `startIdx`, so an end-marker
occurrence *before* the start marker trips the `endIdx < startIdx` guard and aborts the
injection entirely.

**G5. `Inject` on a missing target silently succeeds. [verified]** `go/build.go:411-414`
TS throws `ENOENT`. The code comment claims this "matches TS read-error tolerance for
missing inject targets in tests" — that is not what TS does.

**G6. Dotfile backup naming diverges. [verified]** `go/filehandler.go:495-507`
Go's `annotatedPath('.env','old')` → `.old.env`; TS → `.old`. Go's behaviour is the
correct one, but per `CLAUDE.md` the fix still lands in TS first (see T3).

**G7. Mode dispatch is structurally different from TS.**
`go/filehandler.go:156-184` vs `ts/src/build/FileHandler.ts:180-337`
TS evaluates `preserve`, `present` and `diff`/`merge` as sequential independent blocks,
so `preserve + diff` writes the `.old` backup *and* renders the diff. Go early-returns
from `merge`/`diff` before reaching `preserve`, so the backup is never written.
Similarly, TS's `present` branch can still fire for a `JOSTRACA_PROTECT`ed file, while
Go returns at the protect check. The parity corpus exercises each mode in isolation, so
none of these combinations are covered.

**G8. `fileAfter` only collects content from direct children.** `go/build.go:146-165`
TS accumulates into `buildctx.current.file.content` as the walk descends, which works at
any nesting depth. Go's `fileAfter` iterates `n.Children` one level deep, and
`collectSlot` (`:500-514`) looks only for `KindContent` grandchildren — so a `Fragment`
nested inside a `Slot` contributes nothing. This is the one place where the port's
architecture is materially less general than the original.

**G9. `relative()` prefix bug.** `go/filehandler.go:453` — identical to T14.

**G10. `stringsHasMergeMarkers` requires both markers.** `go/merge.go:217`
TS's unresolved-conflict guard checks only `>>>>>>> EXISTING:`
(`ts/src/build/FileHandler.ts:442`). A half-resolved file — user deleted the opening
marker but not the closing one — is skipped by TS and re-merged by Go.

**G11. Dead code.** `savePreserve` (`go/filehandler.go:435`, no callers) and
`writeConflict` — the 3-side `||||||| BASELINE:` variant (`go/merge.go:189`, no callers).
Both look like live merge behaviour to a reader.

**G12. File modes are hardcoded.** `go/fs.go:50`, `:55` — `0o644` / `0o755`, not
configurable. A generator emitting shell scripts or git hooks cannot make them
executable. (`os.WriteFile` leaves an existing file's mode alone, so this only affects
newly created files.)

**G13. `alignLCS` re-derives the alignment greedily.** `go/merge.go:144-169`
Rather than recording positions during DP reconstruction, it rescans both sequences for
the first occurrence of each LCS element. My probes on repeated-line inputs (`}`, blank
lines) produced correct merges, so this is not a demonstrated bug — but the anchor map is
not guaranteed to be the embedding the DP actually found, which is fragile for the
highest-stakes algorithm in the codebase. Return the index pairs from `lcsLines` instead.

**G14. RE2 has no lookaround — a permanent parity limit.** `go/template.go:405`
`unsupportedLookRE` correctly detects `(?<`/`(?=`/`(?!` in user `replace` keys, but the
consequence is that a JS regex using lookahead works in TS and cannot work in Go. This is
inherent to RE2 and should be documented as a known non-portable feature rather than
treated as a bug to fix.

**G15. `dLogEntries` is a package-level unbounded buffer.** `go/dlog.go:17-20`
Shared across every instance. Better than TS (mutex-guarded, and `Reset` exists), but
still process-global state in a library.

### 3.3 Cleared

`slotNames` map iteration **is** sorted before use (`go/builder.go:293-298`), eject
regexes **are** cached under a mutex (`go/template.go:700-720`), and `go vet` passes for
linux/darwin/windows. Determinism discipline in the port is good.

---

## 4. Shared defects

Present in both implementations; per `CLAUDE.md`, fix TS first then port.

- Path traversal via `../` in a component name (T2). Verified: both write
  `/out/escaped.txt` from `File({name:'../escaped.txt'})` inside `Project({folder:'p'})`.
- `-jostraca-off` ignored for text files (T11).
- `relative()` prefix-not-boundary matching (T14 / G9).
- No symlink-cycle or depth guard in the copy walk (T10; `go/build.go:276-309`).
- Non-atomic writes (T4 / G3).

---

## 5. Parity checking

### 5.1 Neither CI workflow runs. [verified]

**`.github/workflows/go-test.yml`** — the concurrency-stress and parity-snapshot steps
invoke `go test ./jostraca …`, but commit a39979f flattened the module to the `go/`
root:

```
$ go test ./jostraca -run TestParity -count=1
# ./jostraca
stat /home/user/jostraca/go/jostraca: directory not found
FAIL    ./jostraca [setup failed]
```

The step named "Parity snapshots vs TS" — the entire point of the harness — has been
failing since the restructure.

**`.github/workflows/test.yml`** — runs `npm install`, `npm run build`, `npm test` at the
repo root, but `package.json` lives in `ts/`. There is no `working-directory: ts`. The
whole TS job fails at step one.

Fix both first; everything below is secondary to actually running the gate.

### 5.2 `go-test.yml` does not trigger on TS changes

It is path-filtered to `go/**`. The precise event the harness exists to catch — someone
changes TS behaviour and Go silently drifts — does not run the Go job. Add `ts/**` to the
trigger.

### 5.3 The corpus is a snapshot with no freshness check

`go/testdata/parity/*.json` is produced by `ts/tools/extract-parity.js` and committed.
Nothing regenerates it and diffs it. TS behaviour can change while the Go tests keep
passing against stale expectations — the failure is invisible in exactly the direction
that matters. Add a CI step that re-runs the extractor and fails if the committed JSON
differs.

### 5.4 A missing Go runner is a SKIP, not a failure

`go/parity_test.go:218`:

```go
t.Skipf("scenario %s has no Go runner; add one to scenarioRunners", name)
```

Adding a TS scenario without a Go counterpart is silently tolerated. `phaseShapedCorpora`
is a second opt-out of the same kind. Both should fail; an explicit, dated
`knownGaps` allowlist is the honest way to carry a temporary exemption.

### 5.5 The trees are hand-duplicated

`scenarioRunners` (Go) and the trees in `extract-parity.js` (TS) are two independent
transcriptions of the same component tree with nothing enforcing they match. A drifted
runner can still pass, comparing a *different* tree against the recorded output. The
robust form is one declarative scenario spec both sides interpret.

### 5.6 One assertion is a tautology

`ts/test/parity-fidelity.test.ts:102`:

```ts
expect(found || true).true()
```

Cannot fail. The comment says so explicitly ("Skip-tolerant: if TS doesn't implement the
pipeline, this will not match"). The `Options.name` affix behaviour is therefore
unverified on both sides. Either assert it or delete it — a test that cannot fail is
worse than no test, because it reads as coverage.

### 5.7 Coverage is thin exactly where divergence lives

17 single-Generate scenarios, all small and happy-path. I ran a 9-case differential
harness (same tree, same frozen clock, same MemFS prepopulation, TS vs Go) and found
**4 divergences in 9 probes**, none in the corpus:

| probe | TS | Go |
|---|---|---|
| inject, target missing | throws ENOENT | silently succeeds |
| inject, two marker blocks | replaces both | replaces first only |
| `File` with no `Project` | `/x.txt` (root escape) | `/out/x.txt` |
| `.env` + preserve | `/out/p/.old` | `/out/p/.old.env` |
| unicode content + filename | identical | identical |
| inject, markers absent | no-op | no-op |
| duplicate `File` names | last wins | last wins |
| `../` traversal | escapes to `/out` | escapes to `/out` |
| empty file | `""` | `""` |

Credit where due: real merge-conflict output **is** covered (`merge_basic`,
`merge_update`, `diff_mode` all carry conflict markers in their fixtures), and unicode is
byte-identical. The gaps are error paths, marker edge cases, trees without a `Project`,
dotfiles, mode *combinations* (`preserve + diff`), deep nesting, non-UTF8 bytes, and
large inputs.

### 5.8 Recommendations, in order

1. ✅ Fix both CI workflows (`working-directory: ts`; `./...` not `./jostraca`).
2. ✅ Add `ts/**` to the `go-test.yml` trigger.
3. ✅ Add a CI step that regenerates the parity corpus and fails on any diff.
4. ✅ Turn the missing-runner skip into a failure, with a dated `knownGaps` allowlist.
5. ✅ Delete or fix `expect(found || true).true()`.
6. ✅ Add the §5.7 divergence classes as corpus scenarios.
7. ⬜ Generate the Go runners from a shared declarative spec instead of transcribing
   them. **Not done, and largely overtaken.** The two places where transcription actually
   bit — the diff/merge engine and the template engine — are now covered by generated
   differential corpora, which is the same idea applied where it pays. The remaining
   hand-written scenario runners assert small, stable trees; converting them would be a
   large mechanical change for a risk the corpora already carry. Worth revisiting if a
   drifted runner is ever observed.

---

## 6. Reconciliation

`CLAUDE.md` is right that TS wins — but three of the four cases below are places where
the port pre-empted a latent TS bug, so "TS wins" here means "fix TS", not "keep TS".

**Go is correct; fix TS, then re-align Go if needed**

| behaviour | TS | Go | action |
|---|---|---|---|
| `File` with no `Project` | writes to `/` | writes under output folder | fix TS (T1) |
| dotfile backup name | `.old` | `.old.env` | fix TS (T3) |
| unchanged file | rewrites | skips | fix TS (T8) |
| `opts.exclude` mtime window | dead code | implemented | fix TS (T7) |

**TS is correct; fix Go**

| behaviour | TS | Go | action |
|---|---|---|---|
| inject, multiple marker blocks | replaces all | first only | fix Go (G4) |
| inject, missing target | errors | silent | fix Go (G5) |
| `preserve` + `diff`/`merge` | both fire | preserve skipped | fix Go (G7) |
| nested content collection | any depth | direct children | fix Go (G8) |

**Both wrong; fix TS then port** — §4.

### Suggested order of work

1. CI (§5.1–5.2) — until it runs, nothing else is enforced.
2. T1, T2, T3 — output containment and backup naming; all three are data-integrity bugs.
3. G2, T4/G3 — durability: stop dropping baseline-write errors, add temp+rename.
4. G1 — Hirschberg or Myers, plus a size guard.
5. T5 — content-sniff binary detection.
6. The remaining reconciliation table, each with a new parity scenario alongside it.

---

## 7. Notes on method

TS reproductions ran against `ts/dist` with `memfs` and a frozen clock. Go reproductions
ran against a scratch copy of the module (the repo was not modified) with `MemFS`, the
same frozen clock, and the same tree shapes, so TS/Go outputs are directly comparable.
LCS figures come from a Go benchmark over synthetic inputs of 500–8000 lines measuring
wall time and `runtime.MemStats.TotalAlloc` deltas.

Claims I checked and did **not** report as defects are listed at the end of §2 and in
§3.3.

---

## 8. Final state

Every finding in this review is fixed except **T15**, which is documented above as a
deliberate no-change.

| | before | after |
|---|---|---|
| TS tests | 36 | 115 |
| Go tests | 147 | 228 |
| TS runtime dependencies | 2 (`node-diff3`, `diff`) | 0 |
| CI workflows that run | 0 | 2 |
| Parity scenarios | 17 | 32 + 2 generated corpora (1 200 diff, 471 template) |
| Fuzz targets | 0 | 5 |
| Diff engine coverage | not measured | 100% both stacks, gated |

Gates, all in CI and all runnable locally:

```
make all         # build + test, both stacks
make coverage    # diff engine at 100%, both stacks
make mutation    # the corpus would notice if a load-bearing line changed
make fuzz        # 30s per target; FUZZTIME=5m for a soak
```

**What actually found the bugs**, in rough order of yield — worth recording, because it is
not the order I would have guessed:

1. **Cross-stack differential corpora.** The single most productive technique here. The
   diff/merge unification exposed a ~72% disagreement that six passing parity scenarios
   had never touched; the template corpus found six live divergences in two rounds, one
   of them a JS built-in quietly swapping its own arguments.
2. **Using a production default in a test.** T0 — the library's primary documented use
   case was broken, and surfaced only because one new test happened to write to a real
   temp directory instead of the memfs double every other test injected.
3. **Fuzzing.** Found a wrong *property* in under a second, which is the failure mode a
   hand-written corpus structurally cannot catch: I do not write the inputs I did not
   think of.
4. **Mutation testing.** Found no bugs, and was still worth it: it disproved a claim I
   had written into two source files about which lines were load-bearing.
5. **Reading the code.** Most of the individual T- and G- findings. Reliable, but it
   produced no surprises — every genuinely surprising defect came from running something.
