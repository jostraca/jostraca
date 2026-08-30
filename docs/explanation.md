# Explanation: why Jostraca is shaped this way

This page argues the design. It is not the place to look up a prop or
follow a recipe — the [component reference](reference-components.md) and
the [how-to guides](how-to/README.md) do those jobs. Read this to build
a model of why the pieces sit where they do, and what the arrangement
costs.

## The problem is the second run

Code generation has an easy first run and a hard second one. The first
run writes into an empty directory and everybody is pleased. The second
run arrives weeks later, after the generated code has been checked in,
read, debugged and edited by hand. A generator that treats the output
directory as scratch space deletes that work, silently, with a zero exit
code.

The usual responses avoid the problem rather than solve it. Generate
into a directory nobody may touch, and re-export by hand. Generate once,
commit, and never run the generator again. Split every file into a
generated half and an editable half, and pay the ceremony on every file
forever. Each of these works. Each is a way of not running the generator
twice.

Jostraca's position is that the file already on disk is an **input**,
not an obstacle. Everything below follows from taking that seriously.

## Two phases, and what the split buys

A `generate()` call runs in two halves. The **define phase** executes
your callback: every component call records a node in an in-memory tree,
and nothing touches the filesystem. The **build phase** then walks that
tree and performs the file operations.

The order matters more than it looks. Because the entire intended output
exists before the first byte is written, the build phase can ask
questions a streaming generator cannot answer:

- Does this file already exist, and does its content differ from what I
  am about to write?
- Is it the same as what I wrote last time, so there is nothing to do?
- Does it carry a marker saying it has been taken out of my hands?
- If it has changed since my last run, which of the changes are mine and
  which are the user's?

A generator that opens a stream and writes as it goes has already
committed to the first file before it knows the tenth exists. Two phases
are what make a policy about existing files possible at all.

The split also produces a smaller benefit that shows up daily: an error
in your generator logic is raised during define, before anything is
written, so a failed run leaves the output directory as it was.

## The ambient tree

Components nest by ordinary function calls, with no parent threaded
through the arguments:

<!-- test: scenario ambient -->

<!-- test: run -->
```js
import { Jostraca, Project, Folder, File, Content } from 'jostraca'

await Jostraca().generate({ folder: './out' }, () => {
  Project({ folder: 'app' }, () => {
    Folder({ name: 'src' }, () => {
      File({ name: 'index.js' }, () => Content('// generated\n'))
    })
  })
})
```

<!-- test: out -->
```text
app/src/index.js
```

`File` knew it was inside `Folder` inside `Project` because `cmp()`
keeps the current node in an `AsyncLocalStorage`, and each component
call swaps it for the duration of its children. That is the whole trick,
and it is why a component author writes `Content(...)` rather than
`ctx.append(node, ...)`.

Two consequences are worth stating plainly.

The storage lives on `global` rather than on the `Jostraca` instance. It
has to: a component imported from `jostraca` must find the context of
whichever `generate()` is running, and an npm dedupe miss that loads two
copies of the package would otherwise give the two copies separate
storages and separate trees. Putting it on `global` makes them
interoperate.

And a component called outside `generate()` has no context, so it
throws. The error says so in as many words rather than failing with an
undefined property read, because "cannot read properties of undefined"
tells a caller nothing about the actual mistake.

## Components, not a template dialect

The alternative design is a template language: files of text with
interpolation markers, driven by a data model. It starts smaller than
this one and it grows in a predictable direction. First an
interpolation. Then a conditional, because one project needs a section
the others do not. Then a loop. Then partials, because the templates
repeat. Then an escape hatch to call real code, because the dialect
cannot express the thing you actually need. Every step is locally
reasonable and the destination is a second programming language with
worse tooling than the one you started in.

Jostraca's components are function calls, so iteration, branching,
parameters and extraction are whatever your language already does. You
also get its debugger, its type checker and its test runner, none of
which a dialect can offer without building them.

The template syntax that remains is deliberately unable to grow:
`$$path$$` substitutes a value from the model, and does nothing else. No
conditionals, no loops, no expressions. Anything harder lives in the
surrounding code, where it can be tested.

**What this costs.** A template file can be opened and read; a component
tree cannot. Somebody reviewing a generator has to run it to see its
output, and the shape of a generated file is spread across function
calls rather than sitting in one readable artifact. `Fragment` and
`Slot` give some of that back — an external template file with named
regions the generator fills — and that is exactly why they exist. They
do not give all of it back.

## Existing files, and the merge base

The build phase decides what to do with a file that already exists, per
file extension, from five modes: `write` overwrites, `preserve` writes
the new version and leaves the old bytes in a sibling, `present` leaves
the file alone and writes the new version beside it, `diff` writes an
annotated two-way diff, and `merge` performs a three-way merge. They are
checked in that order, which is why `present` needs `write: false` to
take effect at all. The [options reference](reference-options.md)
specifies each one.

`merge` is the interesting one, and the interesting question about a
three-way merge is what it uses as the base. Jostraca keeps a copy of
what it generated last time under `.jostraca/` beside the output, and
uses that. The consequence is precise: anything in the file that is not
in the base is somebody's edit, and anything the generator changed since
the base is the generator's. Both are applied. Where they touch the same
lines, conflict markers go in and the file is reported in
`result.files.conflicted`, because guessing there would be worse than
stopping.

Choosing the previous generate rather than, say, an empty file is what
makes hand edits survivable. It also means the guarantee is narrower
than people expect, and the narrowness is deliberate:

<!-- test: scenario merge-drops -->

<!-- test: run -->
```js
import { writeFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({
  existing: { txt: { write: true, merge: true } },
})

const run = (body) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'notes.txt' }, () => Content(body))
  })
})

await run('one\ntwo\nthree\n')

// The user deletes a line the generator did not touch.
writeFileSync('./out/notes.txt', 'one\nthree\n')

await run('one\ntwo\nthree\nfour\n')
```

`notes.txt` now holds:

<!-- test: file out/notes.txt -->
```text
one
three
four
```

The generator asked for `two` on both runs and it is not there. That is
correct: the user deleted it, the generator did not change it, so the
deletion is the only intent expressed about that line. "Every generated
line survives a merge" is not an invariant, and a design that made it
one would have to overrule the user to do it.

A file containing the string `JOSTRACA_PROTECT` sits outside all of
this. It is never overwritten, whatever the modes say. Under `write`,
`preserve`, `diff` and `merge` it is skipped outright and appears in
none of the result lists — not written, not preserved, not even
reported as unchanged. Under `present` the protection stops the
overwrite but not the run: the new version still lands in the `.new.`
sidecar and the file is reported as presented, which is the useful
behaviour, since a user who has taken a file over may still want to see
what they are declining.

It is the blunt instrument, and it is blunt on purpose: a user should be
able to take a file away from your generator without negotiating with
you about which mode to configure.

## The bookkeeping directory

`merge` needs the previous generate, and unchanged-detection needs to
know what the last run produced. Both come from a `.jostraca/` directory
written beside the output: a copy of what was generated, and a log of
what happened to each file.

It is gitignored by default, and that default is the arguable one. The
case for ignoring it is that it is derived state whose only reader is
the next run, and a diff of it on every commit is noise. The case
against is that a colleague who clones the repository and regenerates
has no base, so their first merge degrades to a two-way comparison.
`control.version: true` switches it, and which one is right depends on
whether your generator runs on one machine or many.

## Two implementations

TypeScript is canonical; Go is a port that aims at byte-identical output
for the same logical input. The parity is held by a shared,
language-neutral corpus in [`../test/spec/`](../test/spec/) that both
test suites read, so a case added there is picked up by both runners
with no code change, and an unknown case is a hard failure on both sides
rather than a silent skip on one.

The rule for disagreements is that TypeScript wins and Go is the one
that changes — including on the occasions when the Go code is the more
correct of the two. That sounds perverse and it is the only rule that
converges. A parity project with two sources of truth has none, and
"whichever looks better today" is not a rule anybody can apply twice the
same way. When the port turns out to have pre-empted a bug, the fix is
still to correct TypeScript first and then realign Go, which is what
happened to `deep`: the port never copied one custom-constructor value's
properties into another, canonical TypeScript did, and the correction
landed in TypeScript with the Go behaviour as the target.

One more parity constraint shows up in a place nobody expects. `omap`,
`each`, `cmap` and `vmap` visit object entries in **sorted key order**,
not insertion order. A Go map has no insertion order to reproduce, so
matching it in TypeScript is the only way both stacks can agree on the
order of anything derived from an object. It is a real behavioural
difference from the JavaScript norm, and it is the price of the
byte-identical claim.

## What Jostraca is not for

If you scaffold a project once and never generate into it again, a
template repository is simpler and you should use one. If the output is
a single file with no structure, a string and `writeFileSync` will do.
Jostraca starts paying for itself when the output is a tree, the tree is
checked in, and the generator is going to run again.

Next: the [tutorial](tutorial.md) builds a generator from nothing, and
the [how-to guides](how-to/README.md) cover the tasks this page has only
argued about.
