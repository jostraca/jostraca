---
description: Run a generator on a virtual filesystem with mem, and read the result back from the volume.
group: embed
order: 10
---

# Generate in memory

`mem: true` runs the whole generate on an in-memory filesystem. Nothing
touches disk, and the result carries `vol()` so you can read back what
was written.

<!-- test: scenario embed-mem -->

<!-- test: run -->
```js
import { Jostraca, Project, Folder, File, Content } from 'jostraca'

const jostraca = Jostraca({ mem: true })

const res = await jostraca.generate({ folder: '/out' }, () => {
  Project({ folder: 'app' }, () => {
    File({ name: 'index.js' }, () => Content('// entry\n'))
    Folder({ name: 'src' }, () => {
      File({ name: 'lib.js' }, () => Content('// lib\n'))
    })
  })
})

const vol = res.vol().toJSON()
const paths = Object.keys(vol).filter((p) => !p.includes('/.jostraca/'))
console.log(JSON.stringify(paths.sort()))
console.log(JSON.stringify(vol['/out/app/index.js']))
```

<!-- test: log -->
```text
["/out/app/index.js","/out/app/src/lib.js"]
"// entry\n"
```

Use an absolute output folder in memory mode. A relative one resolves
against the process working directory, so the volume keys come back
prefixed with wherever the process happened to be.

Seed input files with `vol`, which is how a fragment or a copy source
gets there without a temp directory:

<!-- test: run -->
```js
import { Jostraca, Project, File, Fragment } from 'jostraca'

const jostraca = Jostraca({
  mem: true,
  vol: { '/tpl/header.txt': 'HEADER\n' },
})

const res = await jostraca.generate({ folder: '/out' }, () => {
  Project({}, () => {
    File({ name: 'a.txt' }, () => Fragment({ from: '/tpl/header.txt' }))
  })
})

console.log(JSON.stringify(res.vol().toJSON()['/out/a.txt']))
```

<!-- test: log -->
```text
"HEADER\n"
```

Three rules about the pairing, because they are not symmetrical:

- **`vol` without `mem` does nothing.** No virtual filesystem is built
  and the run goes to the real one. This is the mistake to check first
  when a memory-mode test writes real files.
- **A global `mem: true` with no per-call `vol` shares one volume** for
  the life of the instance, so state accumulates across `generate()`
  calls. That is useful for a two-run test and surprising otherwise.
- **A per-call `vol` forks**: it seeds a fresh volume from the global
  seed merged with yours, and that call's writes never reach the shared
  one.

The in-memory filesystem is part of jostraca. Nothing is installed for
it, and it is not a filesystem you can pass around outside a run.

**This page is TypeScript only.** The Go port's `WithMem()` and
`WithVol()` are inert: a generator configured with them runs against the
real filesystem and returns a result whose `Vol` and `FS` are `nil`,
with no error. Use `WithFS(NewMemFS())` instead, and seed it by writing
into the provider before generating. The [Go
reference](../reference-go.md#withmem-and-withvol-do-nothing) shows
both.

## See also

- [Test a generator](test-a-generator.md) for the pattern this enables.
- [Options reference](../reference-options.md#in-memory-generation).
