# Reference: utilities

The helper functions the package exports alongside the components, and
the diff engine behind the existing-file modes. This page states facts.
The [tutorial](tutorial.md) teaches, and the
[how-to guides](how-to/README.md) solve named tasks.

Every example here is executed by `ts/test/docs.test.ts`.

## What is exported

```
each  get  getx
camelify  snakify  kebabify  partify  ucf  lcf  names
cmap  vmap  deep  omap
template  escre  indent  isbinext  isbincontent
cmp  Jostraca  BuildContext
PointUtil  DiffUtil
```

`select` exists in the source and is deliberately not exported.

## `each`

```
each(subject?, spec?, apply?) => any[]
```

Iterates an array or an object and always returns an array. Anything
else — a number, a string, `null` — gives `[]`. A string is not
iterated.

| spec field | default | effect |
|---|---|---|
| `mark` | `true` | Stamp `index$` on array items, `key$` on object values. |
| `oval` | `true` | Wrap a scalar as `{val$}` for an array, `{key$, val$}` for an object. |
| `sort` | `false` | See below. |
| `call` | `false` | Invoke function items and use the return value. |
| `args` | `[]` | Arguments for `call`. An array is spread; anything else is passed as one argument. |

`spec` may be the apply function itself, in which case the third
argument is ignored.

**Object keys are always visited in sorted order**, whatever `sort`
says. That is deliberate: a Go map has no insertion order for the port
to reproduce, so sorted is the only order both stacks can agree on.

`each` **mutates your objects**: `index$` and `key$` are written onto
the source objects, not onto copies. Scalars are wrapped in new objects,
so those are left alone.

The apply signature differs by subject. For an array it is
`(item, index, all)` — it is `Array.prototype.map`. For an object it is
`(value, key, index, entries)`, where `entries` is the array of
`[key, value]` pairs.

Two sharp edges:

- `sort: 'prop'` works for an **array** subject and does nothing for an
  object one. The object branch tests the sort value against the
  literal string `"string"` rather than against its type, so an object
  subject re-sorts by `key$` — which the unconditional key sort already
  did — unless your property is literally named `string`.
- `sort: true` on an array sorts the **raw** values before wrapping;
  `sort: 'prop'` sorts the wrapped ones. Numbers therefore sort as
  strings: `[10, 9, 1]` becomes `[1, 10, 9]`.

<!-- test: scenario util-each -->

<!-- test: run -->
```js
import { each } from 'jostraca'

console.log(JSON.stringify(each([11, 22])))
console.log(JSON.stringify(each([11], { oval: false })))
console.log(JSON.stringify(each({ b: 22, a: 33 })))
console.log(JSON.stringify(each([{ n: 2 }, { n: 1 }], { sort: 'n' })))
console.log(JSON.stringify(each([() => 1], { call: true })))
console.log(JSON.stringify(each([1], (x) => 2 * x.val$)))
```

<!-- test: log -->
```text
[{"val$":11,"index$":0},{"val$":22,"index$":1}]
[11]
[{"key$":"a","val$":33},{"key$":"b","val$":22}]
[{"n":1,"index$":0},{"n":2,"index$":1}]
[{"val$":1,"index$":0}]
[2]
```

The Go port takes `EachSpec{NoMark, Raw, Sort, Args}` — the inverted
forms of `mark` and `oval` — has no `call`, and its `sort` is a boolean
only.

## `get`

```
get(root, path) => any
```

Plain dot-path lookup, with no operators. `getx` is the one with the
grammar.

<!-- test: scenario util-get -->

<!-- test: run -->
```js
import { get } from 'jostraca'

console.log(JSON.stringify(get({ a: { b: { c: 1 } } }, 'a.b.c')))
console.log(JSON.stringify(get({ a: { b: 2 } }, 'a.x')))
```

<!-- test: log -->
```text
1
undefined
```

## `getx`

```
getx(root, path) => any
```

A path language with operators. Returns `undefined` unless `root` is a
non-null object and `path` is a string or an array.

### The tokenizer, and what it eats

A string path is tokenised into quoted strings, word atoms, whitespace
runs and greedy runs of non-word characters. **Any token containing
whitespace or a dot is then discarded**, which produces three results
worth knowing before you write a path:

- `.` is a plain separator, exactly like a space. `'a.b'`, `'a b'`,
  `'a . b'` and `'a  b'` are the same path.
- Whitespace next to an operator destroys the operator, because the
  space is swallowed into the operator token and the whole token is
  dropped. `'a>=3'` works; `'a >= 3'` does not.
- A key containing a dot is unreachable from a string path, quoted or
  not.

The **array form** bypasses the tokenizer: every element is one token,
so keys with dots and spaces, and full regular expressions, all work.
Use it whenever the path is not a plain identifier chain.

### Operators

| operator | meaning |
|---|---|
| `.` or space | traverse |
| `:` | ancestry: the result becomes the object the walk started from |
| `=` | loose equality (`==`) |
| `==` | strict equality (`===`) |
| `!=` | loose inequality |
| `<` `<=` `>` `>=` | ordering, with JavaScript's typing |
| `~` | `String(value).match(RegExp(arg))` |
| `?` | filter the current node's children |

A comparison that passes yields the object the comparison was made
against, not the value. A comparison that fails yields `undefined`.

The comparison argument is coerced only for `'true'` and `'false'`;
everything else stays a **string**, and there is no numeric coercion.
Since `5 === '5'` is false, `==` is nearly useless against numbers: use
`=` unless you are comparing strings. `'null'` is not coerced either.

`~` in a string path can only take a bare word, since any metacharacter
is swallowed into the operator token. Use the array form for a real
pattern.

`?` filters the children of the current node, keeping those for which
the trailing sub-path resolves, and mirrors the input shape: an array
node gives an array, an object node gives an object keyed as before.
Its end-of-filter detection is heuristic — the filter ends at the first
pair of adjacent word tokens — so `'a?c:e=1'` works where `'a?c.e=1'`
does not. The `?` filter also **mutates the source**, leaving `each`'s
markers on the children that did not match.

<!-- test: scenario util-getx -->

<!-- test: run -->
```js
import { getx } from 'jostraca'

console.log(JSON.stringify(getx({ a: { b: 1 } }, 'a.b')))
console.log(JSON.stringify(getx({ a: { b: 1 } }, 'a:b')))
console.log(JSON.stringify(getx({ a: 5 }, 'a>3')))
console.log(JSON.stringify(getx({ a: 5 }, 'a==5')))
console.log(JSON.stringify(getx({ a: '5' }, 'a=5')))
console.log(JSON.stringify(getx({ a: [{ c: 1 }, { c: 2 }] }, 'a?c=1')))
console.log(JSON.stringify(getx({ a: 'hello' }, ['a', '~', '^h.*o$'])))
console.log(JSON.stringify(getx({ 'a.b': 1 }, ['a.b'])))
```

<!-- test: log -->
```text
1
{"a":{"b":1}}
{"a":5}
undefined
{"a":"5"}
[{"c":1}]
{"a":"hello"}
1
```

## The name-case family

```
partify(input) => string[]
camelify(input) => string
snakify(input) => string
kebabify(input) => string
ucf(s) => string
lcf(s) => string
```

`partify` splits; the other three join what it produced. All of them
stringify a non-string input rather than throwing, and an array input
is stringified element-wise with empties dropped.

The splitting rules, in order:

1. Collapse an acronym run (`FOOBar` becomes `FooBar`), guarded so a
   single capital before a lowercase tail survives (`AService` keeps
   its `A`).
2. Split on `-`, `_`, space, or before a capital.
3. Drop empty parts.
4. Re-attach a lone capital to the lowercase tail after it.

Two consequences catch people out. **Only `-`, `_` and space split** —
not `.`, not `/`, not a tab. And **digits never split**: `foo2bar` is
one part, while `foo2Bar` splits at the capital.

Round trips are not guaranteed. `kebabify(camelify('a-b-c'))` is
`'abc'`, because single-letter parts fuse.

`ucf` and `lcf` touch the first character only, so `lcf('FOO')` is
`'fOO'`.

<!-- test: scenario util-case -->

<!-- test: run -->
```js
import { partify, camelify, snakify, kebabify, ucf, lcf } from 'jostraca'

console.log(JSON.stringify(partify('XMLParser')))
console.log(camelify('foo_bar'), snakify('FooBar'), kebabify('fooBar'))
console.log(camelify('FOO'), camelify('AService'), camelify('a-b-c'))
console.log(snakify('foo2bar'), snakify('foo2Bar'))
console.log(ucf('hello'), lcf('FOO'))
```

<!-- test: log -->
```text
["Xml","Parser"]
FooBar foo_bar foo-bar
Foo AService ABC
foo2bar foo2_bar
Hello fOO
```

## `names`

```
names(base, name, prop = 'name') => base
```

Writes every case variant of `name` onto `base` and returns it.

<!-- test: scenario util-names -->

<!-- test: run -->
```js
import { names } from 'jostraca'

console.log(JSON.stringify(names({}, 'FooBar'), null, 1))
```

<!-- test: log -->
```text
{
 "name__orig": "FooBar",
 "Name": "FooBar",
 "name_": "foo_bar",
 "name-": "foo-bar",
 "name": "foobar",
 "NAME": "FOOBAR"
}
```

With a `prop` other than `'name'`, the same six keys are written with
that stem instead.

## `cmap` and `vmap`

```
cmap(source, projection) => Record<string, any>
vmap(source, projection) => any[]
```

Project each child object of `source` into a new one. Each key of the
projection is a key to write; its value is either a literal or a
transform `(value, {skey, self, key, parent}) => any`, where `value` is
the source child's value under the projection key's own name.

Both source and projection keys are iterated in sorted order, for the
same cross-stack determinism reason as `each`.

Helpers: `cmap.COPY`, `cmap.KEY`, `cmap.FILTER`, and the matching
`vmap.*`. **They are distinct function objects.** The drop sentinel is
compared by identity, so `vmap.FILTER` inside a `cmap` projection will
not drop anything.

`cmap.FILTER`'s polarity is the opposite of the obvious reading, and it
only drops in two cases:

- `FILTER(falsyValue)` drops **every** entry.
- `FILTER(fn)` where `fn` returns `[flag, value]` drops the entry when
  `flag` is **truthy**, and otherwise writes `value`.

A function that returns anything other than an array is just a mapper;
nothing is filtered. A projection key with no matching source key still
creates the key, with value `undefined`.

<!-- test: scenario util-cmap -->

<!-- test: run -->
```js
import { cmap, vmap } from 'jostraca'

const src = { b: { x: 2, y: 'B' }, a: { x: 1, y: 'A' } }

console.log(JSON.stringify(cmap(src, { x: cmap.COPY })))
console.log(JSON.stringify(cmap(src, { k: cmap.KEY })))
console.log(JSON.stringify(vmap(src, { k: vmap.KEY, x: vmap.COPY })))
console.log(JSON.stringify(cmap(src, { x: cmap.FILTER((v) => [1 < v, v]) })))
```

<!-- test: log -->
```text
{"a":{"x":1},"b":{"x":2}}
{"a":{"k":"a"},"b":{"k":"b"}}
[{"k":"a","x":1},{"k":"b","x":2}]
{"a":{"x":1}}
```

Neither function has a dedicated test suite. Treat the behaviour above
as the specification and add a case when you rely on something else.

## `deep`

```
deep(base?, ...rest) => any
```

Right-most wins. **Mutates and returns the first argument.**

Two values merge key by key only when both are objects (or functions),
the overriding value is not a function, the overriding value has no
custom constructor, and both are arrays or both are not. Otherwise the
overriding value replaces — with three exceptions: `undefined` and the
`SKIP` sentinel leave the base alone, and a plain object is deep-cloned
rather than taken by reference.

Arrays merge **by index**, and the result is as long as the longer of
the two. That is why a caller-supplied `cmp.Copy.ignore` list replaces
index 0 of the default rather than appending to it.

The custom-constructor rule is the one to remember: a `Date`, a
`RegExp` or a class instance replaces the value under its key instead
of being walked into. Walking two `RegExp`s would copy the enumerable
properties of one into the other — a `RegExp` has none — and so discard
the override entirely. That was a real bug, and it was a real
divergence from the Go port, which never had it.

Key order: keys already in `base` hold their position and new keys
append in the overriding object's enumeration order. Enumeration is
`for...in`, so **inherited enumerable properties merge too**.

<!-- test: scenario util-deep -->

<!-- test: run -->
```js
import { deep } from 'jostraca'

console.log(JSON.stringify(deep({ a: { x: 1, y: 2 } }, { a: { y: 9, z: 8 } })))
console.log(JSON.stringify(deep([1, 2, 3], [9])))
console.log(JSON.stringify(Object.keys(deep({ b: 1, a: 1 }, { a: 2, c: 3 }))))
console.log(JSON.stringify(deep({ a: 1 }, undefined, { b: 2 })))

const base = { a: 1 }
console.log(deep(base, { b: 2 }) === base)
```

<!-- test: log -->
```text
{"a":{"x":1,"y":9,"z":8}}
[9,2,3]
["b","a","c"]
{"a":1,"b":2}
true
```

## `omap`

```
omap(source?, fn?) => Record<string, any>
```

Builds a **new** object; the source is untouched. `fn` receives
`[key, value]` and returns the replacement pair. A returned key of
`undefined` drops the entry, and extra pairs beyond index 1 set extra
keys.

Entries are visited in **sorted key order**, the same convention `each`,
`cmap` and `vmap` follow. That is a deliberate divergence from the
jsonic original this replaced, which walked insertion order, and it is
what lets the Go port agree.

Visiting in sorted order is not the same as producing sorted output:
renaming keys does not re-sort, and numeric-looking keys follow
JavaScript's own integer-key ordering once written.

## `escre`

```
escre(s) => string
```

Escapes the fourteen regular-expression metacharacters
`. * + ? ^ $ { } ( ) | [ ] \`. It does **not** escape `-`, `/` or `#`,
and it does not coerce: a non-string throws.

## `indent`

```
indent(src, indent) => string
```

Prefixes every line start that is not the end of the string. `indent`
defaults to `2`; a number becomes that many spaces, anything else is
stringified and used literally. `src` is coerced, so `null` gives `''`.

A blank line inside the text **is** indented, which leaves trailing
whitespace on it. A trailing newline is not followed by a line start,
so nothing is appended after it.

<!-- test: scenario util-indent -->

<!-- test: run -->
```js
import { indent } from 'jostraca'

console.log(JSON.stringify(indent('a\nb', 2)))
console.log(JSON.stringify(indent('a\nb', '--')))
console.log(JSON.stringify(indent('a\n\nb', 2)))
console.log(JSON.stringify(indent('a\n', 2)))
console.log(JSON.stringify(indent('{\n  a\n}', 2)))
console.log(JSON.stringify(indent(null, 2)))
```

<!-- test: log -->
```text
"  a\n  b"
"--a\n--b"
"  a\n  \n  b"
"  a\n"
"  {\n    a\n  }"
""
```

A negative number throws, since it reaches `String.repeat`.

## `isbinext` and `isbincontent`

```
isbinext(path) => boolean
isbincontent(content) => boolean
```

`isbinext` tests the lower-cased final extension against a fixed set of
around 250 names — `png`, `jpg`, `pdf`, `zip`, `exe`, `so`, `woff2`,
`docx` and the rest. Only the last dot segment counts.

`isbincontent` looks for a NUL byte in the first 8192 bytes.

`Copy` and the existing-file modes use both: the extension decides, and
the content sniff can promote an unlisted extension to binary. It never
demotes a listed one to text. See
[`existing`](reference-options.md#existing).

<!-- test: scenario util-binext -->

<!-- test: run -->
```js
import { isbinext, isbincontent } from 'jostraca'

console.log(isbinext('photo.png'), isbinext('code.ts'), isbinext('noext'))
console.log(isbincontent('plain text'), isbincontent(Buffer.from([0, 1, 2])))
```

<!-- test: log -->
```text
true false false
false true
```

## `template`

```
template(src, model, spec?) => string
```

The substitution engine behind `Content`, `Fragment` and `Copy`.
`$$path$$` resolves against the model with `getx`, so the full path
grammar above is available. An unresolved path is **left in place**,
which is deliberate: a typo shows up in the output rather than
vanishing.

| spec field | effect |
|---|---|
| `open` / `close` | Delimiter patterns. Default `\\$\\$` for both. |
| `replace` | Custom replacements. |
| `eject` | Keep only the region between two markers. |
| `handle` | A sink called with each output piece instead of joining. |

### The `replace` map

Keys are matched in three ways:

- A key wrapped in `/…/` is a raw regular expression.
- A key of the form `#Name` or `#Name-Tag` matches a comment tag line:
  `// #Name`.
- Anything else is matched literally, escaped with `escre`.

Values may be a string, a function returning a string, or a function
that calls components.

A function value receives a groups object carrying any named capture
groups, the whole match under `$&`, and the current `indent`.

One asymmetry to know: a replacement that **emits a component** lands in
a different place depending on the caller. `Fragment` streams its
output, so the component appears where the marker was. `Content` joins
its template output into one string first, so the component is appended
after the whole string. Where the position matters, use `Fragment`, or
have the function return a string.

## `PointUtil`

A small extension-point mechanism, exported as a namespace. It is used
internally and has no stable published contract yet; read
`ts/src/util/point.ts` before depending on it.

## `DiffUtil`

The line-diff and three-way-merge engine behind the `diff` and `merge`
existing-file modes. `go/diff.go` mirrors it closely, and the 1200-case
corpus in `go/testdata/parity/diff_corpus.json` holds the two stacks to
the same output. Two differences survive that corpus, because no case
in it goes near them:

- `hasConflicts` is one function in TypeScript and two in Go,
  `HasConflicts` and `HasConflictsLabel`.
- An empty-string `kind` or label is a value in TypeScript and an
  absence in Go, which falls back to the default. Passing `''` is the
  only way to reach it.

### `DiffUtil.merge(generated, baseline, existing, spec?)`

Named for what the three inputs are: what this run produced, what the
last run produced, and what is on disk now. Using the previous generate
as the ancestor is what preserves hand edits.

Returns `{content, conflict, outcome}`. `outcome` reports which path
was taken, so a caller need not re-derive it:

| outcome | meaning | content |
|---|---|---|
| `same` | the file on disk already equals the new generate | `existing` |
| `clean` | the file is untouched since the last generate | `generated` |
| `unresolved` | the file still holds markers from an earlier merge | `existing`, untouched |
| `merged` | a real three-way merge ran | the merged text |

The first three are fast paths, each semantically identical to running
the full merge and each skipping the quadratic core.

`spec` takes `when`, `last` and `kind` for the marker labels, or
`labels` to override either side outright.

### `DiffUtil.diff(generated, existing, spec?)`

Two-way annotated diff. Unchanged text passes through; each changed
region becomes a pair of marked blocks, existing side first. Returns
`{content, conflict, outcome}` with `outcome` of `same` or `changed`.

`conflict` is not a finding here. It is `true` on every `changed`
result and `false` on every `same` one, so it repeats the outcome
rather than reporting that anything genuinely clashes. Only `merge`
sets it from real conflicting edits.

The two marker layouts differ, and the difference is not cosmetic — see
[the options reference](reference-options.md#each-mode) for both,
generated from real runs.

### `DiffUtil.hasConflicts(text, existingLabel?)`

Whether the text still holds an unresolved conflict. Keyed on the
closing `EXISTING` marker alone, so a half-resolved file (opening
marker removed, closing one left) still counts.

The second argument is easy to miss, and missing it costs you the
check. Without it the check matches only the default
`>>>>>>> EXISTING:` sentinel, so a
conflict written under a custom `labels.existing` is not recognised,
and the next merge nests a fresh set of markers inside the old ones.
Pass the same `existingLabel` you passed to `merge`.

### Primitives

`lines(text)`, `lcs(a, b)`, `alignLcs(base, target)` and
`hunks(generated, existing)` are exported for reuse. `lines` keeps the
newline on each line, so `lines(s).join('') === s` for every input,
including one with no trailing newline.

**Only `lines` takes a string.** The other three take arrays of lines,
which is what `lines` returns, so the pairing is
`hunks(lines(a), lines(b))`. Their result types are nameable through
the namespace, as `DiffUtil.DiffResult` and the rest, with one
exception: `Hunk`, the element type `hunks` returns, is not exported.

### Notes

- Common prefix and suffix are trimmed first, then Hirschberg's
  algorithm runs on the remainder: linear space, quadratic time on what
  is left. The trim only reaches the ends. Changes in one contiguous
  span leave almost nothing for the quadratic core, and the cost hardly
  moves as the file grows; changes at both ends leave the whole middle
  in it, and the cost then grows with the square of the file. Measured
  on this engine, the gap between the two reaches three orders of
  magnitude before 10 000 lines.
- **A `diff` render blocks a later `merge`.** The closing marker of a
  deletion block is `>>>>>>> EXISTING: <timestamp>/diff`, which carries
  the same sentinel an unresolved merge does. Point `merge` at that
  file and it reports `unresolved` and declines to touch it. Clear the
  diff markers by hand before switching a file between the two modes.
- Conflict markers always start their own line, including when the last
  line of a region has no trailing newline.
- **A three-way merge can drop content, correctly.** If the user deleted
  a region the generator did not touch, the deletion wins. "Every
  generated line survives" is not an invariant; the
  [explanation](explanation.md#existing-files-and-the-merge-base) argues
  why.

Next: the [component reference](reference-components.md), the
[options reference](reference-options.md), and the [Go
reference](reference-go.md).
