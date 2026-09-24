# Reference: components

Every component, every prop, and the edge cases. This page states facts;
it does not teach. The [tutorial](tutorial.md) teaches, and the
[how-to guides](how-to/README.md) solve named tasks.

Every example here is executed by `ts/test/docs.test.ts` against the
build in `ts/dist`, in a temp directory, and the listings are what the
generator wrote.

## The exported components

`Project`, `Folder`, `File`, `Content`, `Line`, `Fragment`, `Slot`,
`Inject`, `Copy`, `List`, the `cmp()` factory that makes more, and
[`cmpTree()`](#cmptree) for a tree given as data rather than as calls.

`None` is **not exported**. It exists in the source as the internal
no-op used for the synthetic root node, and it is not reachable from
`import { … } from 'jostraca'`. To make a component conditional, branch
at the call site instead of substituting a no-op component.

## Props are types

Each component declares what it reads, and the package exports the
declaration under the component's name:

| component | props type | required |
|---|---|---|
| `Project` | `ProjectProps` |—|
| `Folder` | `FolderProps` |—|
| `File` | `FileProps` | `name` |
| `Content` | `ContentProps` |—|
| `Line` | `LineProps`, an alias of `ContentProps` |—|
| `Fragment` | `FragmentProps` | `from` |
| `Slot` | `SlotProps` |—|
| `Inject` | `InjectProps` | `name` |
| `CopyFiles` | `CopyFilesProps` | `from` |
| `ListItems` | `ListItemsProps` |—|

<!-- test: skip a type-only import, shown in place; the types are compiled by ts/typecase -->
```ts
import type { FileProps } from 'jostraca'

const script: FileProps = { name: 'run.sh', mode: 0o755 }
```

A misspelled or mistyped prop is a compile error in all ten, whatever
the component does with one at run time. That matters because run time
answers two different ways: `Fragment` and `CopyFiles` validate a closed
shape and throw, and the other eight accept an unknown prop and drop it.
The types close the gap at the call site, where the typo is.

`ctx$` is in none of them. `cmp()` writes it into the props object on the
way in, so a caller never passes one, and a type that declared it would
be asking for one.

Two more types travel with them. `ListItemProps` is what a `ListItems`
child is called with, `{item, indent, replace}`. `CmpProps<P>` is `P`
plus the `ctx$` a component body reads, which is the props type of a
component built with [`cmp()`](#cmp).

## How a component call works

`cmp()` wraps a function into a component. Each call:

1. reads the ambient context from an `AsyncLocalStorage` on `global`—with
   no context, it throws (see [Errors](#errors));
2. normalises its arguments (below);
3. sets `props.ctx$` on the props object you passed, mutating it;
4. appends a node to the current parent and makes that node current for
   the duration of the call;
5. returns whatever the wrapped function returned.

### Call forms

`Component(props, children)` is the full form. Both arguments are
normalised:

| call | `props` | `children` |
|---|---|---|
| `C({x: 1}, fn)` | `{x: 1, ctx$}` | `[fn]` |
| `C({x: 1}, [f1, f2])` | `{x: 1, ctx$}` | `[f1, f2]` |
| `C(fn)` | `{arg: fn, ctx$}` | `[fn]` |
| `C([f1])` | `{arg: [f1], ctx$}` | `[f1]` |
| `C({}, 'text')` | `{ctx$}` | `'text'` (not wrapped) |
| `C({})` | `{ctx$}` | `null` |
| `C('hello')` | `{arg: 'hello', ctx$}` | `null` |
| `C(42)` | `{arg: 42, ctx$}` | `null` |
| `C()` | `{arg: undefined, ctx$}` | `null` |

A non-object first argument becomes `props.arg`. Only `Content` and
`Line` read `arg`; for every other component a positional string is
accepted and ignored at run time, so `File('x.txt', …)` does **not**
name the file. The table is what a tree arriving as data gets: from
TypeScript, `File('x.txt')` does not compile, because `FileProps` is
what `File` takes and a string is not one. `Copy` and `Fragment` are
stricter still: their props are closed shapes, so a positional argument
throws as well.

### `props.ctx$`

Present on every component's props:

| key | value |
|---|---|
| `model` | the data model for this generate |
| `fs` | `() => FS`—call it for the filesystem provider |
| `now` | `() => number` |
| `folder` | the resolved base output folder |
| `meta` | global `meta` merged with generate `meta` |
| `opts` | the validated generate options |
| `log` | `{trace, debug, info, warn, error, fatal}` |
| `debug` | debug level string, default `'.'` |
| `node` | the node being built |
| `children` | that node's child array |
| `root` | the synthetic root node |
| `content` | `null`; seeded once, unused by any built-in |

### Evaluation order

Children run inline during the define phase, in source order. Build
then walks the tree depth-first: `before(node)`, each child in order,
`after(node)`.

Bare top-level siblings all render—each generate seeds a synthetic
root node, so the first component does not become the root and orphan
the rest. Two top-level `Project` calls both produce output.

If two components resolve to the same output path, the later one wins
and a warning goes to `log.debug`:
`duplicate save, later content wins: <path>`.

## Where content goes

`Content`, `Line`, `List` and `Fragment` push into the *current file*.
`File`, `Inject`, `Fragment` and `Slot` each make themselves the current
file for their children and put the previous one back when they close:

| component | sets current file | restores it |
|---|---|---|
| `File` | yes | yes |
| `Inject` | yes | yes |
| `Fragment` | yes | yes |
| `Slot` | yes | yes |

Content with no enclosing `File` or `Inject` is discarded, silently.

A `Folder` or a `Project` never becomes the current file. Inside a
`File`, what its children emit lands in that `File`, in source order,
and its directory is still made.

A `File` nested inside a `File`, directly or through a `Folder`, is
written to its own path, and the outer file keeps its own content from
both sides of the nested one. `File({name: 'outer.txt'},
() => { Content('1'); File({name: 'inner.txt'}, () => Content('2'));
Content('3') })` writes `outer.txt` as `13` and `inner.txt` as `2`.
Sibling `File` calls still read more plainly.

## Project

Roots one generated tree.

```
Project(props, children)
```

| prop | type | default | effect |
|---|---|---|---|
| `folder` | `string` | `'.'` | The only prop that changes the output path. An absolute value is used as-is; a relative one joins onto the base output folder. Backslashes become `/`, a trailing `/` is stripped. |
| `name` | `string` |—| Adds **no** path segment. It joins the component path that `File.exclude` matches against, and nothing else. |

Project is the only container that passes its props to its children:
each child function is called with `props` as its argument.

A `Project`'s folder applies to its own subtree only. Its `folder` joins
the base output folder, not the enclosing `Folder`, so a `Project`
nested inside a `Folder` does not take that `Folder`'s segment. When
the `Project` closes, the enclosing folder is back in force: a sibling
after it, and the rest of the enclosing `Folder`, land where they would
have without it.

Paths, with the generate folder set to `out`:

| declaration | written |
|---|---|
| `Project({folder: 'app'})` | `out/app/a.txt` |
| `Project({name: 'app'})` | `out/a.txt` |
| `Project({name: 'N', folder: 'F'})` | `out/F/a.txt` |
| `Project({})`, or no `Project` at all | `out/a.txt` |
| `Project({folder: 'x/y/z'})` | `out/x/y/z/a.txt` |
| `Project({folder: 'p/'})` | `out/p/a.txt` |
| `Project({folder: '.'})` or `''` | `out/a.txt` |
| `Project({folder: '/abs'})` | `/abs/a.txt` |
| `Project({folder: 'p'})`, then a sibling `File` | `out/p/a.txt`, then the sibling in `out/` |
| `Folder({name: 'a'})` holding `Project({folder: 'p2'})` | `out/p2/a.txt`, and `out/a` stays empty |
| `Project({folder: '..'})` | escapes the output folder |

That last row is the asymmetry to know about. `Folder({name: '..'})`
throws; `Project({folder: '..'})` does not. The traversal guard covers
`name` props, and `folder` is not one.

A backslash is a separator in every output name: `Project`'s `folder`,
`Folder`, `File`, `Inject` and `Copy`'s `to`. A `Fragment` or `Copy`
`from` is a source path and keeps its platform meaning.

<!-- test: scenario ref-project -->

<!-- test: run -->
```js
import { Jostraca, Project, Folder, File, Content } from 'jostraca'

await Jostraca().generate({ folder: './out' }, () => {
  Project({ folder: 'my-app' }, () => {
    Folder({ name: 'src' }, () => {
      File({ name: 'index.js' }, () => Content('console.log("hi")\n'))
    })
    File({ name: 'package.json' }, () => Content('{"name":"my-app"}\n'))
  })
})
```

<!-- test: out -->
```text
my-app/package.json
my-app/src/index.js
```

## Folder

Adds a directory to the output path.

```
Folder(props, children)
```

| prop | type | default | effect |
|---|---|---|---|
| `name` | `string` |—| Appended to the current folder path. Omitted or empty adds no segment, which makes `Folder({})` a pure grouping container. |

Children are called with no arguments.

A folder is created even when nothing is written into it. Slashes in
`name` are allowed and create nested directories. A `..` segment
throws.

| declaration | result |
|---|---|
| `Folder({name: 'a/b/c'})` | creates `a/b/c` |
| `Folder({})` or `Folder({name: ''})` | no segment |
| `Folder({name: 'empty'}, () => {})` | the directory exists, empty |
| `Folder({name: '..'})` | throws |
| `Folder('zzz', …)` | positional string is `props.arg`, **not** `name` |

## File

Names a file. Its children supply the content.

```
File(props, children)
```

| prop | type | default | effect |
|---|---|---|---|
| `name` | `string` |—| The filename. Slashes create nested directories. A `..` segment throws. Omitted, the file is literally called `undefined`. |
| `exclude` | `boolean \| string \| (string\|RegExp)[]` |—| Skip the file, but **only when it already exists**. See below. |
| `mode` | `number` | platform default | POSIX permission bits, re-applied after the atomic write-then-rename. |

Children are called with no arguments. A string child produces nothing—only
functions are called—so `File({name: 'a.txt'}, 'hello')`
writes an empty file.

### `exclude`

Consulted only when the target exists; a file that is not there yet is
always written. `exclude: true` skips it. A string or array of strings
is compared against the **component path**—the `name` props of the
ancestors joined with `/`—not the filesystem path. Since
`Project({folder: …})` contributes no name and `Project({name: …})`
does, the two behave differently:

| declaration | `exclude` that skips |
|---|---|
| `Project({folder: 'p'})` + `File({name: 'a.txt'})` | `'a.txt'` |
| `Project({name: 'p'})` + `File({name: 'a.txt'})` | `'p/a.txt'` |
| `Folder({name: 'sub'})` + `File({name: 'a.txt'})` | `'sub/a.txt'` |

A `RegExp` inside the array is accepted by the type and can never
match: the comparison is an array identity test, not a pattern test.

### `mode`

An explicit mode beats the existing file's mode on regeneration, and
survives the atomic write (which swaps the inode, so it has to be
re-applied deliberately). It applies to the target only, not to the
`.old`/`.new` sidecars or the merge baseline.

**Windows has no POSIX permission bits.** `fs.chmod` there only toggles
the read-only attribute, so a `mode` of `0o755` is accepted, throws
nothing, and has no effect beyond that.

<!-- test: scenario ref-file -->

<!-- test: run -->
```js
import { Jostraca, Project, File, Content } from 'jostraca'

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'run.sh', mode: 0o755 }, () => {
      Content('#!/bin/sh\necho hi\n')
    })
    File({ name: 'nested/deep/note.txt' }, () => Content('note\n'))
    File({ name: 'empty.txt' })
  })
})
```

<!-- test: out -->
```text
empty.txt
nested/deep/note.txt
run.sh
```

## Content

Adds text to the current file, with model substitution.

```
Content(text)
Content(props)
Content(props, text)
```

| prop | type | default | effect |
|---|---|---|---|
| `arg` | any |—| Source text. Highest precedence; also the positional form. |
| `src` | any |—| Source text, used when `arg` is absent. |
| (string child) | `string` |—| Source text, used when both are absent. |
| `indent` | `string \| number` |—| A number is that many spaces; a string is a literal prefix. Applied to every line. |
| `extra` | `object` | `{}` | Merged over the model for this call only. |
| `replace` | `Record<string, any>` |—| Custom replacements. See the [utilities reference](reference-utilities.md). |
| `raw` | `boolean` | `false` | Hand the bytes through untouched: no model substitution, and `extra` and `replace` are not read. |
| `name` | `string` |—| Joins the component path. No output effect. |

`Content` adds **no** newline. Use `Line` for that.

### `raw`

`Content` substitutes the model into whatever it is handed. That is
what the component is for when you write the text at the call site: you
put the `$$name$$` there on purpose. It is wrong when the text came
from somewhere else and is already final—a `$$` in a shell script, a
makefile, a doc comment or a regular expression is then rewritten, and
the run reports nothing and exits 0.

`raw: true` skips the render. `indent` still applies, because indenting
is where the span sits rather than what it says; `extra` and `replace`
are inputs to a render that is not happening, and are not read.

**An empty model is not the same guard.** Two forms substitute with no
model at all: `$$"quoted"$$` writes its own literal, and
`$$__JOSTRACA_REPLACE__$$` writes the matcher. Reaching for `model: {}`
covers the model paths and leaves those two.

Templating stays the default, so nothing that worked before changes.

**The second positional argument is `children`, not props.** This is the
single easiest mistake to make with this component:

| call | result |
|---|---|
| `Content('N=$$n$$', {extra: {n: 1}})` | `N=$$n$$`, because `extra` never arrives |
| `Content({src: 'N=$$n$$', extra: {n: 1}})` | `N=1` |

An unresolved `$$path$$` is left in place rather than blanked, so a
typo shows up in the output instead of vanishing.

Non-string values are stringified: `Content(0)` writes `0`,
`Content(true)` writes `true`, and an object writes
`[object Object]`.

<!-- test: scenario ref-content -->

<!-- test: run -->
```js
import { Jostraca, Project, File, Content, Line } from 'jostraca'

const jostraca = Jostraca({ model: { n: 5 } })

await jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'a.txt' }, () => {
      Content('ONE\n')
      Line('TWO')
      Content({ src: 'THREE\nFOUR\n', indent: 2 })
      Content({ src: 'N=$$n$$ M=$$m$$\n', extra: { m: 9 } })
      Content('missing=$$nope$$\n')
      Content({ src: 'foo-bar-baz\n', replace: { bar: 'BAR' } })
      Content({ src: 'raw N=$$n$$ Q=$$"lit"$$\n', raw: true })
      Line({ src: 'L=$$n$$ tok={t}', replace: { '{t}': 'T' } })
    })
  })
})
```

The resulting `a.txt`:

<!-- test: file out/a.txt -->
```text
ONE
TWO
  THREE
  FOUR
N=5 M=9
missing=$$nope$$
foo-BAR-baz
raw N=$$n$$ Q=$$"lit"$$
L=5 tok=T
```

The last two lines are the ones to look at: `raw` kept both `$$` forms,
including the one a model could not have supplied, and the `Line` below
it resolved a model path and a `replace` key in the same call.

## Line

`Content` with a newline appended.

```
Line(text)
Line(props)
```

Source resolution is identical to `Content`, and every prop behaves the
same: `indent`, `name`, `extra`, `replace` and `raw`. The newline is
appended before the render, so a `$$name$$` at the end of the line
still resolves.

| call | writes |
|---|---|
| `Line('a')` | `a\n` |
| `Line('')` or `Line()` | `\n` |
| `Line('a\n')` | `a\n\n` |
| `Line({arg: 'L', indent: '..'})` | `..L\n` |
| `Line({src: 'L $$n$$', raw: true})` | `L $$n$$\n` |

## Fragment

Reads a template file into the current file.

```
Fragment(props)
Fragment(props, children)
```

Props are a **closed** shape: an unknown prop throws.

| prop | type | default | effect |
|---|---|---|---|
| `from` | `string`, required |—| The template file. Absolute is used as-is; **relative resolves against the generate output folder**, not the enclosing Project or Folder and not the process working directory. The file must exist when the component is called, in the define phase. |
| `indent` | `string \| number` |—| Applied to the whole assembled fragment. |
| `replace` | `Record<string, any>` | `{}` | Custom replacements. The `Slot` machinery adds its own entries to this same object. |
| `eject` | `[start, end]` of `string \| RegExp` |—| Keep only the region between the two markers. |
| `name` |—|—| Not allowed; throws. |

`exclude` used to be here. It was validated and then read by nothing,
and it is gone from both ports: a prop the types now promise has to be a
prop the code keeps. A Fragment that is passed one is refused by name
rather than accepting it and doing nothing.

The `from` resolution catches people out, so it is worth stating twice:
with `generate({folder: './out'})`, a template at `tpl/page.html` is
reached as `'../tpl/page.html'`. In a generator you ship, build an
absolute path from `import.meta.url` instead.

`eject` is forgiving in one direction only. If either marker is
missing, or the end precedes the start, or the array has one element,
the source is used whole rather than erroring.

A `Fragment` renders when it is called. Its source is read, its slots
are replayed and its template runs inside the define callback, so a
render error stops the run before anything is written, the model is
read at that point, and a `from` file written earlier in the same run is
read with its bytes from before the run. Everything a `Slot` or a
`replace` function emits (`Content`, `Line`, `ListItems`, a component of
your own, a nested `Fragment`, `CopyFiles`, `Inject`) lands at the
marker, in emission order, and a `CopyFiles` there also writes its own
target.

The source is templated once. A `$$path$$` that arrives inside a model
value, a `replace` value or the return of a `replace` function is written
as text, exactly as a plain `Content` writes it.

A `Fragment` outside any `File` is discarded, like any other content.

## Slot

A named region inside a `Fragment`.

```
Slot(props, children)
```

| prop | type | effect |
|---|---|---|
| `name` | `string` | Matches a `<[SLOT:name]>` marker in the fragment source. |

An unnamed `<[SLOT]>` marker receives the fragment's non-`Slot`
children. A named `<[SLOT:name]>` marker receives the matching `Slot`.

Markers may be wrapped in comment decoration: any run of `- < ! / # *`
before, and any run of `- > / # *` after, with optional spaces, or tabs.
So all of these work, and the list is not exhaustive:

```
<!-- <[SLOT:head]> -->
// <[SLOT:head]>
/* <[SLOT:head]> */
# <[SLOT:head]>
-- <[SLOT:head]>
* <[SLOT:head]>
    <[SLOT:head]>
```

The marker's newline is not consumed, and the replacement is not
indented to match the marker—it starts at the column the marker's
decoration started. Pass `indent` where that matters.

Dispatch rules, all of which are quiet rather than fatal:

| case | result |
|---|---|
| unnamed marker, no children | marker replaced by nothing |
| the same marker twice | rendered at both |
| two `Slot`s with one name | concatenated |
| named marker, no matching `Slot` | **left in the output as literal text** |
| `Slot({})` with no name | content dropped |
| `Slot` outside a `Fragment` | transparent; children render in place |

The one case that does throw: non-`Slot` children with no unnamed
marker to receive them. That content would otherwise be discarded
silently, so it is an error naming the fragment and telling you both
ways out.

A `Slot` created **inside a custom component** is not recognised as a
slot. The fragment only inspects its direct children, so the wrapper
counts as a non-`Slot` child and its whole output lands in the unnamed
slot. Emit `Slot` directly from the `Fragment` body.

<!-- test: scenario ref-fragment -->

The template is `tpl/page.html`:

<!-- test: input tpl/page.html -->
```html
<html>
<!-- <[SLOT:head]> -->
<body>
<[SLOT]>
</body>
</html>
```

<!-- test: run -->
```js
import { Jostraca, Project, File, Fragment, Slot, Content } from 'jostraca'

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'index.html' }, () => {
      Fragment({ from: '../tpl/page.html' }, () => {
        Content('<h1>Hello</h1>')
        Slot({ name: 'head' }, () => Content('<title>My Page</title>'))
      })
    })
  })
})
```

The generated `index.html`:

<!-- test: file out/index.html -->
```html
<html>
<title>My Page</title>
<body>
<h1>Hello</h1>
</body>
</html>
```

## Inject

Replaces the region between two markers in a file that already exists.

```
Inject(props, children)
```

| prop | type | default | effect |
|---|---|---|---|
| `name` | `string` |—| The target file, relative to the current folder path. A `..` segment throws. |
| `markers` | `[string, string]` | `['#--START--#\n', '\n#--END--#']` | The delimiters. |
| `exclude` | `boolean` |—| Truthy skips the whole injection. |

Children build the replacement body exactly as they would inside a
`File`.

Both markers are matched literally: regular-expression metacharacters
are escaped rather than interpreted. **Every** matching pair in the
file is replaced, not only the first. The body is inserted verbatim, so
`$&`, `$1` and `$$` in generated content survive.

Two failure modes, and they differ:

- **The target does not exist**: throws. `Inject` rewrites a file; use
  `File` to create one.
- **The markers are not in the file**: the file is left alone, and a
  warning goes to `log.debug`. No error.

`markers` validation: `null`, or a pair of empty strings, falls back to
the defaults. Exactly one empty string throws. A third element is
ignored.

<!-- test: scenario ref-inject -->

The file to edit is `out/foo.txt`:

<!-- test: input out/foo.txt -->
```text
HEADER
#--START--#
old content
#--END--#
FOOTER
```

<!-- test: run -->
```js
import { Jostraca, Project, Inject, Content } from 'jostraca'

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    Inject({ name: 'foo.txt' }, () => Content('new content'))
  })
})
```

`foo.txt` afterwards:

<!-- test: file out/foo.txt -->
```text
HEADER
#--START--#
new content
#--END--#
FOOTER
```

## Copy

Copies a file or a directory tree into the output.

```
Copy(props)
```

Props are a **closed** shape: unknown props throw, there is no
positional form, and children are accepted syntactically but never
called.

| prop | type | default | effect |
|---|---|---|---|
| `from` | `string`, required |—| Source file or directory. It is stat'd in the define phase and must exist. A relative `from` resolves against the **process working directory**—unlike `Fragment`, it is not joined to the output folder. |
| `to` | non-empty `string` | source basename | For a file, the output name; for a directory, an output subfolder. May contain `/`. A `..` segment throws. |
| `exclude` | `boolean \| string \| RegExp \| (string\|RegExp)[]` |—| Paths relative to the copied source root. A boolean is accepted and does nothing. |
| `replace` | `Record<string, any>` |—| Custom replacements, applied to text files, including the text a single-file copy splices into an enclosing `File` or `Inject`. |

### Text or binary

Text files pass through the template system; binaries are copied byte
for byte. The extension decides first, by membership of a fixed list
(`png`, `jpg`, `zip`, `pdf`, `woff2` and around 250 more—see
[`isbinext`](reference-utilities.md#isbinext-and-isbincontent)); a listed extension is
binary whatever the bytes look like. Because no such list is complete,
the content is then sniffed: a NUL byte in the first 8192 promotes an
unlisted file to binary, which is what keeps `.wasm`, `.zst` and
extensionless files intact. Sniffing only ever promotes; it never
demotes a listed extension to text.

### What is skipped

Two rules, both matching on the bare entry name and both applying to
directories as well as files, so naming a directory prunes its subtree:

- Built-in: anything ending `~` or `-jostraca-off`. Always on.
- `cmp.Copy.ignore` from the options: a list of regular expressions,
  or of their sources as strings, defaulting to `[/~$/]`.

`exclude` is separate, and is compared against the path **relative to
the copied source root**, however deep in the output tree the `Copy`
sits. String entries are compared exactly, so `'./a.txt'` does not
match `a.txt`. Regular expressions have their `lastIndex` reset before
each test, so a `/g` flag is not stateful.

A symlink that re-enters an active ancestor directory is skipped and
logged. The backstop is a depth cap of 64.

<!-- test: scenario ref-copy -->

The source tree holds `tpl/assets/logo.svg`:

<!-- test: input tpl/assets/logo.svg -->
```html
<svg><!-- $$title$$ --></svg>
```

An editor backup sits beside it as `tpl/assets/notes.txt~`, to show
what the built-in ignore rule does:

<!-- test: input tpl/assets/notes.txt~ -->
```text
an editor backup, never copied
```

And a single file to rename on the way, `tpl/readme.txt`:

<!-- test: input tpl/readme.txt -->
```text
# $$title$$
```

<!-- test: run -->
```js
import { Jostraca, Project, Folder, Copy } from 'jostraca'

const jostraca = Jostraca({ model: { title: 'My App' } })

await jostraca.generate({ folder: './out' }, () => {
  Project({ folder: 'app' }, () => {
    Folder({ name: 'static' }, () => {
      Copy({ from: './tpl/assets' })
      Copy({ from: './tpl/readme.txt', to: 'README.txt' })
    })
  })
})
```

<!-- test: out -->
```text
app/static/README.txt
app/static/logo.svg
```

`notes.txt~` was skipped by the built-in rule, and `$$title$$` was
substituted on the way through into `logo.svg`:

<!-- test: file out/app/static/logo.svg -->
```html
<svg><!-- My App --></svg>
```

## List

Emits one block of content per item.

```
List(props, children)
```

| prop | type | default | effect |
|---|---|---|---|
| `item` | array or object |—| Iterated with [`each`](reference-utilities.md#each): object entries in sorted key order, scalars wrapped as `{val$: …}`, every entry marked with `index$` or `key$`. |
| `line` | `boolean` | `true` | Unless **strictly** `false`, one trailing newline is emitted after the whole list. `line: 0` still emits it. |
| `indent` | `string \| number` |—| Passed to each child as `args.indent`. The child must apply it. On its own it indents nothing. |
| `replace` |—|—| Accepted and never used. The `replace` handed to children is built fresh. |

Each child is called once per item with one object argument:
`{item, indent, replace}`. Children iterate *inside* the item loop, so two
children over items `p` and `q` emit `a=p, b=p, a=q, b=q`.

A child may also be a plain **string**, which is shorthand for a child that
renders it: the string is emitted once per item, `{item.path}` resolves in
it, and `indent` is applied for you rather than left to the child. It is
the same output as the props-object form spelled out by hand, so the two
mix freely in one list.

The `replace` a *function* child receives implements `{item.path}`
substitution, and it has to be threaded into a component that takes a
`replace` prop—which means the props-object call form. `Content(text, {replace})` passes
`{replace}` as *children* and substitutes nothing:

| call inside the child | output |
|---|---|
| `Content('{item.name}', {replace})` | `{item.name}` |
| `Content({src: '{item.name}', replace})` | `Alice` |

`{item.path}` resolves with `getx`, so nested paths work
(`{item.a.b}`). Three limits, all quiet:

- A bare `{item}` yields the empty string.
- `getx` cannot address a `$`-suffixed key, so `{item.val$}`,
  `{item.key$}` and `{item.index$}` all yield the empty string. For
  scalars and for the marks, use the `item` argument directly.
- An unresolved path yields the empty string, unlike `$$path$$`, which
  is left in place.

<!-- test: scenario ref-list -->

<!-- test: run -->
```js
import { Jostraca, Project, File, Content, List } from 'jostraca'

const items = [
  { name: 'Alice', role: 'admin' },
  { name: 'Bob', role: 'user' },
]

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'users.txt' }, () => {
      List({ item: items, line: false }, ({ replace }) => {
        Content({ src: '{item.name}: {item.role}\n', replace })
      })
    })
  })
})
```

The generated `users.txt`:

<!-- test: file out/users.txt -->
```text
Alice: admin
Bob: user
```

## cmp()

Turns a function into a component.

```
cmp(fn) => Component
cmp<P>(fn) => Component<P>
```

The wrapper keeps the wrapped function's `name`, which is not
cosmetic: `Fragment` identifies its `Slot` children by name.

With no type argument, `props` is `any`, which is what a component
written before there were [props types](#props-are-types) gets and
keeps. Name the type and both ends are checked, the call and the body:

<!-- test: skip a type argument, shown in place; ts/typecase compiles the same call -->
```ts
const Banner = cmp<{ text: string }>((props) =>
  Content('// ' + props.text + '\n'))

Banner({ text: 'generated' })
```

Inside the body, `props` is `CmpProps<P>`: the declared props, plus the
`ctx$` that `cmp()` writes in. A caller passes the first and never the
second.

A component emits content, and where that content lands is decided by
its caller—which is what makes it reusable. It may also emit
containers: a component that calls `File` or `Folder` works, and the
`root` callback passed to `generate()` may itself be a component.

To call your children, use `each(children, {call: true})`, adding
`args` to hand data down. `args` is spread into the call, so a single
non-array value arrives as one argument.

A component that throws leaves the ambient tree cursor intact, so a
caller that catches the error can carry on building.

<!-- test: scenario ref-cmp -->

<!-- test: run -->
```js
import { Jostraca, Project, File, Content, cmp, each } from 'jostraca'

const FunctionDef = cmp(function FunctionDef(props) {
  Content('function ' + props.name + '(')
  Content(props.params.join(', '))
  Content(') {\n')
  each(props.ctx$.model.body, (line) => Content('  ' + line.val$ + '\n'))
  Content('}\n')
})

const jostraca = Jostraca({ model: { body: ['return 1'] } })

await jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'utils.js' }, () => {
      FunctionDef({ name: 'greet', params: ['name'] })
    })
  })
})
```

The generated `utils.js`:

<!-- test: file out/utils.js -->
```js
function greet(name) {
  return 1
}
```

`line.val$` rather than `line`, because `each` wraps scalar entries.

## cmpTree()

Generates from a component tree given as **data** rather than as a
callback.

```
cmpTree(tree, opts?) => () => void
```

`generate()` takes a function that calls components, which is the
surface for a generator written in TypeScript and no surface at all for
one written in another language. `cmpTree` is the other door: a tree of
plain objects in, a define-phase callback out.

<!-- test: scenario ref-cmptree -->

<!-- test: run -->
```js
import { Jostraca, cmpTree } from 'jostraca'

const tree = {
  cmp: 'Folder',
  props: { name: 'src' },
  children: [{
    cmp: 'File',
    props: { name: 'planet.ts' },
    children: [
      { cmp: 'Content', props: { src: 'export interface Planet {\n' } },
      { cmp: 'Content', props: { src: '  id: string\n' } },
      { cmp: 'Content', props: { src: '}\n' } },
    ],
  }],
}

await Jostraca().generate({ folder: './out' }, cmpTree(tree))
```

The generated `src/planet.ts`:

<!-- test: file out/src/planet.ts -->
```ts
export interface Planet {
  id: string
}
```

**It is not an interpreter.** Each node calls the same exported
component a hand-written generator calls, in the same define phase, so
every rule the components carry holds unchanged—containment, the
existing-file modes, `dryrun`, the run report. There is no second
implementation to keep in step.

### The node

Three keys, and two of them are optional:

| key | type | meaning |
|---|---|---|
| `cmp` | `string` | The component, spelled as it is exported: `File`, `Content`, `ListItems`. |
| `props` | `object` | Its first argument. |
| `children` | `array` | Its second, as nodes. |

The vocabulary is the component surface itself, so it needs no entry
per component and no version of its own: a component works as soon as
it is exported. `Copy` and `List` resolve to `CopyFiles` and
`ListItems`, the names those two shipped under. A name is looked up as
written: your own component under that name first (see
[`cmp`](#options)), then the exported one, then the deprecated
spelling. So an override keyed `Copy` runs for a `Copy` node, while an
override keyed only `CopyFiles` leaves `Copy` on the built-in. Error
paths use the name as written: `[0]/List[0]`. The root may be one node
or a list of them, and a list becomes siblings.

`props` is passed to the component as written, so
[every prop on this page](#the-exported-components) is reachable from a
tree. [The props types](#props-are-types) are the machine-readable form
of that surface: a generator that emits trees from another language can
check them against `FileProps` and the rest, in `dist/*.d.ts`, rather
than against this page.

A tree is data, though, and data never met the compiler, so the answer
still differs by component: `Fragment` and `CopyFiles` refuse an unknown
prop and the other eight drop it. `cmpTree` checks the two closed sets
over each node's own props when it reads the tree, so a bad node is
refused even where it would never run, such as under an empty
`ListItems`:

```
cmpTree: Fragment: prop not allowed: bogus (at [0]/File[0])
```

The props a parent binds for its children (`item`, `indent`,
`replace`) are admitted, and a component you supply through `cmp`
under either name is not checked.

### Options

| option | type | effect |
|---|---|---|
| `cmp` | `Record<string, Component>` | Extra components, by the name a node's `cmp` uses. Merged over the exported set, so you may add your own or override one. |
| `raw` | `boolean` | Set `raw` on every `Content` and `Line` in the tree, beneath each node's own props. |

`raw` is the option to reach for when the tree arrived from elsewhere
and its text is already final. It sets the prop rather than replacing
it, so a node that does want the model in scope says `raw: false` and
gets it.

It reaches `Content` and `Line`—the components that render text they
were handed—and no others. A `Fragment` reads a template from disk
and a `CopyFiles` copies one, so neither has bytes from the tree to
protect, and both validate a closed prop set that a stray `raw` would
fail.

### What a tree may not do

Three rules that a hand-written generator does not need, because a data
tree can say things a call site cannot:

- **A tree may not choose the output root.** `Project.folder` is
  refused if it is absolute or holds a `..` segment. The operator picks
  the root, through `generate()`; the tree fills it. A `folder` of
  `null` is the same as no `folder`.
- **`cmp` must name a component the registry owns.** `toString` and
  `constructor` answer on any ordinary object, and used to run as
  components: no node, no output, no error. An unknown name is refused
  before the node's props or children are looked at.
- **A malformed tree is refused by the call that reads it.** `cmpTree`
  walks the whole tree before returning, so a bad node is reported
  before the define phase has made a folder. That includes a prop
  outside the closed set of `Fragment` or `CopyFiles`. Every refusal
  names the node by path: `[0]/Folder[0]/File[0]`.

The tree is your data and comes back unchanged. Components write into
the props they are handed, so each node's props are copied on every
call—deeply enough that a `replace` map may be frozen, and a tree may
be generated twice.

### Driving it from a file

`tools/cmptree-gen.js` in the repository reads a tree as JSON and
generates it, which is the whole integration for a tool that emits
trees:

<!-- test: skip a repository script, not part of the published package -->
```sh
gen-the-tree | node tools/cmptree-gen.js --at out --folder ./build
gen-the-tree | node tools/cmptree-gen.js --at out --check ./app
```

`--at` takes one top-level key, for a producer that prints a whole
document. `--check <dir>` generates into memory and compares with the
tree on disk instead of writing: it exits 1 on drift and names the
paths that drifted and how, which is the shape of a CI gate holding
committed output to what the generators produce. A file the tree does
not claim is left alone, so one generator can be checked against a
directory that several of them write into.

It compares the bytes, and the permission bits where the tree stated
them with [`mode`](#mode). A file whose tree says nothing about mode is
held to nothing, since a run would leave the bits it found; Windows has
no bits to compare.

`raw` is on by default in that tool and `--template` turns it off, the
opposite way round from the library: its input is text somebody else
already finished.

## Errors

Every error out of the build phase carries `err.jostraca = true` and
`err.step = <node kind>`.

A component called outside `generate()` throws with its own name in the
message, rather than failing on an undefined property read:

```
jostraca: component Content called outside generate(); components can only be used inside the callback passed to Jostraca().generate()
```

The Go port panics with the same text, naming `Generate()` as the
entry point.

`name` props are guarded against path traversal, on `File`, `Folder`,
`Inject` and `Copy`'s `to`:

```
ERROR:FolderOp:before: Folder name must not contain a ".." path segment, name=..
```

`Project`'s `folder` is **not** covered by that guard, except in a
[component tree given as data](#what-a-tree-may-not-do).

Two `File` components resolving to one output path is refused, naming
the path and both components:

```
ERROR:FileOp:before: two File components resolve to the same output path, path=/top/x/a.txt, first=x/a.txt, second=x/a.txt
```

The second used to win and the first was never written. The check is at
the build phase, where the path is final, so it covers a name composed
from `Project` and `Folder` nesting as well as a plain collision. It
counts `File` components: an `Inject` writing to a file the same run
created is the edit it is meant to be, not a collision.

Two depth caps exist as backstops: 22 directory segments on an output
path, and 64 on a `Copy` tree walk (the symlink-cycle guard).

Next: the [options reference](reference-options.md) for `Jostraca()`
and `generate()`, and the [utilities
reference](reference-utilities.md) for `each`, `getx`, `template` and
the rest.
