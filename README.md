# Jostraca

A code and project generator that uses React-style components to define
files, folders, and content declaratively.

[![npm version](https://badge.fury.io/js/jostraca.svg)](https://www.npmjs.com/package/jostraca)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/jostraca/jostraca/blob/HEAD/LICENSE)

You describe an output file tree with components—`Project`, `Folder`,
`File`, `Content`, `Fragment`, `Slot`, `Inject`, `Copy`, and more—in a
*define* phase, and Jostraca walks that tree to write the real files in a
*build* phase. Templates, slots, injections, protected regions, and
three-way merges let you regenerate over hand-edited code without
clobbering it.

**No template syntax to learn.** You have two ways to produce a file and
neither is a dialect:

- **Write code.** Components are function calls in the language you are
  already in. Iteration is `for`, branching is `if`, reuse is a
  function. Your debugger, type checker, formatter and test runner all
  still work.
- **Or fill in a file that is still valid source.** Mark the regions to
  fill, and put the marker inside the target language's own comment
  syntax. `<!-- <[SLOT:head]> -->` is valid HTML; `// <[SLOT:head]>` is
  valid Go. The template opens, highlights, formats, and lints like any
  other file of its type.

Nothing you write is a file that is valid in neither language, so no
editor needs a plugin to read it. Value substitution follows the same
rule: `$$service.port$$` sits inside a string literal or a comment,
where the host language already expects arbitrary text. It reads a value
from the model and does nothing else—no conditionals, no loops, no
expressions—so it cannot grow into a second language.

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

The documentation set lives in [`docs/`](./docs/), in four kinds of
material, each answering a different need. Start with the one that matches
what you are doing:

- **[Tutorial](./docs/tutorial.md)**—build a generator from nothing, then
  run it a second time over hand-edited output.
- **[How-to guides](./docs/how-to/README.md)**—one page per task:
  copying trees, filling template slots, injecting into files that exist,
  regenerating safely, generating in memory.
- **Reference**—[components](./docs/reference-components.md),
  [options](./docs/reference-options.md),
  [utilities](./docs/reference-utilities.md), and the
  [Go surface](./docs/reference-go.md).
- **[Explanation](./docs/explanation.md)**—the two-phase model, why
  components instead of a template dialect, and what the design costs.

[`docs/index.md`](./docs/index.md) is the doorway. Every example in those
pages is executed by `ts/test/docs.test.ts`, which runs each snippet in a
temp directory and compares the tree it wrote, so a page cannot drift from
the code without failing the build. How the pages are written is in
[`docs/STYLE-GUIDE.md`](./docs/STYLE-GUIDE.md).

The same set is rendered at [jostraca.org](https://jostraca.org), which
holds no second copy: the site syncs these files.

## Repository layout

```
jostraca/
  ts/     canonical TypeScript package (published to npm as `jostraca`)
  go/     Go port, kept in feature parity
  test/   shared cross-stack spec corpus and performance workloads
  Makefile
```

- `ts/`—source in `ts/src/`, tests in `ts/test/`. Build and test with
  `cd ts && npm install && npm run build && npm test`.
- `go/`—package `jostraca` at the module root. Build and test with
  `cd go && go build ./... && go test ./...`.
- From the repo root, `make all` builds and tests both stacks, and
  `make publish` releases both (see the Makefile).

When changing behaviour, change TypeScript first, then bring Go into
parity—TS is the source of truth.

## License

MIT. Copyright (c) Richard Rodger.
