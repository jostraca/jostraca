---
description: Declare folders and files with nested components, and know which props move the output path.
group: compose
order: 10
---

# Write a file tree

Nest `Project`, `Folder` and `File` to mirror the tree you want. Each
component's callback runs inline, so the nesting in your source is the
nesting on disk.

<!-- test: scenario tree -->

<!-- test: run -->
```js
import { Jostraca, Project, Folder, File, Content } from 'jostraca'

await Jostraca().generate({ folder: './out' }, () => {
  Project({ folder: 'acme-api' }, () => {

    File({ name: 'package.json' }, () => Content('{}\n'))

    Folder({ name: 'src' }, () => {
      File({ name: 'index.js' }, () => Content('// entry\n'))

      Folder({ name: 'routes' }, () => {
        File({ name: 'health.js' }, () => Content('// health\n'))
      })
    })
  })
})
```

<!-- test: out -->
```text
acme-api/package.json
acme-api/src/index.js
acme-api/src/routes/health.js
```

Only two props move the path: `Project`'s `folder` and `Folder`'s
`name`. `Project`'s `name` adds nothing to it — it is there for
`File.exclude` matching, and using it where you meant `folder` produces
a flat tree with no error.

A slash inside a name works, so `File({name: 'src/index.js'})` creates
the directory on the way. Use it for a one-off; nest `Folder` when more
than one file shares the directory.

Two more rules to keep in mind:

- `Folder({})` with no name adds no segment. That makes it a grouping
  container, useful for applying one `each` loop to a set of files that
  belong at the same level.
- Do not nest `File` inside `File`. The inner one takes over as the
  current file and never gives it back, so the outer file's content is
  written to the inner file's path and the outer file never appears.

## See also

- [Component reference](../reference-components.md) for every prop.
- [Insert values from your model](insert-model-values.md) to make the
  content vary.
