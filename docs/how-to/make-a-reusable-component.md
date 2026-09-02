---
description: Wrap a function with cmp so it can be called anywhere in a component tree.
group: reuse
order: 10
---

# Make a reusable component

When the same shape appears more than once, give it a name. `cmp()`
turns an ordinary function into a component: it can be called from
inside the tree, and the components it calls attach in the right place.

<!-- test: scenario reuse-cmp -->

<!-- test: run -->
```js
import { Jostraca, Project, File, Content, cmp } from 'jostraca'

const Banner = cmp(function Banner(props) {
  Content('/* ' + props.title + ' */\n')
  Content('/* generated, do not edit by hand */\n')
})

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'a.js' }, () => {
      Banner({ title: 'alpha' })
      Content('export const a = 1\n')
    })
    File({ name: 'b.js' }, () => {
      Banner({ title: 'beta' })
      Content('export const b = 2\n')
    })
  })
})
```

The generated `a.js`:

<!-- test: file out/a.js -->
```js
/* alpha */
/* generated, do not edit by hand */
export const a = 1
```

`Banner` never mentions a file, a folder, or a path. It emits content,
and its caller decides where that content lands. That is what makes it
reusable, and it is the discipline to keep: a component that calls
`File` is a section of a generator, not a building block.

Name the function you pass to `cmp()`. The wrapper keeps the name, and
`Fragment` uses it to recognise `Slot` children—an anonymous
component is harder to debug and, inside a `Fragment`, behaves
differently.

A component can also emit containers when that is what you want: a
`cmp()` that calls `Folder` and `File` works, and the callback you pass
to `generate()` may itself be a component.

## See also

- [Pass data to child components](pass-data-to-children.md) for
  components that take a body.
- [Component reference](../reference-components.md#cmp) for the call
  forms and `ctx$`.
