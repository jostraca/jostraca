---
description: Bring an existing file or directory tree into the output, templating text on the way.
group: files
order: 10
---

# Copy a directory into the output

`Copy` brings in a file or a whole tree. Text files pass through the
template system, so `$$path$$` works in copied content; binaries are
copied byte for byte.

<!-- test: scenario files-copy -->

The source tree is under `tpl/`. A templated asset, `tpl/assets/logo.svg`:

<!-- test: input tpl/assets/logo.svg -->
```html
<svg><!-- $$title$$ --></svg>
```

Something a level deeper, `tpl/assets/style/site.css`:

<!-- test: input tpl/assets/style/site.css -->
```css
body { font-family: sans-serif; }
```

And a single file to rename, `tpl/readme.txt`:

<!-- test: input tpl/readme.txt -->
```text
# $$title$$
```

<!-- test: run -->
```js
import { Jostraca, Project, Folder, Copy } from 'jostraca'

const jostraca = Jostraca({ model: { title: 'My App' } })

await jostraca.generate({ folder: './out' }, () => {
  Project({ folder: 'app' }, () => {

    Folder({ name: 'static' }, () => {
      Copy({ from: './tpl/assets' })
    })

    Copy({ from: './tpl/readme.txt', to: 'README.txt' })
  })
})
```

<!-- test: out -->
```text
app/README.txt
app/static/logo.svg
app/static/style/site.css
```

The tree keeps its shape, and `$$title$$` was substituted in
`logo.svg`:

<!-- test: file out/app/static/logo.svg -->
```html
<svg><!-- My App --></svg>
```

`to` renames a single file and names a subfolder for a directory. Both
may contain slashes.

The one asymmetry to remember: **a relative `from` resolves against the
process working directory**, not against the output folder the way
`Fragment`'s `from` does. In a generator you publish, build an absolute
path from `import.meta.url` rather than relying on where the user
happened to be standing.

Text or binary is decided by the extension first, against a fixed list
of around 250. Because no such list is complete, the content is then
sniffed: a NUL byte in the first 8192 promotes an unlisted file to
binary, which is what keeps `.wasm` and extensionless files intact.

## See also

- [Skip files when copying](skip-files-when-copying.md).
- [Component reference](../reference-components.md#copy) for every
  prop.
