---
description: Rewrite the target as an annotated two-way diff so a reviewer can see both versions.
group: regenerate
order: 40
---

# Show a diff instead of writing

`diff` replaces the target with an annotated two-way diff: unchanged
text passes through, and each changed region becomes a pair of marked
blocks. Nobody's version is chosen, so the file is deliberately left
unusable until a person resolves it.

The clock is pinned here so the marker labels are reproducible; in real
use they carry the run times.

<!-- test: scenario regen-diff -->

<!-- test: run -->
```js
import { writeFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({
  now: () => 1735689600000,
  existing: { txt: { diff: true } },
})

const run = (body) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => File({ name: 'config.sh' }, () => Content(body)))
})

await run('PORT=8080\nHOST=localhost\n')
writeFileSync('./out/config.sh', 'PORT=3000\nHOST=localhost\n')
await run('PORT=9090\nHOST=localhost\n')
```

The rewritten `config.sh`:

<!-- test: file out/config.sh -->
```text
<<<<<<< EXISTING: 2025-01-01T00:00:00.000Z/diff
PORT=3000
>>>>>>> EXISTING: 2025-01-01T00:00:00.000Z/diff
<<<<<<< GENERATED: 2025-01-01T00:00:00.000Z/diff
PORT=9090
>>>>>>> GENERATED: 2025-01-01T00:00:00.000Z/diff
HOST=localhost
```

Two details that differ from the merge markers, and from the git
convention they resemble:

- **The existing side comes first**, and there is **no `=======`
  separator**. Each side gets its own opening and closing marker.
- **`diff` beats `write`.** It forces the write off, so you do not need
  `write: false` the way `present` does.

`diff` and `merge` are mutually exclusive, and `diff` wins. A diffed
file whose content changed is always reported in
`result.files.conflicted` as well as `result.files.diffed`.

Reach for `diff` when you want a person to look, and `merge` when you
want the machine to try first.

## See also

- [Merge your changes with the user's](merge-generator-and-user-edits.md).
- [Options reference](../reference-options.md#each-mode) for both
  marker layouts side by side.
