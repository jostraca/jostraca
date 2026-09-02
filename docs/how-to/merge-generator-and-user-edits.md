---
description: Three-way merge the new generate with hand edits, using the previous run as the base.
group: regenerate
order: 30
---

# Merge your changes with the user's

`merge` performs a three-way merge. The base is the previous generate,
which Jostraca keeps under `.jostraca/` beside the output, so anything
in the file that is not in the base is somebody's edit and anything the
generator changed since the base is yours. Both are applied.

<!-- test: scenario regen-merge -->

<!-- test: run -->
```js
import { appendFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({
  existing: { txt: { write: true, merge: true } },
})

const run = (body) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => File({ name: 'config.sh' }, () => Content(body)))
})

await run('PORT=8080\nHOST=localhost\n')
appendFileSync('./out/config.sh', 'DEBUG=1\n')
await run('PORT=9090\nHOST=localhost\n')
```

The merged `config.sh`:

<!-- test: file out/config.sh -->
```text
PORT=9090
HOST=localhost
DEBUG=1
```

Where both sides changed the same region, conflict markers go in rather
than a guess, and the path is reported in `result.files.conflicted`.
Check that array and fail the run if it is non-empty; a conflicted file
is not a finished file.

Three things will stop a merge, and all of them fall back to a plain
overwrite with no error:

- **`control.duplicate: false`.** No baseline is kept, so there is
  nothing to merge against.
- **A file that is new.** There is no previous generate.
- **An output path outside the output folder.** No baseline is kept for
  it.

If merge silently overwrote something, that list is where to look.

A merge honours a deletion. If the user removed a region your generator
did not touch, the region stays gone—the deletion is the only intent
anybody expressed about those lines. "Every generated line survives" is
not a promise Jostraca makes, and the
[explanation](../explanation.md#existing-files-and-the-merge-base) says
why not.

## See also

- [Keep a backup when overwriting](keep-a-backup-when-overwriting.md)
  for something simpler.
- [Utilities reference](../reference-utilities.md#diffutil) for the
  merge engine's own API.
