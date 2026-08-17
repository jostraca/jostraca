# Jostraca — Agent Guide

## Canonical source: TypeScript

**The TypeScript package in `ts/` is the canonical implementation.** The Go
module under `go/` is a *port* that must be kept in feature parity with it. The
two implementations live side by side: `ts/` (npm package) and `go/` (Go module).

When changing behaviour:

1. **Make the change in TypeScript first** — `ts/src/`, with tests in `ts/test/`.
2. **Then bring the Go port into parity** — `go/`, with matching tests.
3. Keep the Go parity notes (`go/REFERENCE.md`, `go/PORT_PLAN.md`,
   `go/README.md` "Deviations from the TypeScript original") accurate when
   behaviour shifts.

Never treat the Go port as the source of truth. If the two implementations
disagree, **TS wins and Go is the one to fix** — even if the Go code happens to
look more correct (the port has occasionally pre-empted latent TS bugs; the fix
is still to correct TS first, then realign Go).

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
- `test/spec/` — the **shared corpus**: language-neutral TSV cases that both
  stacks assert against (`ts/test/spec.test.ts`, `go/spec_test.go`). This is
  where parity for the pure helpers is pinned; see `test/spec/README.md`.
  `test/spec/perf/` holds the performance workloads and baselines.

## Build & test

TypeScript — run from `ts/` (build emits JS to `ts/dist/`, tests to `ts/dist-test/`):

```bash
cd ts
npm install          # also pulls peer deps: memfs, shape
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
- **`shape` engine warning.** `shape` may emit `EBADENGINE` on Node < 24; the
  build and tests still pass on Node 22. Peer deps are intentionally loose
  ranges (`memfs >=4`, `shape >=10`).
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
