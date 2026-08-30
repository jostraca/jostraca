---
description: Keep editor backups, caches and named paths out of a copied tree.
group: files
order: 20
---

# Skip files when copying

Two mechanisms, and they do different jobs. `cmp.Copy.ignore` matches
**names** anywhere in the tree; `exclude` matches **paths** relative to
the copied source root.

<!-- test: scenario files-skip -->

The source holds the file worth copying, `tpl/src/app.js`:

<!-- test: input tpl/src/app.js -->
```js
export const app = 1
```

an editor backup beside it, `tpl/src/app.js~`:

<!-- test: input tpl/src/app.js~ -->
```text
an editor backup
```

something internal, `tpl/src/notes.md`:

<!-- test: input tpl/src/notes.md -->
```text
internal notes
```

and a cache directory, `tpl/src/.cache/blob.txt`:

<!-- test: input tpl/src/.cache/blob.txt -->
```text
cached
```

<!-- test: run -->
```js
import { Jostraca, Project, Copy } from 'jostraca'

const jostraca = Jostraca({
  cmp: { Copy: { ignore: [/^\.cache$/] } },
})

await jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    Copy({ from: './tpl/src', exclude: ['notes.md'] })
  })
})
```

<!-- test: out -->
```text
app.js
```

Three rules were in play:

- **`app.js~` went without being asked.** Names ending `~` or
  `-jostraca-off` are always skipped, whatever you configure. That rule
  cannot be turned off, and it applies to directories too.
- **`.cache/` was pruned by `cmp.Copy.ignore`.** The list holds regular
  expressions matched against the bare entry name, so naming a
  directory removes its whole subtree.
- **`notes.md` was dropped by `exclude`.** That one is matched against
  the path relative to the copied source root, however deep in the
  output tree the `Copy` sits.

Two traps in `exclude`. String entries are compared exactly, so
`'./a.txt'` does **not** match `a.txt`. And a boolean is accepted and
does nothing at all: `exclude: true` copies everything.

`cmp.Copy.ignore` merges over the built-in default index by index, so a
list of your own replaces the default's first entry. That costs nothing
in practice, because the `~` rule is hard-coded as well.

## See also

- [Copy a directory into the output](copy-a-directory.md).
- [Options reference](../reference-options.md#options) for
  `cmp.Copy.ignore`.
