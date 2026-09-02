---
description: Swap named placeholders in a template for strings, computed values or generated components.
group: templates
order: 30
---

# Replace markers in a template

`$$path$$` covers values that live in the model. For everything else—a
name computed at generate time, a whole block of generated code—pass
a `replace` map. It works on `Fragment`, `Content` and `Copy`.

<!-- test: scenario replace -->

The template is `tpl/class.js`:

<!-- test: input tpl/class.js -->
```js
export class CLASS_NAME {
  // #Body
}
```

<!-- test: run -->
```js
import { Jostraca, Project, File, Fragment, Content } from 'jostraca'

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'widget.js' }, () => {

      Fragment({
        from: '../tpl/class.js',
        replace: {
          CLASS_NAME: 'Widget',
          '#Body': () => Content('    return 1\n'),
        },
      })
    })
  })
})
```

The generated `widget.js`:

<!-- test: file out/widget.js -->
```js
export class Widget {
    return 1
}
```

Two different key forms did the work there, and the difference matters:

- **A plain key is matched literally.** `CLASS_NAME` replaced the text
  wherever it appeared.
- **A key starting `#` is a comment tag.** `'#Body'` matched the whole
  line `// #Body`, indentation included, and replaced it. Writing
  `#Body` bare in the template would not have matched.

A key wrapped in slashes is a regular expression: `'/name_\\w+/'`. A
function value receives the named capture groups, the whole match under
`$&`, and the current `indent`.

One asymmetry to know before you rely on it. A replacement that **emits
a component** lands in the right place inside a `Fragment`, which
streams its output, but is appended after the whole string inside a
`Content`, which joins first. Where position matters, use `Fragment`—or
return a string.

## See also

- [Utilities reference](../reference-utilities.md#template) for the
  full `replace` grammar.
- [Fill a template file's slots](fill-a-template-slot.md) for regions
  big enough to deserve a name.
