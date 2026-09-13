---
description: Generate from a component tree given as data, so a tool in another language can drive Jostraca through a pipe.
group: embed
order: 50
---

# Generate from a tree given as data

`generate()` takes a callback that calls components, which is no use to
a tool written in another language. `cmpTree` takes the tree as plain
data instead: `cmp` names the component, `props` is its first argument,
`children` its second.

Write the tree as `tree.json`:

<!-- test: input tree.json -->
```json
[
  {
    "cmp": "File",
    "props": { "name": "build.sh" },
    "children": [
      { "cmp": "Line", "props": { "src": "#!/bin/sh" } },
      { "cmp": "Line", "props": { "src": "sed -i \"s/$$VER$$/1/\" out" } }
    ]
  }
]
```

Then read it and generate:

<!-- test: run -->
```js
import { readFileSync } from 'node:fs'
import { Jostraca, cmpTree } from 'jostraca'

const tree = JSON.parse(readFileSync('tree.json', 'utf8'))

await Jostraca().generate({ folder: './out' }, cmpTree(tree, { raw: true }))
```

The generated `build.sh`:

<!-- test: file out/build.sh -->
```sh
#!/bin/sh
sed -i "s/$$VER$$/1/" out
```

`raw: true` is why `$$VER$$` survived. Without it `Content` and `Line`
substitute the generate model into whatever they are handed, which is
what you want when you wrote the text at the call site and wrong when
the text arrived already finished—and a rewritten `$$` costs you a
wrong file with no error and an exit code of 0. The option sets the prop
beneath each node's own, so a node that does want the model in scope
says `raw: false`.

Nothing else changes. Each node calls the same exported component a
hand-written generator calls, in the same define phase, so `dryrun`, the
existing-file modes and the run report all work as they do anywhere
else. A component you wrote yourself joins the vocabulary through
`cmpTree(tree, {cmp: {MyThing}})`.

Three rules apply to a tree that do not apply to a call site, because a
tree can say things a call site cannot: `Project.folder` may not be
absolute or hold a `..` segment, `cmp` must name a component rather than
an inherited property, and a malformed node is refused by `cmpTree`
itself rather than half way through a define phase that has already made
folders.

The repository's `tools/cmptree-gen.js` does every step here from the
command line, including a `--check <dir>` mode that generates into
memory and compares with what is committed instead of writing. The
[component reference](../reference-components.md#cmptree) covers both,
and [the props types](../reference-components.md#props-are-types) are
the prop surface to check a tree against before it gets here.
