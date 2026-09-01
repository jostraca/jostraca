# Reference: options and results

`Jostraca()`, `generate()`, every option, and what comes back. This page
states facts. The [tutorial](tutorial.md) teaches, and the
[how-to guides](how-to/README.md) solve named tasks.

Every example here is executed by `ts/test/docs.test.ts`. The examples
that show diff or merge markers pin the clock with `now`, because the
markers carry timestamps.

## The two calls

```
Jostraca(options?) => { generate }
generate(options, root) => Promise<JostracaResult>
```

The factory returns `{ generate }` and nothing else.

Both option objects are validated by the **same** shape. There is no
separate global-options type and no separate per-call type. An unknown
key is a hard error, not a warning:

```
Jostraca Options: Validation failed for object "{folder:/out,bogus:1}" because the property "bogus" is not allowed.
```

## Options

| option | type | default | effect |
|---|---|---|---|
| `folder` | `string` | `'.'` | Base output folder. |
| `model` | any | `{}` | The data model. Reaches components as `props.ctx$.model`, and drives `$$path$$` substitution. |
| `meta` | `object` | `{}` | Arbitrary data, reachable as `props.ctx$.meta`. Jostraca does not read it. |
| `fs` | `() => FS` | `node:fs` | Filesystem provider factory. |
| `now` | `() => number` | `Date.now` | Clock. Pin it for reproducible output. |
| `log` | `Log` | a console logger | Receives `log.debug` warnings, and nothing else. |
| `debug` | `string` | `'.'` | Must be a string; a boolean throws. Truthy makes `cmp()` stamp a callsite on each node. |
| `build` | `boolean` | `true` | Run the build phase. `false` runs define only and writes nothing. |
| `mem` | `boolean` | — | Generate onto an in-memory filesystem. |
| `vol` | `object` | — | Seed for the in-memory filesystem. Does nothing without `mem`. |
| `existing` | `{txt, bin}` | see below | What to do with a file that already exists. |
| `control` | `{dryrun, duplicate, version}` | see below | See [Control](#control). |
| `cmp.Copy.ignore` | `RegExp[]` | `[/~$/]` | Extra names for `Copy` to skip. |
| `exclude` | `boolean` | `false` | Skip output files modified since the last build. |

`debug` is worth a note. Its shape declares `'info'` as an example
value, not as a default, so nothing sets it when you omit it and the
fallback is the string `'.'` — which is truthy. Debug callsite stamping
is therefore **on** by default.

### Options that exist and do nothing

`name.file.prefix`, `name.file.suffix`, `name.folder.prefix`,
`name.folder.suffix` and `name.exclude` validate, and no code reads
them. They are declared against a `// TODO: implement` in the source.
Setting them has no effect anywhere.

`Fragment`'s `exclude` prop is the same kind of dead end; see the
[component reference](reference-components.md#fragment).

## How per-call options override global ones

**The rule differs per option, and three of them ignore the global
value entirely.** This is the part most likely to surprise you, so it
is a table rather than a sentence:

| option | rule | global honoured when the call omits it? |
|---|---|---|
| `folder` | per-call wins, else global, else `'.'` | yes |
| `fs` | per-call wins, else global, else `node:fs` | yes |
| `now` | per-call wins, else global, else `Date.now` | yes |
| `log`, `debug` | per-call wins, else global, else the default | yes |
| `mem` | per-call wins if present, else global | yes |
| `vol` | omitted: the global volume. Present: a deep merge of global then per-call, in a **new** volume | yes, as a union |
| `meta` | shallow spread, per-call keys win | yes, merged |
| `model` | per-call **replaces** wholesale | yes, replaced rather than merged |
| `existing.txt` / `existing.bin` | deep merge, per key | yes |
| `cmp` | deep merge over the built-in default | yes |
| `build` | — | **no. The global value is silently ignored.** |
| `control.*` | — | **no. The global value is silently ignored.** |
| `exclude` | — | **no. The global value is silently ignored.** |

The cause is one asymmetry in the shape. Keys declared as optional are
simply absent when you omit them, so the `null ==` test that falls back
to the global works. Keys with a materialised default (`build`,
`control`, `exclude`) are **never** absent from the per-call object, so
the fallback never fires and the per-call default wins over your global
setting.

Set `build`, `control` and `exclude` on the `generate()` call.

## The result

```
{
  when,       // number: now() sampled once, at the start of the build
  files: {
    written,     // paths written
    preserved,   // paths that got a .old backup
    presented,   // paths that got a .new sidecar
    diffed,      // paths rewritten as a two-way diff
    merged,      // paths rewritten by three-way merge
    conflicted,  // of those, the ones carrying conflict markers
    unchanged,   // byte-identical, so not rewritten
  },
  audit,      // () => [tag, data][]
  vol,        // () => Volume  -- only when an in-memory fs was built
  fs,         // () => FS      -- only when an in-memory fs was built
}
```

`when` is the *start* stamp, not the end.

Paths in `files` are folder-prefixed and forward-slashed, exactly as
they were passed to the writer — not relative to the output folder. A
relative `folder` keeps them relative.

`files.unchanged` means byte-identical and therefore not rewritten. A
byte-identical rewrite would bump the mtime and re-trigger every
watcher downstream, so Jostraca skips it and records the path here
instead of in `written`. An explicit `File` `mode` is still applied.

`vol()` and `fs()` are present only when an in-memory filesystem was
constructed, and in two configurations one of them can mislead:

- Global `mem: true` with a per-call `fs`: `fs()` is right, `vol()`
  returns the untouched global volume.
- Global `mem: true` with per-call `mem: false`: output still goes to
  the global in-memory filesystem, and both accessors are absent.

Neither is a configuration worth having. Pick one provider per
instance.

## `existing`

Two independent sets, chosen by the file's **extension**:

```
existing: {
  txt: { write, preserve, present, diff, merge },
  bin: { write, preserve, present },
}
```

`bin` has no `diff` and no `merge`; passing either throws.

The extension decides first, by membership of the
[`isbinext`](reference-utilities.md#isbinext-and-isbincontent) list, and content
sniffing can then promote an unlisted extension to binary (a NUL byte
in the first 8192). Sniffing never demotes a listed extension to text.

### The order the flags are checked

This order is the whole behaviour, and two of its consequences are not
guessable:

1. A file that **does not exist** is always written, whatever the flags
   say.
2. The existing content is read, and checked for `JOSTRACA_PROTECT`.
3. `preserve` — take the `.old` backup, unless protected.
4. `write` **else if** `present` — so **`present` does nothing unless
   `write: false`.**
5. `diff` **else if** `merge` — so **`diff` wins; they never both
   run.** `diff` also forces the write off.
6. Write, or record that the content was unchanged.
7. Refresh the merge baseline under `.jostraca/generated/`, in every
   mode including a skip.

### Each mode

The scenario below is the same throughout: generate a three-line file,
somebody edits line 2, regenerate with line 2 changed.

<!-- test: scenario existing-write -->

<!-- test: run -->
```js
import { writeFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({ now: () => 1735689600000 })

const run = (body) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => File({ name: 'a.txt' }, () => Content(body)))
})

await run('line1\nline2\nline3\n')
writeFileSync('./out/a.txt', 'line1\nUSER\nline3\n')
await run('line1\nCHANGED\nline3\n')
```

Under the default, `a.txt` is the new generate and the edit is gone:

<!-- test: file out/a.txt -->
```text
line1
CHANGED
line3
```

**`write: false`** skips an existing file outright. A file that is not
there yet is still written.

**`preserve: true`** copies the current bytes to a `.old` sibling
before overwriting. With `write: false` as well, you get a snapshot:
the backup is taken and the target is left alone.

<!-- test: scenario existing-preserve -->

<!-- test: run -->
```js
import { writeFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({
  now: () => 1735689600000,
  existing: { txt: { preserve: true } },
})

const run = (body) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => File({ name: 'a.txt' }, () => Content(body)))
})

await run('line1\nline2\nline3\n')
writeFileSync('./out/a.txt', 'line1\nUSER\nline3\n')
await run('line1\nCHANGED\nline3\n')
```

<!-- test: out -->
```text
a.old.txt
a.txt
```

`a.old.txt` holds what was on disk, edit included:

<!-- test: file out/a.old.txt -->
```text
line1
USER
line3
```

**`present: true, write: false`** leaves the target alone and writes
the new version to a `.new` sibling.

**`diff: true`** rewrites the target as an annotated two-way diff. Each
changed region becomes a pair of marked blocks, **existing side first**,
and there is **no `=======` separator**:

<!-- test: scenario existing-diff -->

<!-- test: run -->
```js
import { writeFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({
  now: () => 1735689600000,
  existing: { txt: { diff: true } },
})

const run = (body) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => File({ name: 'a.txt' }, () => Content(body)))
})

await run('line1\nline2\nline3\n')
writeFileSync('./out/a.txt', 'line1\nUSER\nline3\n')
await run('line1\nCHANGED\nline3\n')
```

The rewritten `a.txt`:

<!-- test: file out/a.txt -->
```text
line1
<<<<<<< EXISTING: 2025-01-01T00:00:00.000Z/diff
USER
>>>>>>> EXISTING: 2025-01-01T00:00:00.000Z/diff
<<<<<<< GENERATED: 2025-01-01T00:00:00.000Z/diff
CHANGED
>>>>>>> GENERATED: 2025-01-01T00:00:00.000Z/diff
line3
```

A diffed file whose content differs is always reported in
`files.conflicted` as well as `files.diffed`.

**`merge: true`** performs a three-way merge against the previous
generate. Where both sides changed the same region, markers go in —
**generated side first, with a `=======` separator**, which is the
opposite arrangement from the two-way diff:

<!-- test: scenario existing-merge -->

<!-- test: run -->
```js
import { writeFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({
  now: () => 1735689600000,
  existing: { txt: { merge: true } },
})

const run = (body) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => File({ name: 'a.txt' }, () => Content(body)))
})

await run('line1\nline2\nline3\n')
writeFileSync('./out/a.txt', 'line1\nUSER\nline3\n')
await run('line1\nCHANGED\nline3\n')
```

The merged `a.txt`:

<!-- test: file out/a.txt -->
```text
line1
<<<<<<< GENERATED: 2025-01-01T00:00:00.000Z/merge
CHANGED
=======
USER
>>>>>>> EXISTING: 2025-01-01T00:00:00.000Z/merge
line3
```

The two timestamps come from different clocks: the generated label is
this run's `now()`, the existing label is the **previous** run's
completion time. With no previous run that is `-1`, which renders as
`1969-12-31T23:59:59.999Z`.

A file that still carries an unresolved `>>>>>>> EXISTING:` marker from
an earlier merge keeps its contents: the engine will not nest a second
merge inside the first. The two stacks report that differently.
TypeScript rewrites the identical bytes and lists the file under
`merged`, with no conflict; Go does not write at all and records the
file as skipped.

### Merge needs a baseline, and degrades quietly without one

The merge ancestor is the copy under `.jostraca/generated/`. Where
there is no such copy the merge cannot run, and the file is
**overwritten** instead — no error, no warning. That happens when:

- `control.duplicate` is `false`, so no baseline is ever written;
- the file is new, so there is no previous generate;
- the output path escapes the output folder, so no baseline was kept
  for it.

### `.old` and `.new` naming

The suffix goes before the extension: `a.txt` becomes `a.old.txt`, and
`b.min.js` becomes `b.min.old.js`. A file with no extension appends:
`noext` becomes `noext.old`. A dotfile appends too, so `.env` becomes
`.env.old` rather than colliding with anything.

## `JOSTRACA_PROTECT`

The literal string `JOSTRACA_PROTECT`, appearing **anywhere** in the
file that is already on disk. Not a line, not a comment, not anchored —
a substring. The generated content is never checked, only the existing
file.

A protected file is never overwritten. `preserve` takes no backup,
`diff` and `merge` do not run, and the file is recorded as skipped with
`protect: true`, appearing in none of the `files` arrays. The merge
baseline is still refreshed.

**One exception.** `present` still fires: the protect test guards the
`write` arm, and the `present` arm does not repeat it. So with
`{write: false, present: true}` a protected file keeps its bytes and
still gets a `.new` sidecar, and is reported in `files.presented`. That
is arguably the useful behaviour — the reader can see what they are
declining — but it is not what "skipped under every mode" would lead
you to expect.

## Control

```
control: { dryrun: false, duplicate: true, version: false }
```

Set these on the `generate()` call; a global `control` is ignored.

**`dryrun`** guards every mutation while letting everything else run.
The decision tree, the audit and the `files` arrays all report what
*would* have happened, and nothing is created — not even the
`.jostraca` folder.

**`duplicate`** writes a copy of each generated file to
`.jostraca/generated/<relative path>` after every save. That copy is
the merge ancestor, so turning this off disables `merge` (see above).
It is skipped for a path that resolves outside the output folder.

**`version`** does exactly one thing: when `false`, `.jostraca/.gitignore`
is written. With `true` it is not written, and an existing one is left
alone. The meta log and `generated/` are written either way.

## In-memory generation

`mem: true` runs the whole generate on a virtual filesystem. `vol`
seeds it.

- **`vol` without `mem` does nothing.** No virtual filesystem is
  created and the run goes to the real one.
- Global `mem: true` with no per-call `vol` shares **one** volume for
  the life of the instance, so state accumulates across `generate()`
  calls.
- A per-call `vol` forks: it seeds a fresh volume from the global seed
  merged with yours, and that call's writes never reach the shared one.
- A provider missing `existsSync` is rejected with
  `BuildContext: Invalid file system provider`.

Relative paths resolve against the process working directory, so
`folder: 'out'` produces cwd-absolute keys in `vol().toJSON()` while
`files` keeps the relative form.

## The `.jostraca` folder

```
<folder>/.jostraca/jostraca.meta.log     JSON, two-space indented
<folder>/.jostraca/generated/<relpath>   this run's output, verbatim
<folder>/.jostraca/.gitignore            unless control.version is true
```

None of these paths is configurable.

`.gitignore` holds a leading blank line, then `jostraca.meta.log`, then
`generated`.

`jostraca.meta.log` records `last` (the completion stamp, reused next
run as the existing-side marker timestamp and as the `exclude` cutoff)
and one entry per file, keyed **relative to the output folder**:

<!-- test: scenario meta-log -->

<!-- test: run -->
```js
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({ now: () => 1735689600000 })

await jostraca.generate({ folder: './out' }, () => {
  Project({ folder: 'p' }, () => {
    File({ name: 'a.txt' }, () => Content('A\n'))
  })
})
```

<!-- test: all -->
```text
.jostraca/.gitignore
.jostraca/generated/p/a.txt
.jostraca/jostraca.meta.log
p/a.txt
```

The `jostraca.meta.log` it wrote, in full:

<!-- test: file out/.jostraca/jostraca.meta.log -->
```json
{
  "foldername": ".jostraca",
  "filename": "jostraca.meta.log",
  "last": 1735689600000,
  "hlast": 2025010100000000,
  "files": {
    "p/a.txt": {
      "action": "write",
      "path": "p/a.txt",
      "exists": false,
      "actions": [
        "write"
      ],
      "protect": false,
      "conflict": false,
      "when": 1735689600000,
      "hwhen": 2025010100000000
    }
  }
}
\ No newline at end of file
```

`action` is the last action taken; `actions` is the ordered list.
Observed values: `write`, `preserve`, `present`, `diff`, `merge`,
`skip`. `hlast` and `hwhen` are the ISO timestamp with the non-digits
stripped and the last digit dropped, as a number.

An unreadable meta log is **not** fatal: a warning goes to `log.debug`
and the run continues as though there were no previous build. Nothing
is written at all when the root produced no components.

## `audit()`

Returns `[tag, data][]`, appended by the file handler alone. Two
families: low-level filesystem calls, tagged
`FileHandler:<method>:<whence>`, and one decision record per file,
tagged `FileHandler:save:<action>` and carrying the file's metadata
plus a `why` breadcrumb array naming each branch the decision took.

A `why` trail reads, for a plain overwrite:

<!-- test: skip an audit breadcrumb quoted for shape; the trails are pinned by ts/test suites -->
```text
start<Wx> exists-0 write-0 not-protect-1 write-1 duplicate-1 within-0
```

and for a protected file:

<!-- test: skip an audit breadcrumb quoted for shape; the trails are pinned by ts/test suites -->
```text
start<Wx> exists-0 skip-0 duplicate-1 within-0
```

Note the missing `not-protect-1` in the second: protection
short-circuits the whole diff and merge stage.

Errors are tagged with an `ERROR:` prefix and carry `err`. The
duplicate-baseline write does not appear in the audit at all; it
bypasses the audited writer.

## `exclude`

`exclude: true` on the `generate()` call skips any output file that
exists and whose mtime is later than the previous build's completion
stamp — a "do not touch what the user has been editing" switch. An
excluded file appears in **none** of the `files` arrays.

Two limits: the global form is ignored (see the override table), and
`Inject` does not honour it. The equivalent block in the inject
operation is commented out in the source, so an injection runs
regardless.

## Errors

An error out of the build phase carries `err.jostraca = true` and
`err.step = <node kind>`. An error thrown during the define phase is
not decorated, because the walk has not started.

`err.callsite` is never populated. The walker reads a property the
component wrapper does not write. Treat it as absent.

`log` receives `log.debug` calls and nothing else, and only to replay
warnings: a duplicate save, an unreadable meta log, a failed chmod, a
temp-file cleanup failure. A clean run logs nothing.

Next: the [component reference](reference-components.md) for the
component surface, and the [utilities
reference](reference-utilities.md) for `template`, `each`, `getx` and
the diff engine.
