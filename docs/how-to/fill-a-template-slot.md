---
description: Read a template file with Fragment and fill its marked regions with Slot.
group: templates
order: 10
---

# Fill a template file's slots

When the shape of a file is easier to read as a file than as a tree of
component calls, keep it as one. `Fragment` reads it in; `Slot` fills
the regions you marked.

<!-- test: scenario slots -->

Mark the regions in the template. Here it is `tpl/page.html`:

<!-- test: input tpl/page.html -->
```html
<!doctype html>
<html>
  <head>
    <!-- <[SLOT:head]> -->
  </head>
  <body>
    <[SLOT]>
  </body>
</html>
```

Then fill them:

<!-- test: run -->
```js
import { Jostraca, Project, File, Fragment, Slot, Content } from 'jostraca'

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'index.html' }, () => {

      Fragment({ from: '../tpl/page.html' }, () => {
        Slot({ name: 'head' }, () => Content('<title>Acme</title>'))
        Content('<h1>Acme</h1>')
      })
    })
  })
})
```

The generated `index.html`:

<!-- test: file out/index.html -->
```html
<!doctype html>
<html>
  <head>
<title>Acme</title>
  </head>
  <body>
<h1>Acme</h1>
  </body>
</html>
```

A named `<[SLOT:head]>` marker takes the `Slot` with that name. The bare
`<[SLOT]>` marker takes everything else inside the `Fragment`.

Four things to watch for:

- **`from` is relative to the output folder**, not to your script. With
  `folder: './out'`, a template beside `out/` is `'../tpl/page.html'`.
  In a generator you publish, build an absolute path from
  `import.meta.url` instead.
- **The replacement is not indented to match the marker.** The whole
  marker, decoration and all, is replaced, so the content starts at
  column zero. Pass `indent` to the `Content` where that matters.
- **A named marker with no matching `Slot` is left in the output** as
  literal text. Nothing warns you, so check the result the first time.
- **Non-`Slot` children with no bare `<[SLOT]>` marker is an error.**
  That content would have nowhere to go, and being told beats having it
  silently dropped.

The marker may be wrapped in whatever comment syntax the file uses:
`<!-- … -->`, `// …`, `/* … */`, `# …`, `-- …`, or nothing at all.

## See also

- [Replace markers in a template](replace-markers-in-a-template.md) for
  the cases where a slot is more structure than you need.
- [Extract part of a template](extract-part-of-a-template.md) to use
  one region of a bigger file.
