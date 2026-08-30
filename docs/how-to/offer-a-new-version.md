---
description: Leave the existing file untouched and write the new version beside it with present.
group: regenerate
order: 20
---

# Offer a new version instead of overwriting

`present` writes the new version to a `.new` sibling and leaves the
existing file exactly as it is. The user decides.

**`present` needs `write: false`.** The flags are checked in order and
`write` is checked first, so `present: true` on its own does nothing at
all and the file is overwritten. This is the single easiest way to
misconfigure regeneration:

<!-- test: scenario regen-present -->

<!-- test: run -->
```js
import { appendFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({
  existing: { txt: { write: false, present: true } },
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
config.new.sh
config.sh
```

`config.sh` is untouched:

<!-- test: file out/config.sh -->
```text
PORT=8080
DEBUG=1
```

and `config.new.sh` holds what the generator wanted to write:

<!-- test: file out/config.new.sh -->
```text
PORT=9090
```

The run reports these paths in `result.files.presented`, so a wrapper
command can list them and tell the user what is waiting.

`present` is also the one mode that still acts on a file the user has
taken over with `JOSTRACA_PROTECT`: the protected file keeps its bytes,
and the `.new` sidecar is still written. That is deliberate — somebody
who has taken a file over may still want to see what they are
declining.

## See also

- [Let a user take a file over](let-a-user-take-a-file-over.md).
- [Show a diff instead of writing](show-a-diff-instead-of-writing.md)
  when the difference matters more than the new version.
