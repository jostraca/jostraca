# Jostraca Reference

Complete reference for all components, options, and utilities.


## Table of Contents

- [Jostraca()](#jostraca-1)
- [generate()](#generate)
- [Components](#components)
  - [Project](#project)
  - [Folder](#folder)
  - [File](#file)
  - [Content](#content)
  - [Line](#line)
  - [Fragment](#fragment)
  - [Slot](#slot)
  - [Inject](#inject)
  - [Copy](#copy)
  - [List](#list)
  - [None](#none)
- [Custom Components](#custom-components)
- [Options](#options)
  - [Global Options](#global-options)
  - [Generate Options](#generate-options)
  - [Existing File Options](#existing-file-options)
  - [Control Options](#control-options)
- [Template System](#template-system)
  - [Model Substitution](#model-substitution)
  - [Custom Replacements](#custom-replacements)
  - [Tag Syntax](#tag-syntax)
  - [Eject](#eject)
- [Utility Functions](#utility-functions)
  - [each](#each)
  - [get](#get)
  - [getx](#getx)
  - [camelify](#camelify)
  - [snakify](#snakify)
  - [kebabify](#kebabify)
  - [partify](#partify)
  - [names](#names)
  - [template](#template)
  - [indent](#indent-1)
  - [escre](#escre)
  - [isbinext](#isbinext)
  - [ucf](#ucf)
  - [lcf](#lcf)
  - [cmap](#cmap)
  - [vmap](#vmap)
  - [deep](#deep)
  - [omap](#omap)
- [File Protection](#file-protection)
- [Metadata](#metadata)


---


## Jostraca()

```typescript
Jostraca(gopts?: JostracaOptions): { generate }
```

Creates a Jostraca instance. Global options passed here are shared across
all calls to `generate()`.

```typescript
const jostraca = Jostraca({
  model: { app: 'MyApp' },
  now: () => Date.now(),
})
```


## generate()

```typescript
generate(opts: JostracaOptions, root: Function): Promise<JostracaResult>
```

Runs the two-phase generation process:

1. **Define phase**: the `root` function executes, composing components
   into a node tree.
2. **Build phase**: operations traverse the node tree and write files.

Options passed to `generate()` override global options.

```typescript
const result = await jostraca.generate(
  { folder: './out' },
  () => {
    Project({ folder: 'sdk' }, () => {
      File({ name: 'index.js' }, () => {
        Content('// generated\n')
      })
    })
  }
)
```

**Returns** `JostracaResult`:

| Field | Type | Description |
|---|---|---|
| `when` | `number` | Timestamp of generation |
| `files.written` | `string[]` | Files written to disk |
| `files.preserved` | `string[]` | Backup copies created (`.old.`) |
| `files.presented` | `string[]` | New files created (`.new.`) |
| `files.diffed` | `string[]` | Diff files created |
| `files.merged` | `string[]` | Merged files |
| `files.conflicted` | `string[]` | Files with merge conflicts |
| `files.unchanged` | `string[]` | Files not modified |
| `audit()` | `Audit[]` | Audit trail of all operations |
| `vol()` | `any` | Virtual volume (when `mem: true`) |
| `fs()` | `FST` | File system reference (when `mem: true`) |


---


## Components


### Project

Root container for a generation target. Sets up the base folder.

```typescript
Project(props, children)
```

| Prop | Type | Description |
|---|---|---|
| `folder` | `string` | Subfolder name within the output folder |
| `name` | `string` | Project name |

```typescript
Project({ folder: 'my-sdk' }, () => {
  // Folders and files go here
})
```


### Folder

Creates a directory in the output.

```typescript
Folder(props, children)
```

| Prop | Type | Description |
|---|---|---|
| `name` | `string` | Folder name |

Folders can be nested:

```typescript
Folder({ name: 'src' }, () => {
  Folder({ name: 'lib' }, () => {
    File({ name: 'util.js' }, () => Content('// util'))
  })
})
// Creates: src/lib/util.js
```

An empty `Folder({}, ...)` adds no path segment — useful as a grouping
container.


### File

Creates a file. Content is provided by child components.

```typescript
File(props, children)
```

| Prop | Type | Description |
|---|---|---|
| `name` | `string` | File name including extension |
| `exclude` | `boolean \| string \| (string \| RegExp)[]` | Exclude file from generation if it already exists |

```typescript
File({ name: 'config.json' }, () => {
  Content('{ "key": "value" }\n')
})
```


### Content

Adds text content to the current file. Supports template substitution.

```typescript
Content(text)
Content(props)
Content(props, children)
```

| Prop | Type | Description |
|---|---|---|
| `arg` | `string` | Content text (also accepted as first positional argument) |
| `src` | `string` | Content text (alternative to `arg`) |
| `indent` | `string \| number` | Indentation to apply |
| `name` | `string` | Optional name for the content node |
| `extra` | `object` | Additional model data merged with the global model |
| `replace` | `Record<string, any>` | Custom replacement map |

```typescript
// Simple string
Content('hello world\n')

// With template substitution (uses global model)
Content('Name: $$user.name$$\n')

// With extra model data
Content('Count: $$count$$\n', { extra: { count: 42 } })

// With custom replacements
Content('foo-bar-baz', { replace: { bar: 'BAR' } })
```


### Line

Like `Content`, but appends a newline character.

```typescript
Line(text)
Line(props)
```

Same props as [Content](#content).

```typescript
File({ name: 'list.txt' }, () => {
  Line('first')
  Line('second')
  Line('third')
})
// list.txt -> first\nsecond\nthird\n
```


### Fragment

Reads an external file and injects its content into the current file.
Supports template substitution, custom replacements, and slots.

```typescript
Fragment(props)
Fragment(props, children)
```

| Prop | Type | Description |
|---|---|---|
| `from` | `string` | Path to the fragment file (absolute or relative to output) |
| `indent` | `string \| number` | Indentation to apply |
| `exclude` | `boolean \| string[]` | Exclude conditions |
| `replace` | `Record<string, any>` | Custom replacement map (strings, functions, or components) |
| `eject` | `[string \| RegExp, string \| RegExp]` | Extract a portion of the fragment between markers |

```typescript
// Simple fragment inclusion
Fragment({ from: '/templates/header.txt' })

// With indentation
Fragment({ from: '/templates/snippet.js', indent: '  ' })

// With replacements
Fragment({
  from: '/templates/class.ts',
  replace: {
    'CLASS_NAME': 'MyClass',
    'METHOD': () => Content('doSomething() {}'),
  }
})
```

**Replacements** can be:
- **String**: literal replacement
- **Function returning string**: dynamic replacement
- **Function calling components**: component-based replacement
- **RegExp** (as `/pattern/` string key): regex-based matching

```typescript
Fragment({
  from: '/templates/code.ts',
  replace: {
    placeholder: 'value',                    // literal
    dynamic: () => 'computed-' + Date.now(),  // dynamic string
    widget: () => MyComponent({ x: 1 }),      // component
    '/name_\\w+/': ({ '$&': match }) => match.toUpperCase(),  // regex
  }
})
```


### Slot

Defines a named replaceable region within a Fragment. Used with
`<[SLOT:name]>` markers in fragment template files.

```typescript
Slot(props, children)
```

| Prop | Type | Description |
|---|---|---|
| `name` | `string` | Slot name matching the marker in the fragment |

Fragment file (`template.html`):
```html
<html>
<!-- <[SLOT:head]> -->
<body>
<[SLOT]>
<!-- <[SLOT:footer]> -->
</body>
</html>
```

Generator code:
```typescript
Fragment({ from: 'template.html' }, () => {
  Content('<main>Default content</main>')

  Slot({ name: 'head' }, () => {
    Content('<title>Page Title</title>')
  })

  Slot({ name: 'footer' }, () => {
    Content('<footer>Copyright 2025</footer>')
  })
})
```

- `<[SLOT]>` (unnamed) is replaced by non-Slot children.
- `<[SLOT:name]>` is replaced by the matching named Slot.
- Slot markers can be wrapped in comment syntax:
  `<!-- <[SLOT:name]> -->`, `// <[SLOT:name]>`, `/* <[SLOT:name]> */`,
  `# <[SLOT:name]>`.


### Inject

Updates an existing file by replacing content between start/end markers.

```typescript
Inject(props, children)
```

| Prop | Type | Description |
|---|---|---|
| `name` | `string` | File name to inject into (relative to current path) |
| `markers` | `[string, string]` | Start and end markers. Default: `['#--START--#\n', '\n#--END--#']` |
| `exclude` | `boolean` | Exclude from generation |

```typescript
// Given existing file foo.txt:
// PREFIX
// #--START--#
// old content
// #--END--#
// SUFFIX

Inject({ name: 'foo.txt' }, () => {
  Content('new content')
})
// Result: PREFIX\n#--START--#\nnew content\n#--END--#\nSUFFIX
```


### Copy

Copies files and directories from a source path into the output.
Text files are processed through the template system; binary files are
copied as-is.

```typescript
Copy(props)
```

| Prop | Type | Description |
|---|---|---|
| `from` | `string` | Source file or directory path (must exist) |
| `to` | `string` | Destination name (optional; defaults to source name) |
| `exclude` | `boolean \| (string \| RegExp)[]` | Exclude patterns |
| `replace` | `Record<string, any>` | Custom replacement map applied to text files |

```typescript
// Copy a single file
Copy({ from: '/templates/config.json', to: 'app-config.json' })

// Copy a directory (recursive)
Copy({ from: '/templates/static-assets' })

// Copy with template replacements
Copy({
  from: '/templates/src',
  replace: { 'APP_NAME': 'MyApp' }
})
```

By default, files ending with `~` are ignored. Configure via
`cmp.Copy.ignore` in options.


### List

Iterates over an array, rendering child content for each item.

```typescript
List(props, children)
```

| Prop | Type | Description |
|---|---|---|
| `item` | `any[]` | Array to iterate over |
| `indent` | `string \| number` | Indentation for each item |
| `line` | `boolean` | Add trailing newline (default: `true`) |
| `replace` | `Record<string, any>` | Custom replacement map |

Children receive `{ item, indent, replace }` as arguments. Use
`{item.path}` syntax to reference item properties.

```typescript
const items = [
  { name: 'Alice', role: 'admin' },
  { name: 'Bob', role: 'user' },
]

List({ item: items }, ({ item, replace }) => {
  Content('{item.name}: {item.role}', { replace })
})
// Alice: admin
// Bob: user
```


### None

A no-op component. Useful for conditional logic:

```typescript
const Component = condition ? ActualComponent : None
Component(props, children)
```


---


## Custom Components

Create custom components with `cmp()`:

```typescript
import { cmp, Content, each } from 'jostraca'

const MyComponent = cmp(function MyComponent(props, children) {
  // props.ctx$ provides access to the generation context:
  //   props.ctx$.model   - the data model
  //   props.ctx$.fs      - file system
  //   props.ctx$.folder  - output folder

  Content('/* generated by MyComponent */\n')

  // Call children as functions
  each(children, { call: true, args: props })
})
```

Components receive two arguments:

- **`props`**: an object with component properties. Always includes
  `ctx$` (the generation context). If a non-object is passed as the
  first argument, it becomes `props.arg`.
- **`children`**: child functions or components.

```typescript
// These are equivalent:
MyComponent('hello')
MyComponent({ arg: 'hello' })

// With children:
MyComponent({ name: 'Foo' }, () => {
  Content('child content')
})
```


---


## Options


### Global Options

Passed to `Jostraca()`. Shared across all `generate()` calls.

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `object` | `{}` | Data model for template substitution |
| `folder` | `string` | `'.'` | Base output folder |
| `fs` | `() => FS` | `node:fs` | File system factory |
| `now` | `() => number` | `Date.now` | Timestamp function |
| `log` | `Log` | console | Logging interface |
| `debug` | `string` | `'info'` | Debug level |
| `mem` | `boolean` | `false` | Use in-memory file system (memfs) |
| `vol` | `object` | | Initial virtual volume contents (with `mem`) |
| `cmp.Copy.ignore` | `RegExp[]` | `[/~$/]` | File patterns to ignore during Copy |


### Generate Options

Passed to `generate()`. Override global options for that run.

| Option | Type | Default | Description |
|---|---|---|---|
| `folder` | `string` | global | Output folder |
| `fs` | `() => FS` | global | File system factory |
| `model` | `object` | global | Data model |
| `build` | `boolean` | `true` | Run the build phase |
| `existing` | `object` | | Existing file handling (see below) |
| `meta` | `object` | `{}` | Metadata passed to generation |
| `mem` | `boolean` | global | Use in-memory file system |
| `vol` | `object` | global | Virtual volume contents |
| `control` | `object` | | Control options (see below) |


### Existing File Options

Control behavior when generated files already exist on disk. Configured
separately for text (`txt`) and binary (`bin`) files.

```typescript
existing: {
  txt: { write, preserve, present, diff, merge },
  bin: { write, preserve, present },
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `write` | `boolean` | `true` | Overwrite existing files |
| `preserve` | `boolean` | `false` | Create `.old.` backup before overwriting |
| `present` | `boolean` | `false` | Write to `.new.` file instead of overwriting |
| `diff` | `boolean` | `false` | Create annotated 2-way diff (text only) |
| `merge` | `boolean` | `false` | Create annotated 3-way merge (text only) |

**Behavior combinations:**

- `write: false` — skip files that already exist.
- `preserve: true` — `foo.txt` is backed up to `foo.old.txt` before overwriting.
- `present: true, write: false` — new version written to `foo.new.txt`.
- `diff: true` — conflicting sections shown with `<<<<<<< EXISTING` / `>>>>>>> GENERATED` markers.
- `merge: true` — 3-way merge using the previously generated version as the base.


### Control Options

```typescript
control: {
  dryrun: false,    // Do not modify any files
  duplicate: true,  // Store copy of generated output (for 3-way merge)
  version: false,   // Allow .jostraca files to be committed to git
}
```


---


## Template System


### Model Substitution

The `$$path$$` syntax substitutes values from the model:

```typescript
const jostraca = Jostraca({
  model: { user: { name: 'Alice', id: 42 } }
})

Content('Hello $$user.name$$ ($$user.id$$)')
// -> Hello Alice (42)
```

Unmatched paths are left in place for debugging:
```
$$unknown.path$$ -> $$unknown.path$$
```


### Custom Replacements

The `replace` option provides string or regex-based replacements:

```typescript
Content('hello-world-today', {
  replace: {
    // Literal string replacement
    'hello': 'HELLO',

    // Regex replacement (wrapped in /)
    '/wor(ld)/': ({ '$&': match }) => match.toUpperCase(),

    // Component replacement
    'today': () => MyComponent({ date: new Date() }),
  }
})
```

Replacement functions receive a `groups` object containing:
- Named capture groups from regex matches
- `$&`: the full match string
- `indent`: current indentation (for tag replacements)


### Tag Syntax

Tags provide a comment-based replacement mechanism:

```typescript
// In template files, use tag markers:
// #ClassName

Fragment({
  from: 'template.ts',
  replace: {
    '#ClassName': ({ name }) => Content(`class ${name} {}`),
  }
})
```

Tag format: `#Name` matches `// #Name` comment lines.
Tag-property format: `#Name-Property` matches `// #Identifier-Property`
and provides `{ Property: identifier, name: identifier }` in groups.


### Eject

Extract a portion of a fragment file between markers:

```typescript
Fragment({
  from: 'full-file.ts',
  eject: ['// START-EXTRACT', '// END-EXTRACT']
})
```

Only the content between the markers is included; the markers themselves
are removed.


---


## Utility Functions


### each

```typescript
each(subject, spec?, apply?): any[]
```

Iterate over arrays or objects with options for marking, sorting, and
calling.

| Param | Type | Description |
|---|---|---|
| `subject` | `any[] \| object` | Array or object to iterate |
| `spec.mark` | `boolean` | Add `index$`/`key$` to items (default: `true`) |
| `spec.oval` | `boolean` | Wrap non-object values as `{ val$: value }` (default: `true`) |
| `spec.sort` | `boolean \| string` | Sort items, optionally by property name |
| `spec.call` | `boolean` | Call function items (default: `false`) |
| `spec.args` | `any` | Arguments passed when calling function items |
| `apply` | `function` | Transform function applied to each item |

```typescript
// Iterate an object
each({ a: { x: 1 }, b: { x: 2 } }, (item) => {
  Content(`${item.key$}: ${item.x}\n`)
})

// Call children as functions
each(children, { call: true, args: { name: 'foo' } })

// Sort by property
each(items, { sort: 'name' }, (item) => Content(item.name))
```


### get

```typescript
get(root, path): any
```

Simple dot-path property access.

```typescript
get({ a: { b: { c: 1 } } }, 'a.b.c')  // -> 1
get({ a: { b: 2 } }, 'a.x')            // -> undefined
```


### getx

```typescript
getx(root, path): any
```

Advanced path access with operators and ancestry retention.

**Operators:** `.` (traverse), `:` (ancestry), `=`, `==`, `!=`, `~`
(regex), `<`, `<=`, `>`, `>=`

```typescript
// Ancestry: returns the root object if path resolves
getx({ a: { b: 1 } }, 'a:b')  // -> { a: { b: 1 } }

// Comparison operators
getx({ x: 5 }, 'x > 3')  // -> { x: 5 }

// Filter with ?
getx({ a: { active: true }, b: { active: false } }, '? active = true')
// -> { a: { active: true } }
```


### camelify

```typescript
camelify(input: string | string[]): string
```

Convert to CamelCase (upper first).

```typescript
camelify('foo_bar')     // -> 'FooBar'
camelify('foo-bar')     // -> 'FooBar'
camelify('fooBar')      // -> 'FooBar'
```


### snakify

```typescript
snakify(input: string | string[]): string
```

Convert to snake_case.

```typescript
snakify('FooBar')       // -> 'foo_bar'
snakify('foo-bar')      // -> 'foo_bar'
```


### kebabify

```typescript
kebabify(input: string | string[]): string
```

Convert to kebab-case.

```typescript
kebabify('FooBar')      // -> 'foo-bar'
kebabify('foo_bar')     // -> 'foo-bar'
```


### partify

```typescript
partify(input: string | string[]): string[]
```

Split a string into its constituent parts, handling camelCase,
snake_case, kebab-case, and spaces.

```typescript
partify('fooBarBaz')    // -> ['foo', 'Bar', 'Baz']
partify('foo_bar_baz')  // -> ['foo', 'bar', 'baz']
```


### names

```typescript
names(base: object, name: string, prop?: string): object
```

Generate all case variants of a name and attach them to an object.
Default `prop` is `'name'`.

```typescript
const entity = {}
names(entity, 'FooBar')
// entity.Name       -> 'FooBar'
// entity.name__orig -> 'FooBar'
// entity.name_      -> 'foo_bar'
// entity['name-']   -> 'foo-bar'
// entity.name       -> 'foobar'
// entity.NAME       -> 'FOOBAR'
```


### template

```typescript
template(src: string, model: any, spec?: TemplateSpec): string
```

Process a template string with model data and custom replacements.

| Spec field | Type | Description |
|---|---|---|
| `open` | `string` | Opening delimiter regex (default: `\\$\\$`) |
| `close` | `string` | Closing delimiter regex (default: `\\$\\$`) |
| `replace` | `Record<string, any>` | Custom replacement map |
| `eject` | `[string\|RegExp, string\|RegExp]` | Extract portion between markers |
| `handle` | `(s: string) => void` | Custom output handler |

```typescript
template('Hello $$name$$!', { name: 'World' })
// -> 'Hello World!'

template('a-b-c', {}, {
  replace: { b: 'B' }
})
// -> 'a-B-c'
```


### indent

```typescript
indent(src: string, indent: string | number): string
```

Indent each line of text.

```typescript
indent('foo\nbar', 2)      // -> '  foo\n  bar'
indent('foo\nbar', '> ')   // -> '> foo\n> bar'
```


### escre

```typescript
escre(s: string): string
```

Escape regex special characters in a string.

```typescript
escre('foo.bar*')  // -> 'foo\\.bar\\*'
```


### isbinext

```typescript
isbinext(path: string): boolean
```

Check if a file path has a binary extension (png, jpg, zip, etc.).

```typescript
isbinext('photo.png')   // -> true
isbinext('code.ts')     // -> false
```


### ucf

```typescript
ucf(s: string): string
```

Uppercase the first character.

```typescript
ucf('hello')  // -> 'Hello'
```


### lcf

```typescript
lcf(s: string): string
```

Lowercase the first character.

```typescript
lcf('Hello')  // -> 'hello'
```


### cmap

```typescript
cmap(obj: object, projection: object): object
```

Map child objects to new child objects using a projection. Each key in the
projection is a property to include; its value is a literal or a transform
function `(val, { skey, self, key, parent }) => newVal`.

```typescript
cmap(
  { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } },
  { x: cmap.COPY, y: (v) => v * 10 }
)
// -> { a: { x: 1, y: 20 }, b: { x: 3, y: 40 } }
```

Helpers: `cmap.COPY`, `cmap.FILTER`, `cmap.KEY`.


### vmap

```typescript
vmap(obj: object, projection: object): any[]
```

Like `cmap`, but returns an array of projected objects instead of a keyed
object.


### deep

```typescript
deep(...args: any[]): any
```

Deep merge objects (from `jsonic` util).


### omap

```typescript
omap(obj: object, fn: Function): object
```

Map over object entries (from `jsonic` util).


---


## File Protection

Add the string `JOSTRACA_PROTECT` anywhere in a generated file (typically
in a comment) to prevent Jostraca from overwriting it on subsequent runs:

```javascript
// JOSTRACA_PROTECT
// This file has been customized and should not be regenerated.
```

Protected files are silently skipped during generation.


---


## Metadata

Jostraca stores generation metadata in a `.jostraca/` folder within the
output directory:

```
.jostraca/
  jostraca.meta.log    # JSON metadata (file actions, timestamps)
  generated/           # Copy of generated files (for 3-way merge)
  .gitignore           # Excludes metadata from git (unless control.version: true)
```

The metadata enables:
- **3-way merge**: compares previous generated version, current on-disk
  version, and new generated version.
- **Unchanged detection**: skips files where the generated output hasn't
  changed.
- **Audit**: tracks which files were written, preserved, etc.
