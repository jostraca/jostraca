---
description: Add the jostraca package to a Node project, and run a generator to check the install.
group: install
order: 10
---

# Install Jostraca for TypeScript

Jostraca is published to npm as `jostraca`. There is no command-line
tool to install beside it: a generator is a program you write and run.

<!-- test: skip environment setup; npm is outside the scenario vocabulary -->
```sh
npm install jostraca
```

Two packages arrive. The second is `shape`, the options validator,
declared as a peer dependency and resolved by npm without a further
command.

## Which Node version

`jostraca` sets no engine floor of its own, and `shape` sets `>=20`, so a
current Node installs both without complaint. Anything earlier than 20
installs too, after an `npm warn EBADENGINE` naming `shape`: npm treats an
unmet engine as advice rather than a refusal.

Node 24 and current are the two versions the test suite runs on, so those
are the two to rely on.

## Check it works

Write this as `gen.mjs`:

<!-- test: scenario install-ts -->

<!-- test: run -->
```js
import { Jostraca, Project, File, Content } from 'jostraca'

await Jostraca().generate({ folder: './out' }, () => {
  Project({ folder: 'acme' }, () => {
    File({ name: 'README.md' }, () => {
      Content('# Acme\n')
    })
  })
})
```

Run it with `node gen.mjs`, and one file lands under `out`:

<!-- test: out -->
```text
acme/README.md
```

The run also creates `out/.jostraca/`, holding a copy of what it
generated. That copy is the base a later run merges against, which is
what gives a second run something to compare. See
[merge your changes with the user's](merge-generator-and-user-edits.md).

## Type-checking against the package

The package is CommonJS and ships its own declarations, so `import` from
an ES module and `require` from a CommonJS one both work, and TypeScript
finds the types without a separate `@types` package.

One `tsconfig.json` setting is not optional. The shipped declarations
name `Buffer` without pulling in Node's own types, so a project that
checks them reports errors inside `jostraca` rather than in your code:

<!-- test: skip quoted tsc output; there is nothing here to run -->
```text
node_modules/jostraca/dist/build/FileHandler.d.ts(44,57): error TS2580: Cannot find name 'Buffer'.
```

Set `"skipLibCheck": true`, which most projects already carry. A strict
`nodenext` project then checks clean.

## See also

- [Tutorial](../tutorial.md) to build a generator from here.
- [Install Jostraca for Go](install-go.md) for the other implementation.
- [Component reference](../reference-components.md) for every component
  that example uses.
