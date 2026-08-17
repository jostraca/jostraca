# jostraca

A code and project generator that uses React-style components to define
files, folders, and content declaratively. This is the canonical
TypeScript implementation, published to npm as
[`jostraca`](https://www.npmjs.com/package/jostraca). (A feature-parity Go
port lives at [`github.com/jostraca/jostraca/go`](https://pkg.go.dev/github.com/jostraca/jostraca/go).)

[![npm version](https://badge.fury.io/js/jostraca.svg)](https://www.npmjs.com/package/jostraca)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/jostraca/jostraca/blob/master/LICENSE)

```bash
npm install jostraca
```

Peer dependencies (install the ones your usage needs):

```bash
npm install memfs shape
```

`memfs` backs in-memory generation; `shape` backs option validation. Both
are loose ranges (`memfs >=4`, `shape >=10`).

---

This README is organised along the four [Diátaxis](https://diataxis.fr)
documentation modes. Jump to the one that fits what you need right now:

- **[Tutorial](#tutorial)** — learning-oriented. Build your first
  generator from scratch.
- **[How-to guides](#how-to-guides)** — task-oriented. Recipes for
  specific jobs.
- **[Reference](#reference)** — information-oriented. Every component,
  option, and utility.
- **[Explanation](#explanation)** — understanding-oriented. How and why
  Jostraca works the way it does.

---

## Tutorial

*A short lesson. Follow it top to bottom and you'll have a working
generator.*

### 1. A first file tree

Create a generator, then describe a tree of components. Nesting the
components mirrors the folders and files you want on disk.

```typescript
import { Jostraca, Project, Folder, File, Content } from 'jostraca'

const jostraca = Jostraca()

await jostraca.generate({ folder: './out' }, () => {
  Project({ folder: 'my-app' }, () => {

    Folder({ name: 'src' }, () => {
      File({ name: 'index.js' }, () => {
        Content('console.log("hello world")\n')
      })
    })

    File({ name: 'package.json' }, () => {
      Content('{ "name": "my-app" }\n')
    })
  })
})
```

Run it, and Jostraca writes:

```
out/
  my-app/
    src/
      index.js       -> console.log("hello world")
    package.json     -> { "name": "my-app" }
```

You declared a tree; Jostraca built it. That is the whole model.

### 2. Insert values with a template

Real generators produce files that vary with input data. Pass a `model`
to `Jostraca()` and reference it in content with `$$path$$`:

```typescript
const jostraca = Jostraca({
  model: { app: { name: 'Acme', version: '1.0.0' } }
})

await jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'config.txt' }, () => {
      Content('App: $$app.name$$ v$$app.version$$\n')
    })
  })
})
// out/config.txt -> App: Acme v1.0.0
```

### 3. Make a reusable component

When a shape repeats, capture it with `cmp()` — a plain function that
emits content. This is the "React-style" part: components compose.

```typescript
import { cmp, Content, each } from 'jostraca'

const FunctionDef = cmp(function FunctionDef(props: any) {
  Content(`function ${props.name}(`)
  Content(props.params.join(', '))
  Content(') {\n')
  each(props.ctx$.model.body, (line) => Content(`  ${line}\n`))
  Content('}\n')
})

File({ name: 'utils.js' }, () => {
  FunctionDef({ name: 'greet', params: ['name'] })
})
```

From here, the **How-to guides** below cover each capability in turn, and
the **Reference** documents every option.

## How-to guides

*Practical recipes. Each one is self-contained — read only the one you
need.*

### Read a template file and fill its slots

Use `Fragment` to read an external template, and `Slot` to replace marked
regions inside it.

```typescript
// template.html contains:
// <html>
// <!-- <[SLOT:head]> -->
// <body>
// <!-- <[SLOT:body]> -->
// </body>
// </html>

File({ name: 'index.html' }, () => {
  Fragment({ from: '/templates/template.html' }, () => {
    Slot({ name: 'head' }, () => {
      Content('<title>My Page</title>')
    })
    Slot({ name: 'body' }, () => {
      Content('<h1>Hello</h1>')
    })
  })
})
```

An unnamed `<[SLOT]>` marker receives all non-`Slot` children of the
Fragment. Giving a Fragment non-`Slot` children when its source has no
unnamed `<[SLOT]>` marker is an error — there is nowhere for that content
to go, and it would otherwise be discarded silently.

### Copy files and directories

`Copy` brings in existing files or whole directory trees, applying
template substitution to text files (binaries pass through untouched):

```typescript
const jostraca = Jostraca({ model: { title: 'My App' } })

await jostraca.generate({ folder: './out' }, () => {
  Project({ folder: 'app' }, () => {
    Folder({ name: 'static' }, () => {
      Copy({ from: '/templates/assets' })
      Copy({ from: '/templates/readme.txt', to: 'README.txt' })
    })
  })
})
```

### Edit an existing file in place

`Inject` replaces the content between two markers in a file that already
exists, leaving the rest untouched:

```typescript
// existing foo.txt:
// HEADER
// #--START--#
// old content
// #--END--#
// FOOTER

Project({}, () => {
  Inject({ name: 'foo.txt' }, () => {
    Content('new content')
  })
})
// Result: HEADER\n#--START--#\nnew content\n#--END--#\nFOOTER
```

### Regenerate without clobbering hand edits

By default Jostraca overwrites. When users edit generated files, choose a
gentler mode per file extension:

```typescript
await jostraca.generate({
  folder: './out',
  existing: {
    txt: {
      write: true,      // overwrite existing files (default)
      preserve: true,   // keep a .old. backup of what was overwritten
      present: false,   // write to .new. instead of overwriting
      diff: false,      // write an annotated 2-way diff
      merge: false,     // 3-way merge with conflict markers
    },
    bin: {
      write: true,
      preserve: false,
      present: false,
    }
  }
}, root)
```

For files a user should own outright, add the line `# JOSTRACA_PROTECT`
anywhere in the generated file — Jostraca will never overwrite it on
subsequent runs.

### Generate in memory (for tests or virtual FS)

Set `mem: true` and provide any template inputs via `vol`. Nothing touches
disk; read the result back from the returned volume:

```typescript
const jostraca = Jostraca({
  mem: true,
  vol: { '/templates/header.txt': 'HEADER\n' }
})

const result = await jostraca.generate({ folder: '/' }, root)

const files = result.vol().toJSON()
// { '/output.txt': '...' }
```

## Reference

*Information-oriented. Look things up here; don't read it front to back.*

The complete, authoritative reference for every component, prop, option,
and utility is **[REFERENCE.md](./REFERENCE.md)**.

### Components

`Project`, `Folder`, `File`, `Content`, `Fragment`, `Slot`, `Inject`,
`Copy`, `Line`, `List` — plus custom components via `cmp()`.

### `generate()` result

`generate()` returns a `JostracaResult`:

```typescript
{
  when: number,          // timestamp of generation
  files: {
    written: string[],     // files written to disk
    preserved: string[],   // backup copies created
    presented: string[],   // .new. files created
    diffed: string[],      // diff files created
    merged: string[],      // merged files created
    conflicted: string[],  // files with merge conflicts
    unchanged: string[],   // files left unchanged
  },
  audit: () => Audit[],   // audit trail of operations
  vol?: () => any,         // virtual volume (mem mode)
  fs?: () => FST,          // file system (mem mode)
}
```

### Utility exports

```typescript
import {
  each,           // iterate arrays/objects with marking and sorting
  get,            // simple dot-path property access
  getx,           // advanced path access with operators
  camelify,       // 'foo_bar' -> 'FooBar'
  snakify,        // 'FooBar' -> 'foo_bar'
  kebabify,       // 'FooBar' -> 'foo-bar'
  names,          // generate all case variants of a name
  template,       // process template strings with model data
  indent,         // indent text content
  cmp,            // create custom components
  deep,           // deep merge objects
  omap,           // map over object entries (sorted key order)
} from 'jostraca'
```

See [REFERENCE.md](./REFERENCE.md) for signatures and edge-case behaviour.

## Explanation

*Understanding-oriented. Background and design — read this to build a
mental model, not to accomplish a specific task.*

### Two phases: define, then build

A `generate()` call runs in two distinct phases. First, the **define
phase** executes your callback: every component call (`Project`, `File`,
`Content`, …) records a node in an in-memory tree — nothing is written
yet. Then the **build phase** walks that tree and performs the real file
operations. Separating the two means the whole intended output is known
before a single byte is written, which is what makes existing-file
handling, protection, and merging possible.

### Why React-style components

Components nest to mirror the filesystem, and they compose: a component is
just a function that emits more components. That gives you ordinary
language tools — loops, conditionals, parameters, reuse via `cmp()` — for
describing structure, instead of a bespoke templating dialect. The nesting
is kept noise-free by an `AsyncLocalStorage` context, so child components
know their parent without you threading it through by hand.

### The philosophy of existing files

Generators are run repeatedly against code that humans also edit. Jostraca
treats the already-on-disk file as a first-class input, not an obstacle:
the `write` / `preserve` / `present` / `diff` / `merge` modes and
`# JOSTRACA_PROTECT` exist so that regeneration is safe by policy rather
than by luck. The three-way merge in particular keeps a baseline of what
was last generated, so it can distinguish your edits from generator
changes.

---

## Build and test (contributors)

```bash
cd ts
npm install     # also pulls peer deps: memfs, shape
npm run build   # tsc --build src test
npm test        # node --test dist-test/**/*.test.js
```

From the repo root, `make all` builds and tests both the TS and Go stacks.
See the top-level [`CLAUDE.md`](../CLAUDE.md) for the full contributor
guide, and [`../go/README.md`](../go/README.md) for the Go port.

## License

MIT. Copyright (c) Richard Rodger. See [LICENSE](./LICENSE).
