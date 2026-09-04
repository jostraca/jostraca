# Jostraca — Agent Guide

## Canonical source: TypeScript

**The TypeScript package in `ts/` is the canonical implementation.** The Go
module under `go/` is a *port* that must be kept in feature parity with it. The
two implementations live side by side: `ts/` (npm package) and `go/` (Go module).

When changing behaviour:

1. **Make the change in TypeScript first** — `ts/src/`, with tests in `ts/test/`.
2. **Then bring the Go port into parity** — `go/`, with matching tests.
3. Keep the Go parity notes (`docs/reference-go.md`, `go/PORT_PLAN.md`,
   `go/README.md` "Deviations from the TypeScript original") accurate when
   behaviour shifts.

Never treat the Go port as the source of truth. If the two implementations
disagree, **TS wins and Go is the one to fix** — even if the Go code happens to
look more correct (the port has occasionally pre-empted latent TS bugs; the fix
is still to correct TS first, then realign Go).

**The rule decides which side is canonical, not which side is correct.** Where
Go is right and TS is wrong, the order still holds — fix TS, then realign Go —
but Go must NOT be aligned to a TS defect. This has happened once and is worth
recognising: a global `control: { dryrun: true }` was silently discarded in TS
and wrote the user's files, while Go honoured it. Aligning Go to TS there would
have propagated a data-destroying bug into the port. `docs/design/PARITY_PLAN.md` §1.1 has
the case; the fix went into TS and Go kept its behaviour.

## Layout

The TypeScript package root is `ts/` (holds `package.json`, `src/`, `test/`,
build output `dist/`/`dist-test/`, and the `gen/`/`tools/` helper scripts).

- `ts/src/jostraca.ts` — `Jostraca()` factory + `generate()` driver.
- `ts/src/cmp/` — components (Project, Folder, File, Content, Fragment, Slot,
  Inject, Copy, Line, List, plus internal None).
- `ts/src/op/` — one op per component, with `before()`/`after()` hooks driven by
  the recursive `step()` walker.
- `ts/src/build/` — `BuildContext`, `BuildMeta`, `FileHandler` (the
  write/preserve/present/diff/merge existing-file modes).
- `ts/src/util/` — `basic.ts` (each/get/getx/template/name-case helpers) and
  `point.ts`.
- `ts/test/` — Node test-runner suites; compiled to `ts/dist-test/` before running.
- `go/` — the Go port and its tests (package `jostraca` at the module root,
  mirroring the layout of `voxgig/util`'s `go/`).
- `docs/` — the documentation set, and the Pages site root. `docs/STYLE-GUIDE.md`
  is normative for what is written there; `docs/design/` holds working
  documents and is exempt (see below).
- `test/spec/` — the **shared corpus**: language-neutral TSV cases that both
  stacks assert against (`ts/test/spec.test.ts`, `go/spec_test.go`). This is
  where parity for the pure helpers is pinned; see `test/spec/README.md`.
  `test/spec/perf/` holds the performance workloads and baselines.

## Build & test

TypeScript — run from `ts/` (build emits JS to `ts/dist/`, tests to `ts/dist-test/`):

```bash
cd ts
npm install          # also pulls the peer dep: shape
npm run build        # tsc --build src test
npm test             # node --test dist-test/**/*.test.js
```

Go:

```bash
cd go && go build ./... && go test ./...
```

Both implementations together, from the repo root:

```bash
make all             # build + test, TS and Go
make perf            # performance baselines, both stacks (not part of test)
```

When changing any pure helper (the name-case family, `template`, `deep`,
`omap`, `getx`, `indent`, the diff primitives), add the case to
`test/spec/` rather than to one stack's suite. Both runners pick up a new
row with no code change, and an unknown `fn` is a hard failure in both —
so a case can never be silently ignored by one side.

## Prose follows docs/STYLE-GUIDE.md

[`docs/STYLE-GUIDE.md`](docs/STYLE-GUIDE.md) is normative for `docs/`,
`docs/how-to/`, `docs/ADR.md` and all three package READMEs. It carries the voice, the
Diátaxis placement rules, the banned-phrase list, the em-dash ration, and the
rule that documentation never cites an internal working document. Read it
before writing a sentence that ships; it is short, and every rule in it was
added after something went wrong.

Two gates enforce it and both run in CI:

| Gate | Runs | Covers |
|---|---|---|
| `vale --glob='!docs/design/**' --minAlertLevel=error docs adr README.md ts/README.md` | `.github/workflows/docs.yml` | Google's rules plus the banned list |
| `ts/test/docs.test.ts` | `npm test` | the banned list, the em-dash ration, first person, no emoji, no internal-document citations, and that every snippet executes |

The banned list is one file, `.vale/styles/config/vocabularies/Jostraca/reject.txt`,
read by both. Add a phrase there and both pick it up; there is no second copy
to keep in step.

**`docs/design/` is not documentation.** `PARITY_PLAN.md`, `DEPENDENCY_PLAN.md`
and `CODE_REVIEW.md` are working documents: analysis that argues with itself,
cites line numbers, and is revised as the code moves. Neither gate reads them,
Jekyll does not publish them, and documentation must not cite them — state the
fact instead, or write it into the page that owns it.

The website repository, `jostraca/web`, links to this same guide rather than
keeping a copy, so there is one statement of the house style for both.

## Production dependencies need an ADR first

**Do not add a production dependency without writing its ADR.** That is
`dependencies`, `peerDependencies` or `optionalDependencies` in
`ts/package.json`, and any non-test `require` in `go/go.mod`. Peer and optional
both count: npm installs them into the consumer's tree either way.

The rule and its reasoning are record 0001 in
[`docs/ADR.md`](docs/ADR.md); the one accepted dependency, `shape`, is 0002.
Write
the record before the change, not after: it exists to make the case at the
moment the decision is still cheap to reverse.

The published tree is one runtime dependency per stack, with nothing behind it.
`jsonic`, `memfs` and a phantom `oxc-parser` were all removed after the fact,
and removing `memfs` alone took 20 packages and 68,557 lines of JavaScript out
of every consumer's install. Adding is one line; removing is a reimplementation.

Development dependencies are out of scope. `typescript`, `@types/node` and the
pinned Vale binary never reach a consumer.

## Gotchas

- **Canonical paths in `FileHandler`.** Paths reaching `FileHandler` are already
  folder-prefixed by the build phase (and may be absolute). The low-level FS
  methods (`saveFile`/`loadFile`/`existsFile`/`copyFile`) use them **directly**
  and must NOT re-join `this.folder` — doing so double-prefixes relative,
  non-`.` output folders (e.g. `out/out/foo.txt`). `BuildMeta` therefore builds
  full, folder-prefixed meta/`.gitignore` paths itself.
- **`test/` needs a project reference to `src/`.** The suites import the
  package by path (`'../'`, `'../dist/util/basic'`), which node-resolves
  through `package.json` into `dist/`. `tsc --build src test` resolves both
  projects' module graphs *before* emitting either, so with no `dist/` on
  disk every such import fails `TS2307`. `ts/test/tsconfig.json` therefore
  declares `references: [{ path: "../src" }]` and `ts/src/tsconfig.json` sets
  `composite: true`. Do not remove either: without them `make reset` fails
  outright, and only `make reset` shows it, because `dist/` is committed and
  every other path starts from a populated one.
- **`shape` engine floor.** `shape` sets `engines.node` to `>=20` from 11.4.0;
  11.0 through 11.3 set `>=24`, so an older resolution can still emit
  `EBADENGINE`. It is a warning rather than a refusal, and the build and
  tests pass on Node 22. The peer range is intentionally loose
  (`shape >=11`).
- **`memfs` is in-repo, not imported.** `src/util/memfs.ts` is a port of
  `go/fs.go`'s MemFS wearing `node:fs` sync signatures. It replaced the
  `memfs` package, which cost 20 transitive packages for six required
  methods and `vol.toJSON()`. Two behaviours are contract, not detail, and
  both are pinned in `tools/memfs-differential.js`: `readdirSync` sorts,
  while `toJSON` walks the tree depth-first taking each directory's
  children in creation order. Getting the second wrong reorders 1583 lines
  of `go/testdata/parity` while every unit test still passes.
- **`deep` and `omap` are inlined, not imported.** They used to be re-exports
  of `jsonic.util`; a parser dependency for two object helpers was not worth
  it, so `src/util/basic.ts` carries them. `deep` stays a faithful port —
  `SKIP` sentinel included (resolved via `Symbol.for('tabnas.SKIP')`, so a
  caller holding jsonic's own `SKIP` still works) — with ONE deliberate
  correction: a value with a custom constructor (Date, RegExp, class
  instance) replaces the value under the same key instead of being walked
  into it. The rule was already documented and already applied when the base
  value was a scalar; two objects took the walk branch, which copied the
  enumerable properties of one custom instance into the other and so
  discarded `over` entirely (a RegExp has none). That silently dropped index
  0 of every caller-supplied `cmp.Copy.ignore` list, which is merged over a
  default of `[/~$/]`. `go/util.go` `mergeOne` never had it, so this closed
  a real TS↔Go divergence; both sides now pin it (`deep` in
  `ts/test/utility.test.ts`, `TestDeepCustomTypeReplaces` in
  `go/util_test.go`, and `copy-ignore` in `ts/test/jostraca.test.ts` for the
  option that surfaced it). `omap` deliberately
  differs from the original: it visits entries in **sorted** key order, because
  a Go map has no insertion order for `go/util.go` `OMap` to reproduce. Sorting
  is the same convention `each`, `cmap`, `vmap` and `jsonify` already follow.
