---
description: Read the result arrays and the audit trail to tell a user what a generate changed.
group: embed
order: 20
---

# Report what a run did

`generate()` returns a report. A wrapper command should read it rather
than telling the user "done".

<!-- test: scenario embed-report -->

<!-- test: run -->
```js
import { writeFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({
  existing: { txt: { write: true, merge: true } },
})

const run = (a, b) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'a.txt' }, () => Content(a))
    File({ name: 'b.txt' }, () => Content(b))
  })
})

await run('one\n', 'steady\n')

// The user edits one file, and leaves the other alone.
writeFileSync('./out/a.txt', 'one\nmine\n')

const res = await run('two\n', 'steady\n')

console.log('written  ', JSON.stringify(res.files.written))
console.log('merged   ', JSON.stringify(res.files.merged))
console.log('unchanged', JSON.stringify(res.files.unchanged))
console.log('conflicts', JSON.stringify(res.files.conflicted))
```

<!-- test: log -->
```text
written   []
merged    ["out/a.txt"]
unchanged ["out/b.txt"]
conflicts ["out/a.txt"]
```

`a.txt` was merged and it conflicted: the generator changed the line
the user was writing next to, and Jostraca wrote markers rather than
guessing. `b.txt` was left alone because its bytes were already right.
Neither file appears in `written`.

Each array answers a different question:

| array | meaning |
|---|---|
| `written` | the file was written |
| `preserved` | a `.old` backup was taken |
| `presented` | a `.new` sidecar was written |
| `diffed` / `merged` | the file was rewritten by the diff or merge engine |
| `conflicted` | that rewrite left conflict markers |
| `unchanged` | the bytes were already correct, so nothing was rewritten |

`unchanged` is the one people miss. A byte-identical rewrite would bump
the mtime and re-trigger every watcher downstream, so Jostraca skips it
and records the path here instead of in `written`.

**Check `conflicted` and fail if it is non-empty.** A conflicted file
carries markers and does not compile; a wrapper that reports success
over it has told the user something false. Conflicts are commoner than
they look, because a merge works on regions rather than lines: an edit
next to a line the generator changed lands in the same region and
conflicts, as it did above.

Two paths are absent from every array: a file skipped because it
carries `JOSTRACA_PROTECT`, and a file skipped by the `exclude` option.
An empty report therefore does not always mean "nothing to do".

For the whole decision trail, call `audit()`. It returns
`[tag, data]` pairs — the filesystem calls, and one record per file
carrying its metadata and a `why` breadcrumb naming each branch the
decision took. That is the tool for "why did it do that", not for
routine reporting.

## See also

- [Preview a run without writing](preview-a-run.md).
- [Options reference](../reference-options.md#the-result).
