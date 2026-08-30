---
description: Run the whole generator with control.dryrun so it reports what it would do and writes nothing.
group: regenerate
order: 60
---

# Preview a run without writing

`control.dryrun` guards every write while letting everything else
happen. The decision tree runs, the result arrays fill in, the audit is
recorded — and the filesystem is not touched, not even to create the
`.jostraca` folder.

Set it on the `generate()` call. A global `control` is ignored, which
is a defect worth knowing rather than a design.

<!-- test: scenario regen-dryrun -->

<!-- test: run -->
```js
import { existsSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca()

const res = await jostraca.generate({
  folder: './out',
  control: { dryrun: true },
}, () => {
  Project({ folder: 'app' }, () => {
    File({ name: 'a.txt' }, () => Content('A\n'))
    File({ name: 'b.txt' }, () => Content('B\n'))
  })
})

console.log(JSON.stringify(res.files.written))
console.log('out exists:', existsSync('./out'))
```

<!-- test: log -->
```text
["out/app/a.txt","out/app/b.txt"]
out exists: false
```

The report is the point: `files.written` names what a real run would
write, so a wrapper command can print a plan and ask before doing it.
The other arrays are filled in the same way, so a dry run over an
existing tree tells you which files would be merged and which would
conflict.

For the narrower question "what changed since last time", generate for
real and read `files.unchanged`, which lists the files whose bytes were
already correct.

## See also

- [Report what a run did](report-what-a-run-did.md).
- [Options reference](../reference-options.md#control).
