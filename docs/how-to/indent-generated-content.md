---
description: Indent a block of generated content to match the code around it.
group: templates
order: 40
---

# Indent generated content

Generated code that lands at column zero inside a nested block is
correct and unreadable. `Content`, `Line` and `Fragment` all take an
`indent` prop: a number of spaces, or a literal prefix string.

<!-- test: scenario indent -->

<!-- test: run -->
```js
import { Jostraca, Project, File, Content } from 'jostraca'

const body = 'const a = 1\nconst b = 2\n'

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'fn.js' }, () => {
      Content('export function go() {\n')
      Content({ src: body, indent: 2 })
      Content('}\n')
    })
  })
})
```

The generated `fn.js`:

<!-- test: file out/fn.js -->
```js
export function go() {
  const a = 1
  const b = 2
}
```

`indent` applies to every line start in the block, so a multi-line
string arrives already aligned. A string value is used verbatim, which
covers tabs and comment prefixes: `indent: '\t'`, or `indent: '// '` to
comment a block out.

Two edges to know:

- **A blank line inside the block is indented too**, which leaves
  trailing whitespace on it. Strip it afterwards if your linter cares.
- **A trailing newline gets nothing appended after it**, so the block
  ends cleanly rather than with a stray indent.

Inside a `List`, `indent` is passed to each child rather than applied by
the list itself. The child has to forward it:

<!-- test: run -->
```js
import { Jostraca, Project, File, Content, List } from 'jostraca'

const items = [{ name: 'alpha' }, { name: 'beta' }]

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'list.txt' }, () => {
      List({ item: items, indent: 2, line: false }, ({ replace, indent }) => {
        Content({ src: '{item.name}\n', replace, indent })
      })
    })
  })
})
```

The generated `list.txt`:

<!-- test: file out/list.txt -->
```text
  alpha
  beta
```

## See also

- [Utilities reference](../reference-utilities.md#indent) for the
  standalone `indent` function.
