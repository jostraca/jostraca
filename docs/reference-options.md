# Reference: options and results

`Jostraca()`, `generate()`, every option, and what comes back. This page
states facts. The [tutorial](tutorial.md) teaches, and the
[how-to guides](how-to/README.md) solve named tasks.

Every example here is executed by `ts/test/docs.test.ts`. The examples
that show diff or merge markers pin the clock with `now`, because the
markers carry timestamps.

## The three calls

```
Jostraca(options?) => { generate, check }
generate(options, root) => Promise<JostracaResult>
check(options, root)    => Promise<CheckResult>
```

`generate` writes the tree. [`check`](#check) generates it into memory
and compares it with a folder instead, which is the same run asking a
different question.

Both option objects are validated by the **same** shape. There is no
separate global-options type and no separate per-call type. An unknown
key is a hard error, not a warning:

```
Jostraca Options: Validation failed for object "{folder:/out,bogus:1}" because the property "bogus" is not allowed.
```

## Options

| option | type | default | effect |
|---|---|---|---|
| `folder` | `string` | `'.'` | Base output folder. A trailing separator is ignored, so `out/`, `./out/` and `out//` behave as `out`. An empty string is refused. |
| `model` | any | `{}` | The data model. Reaches components as `props.ctx$.model`, and drives `$$path$$` substitution. |
| `meta` | `object` | `{}` | Arbitrary data, reachable as `props.ctx$.meta`. Jostraca does not read it. |
| `fs` | `() => FS` | `node:fs` | Filesystem provider factory. |
| `now` | `() => number` | `Date.now` | Clock. Pin it for reproducible output. Anything but a function, or `null` for the default, is refused. |
| `log` | `Log` | a console logger | Receives `log.debug` warnings, and nothing else, so it must have a `debug` function; anything else is refused. `null` is the default. |
| `debug` | `string` | `'.'` | Must be a string; a boolean throws. Truthy makes `cmp()` stamp a callsite on each node. |
| `build` | `boolean` | `true` | Run the build phase. `false` runs define only and writes nothing. |
| `mem` | `boolean` |—| Generate onto an in-memory filesystem. |
| `vol` | `object` |—| Seed for the in-memory filesystem: each value a string or `Buffer` (a file, empty allowed) or `null` (an empty directory). Anything else is refused. Does nothing without `mem`. |
| `existing` | `{txt, bin}` | see below | What to do with a file that already exists. |
| `control` | `{dryrun, duplicate, version}` | see below | See [Control](#control). |
| `cmp.Copy.ignore` | `(RegExp \| string)[]` | `[/~$/]` | Extra names for `Copy` to skip. A string is a regular expression source, the form JSON configuration can carry; an empty string or any other value is refused. |
| `exclude` | `boolean` | `false` | Skip output files modified since the last build. See [`exclude`](#exclude). |

`fs` takes a factory, not a filesystem, and `FS` is a small contract
rather than the whole of `node:fs`. Six methods are required:

| required | feature-detected | fallback when absent |
|---|---|---|
| `existsSync` | `renameSync` | a direct write, so no atomic rename |
| `readFileSync` | `chmodSync` | modes stay at their default |
| `writeFileSync` | `unlinkSync` | temp files are not cleaned up |
| `mkdirSync` | `realpathSync` | identity, so no symlink-cycle detection |
| `statSync` | | |
| `readdirSync` | | |

`existsSync` is the one checked at runtime: a provider without it is
rejected outright. The four on the right are tested with `typeof`
before each call, so a partial provider is legitimate. Everything is
synchronous, and `node:fs` satisfies the contract—but it is the
FACTORY that is the option, so pass `fs: () => nodeFs` rather than
`fs: nodeFs`. The bare module fails options validation.

`debug` is worth a note. Its shape declares `'info'` as an example
value, not as a default, so nothing sets it when you omit it and the
fallback is the string `'.'`—which is truthy. Debug callsite stamping
is therefore **on** by default.

`now` is sampled more than once. A run samples it once for `when`, once
per filesystem call the file handler makes, once per recorded action,
and once for the meta log's `last`. A constant clock gives byte-identical
meta logs, and a ticking one gives the same values in the TypeScript and
Go ports.

### Options that exist and do nothing

`name.file.prefix`, `name.file.suffix`, `name.folder.prefix`,
`name.folder.suffix` and `name.exclude` validate, and no code reads
them. They are declared against a `// TODO: implement` in the source.
Setting them has no effect anywhere.

`Fragment`'s `exclude` prop is the same kind of dead end; see the
[component reference](reference-components.md#fragment).

## How per-call options override global ones

Every option given to `Jostraca()` is honoured by each call that does
not set it, and the per-call value wins where it does. How the two
combine differs by option:

| option | rule | global honoured when the call omits it? |
|---|---|---|
| `folder` | per-call wins, else global, else `'.'` | yes |
| `fs` | per-call wins, else the in-memory filesystem when `mem` is on for the call, else global, else `node:fs` | yes |
| `now` | per-call wins, else global, else `Date.now` | yes |
| `log`, `debug` | per-call wins, else global, else the default | yes |
| `mem` | per-call wins if present, else global | yes |
| `vol` | omitted: the global volume. Present: a deep merge of global then per-call, in a **new** volume | yes, as a union |
| `meta` | shallow spread, per-call keys win | yes, merged |
| `model` | per-call **replaces** wholesale | yes, replaced rather than merged |
| `existing.txt` / `existing.bin` | deep merge, per key | yes |
| `cmp` | deep merge over the built-in default | yes |
| `build` | per-call wins, else global, else `true` | yes |
| `control.*` | deep merge, per key: defaults, then global, then per-call | yes |
| `exclude` | per-call wins, else global, else `false` | yes |

A per-call `control` that sets one key leaves every other global key
in force, so a call that asks for `version: true` under a global
`dryrun: true` still writes nothing.

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
  vol,        // () => Volume  -- only when mem is on for the call
  fs,         // () => FS      -- only when mem is on for the call
}
```

`when` is the *start* stamp, not the end.

Paths in `files` are folder-prefixed and forward-slashed, exactly as
they were passed to the writer—not relative to the output folder. A
relative `folder` keeps them relative.

`files.unchanged` means byte-identical and therefore not rewritten. A
byte-identical rewrite would bump the mtime and re-trigger every
watcher downstream, so Jostraca skips it and records the path here
instead of in `written`. An explicit `File` `mode` is still applied.

`vol()` and `fs()` are present exactly when `mem` is on for the call:
`vol()` is the in-memory volume and `fs()` the provider the run
actually used. A provider you supply yourself, even an in-memory one,
gets neither, because you already hold it. One configuration
can mislead: global `mem: true` with a per-call `fs`, where `fs()` is
your provider and `vol()` returns the untouched global volume.

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

The file on disk is compared and merged as bytes. Bytes that are not
valid UTF-8, such as a file saved in Latin-1, survive `diff` and
`merge` exactly, and a file whose bytes differ from the generate is
never reported unchanged.

### The order the flags are checked

This order is the whole behaviour, and two of its consequences are not
guessable:

1. A file that **does not exist** is always written, whatever the flags
   say.
2. The existing content is read, and checked for `JOSTRACA_PROTECT`.
3. `preserve`—take the `.old` backup, unless protected.
4. `write` **else if** `present`—so **`present` does nothing unless
   `write: false`.**
5. `diff` **else if** `merge`—so **`diff` wins; they never both
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
generate. Where both sides changed the same region, markers go in—
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
`1969-12-31T23:59:59.999Z`. A meta log whose `last` is not a finite
epoch-millisecond value within the JavaScript `Date` range counts as no
previous run.

A file that still holds the markers of an earlier merge is left
byte-for-byte untouched: the engine will not nest a second merge inside
the first. It is not rewritten, so its mtime does not move, though a
requested `mode` is still applied. It is reported in both `merged` and
`conflicted`, because it still carries markers, and the
`.jostraca/generated` baseline is refreshed to the new generate. A clean
merge over a file the user never edited is written even when the
generated text itself contains a marker line.

### Merge needs a baseline, and degrades silently without one

The merge ancestor is the copy under `.jostraca/generated/`. Where
there is no such copy the merge cannot run, and the file is
**overwritten** instead—no error, no warning. That happens when:

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
file that is already on disk. Not a line, not a comment, not anchored—a
substring. The generated content is never checked, only the existing
file.

A protected file is never overwritten. `preserve` takes no backup,
`diff` and `merge` do not run, and the file is recorded as skipped with
`protect: true`, appearing in none of the `files` arrays. The merge
baseline is still refreshed.

**One exception.** `present` still fires: the protect test guards the
`write` arm, and the `present` arm does not repeat it. So with
`{write: false, present: true}` a protected file keeps its bytes and
still gets a `.new` sidecar, and is reported in `files.presented`. That
is arguably the useful behaviour—the reader can see what they are
declining—but it is not what "skipped under every mode" would lead
you to expect.

## Control

```
control: { dryrun: false, duplicate: true, version: false }
```

A global `control` and a per-call one merge per key, so a call that
sets `version` keeps a global `dryrun: true` in force. The per-call
value wins for the keys it sets. [`check`](#check) forces
`dryrun: false` and `duplicate: false` for its own run and keeps every
other key.

**`dryrun`** guards every mutation while letting everything else run.
The decision tree, the audit and the `files` arrays all report what
*would* have happened, and nothing is created—not even the
`.jostraca` folder.

**`duplicate`** writes a copy of each generated file to
`.jostraca/generated/<relative path>` after every save. That copy is
the merge ancestor, so turning this off disables `merge` (see earlier).
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
- A per-call `mem: false` turns memory mode off for that call: the run
  uses the global `fs`, else `node:fs`, and never the shared volume.
- With `mem: true`, the in-memory filesystem beats a global `fs`. Only
  a per-call `fs` beats it.
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
stripped and the last digit dropped, as a number. A clock of `() => 0`
is the epoch, not the wall clock, so it gives `1970010100000000` and a
byte-stable meta log.

An unreadable meta log is **not** fatal: a warning goes to `log.debug`
and the run continues as though there were no previous build. A meta
log whose `last` is not a finite epoch-millisecond value within the
JavaScript `Date` range is read the same way, as no previous build, and
a merge then labels the existing side `1969-12-31T23:59:59.999Z`.
Nothing is written at all when the root produced no components.

## `check`

```
check(options, root) => Promise<CheckResult>
```

Holds a committed folder to what the generators produce. It takes the
same options as `generate` and runs the same generate; `folder` is the
folder it checks.

`folder` and `fs` resolve as they do for `generate`: the per-call value,
else the one given to `Jostraca()`, else `'.'` and `node:fs`. `fs` is
the filesystem holding the committed tree. The check always runs the
build phase and never writes: `build: false`, `control.dryrun` and
`control.duplicate` are overridden for its own run, whether they were
set per call or given to `Jostraca()`.

```
{
  folder,     // string: the folder checked, as given
  checked,    // string[]: every path compared, relative and sorted
  drift,      // CheckDrift[]: sorted by path, empty when the folder matches
  files,      // the run report of the generate that produced the comparison
}
```

Each entry of `drift` carries the bytes rather than a rendered diff,
because a build wants an exit code, a test wants an assertion and a
reviewer wants hunks:

| field | meaning |
|---|---|
| `path` | relative to `folder`, forward slashes |
| `kind` | `missing`, `content` or `mode` |
| `generated` | `Buffer`: what the generators produce. Always present |
| `existing` | `Buffer`: what the folder holds. Absent when `kind` is `missing` |
| `mode`, `existingMode` | the declared bits and the bits on disk, on `kind: 'mode'` only |

[`hunks` and `lines`](reference-utilities.md) turn a `content` entry
into a diff.

This is the CI half of generating: a generator runs, its output is
committed and reviewed, and every build after that asks whether the two
still agree.

<!-- test: scenario opt-check -->

Say `app/a.txt` is committed, and holds what the generator writes:

<!-- test: input app/a.txt -->
```text
class Planet
end
```

The generator also emits `app/b.txt`, which nobody committed:

<!-- test: run -->
```js
import { Jostraca, File, Content } from 'jostraca'

const res = await Jostraca().check({ folder: './app' }, () => {
  File({ name: 'a.txt' }, () => Content('class Planet\nend\n'))
  File({ name: 'b.txt' }, () => Content('class Moon\nend\n'))
})

console.log('checked ' + res.checked.length)
for (const d of res.drift) {
  console.log(d.kind + ' ' + d.path)
}
```

<!-- test: log -->
```text
checked 2
missing b.txt
```

### What a check compares, and what it refuses to read

**The bytes, and the permission bits where the tree stated them** with
[`mode`](reference-components.md#mode). A file whose tree says nothing
about mode is held to nothing, because a run would leave the bits it
found. Windows has no bits to compare.

**A file the generators do not claim is left alone.** A generator owns
the files it emits, not the directory it emits them into: one generator
of nine writes a handful of files into a whole application, and calling
every unclaimed file drift would report the other eight generators'
output as a failure. The cost is that a file which stops being
generated lingers and is not reported—deleting it is the same review as
adding it.

**The folder cannot change the answer.** It is shadowed by an in-memory
filesystem for the duration, so every file takes the same path through
the writer whatever is already there: no existing-file mode fires, and
no `exclude` skips a comparison. Without that a generator could exempt
its own output from the gate meant to hold it.

**A check writes nothing, anywhere**, including the run that reports
drift and including the `.jostraca` folder. That folder is never
compared either: it carries timestamps, so it can never be
byte-stable.

**Reads outside the folder fall through**, so a `Fragment` or
`CopyFiles` source is read exactly as on a write run. The one component
this cannot serve is `Inject`, which rewrites a file that already
exists: the folder is not visible to the run, so an Inject into a file
the same run does not also create is refused. That is the price of the
shadow, and the shadow is what the gate is for.

## `audit()`

Returns `[tag, data][]`, appended by the file handler alone. Two
families: low-level filesystem calls, tagged
`FileHandler:<method>:<whence>`, and one decision record per file,
tagged `FileHandler:save:<action>` and carrying the file's metadata
plus a `why` breadcrumb array naming each branch the decision took.

A low-level entry carries `{path, when, exists}` for `existsFile`,
`{path, when, size}` or `{path, when, existed, size}` for `loadFile`,
`loadJSON`, `saveFile` and `saveJSON`, and
`{topath, frompath, when, existed, size}` for `copyFile`. `size` is a
byte length, and the path is as the handler received it,
folder-prefixed or absolute. The meta log's own read and write, and the
`.gitignore`, are audited too. A decision record carries `action`,
`path`, `exists`, `actions`, `protect`, `conflict`, `when`, `hwhen` and
`why`, and it is a snapshot: `actions` and `why` are as they stood when
the record was pushed, so a preserve record's `actions` is
`[preserve]`. The write or skip record is pushed last and carries the
baseline breadcrumbs (`duplicate-1 within-0`). A `build: false` run, or
one whose define phase produced nothing, still reports one entry: the
meta log's `existsFile`.

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
short-circuits the whole diff and merge stage. `start<W...>` marks a
target that already exists, and `w` a new one.

Errors are tagged with an `ERROR:` prefix and carry `err`. The
duplicate-baseline write does not appear in the audit at all; it
bypasses the audited writer.

## `exclude`

`exclude: true`, global or per call, skips any output file that exists
and whose mtime is later than the previous build's completion
stamp—a "do not touch what the user has been editing" switch. An
excluded file appears in **none** of the `files` arrays.

Both times are compared in whole milliseconds, so a write inside the
same millisecond as that build's stamp does not count as newer than the
build.

One limit: `Inject` does not honour it. The equivalent block in the
inject operation is commented out in the source, so an injection runs
regardless.

## Errors

An error out of the build phase carries `err.jostraca = true` and
`err.step = <node kind>`. An error thrown during the define phase is
not decorated, because the walk has not started. A `root` that is not
a function is refused with
`jostraca: generate root callback is not a function`.

`err.callsite` is never populated. The walker reads a property the
component wrapper does not write. Treat it as absent.

`log` receives `log.debug` calls and nothing else, and only to replay
warnings: a duplicate save, an unreadable meta log, an `Inject` whose
markers were not found, a failed chmod of an unchanged file. The replay
happens after a run that succeeds, one call per warning, with the
payload `{point: 'jostraca-warning', dlogentry, note}`, and a run
receives only the warnings it raised itself, even while another
`generate` runs concurrently. A run that throws replays nothing. A
clean run logs nothing.

A write that fails leaves no temporary file behind where it can remove
it. One it cannot remove is recorded as `temp cleanup failed: <path>`
in the debug buffer; the failed write refuses the run, so that warning
never reaches `log`.

Next: the [component reference](reference-components.md) for the
component surface, and the [utilities
reference](reference-utilities.md) for `template`, `each`, `getx` and
the diff engine.
