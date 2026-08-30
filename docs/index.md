# Jostraca documentation

Jostraca is a code and project generator. You describe an output file
tree with components — `Project`, `Folder`, `File`, `Content` and the
rest — inside a callback, and Jostraca writes the tree to disk. The
callback runs first and touches nothing: it records an in-memory node
tree. Only then does the build phase write files. That split is why a
second run over code somebody has edited by hand has choices rather
than a single destructive default.

This repository ships **two implementations kept in parity**:

- **TypeScript** in [`../ts/`](../ts/) — the canonical implementation,
  published to npm as [`jostraca`](https://www.npmjs.com/package/jostraca).
- **Go** in [`../go/`](../go/) — a port
  (`github.com/jostraca/jostraca/go`) that aims at byte-identical
  output for the same logical input.

Both are checked against one language-neutral corpus in
[`../test/spec/`](../test/spec/), and every example in these pages is
executed by `ts/test/docs.test.ts`: each snippet runs in a temp
directory and the pages state the tree it actually wrote.

## How this documentation is organised

The documentation is split by **what you are trying to do** when you
open it. Reach for the part that matches your need:

| If you want to… | Read |
|---|---|
| **Learn** Jostraca from zero by building a generator, step by step | [Tutorial](tutorial.md) |
| **Accomplish a specific task** you already have in mind | [How-to guides](how-to/README.md) |
| **Look up** a component, a prop, an option or a utility | [Components](reference-components.md) · [Options](reference-options.md) · [Utilities](reference-utilities.md) · [Go](reference-go.md) |
| **Understand** how and why Jostraca works the way it does | [Explanation](explanation.md) |

The how-to guides are one page per task, grouped six ways: composing
the output tree; templates and fragments; reusable components;
regenerating over existing files; files, copying and permissions; and
embedding Jostraca in your own tool.

## The parts, in one place

**The components.** `Project` roots a generated tree, `Folder` and
`File` build the path, `Content` and `Line` put text in a file.
`Fragment` reads a template file from disk and `Slot` fills the marked
regions inside it. `Copy` brings in a file or a whole directory,
templating text on the way through. `Inject` edits between markers in a
file that already exists. `List` emits one block per array item.
Anything else is a function you write and wrap with `cmp()`. Each is
specified in the [component reference](reference-components.md).

**The model and the template syntax.** Pass a `model` to `Jostraca()`
and `$$path$$` inside content substitutes the value at that path. The
syntax has no conditionals, loops or expressions, and that is the whole
design: the surrounding code is a programming language already. The
[utilities reference](reference-utilities.md) documents `template()`
and the `replace` map for the cases the plain form cannot reach.

**The existing-file modes.** `write` overwrites, `preserve` keeps the
old bytes in a sibling file, `present` writes the new version beside an
untouched original (it needs `write: false`, which is checked first),
`diff` writes an annotated two-way diff, and `merge` performs a
three-way merge against the previous generate. A file containing
`JOSTRACA_PROTECT` is never overwritten under any of them. The
[options reference](reference-options.md) specifies each; the
[regenerating guides](how-to/README.md) show them in use.

**In-memory generation.** `mem: true` runs the whole thing on a virtual
filesystem, which is how you test a generator without a temp directory.
See [generate in memory](how-to/generate-in-memory.md).

## For contributors

- [The style guide](STYLE-GUIDE.md) — how these pages are written:
  Diátaxis placement, the voice, the banned-phrase list, and the
  snippet directives under which every example runs.
- [`../CLAUDE.md`](../CLAUDE.md) — the contributor guide: layout, build
  and test commands, and the rule that TypeScript is the source of
  truth.
- [`../test/spec/`](../test/spec/) — the shared corpus. A change to any
  pure helper adds a row there rather than a case in one stack's suite.
- [`../go/PORT_PLAN.md`](../go/PORT_PLAN.md) — how the Go port was
  built and what it decided.

If a page here is wrong, it is wrong in this repository. Fix it here;
[jostraca.org](https://jostraca.org) renders these files rather than
holding a second copy of them.
