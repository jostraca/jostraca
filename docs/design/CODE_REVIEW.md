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
| **S1–S4** | **a third round: four more, two of them containment/cleanup defects older than this branch** (see §2.5) |
| S5 | a cross-stack divergence in the containment check, found by self-check rather than review (see §2.6) |
| **U1–U5** | **a fourth round: five more — fixes that changed one code path and left its siblings on the old assumption** (see §2.7) |
| **V1–V2** | **a fifth round: two, both introduced by the fourth round's own fixes** (see §2.8) |

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

**Still open**, each deliberately left alone rather than patched, and each filed as an
issue so the deferral is tracked rather than lost:

| issue | item |
|---|---|
| [#21](https://github.com/jostraca/jostraca/issues/21) | **FIXED** — top-level sibling components were silently dropped. Resolved with an eager synthetic root; see §2.9 |
| [#22](https://github.com/jostraca/jostraca/issues/22) | **FIXED** — the Go suite now runs on macOS and Windows, and a fourth drive-absolute defect was found and fixed on the way; see §2.10 |
| [#23](https://github.com/jostraca/jostraca/issues/23) | **FIXED** — both axes landed once #27/#28 unblocked them: a 95-case `Copy.exclude` corpus and the `existing.bin` classification axis (840 → 1197 cases). See §2.12 and §2.15 |
| [#24](https://github.com/jostraca/jostraca/issues/24) | **FIXED** — the corpus carries binary content via a `{"b64": …}` escape hatch; see §2.11 |
| [#25](https://github.com/jostraca/jostraca/issues/25) | **CLOSED, won't-fix** — T15. The deferral held, but the premise did not: component bodies run *once*, not N+1 times, and nested Fragments do not compound in TS. Removing the one redundant pass was unmeasurable against noise. See §2.13 |
| [#27](https://github.com/jostraca/jostraca/issues/27) | **FIXED** — extension decides, with sniffing able to promote an unlisted extension but never demote a listed one; see §2.14 |
| [#28](https://github.com/jostraca/jostraca/issues/28) | **FIXED** — TS now prunes excluded directories, and a scalar `exclude` is legal in both stacks; see §2.14 |
| [#30](https://github.com/jostraca/jostraca/issues/30) | TS compares a Buffer against a string in `save`, so a Copy-routed binary is always "changed" — spurious `.old`/`.new` sidecars and mtime churn on every run. 36 measured cases; the reason the `same` state is dropped for Copy-routed rows in the new axis |
| [#29](https://github.com/jostraca/jostraca/issues/29) | **FIXED, narrowed** — the literal rule was unimplementable; a non-Slot child errors only when the source has no unnamed `<[SLOT]>` to receive it; see §2.14 |

T15 is the only *code* item from this review not acted on; the rest are follow-on coverage
and infrastructure. Directory modes are still fixed at 0755 and there is no global
default-mode option; both are straightforward additions if a need appears, and neither
blocks anything today.

**Why these were filed rather than folded in.** From the fourth review round onward the
rounds were mostly surfacing defects older than this branch. A change already spanning 137
files should not keep absorbing unrelated repairs — and the arc below puts a number on the
cost of doing so: each round of fixes introduced roughly two new defects of its own. The
stopping rule is stated in §2.8.

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
grouping form instead, with a comment pointing at the issue. Filed as
[#21](https://github.com/jostraca/jostraca/issues/21), with a verified reproduction in both
stacks — `generate()` returns success and the second file simply is not there.

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

## 2.4 Closing the loop: differential testing the option surface

Three review rounds found fourteen defects on this branch. Reading back over them, the
pattern is not subtle — **every single one needed a default, a degenerate value, or an
option combination to reach.** None needed unusual file content.

| defect | what it needed |
|---|---|
| `.` folder path strip | the DEFAULT folder |
| leading-dot strip | a DOTFILE at the top level |
| copy `visited` unwind | a symlink that is NOT an ancestor loop |
| temp collision | a pre-existing file AT the temp path |
| temp retry exhaustion | the retry limit REACHED |
| `wx` cleanup | the exclusive create FAILING |
| mode on unchanged | `mode` COMBINED with equal content |
| mode on diff/merge | `mode` COMBINED with an existing-file mode |
| dlog cursor | a FULL buffer |
| empty inject marker | a DEGENERATE marker value |
| fragment double-resolve | a RELATIVE non-`.` folder |

The diff corpus (1 200 cases) and template corpus (471) vary *content* exhaustively while
holding options at typical values. That is why they caught none of these — and why each one
had to be found by a human or a bot reading code, one at a time.

`ts/tools/scenario-corpus.js` inverts the axis: modest content, exhaustive options. It
crosses output folder (unset, `.`, `out`, `./out`, absolute, nested) × existing-file mode
(write, preserve, diff, merge, present, no-write, preserve+diff) × on-disk state (fresh,
byte-identical, user-edited, empty) × filename shape (plain, dotfile, dotfile *and* its
non-dot sibling, nested, two files) — 840 cases, each recording TS's whole output tree,
replayed through Go and asserted byte-equal.

It passed on first run, which is the point: the fixes had already brought the stacks into
agreement, and that agreement is now pinned rather than incidental. Verified non-vacuous by
reverting the leading-dot fix (12 cases fail) and by swapping the diff/merge branch order
(fails).

One detail worth recording, because it nearly made the corpus useless: memfs resolves a
relative path against `process.cwd()`, so a first attempt rooted every folder under an
absolute prefix — which meant the `.` axis was silently testing `/work/.` and not `.` at
all, i.e. exactly the setting that produced the two worst defects was the one case still
uncovered. The generator now passes relative folders through verbatim and strips the cwd
prefix from the recorded keys instead.

---

## 2.5 S1–S4 — the third round

Same reasoning as the second: `13acbd9` was a fresh fix commit reviewed by nobody but its
author, so it got a pass of its own. Four findings, all four real.

| id | defect | origin |
|---|---|---|
| S1 | a temp file created by an atomic write survived a mid-write failure (ENOSPC) — the error returns before the path is recorded, so the function's own cleanup could never reach it. Both stacks. | pre-existing |
| S2 | with the default folder, `withinFolder` treated *any relative path* as inside, including one with `..`. The merge baseline — `.jostraca/generated` joined to that path — then normalized to a location outside the baseline directory and overwrote whatever was there. Both stacks. | pre-existing |
| S3 | the R11 restructure moved the first candidate inside the loop and left the bound at 8, dropping Go from 9 temp-path attempts to 8 while TS kept 9 | this branch |
| S4 | `MemFS.WriteFileExcl` checked only `m.files`, so it would create a file at a path already held as a directory — diverging from `O_EXCL` and from `OsFS` | this branch |

**S2 is the one that matters.** It is reachable through the public API — `Project({folder:
'../sibling'})` with the default output folder, and `ProjectProps.Folder` is deliberately
exempt from the `..` rejection that covers `File`/`Folder`/`Inject`/`Copy` names, because it
is developer-authored config. Writing into a sibling directory is a legitimate thing to ask
for; silently overwriting a file outside `.jostraca/generated` while doing it is not.

And it is worth being exact about my own contribution: **the R10 boundary fix made this
easier to trigger.** The old one-character bite turned `../x` into `./../x`, consuming a
level of escape, so three `..` segments landed harmlessly and four were needed to escape. At
`13acbd9` three suffice. The defect class is older; my fix removed the accident that was
partly masking it.

`withinFolder` now rejects a path that normalizes to `..` or starts with `../`, in both
stacks, and `writeDuplicate` re-checks containment against the cleaned path as a clamp — the
baseline root being the one place a stray `..` does real damage.

**S1 shows the limit of a fix I was pleased with.** R12 added a `created` flag so the
cleanup could not delete a file this call never made. Correct — but it left the mirror
case open: a `wx`/`O_EXCL` create that *succeeds* and then fails mid-write has created a
partial file that nothing cleans up. `created` was set after the write returned, so an
ENOSPC left it false. The guard was right about one direction and silent about the other.
Fixed on both sides, and in Go at both layers: `OsFS.WriteFileExcl` removes its own partial
file, and `writeAtomicMode` also removes the candidate, since a third-party `exclusiveFS`
implementation need not clean up after itself.

That last point came from the regression test failing after the first fix — the test double
implements `exclusiveFS` without self-cleaning, which is exactly the case the provider-side
fix misses.

---

## 2.6 S5 — found by self-check, not by review

After fixing S2 I probed the new containment check across a table of boundary inputs in
both stacks, rather than trusting that two mirrored functions agree. One input differed:

| input | TS | Go |
|---|---|---|
| `..\x` | rejected | **accepted** |

Every other case matched. The cause: TS's `fwd` is an unconditional backslash→slash
replace, so `..\x` normalizes to `../x` and is rejected; Go's `path.Clean` is
slash-only and treats the backslash as an ordinary character.

**On Windows that is a live containment escape in Go.** A leading `..\` there is a
genuine parent reference, reachable the same way S2 was — `Project({folder: "..\\sibling"})`
— and Go's check would have let the merge baseline out of its directory. The Go job runs on
Linux only, so no test would have caught it, and neither would the option-surface corpus:
it is generated and replayed on Linux, where `..\x` is a legitimate filename and the
two stacks *should* differ.

Both stacks now fold backslashes unconditionally. That is marginally over-strict on POSIX —
a filename genuinely containing a backslash is treated as outside, so it gets no merge
baseline — and correct everywhere else. The boundary table is asserted identically in both
suites, so the next divergence fails a test instead of needing another probe.

Worth naming the general point: **two functions written to mirror each other are the least
reliable place to assume agreement**, because the mirroring is done by hand and the
reviewer's eye slides over it. The corpora catch this where behaviour is platform-neutral;
where it is not, only a table asserted on both sides does.

---

## 2.7 U1–U5 — incomplete fixes

The fourth round has a different character from the second and third. Those attacked the
most recent fix commit. These attack the *earlier* fixes, and every one is the same shape:
**a change that correctly altered one code path and left its siblings on the old
assumption.**

| id | defect | origin |
|---|---|---|
| U1 | T5's content sniffing routed extension-unlisted binaries into `existing.bin`, making `preserve` reachable — but the preserve branch backs up via `copyFile`, which still chose its encoding from the extension, so the `.old` backup was UTF-8 mangled: `00 ff 02` written as `00 ef bf bd 02` | pre-existing |
| U2 | `resolveFragmentFrom` treats `C:/templates/x.html` as relative, rewriting it under the output folder and rejecting a file that exists | this branch |
| U3 | Go's copy sniffs binary correctly, then `save` re-derives the classification from the extension and loses it — so a `.wasm` was governed by `existing.txt`, and `txt.diff` wrote conflict markers into binary data | pre-existing |
| U4 | `hasConflicts` hard-codes `>>>>>>> EXISTING:`, so a file conflicted under custom labels was not recognised as unresolved and got re-merged, nesting markers one level deeper per run | this branch |
| U5 | TS matches copy `exclude` against the source-relative path, Go against the basename — `sub/a.txt` silently ineffective in Go, `a.txt` over-broad | pre-existing |

**U1 is the sharpest illustration.** T5 fixed the primary output — the target is now
byte-exact — while leaving the sidecar wrong. The branch converted *"everything corrupted,
consistently"* into *"target correct, backup silently corrupt"*, which is arguably worse to
diagnose. `copyFile` no longer knows or cares about file type: a copy copies bytes.

**U3 is the same defect one stack over**, and shows why the Buffer-vs-string distinction in
TS was load-bearing: it carried the classification implicitly. Go's `[]byte` cannot, so the
bit has to be passed explicitly — `saveBinary` now does.

**U2 is the third Windows-only defect on this branch**, after the mode assertions and the
backslash containment gap. Go's CI runs Linux only and `path.Clean` is slash-only on every
platform, so no test could have caught it. The pattern is consistent enough to state
plainly: *this project's Go port has a Windows blind spot that no current gate closes.*

**What none of the corpora could catch.** All five are either single-stack (U1, U4 nesting),
platform-specific (U2), or a divergence the corpora do not exercise because they never set
the relevant option (U3's `bin` modes, U5's `exclude`). The option-surface corpus added in
§2.4 crosses folder × existing-mode × state × filename — it does not cross `Copy.exclude`
or `existing.bin`, and extending it there is the obvious next increment.

---

## 2.8 V1–V2 — and where this stops

The fifth pass found two, both introduced by the fourth round's fixes:

- **A prefix match where a whole match was needed.** The custom-label conflict check used
  `text.includes(MARK_END + label)`, so label `E` matched an ordinary line
  `>>>>>>> Example` and `merge` returned `unresolved` — silently suppressing a legitimate
  regeneration over a marker the engine never emitted. `writeConflict` always appends a
  newline, so requiring it makes the match exact.
- **A parity fix that created a different parity gap.** Making Go's copy `exclude`
  source-relative left TS seeding its walk with `node.path`, so a `Copy` nested one
  `Folder` deep needed `outer/sub/a.txt` while the same `Copy` at the top needed
  `sub/a.txt`.

That second one is worth stating carefully, because the resolution went against the usual
rule. TS's exclude base was an **artifact**: `Folder` contributes a path segment because it
has a `name`, `Project` does not because it has a `folder`, and the Copy's own `to` does not
because it is read as a name later, at op time. So the option's spelling depended on where
the component sat in the *output* tree rather than on the source being copied. Nobody could
depend on that deliberately. This is the `CLAUDE.md` exception — the port pre-empted a
latent TS bug — so TS was corrected to match Go rather than the reverse.

---

## 2.9 #21 — the sibling bug, and the third time the port was already right

Filed rather than fixed at the end of the review (§2.2), then taken up on its own. The issue
offered three remedies — error, implicit root, warn-and-drop — and recommended "option 1 or
2". Investigating it moved the answer decisively to **option 2, eagerly**, and corrected two
things the issue itself asserted:

- **The line the issue blamed is inert.** `ctx$.root` is *write-only*: nothing in `ts/src`,
  `ts/test`, `ts/tools` or `ts/gen` ever reads it. Deleting the assignment changes nothing.
  The load-bearing line is the next one, `parent = ctx$.node || node`, which makes the first
  top-level component *its own parent*; the `finally` then restores the cursor to it and
  `build()` walks it, orphaning the rest.
- **Go already had the implicit root.** `Generate` has always created a `KindNone` root node
  and bound the define phase to it, so every top-level sibling was already a child of it
  *with a correct path*. Go's only defect was which node `runBuild` started from — one line.
  The issue's claim that Go mirrored the bug across "four sites in `builder.go`" was wrong;
  those sites needed no change at all.

That makes this the **third** time the port pre-empted a latent TS bug (after G10 and V2),
and again `CLAUDE.md`'s exception applies: TS was corrected to match Go.

**Why eager, not lazy.** The obvious conservative variant — synthesise the wrapper only when
a *second* top-level component appears, leaving the one-component case untouched — does not
work in TS, and the reason is worth recording. Because the first sibling becomes the parent,
TS also derives the orphans' `node.path` *from it*: two top-level files `a.txt` and `b.txt`
give `b.txt` the path `['a.txt','b.txt']` where Go gives `['b.txt']`. `node.path` never
determines output location — only `rpath` exclude matching and log bookkeeping — so it is
invisible today. But reparenting at the end of the define phase resurrects the siblings
carrying that wrong path, creating a *fresh* TS/Go divergence in the act of fixing the bug.
The eager root fixes both halves at once.

The conservative variant's whole selling point was byte-identity for existing trees. The
eager fix delivers that anyway, and it was measured rather than assumed: **all 35 parity
corpus files regenerate byte-identical**, including the 840-case option-surface corpus and
the 471-case template corpus. Both new regression tests were verified in the failing
direction — reverting the source and keeping the tests gives `not ok 9 - top-level-siblings`
in TS and `/top/b.txt missing` in Go.

**What this newly exposes.** Components that were silently dropped now actually run, so this
is not purely additive:

- A second top-level `Inject` whose target does not exist used to be skipped and now throws.
  That is the point of the fix, but it is a user-visible change for existing generators.
- `generate({}, () => {})` with an empty define phase used to throw a bare `TypeError` in TS
  while Go returned success. The synthetic root closes that parity gap incidentally; a
  matching bail mirrors `runBuild`'s `st.root == nil` check.
- `ProjectOp` has no `after` hook, so `Project({folder:'p'}, ...)` followed by a bare
  top-level `File` writes to `p/` rather than the output root. Pre-existing and
  byte-identical in both stacks, so not a parity break — but it was unreachable before this
  fix and is reachable now. Filed as [#26](https://github.com/jostraca/jostraca/issues/26)
  rather than folded in, because #21's change is provably byte-neutral and this one would
  not be. The sharper case there is two sibling `Project`s: the second currently nests
  inside the first.

---

## 2.10 #22 — the Windows gate, and the fourth defect of the same shape

`go-test.yml` ran Linux only. It now matrixes ubuntu/macOS/Windows, and the first run was
green on all three — `-race` included, and all three differential corpora byte-matching on
Windows.

**What the issue predicted, versus what was there.** The issue pointed at mode bits, path
separators, chmod and tempdir shapes. Every one of those was already clean: the mode
assertions are guarded, the suite passes under real Go-Windows `filepath` semantics, macOS's
symlinked `TMPDIR` is a non-event, and both the JSON and fuzz corpora survive CRLF
conversion. The previous round's three Windows defects were genuinely fixed.

What actually blocked a green matrix was almost all harness, not port:

| break | kind |
|---|---|
| `windows-latest` defaults `run:` to pwsh, which cannot parse the POSIX steps | CI |
| `core.autocrlf=true` on the runner makes `gofmt -l` report all 52 Go files | repo |
| a CRLF shebang makes `check_diff_coverage.sh` unexecutable (exit 127) | repo |
| `os.Symlink` needs a privilege the runners lack, at two `t.Fatal` sites | test |
| **`scenario-corpus.js` mis-strips `process.cwd()`, corrupting 700 of 840 cases** | tool |

The last is the notable one, and it sits on the *canonical* side. It strips the machine
prefix with `process.cwd() + '/'`, but memfs forward-slashes and drive-strips its volume
keys, so on Windows the prefix never matches. The repo rule is "TS is canonical, Go is the
port to fix" — here the canonical side's *tooling* is the defect, and the right answer was
neither to change a stack nor to fix the tool, but to recognise that corpus regeneration is
a canonical-source freshness check rather than a platform check, and pin it to Linux.

**A fourth Windows-only port defect, of the shape §2.7 named.** `isAbsFromPath` was added
last round to mirror node's platform-dispatched `Path.isAbsolute`, after slash-only
`isAbsPath` made Go rewrite a drive-absolute Fragment source under the output folder. It was
wired into Fragment — and left off its two siblings, `projectBefore` and `withinFolder`'s
`.` branch. A drive-absolute `Project.folder` therefore had Go writing `out/C:/abs/a.txt`
where TS writes `C:/abs/a.txt`.

So §2.7's pattern — *a change that correctly altered one code path and left its siblings on
the old assumption* — recurred **inside the fix for §2.7 itself**, one round later. The
mechanism is the same one every time: the Windows branch is unreachable on Linux CI, so
nothing can fail. And adding Windows to the matrix does not close it either, because no test
or corpus case uses a drive-letter folder.

That is the real lesson here, and it is not "run CI on more platforms". A platform-gated
branch needs a *seam*, so the boundary can be asserted from any host:

- `isAbsFromPathOn(p, windows)` takes the platform as an argument. The boundary table is
  asserted for both platforms from Linux, and every expectation in it was taken from node
  rather than reasoned about. `ts/test/platform.test.ts` pins the identical table against
  node's own `posix` and `win32`, so a wrong table fails on the TS side and a wrong mirror
  fails on the Go side.
- A structural guard asserts `isAbsPath` has exactly one call site — the legitimate one,
  `withinFolder`'s `/` branch, where TS really does use a literal `startsWith('/')`.
  Verified by reverting either site: it turns red.

---

## 2.11 #24 — binary content in the corpus, and a worse corruption than the one filed

The corpus stored content as JSON strings, so binary bodies could not be expressed and the
one binary behaviour that matters — a file whose extension is absent from `BINARY_EXT` must
survive `Copy` untouched — rested on hand-transcribed per-stack unit tests. That was the
last place the parity guarantee depended on two people writing the same expectation twice.

**The filed diagnosis was wrong, and the correction changed the design.** The issue said
`0xFF 0xFE` round-trips as its UTF-8 encoding, `0xC3 0xBF 0xC3 0xBE` — lossy but reversible.
Measured, memfs's `vol.toJSON()` decodes with *replacement*: every distinct invalid byte
collapses to `U+FFFD`. That is irreversible, which means a serialisation-time encoder is not
enough — by the time `toJSON()` returns, the bytes are already gone. The snapshot has to
re-read each file through `fs`.

**The rule is a round-trip, not a validity predicate.** A plain string is emitted exactly
when `Buffer.from(buf.toString('utf8'),'utf8')` equals `buf`; otherwise `{"b64": …}`. The
property Go relies on is "if it is a string, `[]byte(s)` reproduces the original bytes" —
the round-trip *is* that property, checked directly, so the guarantee holds by construction.
A validity check is a proxy that has to get overlong forms, CESU-8 surrogates and truncated
sequences right separately. It also matters that the corpus is generated by TS and only read
by Go: TS is the only side that ever *decides*, Go only decodes, so there is no second
decision site to keep in sync.

Scoped deliberately to the per-scenario snapshot channel. The diff and template corpora are
left alone — `mutate-diff.js` is a second, TS-side reader of the diff corpus, and
`template_corpus.cases[].model` is arbitrary JSON where `{"b64": …}` would be genuinely
ambiguous with a model that has a `b64` key.

**A binary scenario needs a template marker or it has no teeth.** The first attempt — wasm
magic plus `0xFF 0xFE`, no markers — was byte-identical even with Go's content sniffing
disabled, because Go strings are byte-transparent and its text path is a no-op on arbitrary
bytes. The committed scenario embeds `$$v$$` inside the binary and ships a `.txt` sibling, so
one run proves both halves: the `.wasm` keeps `$$v$$` verbatim while the `.txt` becomes
`hello V`. Verified by disabling `IsBinContent` in the Go copy walk — the corpus then fails
with `\x00asm\x01\x00\x00\x00V\xff\xfe\x80` against the expected `…$$v$$…`.

All 35 pre-existing corpus files regenerate byte-identical; the binary scenario is the only
addition.

---

## 2.12 #23 — the corpus axes, and what building them found

Both axes were prototyped end to end. Neither landed, and the reason is the interesting part:
**a differential corpus cannot record an expectation for behaviour the two stacks disagree
about.** Writing one down anyway would freeze whichever stack happened to run the generator
as canonical — which is exactly the failure the corpora exist to prevent.

The `Copy.exclude` corpus is 65 cases and demonstrably earns its place: with the U5 fix
reverted it fails 16 of 65, and it catches a divergence the two existing hand-written pins
miss (those cover two `exclude` values each). But 8 of 65 fail on today's `master`, because
Go prunes excluded *directories* during the walk while TS matches only on the file branch
(#28). The `existing.bin` axis is no longer blocked on #24 — the escape hatch shipped — but
turned out to be blocked on something worse: the two stacks choose between `existing.txt`
and `existing.bin` by *different criteria entirely*, TS by the type of the value handed to
`save` and Go by the destination extension (#27).

Two design findings worth keeping regardless of when they land:

- **A separate corpus beats an axis on the existing 840.** The full cross is 840 × 13 =
  10 920 cases and ~12 MB of JSON for *zero* added discrimination, because exclusion is
  decided in the copy walk before any `FileHandler` call — the existing-file axis cannot
  interact with it. Standalone: 65 cases, 213 KB, +1.0% test wall time.
- **Value variety is nearly worthless; path shape is everything.** The matcher has two
  branches, string equality and `RegExp.test`. What discriminates is *which path is fed in*
  and *which entries are checked*: the same basename at two depths (the U5 detector), one
  exclude under four `Copy` placements (the V2 detector), directory versus file entries, and
  the degenerate `true` / `[]` forms. More glob spellings and more multi-entry arrays add
  nothing.

The `existing.bin` half of this landed once #27 was decided; §2.15 records what it took, and
the one state it still cannot record.

---

## 2.13 #25 — the deferral held, the reasoning did not

T15 was deferred on the grounds that collapsing `Fragment`'s replay would change
side-effecting-child semantics to buy CPU in a phase that is not the bottleneck. Measuring
it upheld the conclusion and overturned the premise.

**The count was wrong.** Children do not run N+1 times. The body *thunk* runs N+2 times
(N = slot-marker occurrences, not declared slots), but every *component body* runs exactly
**once**: the collect pass admits no component at all, because its filter always returns
false and `cmp()` returns before invoking the component. Exactly one of the N+2 walks is
redundant, and it is the cheapest one. The issue overstated the prize by roughly a factor
of N.

**Nested Fragments do not compound in TS** — the one thing that would have changed the
verdict. Thunk executions per level at D=1..4 are flat (`[3,3,3,3]` at N=1, `[6,6,6,6]` at
N=4), with the source read exactly D times.

**And it was actually removed rather than argued about.** A patched copy with the collect
pass deleted, benchmarked against the original over 7 interleaved child-process reps per
configuration, moved the median by +2.2% / +2.2% / −2.8% / −0.9% / +2.1% across five
configurations — against run-to-run spreads of 7–43%. The sign is not even consistent. The
effect is more than an order of magnitude below the noise floor.

So: closed won't-fix, with the numbers attached, rather than left open on an assertion.

**What the measurement found instead** is #29 — Go never applies the Fragment filter to
non-Slot children, so their bodies run N+1 times where TS runs them zero times. The output
agrees, which is why no corpus case and neither suite catches it; the *side effects* do not.
It is also the sole cause of a Go-only quadratic blowup for nested Fragments (D=8: 608 body
executions against TS's flat 48, and `D(D+1)/2` source re-reads against TS's `D`).

That is the pattern this whole exercise keeps producing: the stated problem was not the
problem, and chasing it properly surfaced a real one next door.

---

## 2.14 #27–#29 — three decided semantics, and one decision that could not be taken literally

These three were escalated rather than chosen unilaterally: each changes canonical
user-visible behaviour, so each got an explicit ruling. Extension decides binary/text;
`Copy.exclude` prunes directories; a non-Slot child of a `Fragment` is an error. What
implementing them found is that two of the three needed a qualifier the ruling did not
contain, and one could not be implemented as stated at all.

**#27 — "extension decides" had to be qualified, or it un-fixed U3.** Taken absolutely,
extension-only sends an unlisted extension like `.wasm` back to `existing.txt`, which is
verbatim the U3 defect from §2.7. That was not argued, it was *built*: with sniffing removed
entirely, two robustness tests fail and the `copy_binary_unlisted_ext` corpus case rewrites
itself — the embedded `$$v$$` templated to `V` and `ff fe 80` collapsed to three `U+FFFD`.
A narrower counterfactual, where sniffing still decides templating but the mode set comes
from the extension alone, produced `<<<<<<< EXISTING` conflict markers wrapped around
binary. So the rule shipped is *extension decides, and sniffing may promote an unlisted
extension to binary but never demote a listed one* — which resolves the inversion the
decision was about (`a.png` holding text is binary, by its extension) without reopening a
fixed data-integrity bug.

Two supporting findings: `go/PORT_PLAN.md` already documented this rule — TS had never
matched its own port plan, so TS was the drifted side and Go needed **no source change** at
all. And `existing.bin.diff`/`.merge` are rejected by `ExistingShape`, so a bin-classified
file structurally cannot reach the diff/merge branches; no extra guard was needed.

**#28 — the widening was safe but not sufficient.** Hoisting the `exclude` test above the
directory/file split makes TS prune, matching Go. Admitting a scalar `String`/`RegExp` makes
`CopyOp`'s scalar branch reachable for the first time — it had been dead code that an
earlier round "fixed" without noticing it could never run. But a scalar *RegExp* still
matched nothing in either stack until one ternary arm in TS and one `case *regexp.Regexp` in
Go were added. Widening a shape does not make the code behind it work.

A residual divergence surfaced and was closed in the same change: configured
`Cmp.Copy.ignore` regexes pruned directories in Go and not in TS, because they were tested
inside `excludeFile()` alongside the user excludes rather than in `ignored()` beside the
built-in rules. The built-in `~` / `-jostraca-off` rules keep matching the bare basename;
user `exclude` matches the source-relative path. Those are two different lists with two
different match targets, and conflating them is what produced the divergence.

**#29 — the rule as stated was unimplementable, because the behaviour is documented.** A
non-Slot child of a `Fragment` is not an accident: `README.md` states that unnamed `<[SLOT]>`
markers *receive all non-Slot children of the Fragment*. The committed `fragment_subcmp`
scenario exercises exactly that (`Content('S')` → `+S`), alongside `replace` callbacks that
invoke components. Erroring on every non-Slot child would delete a documented feature and a
parity scenario covering it.

The narrowed rule is the silent-drop case and nothing else:

> A non-Slot child of a Fragment is an error **only when the fragment source contains no
> unnamed `<[SLOT]>` marker to receive it.**

Every documented usage stays legal, `fragment_subcmp` is untouched and byte-identical, and
the entire corpus regenerates with zero movement. The error text is identical in both stacks
and names the offending source file.

Note what this does *not* fix. #29 was originally about Go running non-Slot children's
bodies N+1 times where TS runs them zero times; the narrowed rule makes the silent-drop case
loud, but the side-effect count still differs for shapes that remain legal. And one new
asymmetry is recorded rather than reconciled, in `go/README.md`'s deviations list: Go's
`J.Cmp` runs its body inline without allocating a node, so a *user component* used as a
direct Fragment child is a non-Slot child in TS and invisible in Go — the new error fires in
TS only, for that one shape. Reconciling it means giving `Cmp` a node, which changes the
shape of every Go component tree.

## 2.15 #23 — the `existing.bin` axis landed, and the hole it could not fill

With #27 decided, the axis §2.12 deferred went in: the option-surface corpus grows from 840
to **1 197 cases** (1.5 MB), adding `.png` (listed binary extension), `.wasm` (unlisted
extension, binary content) and a `.txt` control, crossed with seven mode rows that pair a
`txt` mode against a *different* `bin` mode. Real bytes on both sides — the pre-existing
on-disk state and the generated content — ride the `{"b64": …}` escape hatch from #24.

**The teeth are in the payload, not in the case count.** A binary case with no marker in it
is worth nothing: Go strings are byte-transparent, so the text path is a no-op on arbitrary
bytes and the case stays byte-identical even when the classification is wrong. That was
measured when the first binary scenario was added. Each payload here therefore carries a
`$$v$$` marker, bytes that are not valid UTF-8, and a NUL. Both halves of the #27 rule are
then separately detectable, and by *different* cases:

| reverted fix | cases that move |
|---|---|
| classify by value type instead of extension | 126 / 1 197 (`png-file`, `pngtxt-file`, `mix`) |
| content sniff disabled, so `.wasm` reads as text | 126 / 1 197 (`wasm-copy`, `mix`) |

The two sets overlap on only the 36 `mix` cases. Zero of the pre-existing 840 move under
either — which is the concrete measurement behind §2.12's claim that the old corpus could
not see this question at all.

**The axis is not the full cross, and the two cuts are different in kind.** The binary block
uses three of the six folder settings (`unset`, `rel`, `abs`) because classification is
folder-independent and those are the three distinct branches of
`relative()`/`withinFolder()`; it is not crossed with the seven text-only mode rows or the
five text name shapes because a `bin` mode cannot reach a `.txt` file. That is a size cut,
and it costs nothing.

The other cut is a real hole. **A Copy-routed file gets no `same` state, because the two
stacks disagree about it.** Content copied from a binary source reaches `FileHandler.save`
as a `Buffer`, and `save` compares it for equality against what `loadFile` returns — a UTF-8
*string*. The test is `string !== Buffer`, true whatever the bytes are, so TS treats a
Copy-routed binary as **changed even when the target already holds exactly those bytes**;
Go uses `bytes.Equal`. With `bin.preserve` TS writes a `.old` backup of a file it is about
to rewrite identically, and with `bin.present` a `.new` sidecar identical to the target.
Measured on the full cross: exactly 36 cases failed, all of them `same` × Copy-routed ×
a preserve/present mode.

Per §2.12, recording TS's output there would freeze a Buffer-vs-string comparison artifact
as canonical, which is the failure the corpora exist to prevent — so the state is dropped
for the **route**, not for the four mode rows where it happens to show; dropping only the
latter would be shaping the corpus to pass. The copy-free `pngtxt-file` row keeps `same`
on the side where it is representable. Fixing this changes user-visible output, so it wants
the same explicit ruling #27–#29 got rather than being taken here.

---

### The arc

| round | confirmed | introduced by this branch |
|---|---|---|
| 1 | 9 | 8 |
| 2 | 4 | 3 |
| 3 | 4 | 2 |
| 4 | 5 | 2 |
| 5 | 2 | 2 |

Twenty-four confirmed defects, plus one found by self-check. The branch-introduced count
falls 8 → 3 → 2 → 2 → 2 and the *severity* falls with it: round one had two P1
data-integrity bugs reachable by default configuration; round five has a marker-prefix false
positive and an option-spelling inconsistency.

**The honest reading is that fixing code introduces defects at a fairly stable rate**, and
no amount of reviewing converges to zero — it converges to *small*. The stopping rule that
follows is not "no findings" but "no findings that a user would notice", and this is the
first round to meet it.

**What each technique actually caught**, since the totals are now large enough to say:

| technique | found | characteristic |
|---|---|---|
| adversarial review of the diff | 24 | defaults, degenerate values, option combinations, incomplete fixes |
| cross-stack differential corpora | ~8 (at build time) | platform-neutral behaviour divergence |
| self-check against a boundary table | 1 | a divergence the corpora structurally cannot see |
| fuzzing | 1 (a wrong property) | inputs nobody would write |
| mutation testing | 0 defects, 1 false claim | whether the tests would notice |

The corpora are the cheapest ongoing insurance and caught the most *at build time*, but
every defect found after the corpora existed was found by review or self-check — because
the corpora test what both stacks do *identically*, and most remaining defects are
single-stack, platform-specific, or turn on an option nothing sets.

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
| TS tests | 36 | 120 |
| Go tests | 147 | 238 |
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
