# jostraca

A code and project generator. You describe an output file tree with
components—`Project`, `Folder`, `File`, `Content` and the rest—inside a
callback, and Jostraca writes the tree to disk. The callback runs first and
touches nothing; only then does the build phase write files. That split is why
a second run over code somebody has edited by hand can preserve, present, diff
or merge instead of overwriting.

**No template syntax to learn.** Either write code—iteration is `for`,
branching is `if`, reuse is a function—or mark up a file that is still valid
source, with the marker inside the target language's own comment syntax, so
`<!-- <[SLOT:head]> -->` stays valid HTML and `// <[SLOT:head]>` stays valid
Go. The template opens, highlights, formats, and lints like any other file
of its type. `$$path$$` substitutes a model value and does nothing else: no
conditionals, no loops, no expressions.

This is the canonical TypeScript implementation, published to npm as
[`jostraca`](https://www.npmjs.com/package/jostraca). A feature-parity Go port
lives at
[`github.com/jostraca/jostraca/go`](https://pkg.go.dev/github.com/jostraca/jostraca/go).

[![npm version](https://badge.fury.io/js/jostraca.svg)](https://www.npmjs.com/package/jostraca)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/jostraca/jostraca/blob/HEAD/LICENSE)

```bash
npm install jostraca
```

`shape` is the only peer dependency, and npm installs it for you. It
validates options, on a loose range (`shape >=11`). In-memory generation is
served by an in-repo filesystem (`src/util/memfs.ts`), so nothing else is
installed for it.

## A generator, end to end

```js
import { Jostraca, Project, Folder, File, Content } from 'jostraca'

const jostraca = Jostraca({ model: { app: { name: 'acme' } } })

await jostraca.generate({ folder: './out' }, () => {
  Project({ folder: 'acme' }, () => {

    File({ name: 'package.json' }, () => {
      Content('{ "name": "$$app.name$$" }\n')
    })

    Folder({ name: 'src' }, () => {
      File({ name: 'index.js' }, () => {
        Content('console.log("$$app.name$$")\n')
      })
    })
  })
})
```

Run it and `out/acme/` holds `package.json` and `src/index.js`, with
`$$app.name$$` replaced from the model.

## Documentation

The documentation set lives in
[`docs/`](https://github.com/jostraca/jostraca/tree/HEAD/docs) at the
repository root, and is rendered at [jostraca.org](https://jostraca.org). It
follows [Diátaxis](https://diataxis.fr):

- **[Tutorial](https://github.com/jostraca/jostraca/blob/HEAD/docs/tutorial.md)**. Build a generator from nothing, then run it again over hand-edited output.
- **[How-to guides](https://github.com/jostraca/jostraca/blob/HEAD/docs/how-to/README.md)**. One page per task.
- **Reference**—
  [components](https://github.com/jostraca/jostraca/blob/HEAD/docs/reference-components.md),
  [options](https://github.com/jostraca/jostraca/blob/HEAD/docs/reference-options.md),
  [utilities](https://github.com/jostraca/jostraca/blob/HEAD/docs/reference-utilities.md).
- **[Explanation](https://github.com/jostraca/jostraca/blob/HEAD/docs/explanation.md)**. The two-phase model, and what it costs.

Every example in those pages is executed by `ts/test/docs.test.ts`, which runs
each snippet in a temp directory and compares the tree it wrote.

## Build and test

```bash
cd ts
npm install     # also pulls the peer dep: shape
npm run build   # tsc --build src test
npm test        # node --test dist-test/**/*.test.js
```

From the repository root, `make all` builds and tests both the TypeScript and
Go stacks. See
[`CLAUDE.md`](https://github.com/jostraca/jostraca/blob/HEAD/CLAUDE.md) for
the contributor guide and
[`go/README.md`](https://github.com/jostraca/jostraca/blob/HEAD/go/README.md)
for the port.

## License

MIT. Copyright (c) Richard Rodger. See [LICENSE](./LICENSE).
