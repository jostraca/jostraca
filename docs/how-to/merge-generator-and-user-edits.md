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
than a guess, existing side first as git writes them, and the path is
reported in `result.files.conflicted`. Check that array and fail the
run if it is non-empty; a conflicted file is not a finished file.

To have Jostraca fail the run instead, set `conflict: 'fail'`:

<!-- test: skip an option fragment; the full run is in the options reference -->
```js
existing: { txt: { merge: true, conflict: 'fail' } }
```

A file the merge cannot land is then left as it was, every other file
is written, and `generate` rejects with an error naming each file. That
suits a build or CI job, where markers in a file are worse than a
failed run. The
[options reference](../reference-options.md#conflict-fail) has the
whole run.

A merge needs the previous generate as its base, kept under
`.jostraca/generated/`. A file that differs from the generate and has
no base cannot be told apart from an edit, so it is listed in
`result.files.unmerged` and overwritten, or left alone with
`write: false`, or fails the run under `conflict: 'fail'`. There is no
base when:

- **`control.duplicate: false`.** No baseline is kept.
- **The repository was cloned, or `.jostraca/` removed, since the last
  generate.** The baseline is git-ignored by default;
  `control.version: true` commits it.
- **The output path is outside the output folder.** No baseline is kept
  for it.

If a merge overwrote something, `unmerged` is where to look.

A checkout or a branch switch that puts an older generate back is
handled: a file whose bytes match one of its earlier generates takes the
new generate whole, rather than having the older lines kept as edits.

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
