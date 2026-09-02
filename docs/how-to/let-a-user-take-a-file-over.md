---
description: Mark a generated file with JOSTRACA_PROTECT so no later run overwrites it.
group: regenerate
order: 50
---

# Let a user take a file over

Put the string `JOSTRACA_PROTECT` anywhere in a generated file and no
later run will overwrite it. It needs no comment syntax, no anchor and
no surrounding structure—a substring is enough, so a comment in
whatever language the file is written in works.

<!-- test: scenario regen-protect -->

<!-- test: run -->
```js
import { writeFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca()

const run = (body) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => File({ name: 'config.sh' }, () => Content(body)))
})

await run('PORT=8080\n')

// The user takes the file over.
writeFileSync('./out/config.sh', '# JOSTRACA_PROTECT\nPORT=3000\n')

const res = await run('PORT=9090\n')
console.log(JSON.stringify(res.files.written))
```

<!-- test: log -->
```text
[]
```

The file `config.sh` keeps its bytes:

<!-- test: file out/config.sh -->
```text
# JOSTRACA_PROTECT
PORT=3000
```

The check is against the file **on disk**, not against what you
generated, so this is a decision the user makes without touching your
generator. Emit the marker yourself only in files you intend people to
adopt.

Under `write`, `preserve`, `diff` and `merge` a protected file is
skipped outright and appears in none of the result arrays—not
written, not preserved, not even reported as unchanged. `present` is
the exception: the file is still not overwritten, but the `.new`
sidecar is written and the path is reported as presented.

Because a protected file appears in no array, a wrapper that reports
"nothing changed" from an empty `written` list will be wrong. Read the
audit if you need to tell the two cases apart.

## See also

- [Report what a run did](report-what-a-run-did.md) for the audit.
- [Options reference](../reference-options.md#jostraca_protect).
