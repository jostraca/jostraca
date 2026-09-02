# Tutorial: generate a service, then generate it again

A generator earns its keep on the second run. The first one is easy—any
script that writes files can do it. The second one arrives after
somebody has edited the output, and that is where most generators go
wrong.

We are going to build a small generator for an HTTP service: a package
file, a config file, one module per route, and an index page from a
template. Then we will edit the output by hand and run the generator
again, which is the step this whole design exists for.

There is no template syntax to learn on the way. Everything here is
ordinary JavaScript: the loop that writes one module per route is a
`for`, and the one template file we do use stays valid HTML, because
its marker sits inside an HTML comment.

Each step below is a complete file. Copy any one of them into `gen.mjs`
and run it—you do not have to have followed the previous step. Every
snippet on this page is executed by the test suite, and every listing
below it is what the generator actually wrote.

## 1. Set up

Install the package. `shape` is a peer dependency and npm pulls it in
for you:

<!-- test: skip environment setup; npm is outside the scenario vocabulary -->
```sh
npm install jostraca
```

`shape` validates the options you pass. The in-memory mode we reach in
step 7 needs nothing extra: jostraca carries its own in-memory
filesystem. Jostraca has no command of its own. A generator is a
program you write and run:

<!-- test: skip environment setup; node is outside the scenario vocabulary -->
```sh
node gen.mjs
```

## 2. A tree of components

Nesting components mirrors the folders and files you want. `Project`
roots one generated tree, `Folder` adds a path segment, `File` names a
file, and `Content` puts text in it.

<!-- test: scenario first-tree -->

Write this as `gen.mjs`:

<!-- test: run -->
```js
import { Jostraca, Project, Folder, File, Content } from 'jostraca'

const jostraca = Jostraca()

await jostraca.generate({ folder: './out' }, () => {
  Project({ folder: 'acme-api' }, () => {

    File({ name: 'package.json' }, () => {
      Content('{ "name": "acme-api", "type": "module" }\n')
    })

    Folder({ name: 'src' }, () => {
      File({ name: 'server.js' }, () => {
        Content("import { createServer } from 'node:http'\n")
      })
    })
  })
})
```

Run it, and `out/` holds:

<!-- test: out -->
```text
acme-api/package.json
acme-api/src/server.js
```

You declared a tree; Jostraca built it. Note what the callback did
*not* do: it wrote nothing. Component calls record nodes in an
in-memory tree, and only when the callback returns does Jostraca walk
that tree and touch the disk. Everything else in this tutorial follows
from that split.

## 3. Put data in the files

Real generators produce files that vary with their input. Pass a
`model` to `Jostraca()`, and `$$path$$` inside content is replaced by
the value at that path.

<!-- test: scenario model -->

<!-- test: run -->
```js
import { Jostraca, Project, File, Content } from 'jostraca'

const model = {
  service: { name: 'acme-api', port: 8080 },
}

const jostraca = Jostraca({ model })

await jostraca.generate({ folder: './out' }, () => {
  Project({ folder: model.service.name }, () => {

    File({ name: 'package.json' }, () => {
      Content('{ "name": "$$service.name$$", "type": "module" }\n')
    })

    File({ name: 'config.json' }, () => {
      Content('{ "port": $$service.port$$ }\n')
    })
  })
})
```

Which gives `out/acme-api/config.json`:

<!-- test: file out/acme-api/config.json -->
```json
{ "port": 8080 }
```

The port arrived as a bare `8080` rather than `"8080"`, because
substitution puts the value in as text and the surrounding JSON was
already quoted the way it wanted to be.

Two things are worth pinning down here. Substitution happens **inside
content**, not in names: the project folder shown earlier is
`model.service.name`, an ordinary JavaScript expression, because a
component call is a function call and you already have a language for
that. And `$$path$$` has no conditionals, no loops, and no expressions
of its own. Anything harder belongs in the code around it.

## 4. One file per item

Data usually arrives as a list. `each` iterates an array or an object,
and inside it you call components as normal.

<!-- test: scenario many-files -->

<!-- test: run -->
```js
import { Jostraca, Project, Folder, File, Content, each } from 'jostraca'

const routes = [
  { path: '/health', method: 'get' },
  { path: '/login', method: 'post' },
]

const jostraca = Jostraca()

await jostraca.generate({ folder: './out' }, () => {
  Project({ folder: 'acme-api' }, () => {
    Folder({ name: 'routes' }, () => {

      each(routes, (route) => {
        File({ name: route.path.slice(1) + '.js' }, () => {
          Content("export const method = '" + route.method + "'\n")
        })
      })
    })
  })
})
```

<!-- test: out -->
```text
acme-api/routes/health.js
acme-api/routes/login.js
```

`each` is a convenience, not a requirement—a plain `for` loop or
`routes.map()` works exactly as well. It earns its place when the
subject might be an object rather than an array, or when you want the
items sorted, because it handles both without a branch at the call
site.

## 5. Give a shape a name

When the same shape appears more than once, wrap it in `cmp()`. That
turns an ordinary function into a component: it can be called from
inside the tree, and the components it calls attach in the right place.

<!-- test: scenario component -->

<!-- test: run -->
```js
import { Jostraca, Project, Folder, File, Content, cmp, each } from 'jostraca'

const Handler = cmp(function Handler(props) {
  Content('export function ' + props.name + '() {\n')
  Content("  return { method: '" + props.method + "' }\n")
  Content('}\n')
})

const routes = [
  { name: 'health', method: 'get' },
  { name: 'login', method: 'post' },
]

const jostraca = Jostraca()

await jostraca.generate({ folder: './out' }, () => {
  Project({ folder: 'acme-api' }, () => {
    Folder({ name: 'routes' }, () => {

      each(routes, (route) => {
        File({ name: route.name + '.js' }, () => {
          Handler(route)
        })
      })
    })
  })
})
```

`out/acme-api/routes/health.js` holds:

<!-- test: file out/acme-api/routes/health.js -->
```js
export function health() {
  return { method: 'get' }
}
```

`Handler` never mentions a file, a folder, or a path. It emits content,
and where that content lands is decided by whoever called it—which is
what makes it reusable. A component receives its props as the first
argument, always with `ctx$` added, so `props.ctx$.model` reaches the
model from inside a component that was not handed it.

## 6. Fill a template file

Some output is easier to keep as a file you can open in an editor.
`Fragment` reads such a file in, and `Slot` fills the marked regions
inside it.

<!-- test: scenario fragment -->

Put the template at `tpl/index.html`, marking the regions to fill:

<!-- test: input tpl/index.html -->
```html
<!doctype html>
<html>
  <head>
    <!-- <[SLOT:head]> -->
  </head>
  <body>
    <[SLOT]>
  </body>
</html>
```

Then fill them:

<!-- test: run -->
```js
import { Jostraca, Project, File, Fragment, Slot, Content } from 'jostraca'

const jostraca = Jostraca()

await jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'index.html' }, () => {

      Fragment({ from: '../tpl/index.html' }, () => {
        Slot({ name: 'head' }, () => {
          Content('<title>Acme</title>')
        })
        Content('<h1>Acme</h1>')
      })
    })
  })
})
```

The generated `index.html` holds:

<!-- test: file out/index.html -->
```html
<!doctype html>
<html>
  <head>
<title>Acme</title>
  </head>
  <body>
<h1>Acme</h1>
  </body>
</html>
```

Two details to take away. `<[SLOT:head]>` was filled by the `Slot`
named `head`, and the bare `<[SLOT]>` was filled by everything else
inside the `Fragment`. And a marker is replaced whole, so the
replacement starts at column zero rather than inheriting the marker's
indentation—pass `indent` to `Content` when that matters.

The path in `from` is relative to the **output folder**, not to your
script. That is why `../tpl/index.html` reaches a template beside
`out/`. An absolute path also works, and in a generator you ship you
will usually build one from `import.meta.url`.

## 7. Run it again

Now the part that matters. Generate a config file, edit it the way a
user would, and generate again.

<!-- test: scenario second-run -->

<!-- test: run -->
```js
import { appendFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca()

const run = (body) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'config.sh' }, () => Content(body))
  })
})

await run('PORT=8080\nHOST=localhost\n')

// Somebody adds a line by hand.
appendFileSync('./out/config.sh', 'DEBUG=1\n')

await run('PORT=9090\nHOST=localhost\n')
```

Afterwards, `config.sh` holds:

<!-- test: file out/config.sh -->
```sh
PORT=9090
HOST=localhost
```

`PORT` moved, which is what the second run was for. `DEBUG=1` is gone,
which nobody asked for. That is the default, `write`, and it is the
right default for output nobody edits—but it is not what you want
here.

Add one option. `merge` performs a three-way merge, using the previous
generate as the base:

<!-- test: scenario second-run-merged -->

<!-- test: run -->
```js
import { appendFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({
  existing: { txt: { write: true, merge: true } },
})

const run = (body) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'config.sh' }, () => Content(body))
  })
})

await run('PORT=8080\nHOST=localhost\n')
appendFileSync('./out/config.sh', 'DEBUG=1\n')
await run('PORT=9090\nHOST=localhost\n')
```

This time `config.sh` holds:

<!-- test: file out/config.sh -->
```sh
PORT=9090
HOST=localhost
DEBUG=1
```

Both changes survived. Jostraca kept a copy of the first generate under
`.jostraca/` beside the output, so on the second run it could tell your
change (`PORT`) from the user's (`DEBUG`) and apply both. Where the two
sides touch the same lines it writes conflict markers instead of
guessing, and reports the file in `result.files.conflicted`.

`merge` is one of five modes. `preserve` overwrites but leaves the old
bytes in `config.old.sh`. `diff` writes an annotated two-way diff.
`present` leaves the file alone and writes `config.new.sh` beside it—and
it is the one mode with a trap in it, because `write` is checked
first and defaults to `true`. Turning `present` on without turning
`write` off overwrites the file you meant to protect:

<!-- test: scenario present -->

<!-- test: run -->
```js
import { appendFileSync } from 'node:fs'
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({
  existing: { txt: { write: false, present: true } },
})

const run = (body) => jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'config.sh' }, () => Content(body))
  })
})

await run('PORT=8080\n')
appendFileSync('./out/config.sh', 'DEBUG=1\n')
await run('PORT=9090\n')
```

<!-- test: out -->
```text
config.new.sh
config.sh
```

`config.sh` is untouched, edit and all:

<!-- test: file out/config.sh -->
```sh
PORT=8080
DEBUG=1
```

Finally, a file containing the string `JOSTRACA_PROTECT` is never
overwritten, under any mode—that is how a user takes a file away from
your generator without asking you first. Protection stops the
overwrite, not the run: under `present` the new version still appears
in the `.new.` sidecar and the file is reported in
`result.files.presented`, so the user can see what they are declining.
Under every other mode a protected file is skipped outright and appears
in none of the result lists.

## Where to go next

- The [how-to guides](how-to/README.md) are one page per task—copying
  directories, injecting into files that already exist,
  generating in memory for tests, driving Jostraca from your own tool.
- The [component reference](reference-components.md) lists every
  component and every prop, and the [options
  reference](reference-options.md) specifies the existing-file modes
  you just met.
- The [explanation](explanation.md) argues why the two phases are
  split, and admits what the design costs.
