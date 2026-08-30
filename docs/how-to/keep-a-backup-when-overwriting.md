---
description: Turn on preserve so the bytes you are about to overwrite are kept in a sibling file.
group: regenerate
order: 10
---

# Keep a backup when overwriting

`preserve` copies the current file to a `.old` sibling before writing
the new version. It is the cheapest safety net: no merge to reason
about, and the user's work is one `mv` away.

<!-- test: scenario regen-preserve -->

<!-- test: run -->
```js
import { appendFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({
  existing: { txt: { write: true, preserve: true } },
})

const run = (body) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => File({ name: 'config.sh' }, () => Content(body)))
})

await run('PORT=8080\n')
appendFileSync('./out/config.sh', 'DEBUG=1\n')
await run('PORT=9090\n')
```

<!-- test: out -->
```text
config.old.sh
config.sh
```

`config.old.sh` holds what was on disk, edit included:

<!-- test: file out/config.old.sh -->
```text
PORT=8080
DEBUG=1
```

The suffix goes before the extension, so `config.sh` becomes
`config.old.sh` and `bundle.min.js` becomes `bundle.min.old.js`. A file
with no extension appends instead: `Makefile` becomes `Makefile.old`,
and a dotfile does the same, so `.env` becomes `.env.old`.

No backup is written when the content has not changed, so a run that
generates the same bytes leaves no `.old` files behind.

Add `write: false` to get a snapshot rather than a backup: the copy is
taken and the original is left alone.

Backups accumulate, and each run overwrites the previous one. Add
`*.old.*` to the generated project's `.gitignore` if the output is
checked in.

## See also

- [Merge your changes with the user's](merge-generator-and-user-edits.md)
  when a backup is not enough.
- [Options reference](../reference-options.md#existing) for every mode.
