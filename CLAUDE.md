# Jostraca — Agent Guide

## Canonical source: TypeScript

**The TypeScript package in `src/` is the canonical implementation.** The Go
module under `go/` is a *port* that must be kept in feature parity with it.

When changing behaviour:

1. **Make the change in TypeScript first** — `src/`, with tests in `test/`.
2. **Then bring the Go port into parity** — `go/jostraca/`, with matching tests.
3. Keep the Go parity notes (`go/REFERENCE.md`, `go/PORT_PLAN.md`,
   `go/README.md` "Deviations from the TypeScript original") accurate when
   behaviour shifts.

Never treat the Go port as the source of truth. If the two implementations
disagree, **TS wins and Go is the one to fix** — even if the Go code happens to
look more correct (the port has occasionally pre-empted latent TS bugs; the fix
is still to correct TS first, then realign Go).

## Layout

- `src/jostraca.ts` — `Jostraca()` factory + `generate()` driver.
- `src/cmp/` — components (Project, Folder, File, Content, Fragment, Slot,
  Inject, Copy, Line, List, plus internal None).
- `src/op/` — one op per component, with `before()`/`after()` hooks driven by
  the recursive `step()` walker.
- `src/build/` — `BuildContext`, `BuildMeta`, `FileHandler` (the
  write/preserve/present/diff/merge existing-file modes).
- `src/util/` — `basic.ts` (each/get/getx/template/name-case helpers) and
  `point.ts`.
- `test/` — Node test-runner suites; compiled to `dist-test/` before running.
- `go/jostraca/` — the Go port and its tests.

## Build & test

TypeScript (build emits JS to `dist/`, tests to `dist-test/`):

```bash
npm install          # also pulls peer deps: jsonic, memfs, shape
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
```

## Gotchas

- **Canonical paths in `FileHandler`.** Paths reaching `FileHandler` are already
  folder-prefixed by the build phase (and may be absolute). The low-level FS
  methods (`saveFile`/`loadFile`/`existsFile`/`copyFile`) use them **directly**
  and must NOT re-join `this.folder` — doing so double-prefixes relative,
  non-`.` output folders (e.g. `out/out/foo.txt`). `BuildMeta` therefore builds
  full, folder-prefixed meta/`.gitignore` paths itself.
- **`shape` engine warning.** `shape` may emit `EBADENGINE` on Node < 24; the
  build and tests still pass on Node 22. Peer deps are intentionally loose
  ranges (`jsonic >=2`, `memfs >=4`, `shape >=10`).
