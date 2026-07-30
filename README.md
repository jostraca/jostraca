# Jostraca

A code and project generator that uses React-style components to define
files, folders, and content declaratively.

[![npm version](https://badge.fury.io/js/jostraca.svg)](https://www.npmjs.com/package/jostraca)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/jostraca/jostraca/blob/master/LICENSE)

You describe an output file tree with components — `Project`, `Folder`,
`File`, `Content`, `Fragment`, `Slot`, `Inject`, `Copy`, and more — in a
*define* phase, and Jostraca walks that tree to write the real files in a
*build* phase. Templates, slots, injections, protected regions, and
three-way merges let you regenerate over hand-edited code without
clobbering it.

```
Project → Folder → File → Content        the tree you declare
                    │
                    ▼
              out/my-app/src/index.js     the files Jostraca writes
```

## Two implementations

Jostraca ships as two implementations that produce **byte-identical output**
for the same logical input. The TypeScript package is canonical; the Go
module is a maintained port kept in feature parity.

| | Package | Docs | Getting started |
|---|---|---|---|
| **TypeScript** (canonical) | [`jostraca`](https://www.npmjs.com/package/jostraca) on npm | [`ts/README.md`](./ts/README.md) | `npm install jostraca` |
| **Go** (port) | [`github.com/jostraca/jostraca/go`](https://pkg.go.dev/github.com/jostraca/jostraca/go) | [`go/README.md`](./go/README.md) | `go get github.com/jostraca/jostraca/go` |

Behaviour parity is pinned by a shared, language-neutral corpus in
[`test/spec/`](./test/spec) that both stacks assert against, so a
documented behaviour means the same thing in either language.

## Documentation

This project's documentation follows the [Diátaxis](https://diataxis.fr)
framework — four distinct kinds of material, each answering a different
need. Start with the one that matches what you're trying to do:

- **Tutorial** — *learning-oriented.* A first-generator walkthrough for
  newcomers. See the "Tutorial" section of the
  [TypeScript](./ts/README.md) or [Go](./go/README.md) README.
- **How-to guides** — *task-oriented.* Recipes for specific goals
  (templates, slots, copying, injecting, regenerating over existing
  files). See the "How-to guides" sections in the same READMEs.
- **Reference** — *information-oriented.* The exhaustive, dry description
  of every component, option, and utility:
  [`ts/REFERENCE.md`](./ts/REFERENCE.md) and
  [`go/REFERENCE.md`](./go/REFERENCE.md).
- **Explanation** — *understanding-oriented.* The two-phase model, the
  component design, and (for Go) the port's design decisions:
  the "Explanation" sections, plus [`go/PORT_PLAN.md`](./go/PORT_PLAN.md).

## Repository layout

```
jostraca/
  ts/     canonical TypeScript package (published to npm as `jostraca`)
  go/     Go port, kept in feature parity
  test/   shared cross-stack spec corpus and performance workloads
  Makefile
```

- `ts/` — source in `ts/src/`, tests in `ts/test/`. Build and test with
  `cd ts && npm install && npm run build && npm test`.
- `go/` — package `jostraca` at the module root. Build and test with
  `cd go && go build ./... && go test ./...`.
- From the repo root, `make all` builds and tests both stacks, and
  `make publish` releases both (see the Makefile).

When changing behaviour, change TypeScript first, then bring Go into
parity — TS is the source of truth. See [`CLAUDE.md`](./CLAUDE.md) for the
full contributor guide.

## License

MIT. Copyright (c) Richard Rodger.
