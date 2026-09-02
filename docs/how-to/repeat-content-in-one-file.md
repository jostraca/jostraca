---
description: Emit one block of content per array item inside a single file, with List.
group: compose
order: 30
---

# Repeat content inside one file

When the repetition is *inside* a file rather than across files, `List`
emits one block per item.

<!-- test: scenario compose-list -->

<!-- test: run -->
```js
import { Jostraca, Project, File, Content, List } from 'jostraca'

const users = [
  { name: 'Alice', role: 'admin' },
  { name: 'Bob', role: 'user' },
]

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'users.txt' }, () => {

      List({ item: users, line: false }, ({ replace }) => {
        Content({ src: '{item.name}: {item.role}\n', replace })
      })
    })
  })
})
```

The generated `users.txt`:

<!-- test: file out/users.txt -->
```text
Alice: admin
Bob: user
```

Two things in that call are easy to get wrong, and both fail quietly.

**`replace` must be threaded through the props form.** The `{item.…}`
substitution arrives in the `replace` object the child is handed, and
`Content`'s second positional argument is *children*, not props. So
`Content('{item.name}', {replace})` substitutes nothing and writes the
marker text verbatim. Use `Content({src: …, replace})`.

**`line: false` turns off the trailing newline.** By default `List`
emits one after the whole list, and only the exact value `false`
disables it—`line: 0` still emits.

`{item.path}` resolves with the same path grammar as `getx`, so
`{item.a.b}` works. It cannot address a `$`-suffixed key, though, so
`{item.val$}`, `{item.key$}` and `{item.index$}` all come out empty.
For a list of scalars, or when you want the index, use the `item`
argument directly:

<!-- test: run -->
```js
import { Jostraca, Project, File, Content, List } from 'jostraca'

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'flags.txt' }, () => {
      List({ item: ['alpha', 'beta'], line: false }, ({ item }) => {
        Content('--' + item.val$ + '=' + item.index$ + '\n')
      })
    })
  })
})
```

The generated `flags.txt`:

<!-- test: file out/flags.txt -->
```text
--alpha=0
--beta=1
```

An unresolved `{item.nope}` yields the empty string, unlike `$$nope$$`,
which is left in place. That asymmetry is a trap when a property name
changes: the marker vanishes rather than shouting.

## See also

- [Branch and loop in a generator](branch-and-loop.md) when the
  repetition spans files.
- [Component reference](../reference-components.md#list).
