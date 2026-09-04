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

Jostraca needs Node 20 or newer, which is what `engines.node` declares.
The test suite passes on Node 20, 24, and current.

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

A project that type-checks its dependencies needs Node's own types for
this package to check clean: `npm i --save-dev @types/node`. What it looks
like without them is under [Troubleshooting](#troubleshooting).

## Troubleshooting

### npm warns that the Node version is unsupported

<!-- test: skip quoted npm output; there is nothing here to run -->
```text
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'jostraca@0.36.6',
npm warn EBADENGINE   required: { node: '>=20' },
npm warn EBADENGINE   current: { node: 'v18.20.8', npm: '10.8.2' }
npm warn EBADENGINE }
```

The install is running on a Node older than 20. npm prints this and
installs anyway, so it is a warning rather than a failure—unless the
project sets `engine-strict=true`, where npm refuses and the install
fails instead.

The same warning can name `shape`, the peer dependency. Its range is
`>=11`, and 11.0 through 11.3 asked for Node 24 before 11.4.0 lowered it
to 20. A project still resolving one of those older releases gets the
warning on Node 20 through 23, even though `jostraca` is satisfied.
Updating `shape` clears it.

### TypeScript reports errors inside node_modules/jostraca

<!-- test: skip quoted tsc output; there is nothing here to run -->
```text
node_modules/jostraca/dist/build/FileHandler.d.ts(44,57): error TS2580: Cannot find name 'Buffer'.
```

The shipped declarations name `Buffer` without pulling in Node's own
types, so a project that type-checks its dependencies reports the error
there rather than in your code.

Install Node's types: `npm i --save-dev @types/node`. That defines the
global `Buffer` and clears it. Measured against this release with
`skipLibCheck` off: five errors without them, none with. A project that
restricts `compilerOptions.types` needs `node` in that list too.

`"skipLibCheck": true` also silences it, and many projects already carry
it, but it turns off declaration checking for every dependency rather than
supplying the one type that is missing.

## See also

- [Tutorial](../tutorial.md) to build a generator from here.
- [Install Jostraca for Go](install-go.md) for the other implementation.
- [Component reference](../reference-components.md) for every component
  that example uses.
