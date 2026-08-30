---
description: Give a generated script its execute bit with the File mode prop.
group: files
order: 30
---

# Make a generated script executable

A generated shell script that is not executable is a bug report waiting
to happen. Pass `mode` to `File`:

<!-- test: scenario files-mode -->

<!-- test: run -->
```js
import { statSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'run.sh', mode: 0o755 }, () => {
      Content('#!/bin/sh\necho hi\n')
    })
    File({ name: 'plain.txt' }, () => Content('hi\n'))
  })
})

const mode = (p) => (statSync(p).mode & 0o777).toString(8)
console.log('run.sh', mode('./out/run.sh'))
console.log('executable:', 0 !== (statSync('./out/run.sh').mode & 0o111))
console.log('plain.txt executable:', 0 !== (statSync('./out/plain.txt').mode & 0o111))
```

<!-- test: log -->
```text
run.sh 755
executable: true
plain.txt executable: false
```

Without `mode`, a file gets the platform default, which does not
include an execute bit.

An explicit `mode` wins over the existing file's mode when regenerating,
so changing it in the generator actually takes effect. It survives the
atomic write, which swaps the inode and would otherwise lose it, and it
is applied even when the content was unchanged and no write happened.

It applies to the target only. The `.old` and `.new` sidecars and the
merge baseline stay at the default, since those are Jostraca's
bookkeeping rather than your output.

**Windows has no POSIX permission bits.** `fs.chmod` there only toggles
the read-only attribute, so `mode: 0o755` is accepted, throws nothing,
and has no effect beyond that. Generate a `.cmd` wrapper if Windows
users need to run the thing.

## See also

- [Component reference](../reference-components.md#file).
