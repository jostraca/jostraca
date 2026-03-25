# jostraca

A code and project generator that uses React-style components to define
files, folders, and content declaratively.

[![npm version](https://badge.fury.io/js/jostraca.svg)](https://www.npmjs.com/package/jostraca)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/jostraca/jostraca/blob/master/LICENSE)


## Overview

Jostraca lets you compose a file tree using components — `Project`,
`Folder`, `File`, `Content`, `Fragment`, `Copy`, and more. You describe
the output structure in a define phase, then Jostraca builds the actual
files in a build phase. Templates, slots, injections, 3-way merges, and
custom components give you fine-grained control over generated output.


## Install

```bash
npm install jostraca
```

Peer dependencies:

```bash
npm install jsonic memfs
```


## Quick Start

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

This generates:

```
out/
  my-app/
    src/
      index.js       -> console.log("hello world")
    package.json     -> { "name": "my-app" }
```


## Template Substitution

Use `$$path$$` syntax to insert values from the model:

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
// config.txt -> App: Acme v1.0.0
```


## Fragments and Slots

Read external template files with `Fragment`, and replace marked regions
with `Slot`:

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

Unnamed `<[SLOT]>` markers receive all non-Slot children of the Fragment.


## Copy

Copy files and directories, applying template substitution to text files:

```typescript
const jostraca = Jostraca({
  model: { title: 'My App' }
})

await jostraca.generate({ folder: './out' }, () => {
  Project({ folder: 'app' }, () => {
    Folder({ name: 'static' }, () => {
      Copy({ from: '/templates/assets' })
      Copy({ from: '/templates/readme.txt', to: 'README.txt' })
    })
  })
})
```


## Inject

Update existing files by replacing content between markers:

```typescript
// existing foo.txt contains:
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


## Custom Components

Use `cmp()` to create reusable components:

```typescript
import { cmp, Content, each } from 'jostraca'

const FunctionDef = cmp(function FunctionDef(props: any) {
  Content(`function ${props.name}(`)
  Content(props.params.join(', '))
  Content(') {\n')
  each(props.ctx$.model.body, (line) => Content(`  ${line}\n`))
  Content('}\n')
})

// Usage inside a File:
File({ name: 'utils.js' }, () => {
  FunctionDef({ name: 'greet', params: ['name'] })
})
```


## Existing File Handling

Control how generated files interact with files that already exist:

```typescript
await jostraca.generate({
  folder: './out',
  existing: {
    txt: {
      write: true,      // Overwrite existing files (default)
      preserve: true,    // Keep .old. backup of overwritten files
      present: false,    // Write to .new. instead of overwriting
      diff: false,       // Annotated 2-way diff
      merge: false,      // 3-way merge with conflict markers
    },
    bin: {
      write: true,
      preserve: false,
      present: false,
    }
  }
}, root)
```


## Protected Files

Add `# JOSTRACA_PROTECT` to any generated file to prevent it from being
overwritten on subsequent generations. This lets users safely edit
generated files.


## In-Memory Generation

Use `mem` and `vol` for testing or virtual file systems:

```typescript
const jostraca = Jostraca({
  mem: true,
  vol: {
    '/templates/header.txt': 'HEADER\n'
  }
})

const result = await jostraca.generate({ folder: '/' }, root)

const files = result.vol().toJSON()
// { '/output.txt': '...' }
```


## Result Object

`generate()` returns a `JostracaResult`:

```typescript
{
  when: number,          // Timestamp of generation
  files: {
    written: string[],     // Files written to disk
    preserved: string[],   // Backup copies created
    presented: string[],   // .new. files created
    diffed: string[],      // Diff files created
    merged: string[],      // Merged files created
    conflicted: string[],  // Files with merge conflicts
    unchanged: string[],   // Files unchanged
  },
  audit: () => Audit[],   // Audit trail of operations
  vol?: () => any,         // Virtual volume (mem mode)
  fs?: () => FST,          // File system (mem mode)
}
```


## Utility Functions

Jostraca exports several utility functions for working with names,
templates, and data:

```typescript
import {
  each,           // Iterate arrays/objects with marking and sorting
  get,            // Simple dot-path property access
  getx,           // Advanced path access with operators
  camelify,       // 'foo_bar' -> 'FooBar'
  snakify,        // 'FooBar' -> 'foo_bar'
  kebabify,       // 'FooBar' -> 'foo-bar'
  names,          // Generate all case variants of a name
  template,       // Process template strings with model data
  indent,         // Indent text content
  cmp,            // Create custom components
  deep,           // Deep merge objects
} from 'jostraca'
```

See [REFERENCE.md](REFERENCE.md) for full details on every component,
option, and utility function.


## License

MIT. Copyright (c) Richard Rodger.

## Go Port

A Go template utility port is available under [`go/`](./go), using `github.com/rjrodger/shape/go` from release `go/v0.1.0`.
