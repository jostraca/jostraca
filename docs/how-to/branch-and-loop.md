---
description: Use ordinary JavaScript control flow to decide what a generator emits.
group: reuse
order: 30
---

# Branch and loop in a generator

There is no conditional syntax to learn, because a component call is a
function call. Use `if`, use `for`, use `map`.

<!-- test: scenario reuse-flow -->

<!-- test: run -->
```js
import { Jostraca, Project, Folder, File, Content } from 'jostraca'

const model = {
  name: 'acme',
  typescript: true,
  routes: ['health', 'login'],
}

await Jostraca().generate({ folder: './out' }, () => {
  Project({ folder: model.name }, () => {

    if (model.typescript) {
      File({ name: 'tsconfig.json' }, () => Content('{}\n'))
    }

    Folder({ name: 'routes' }, () => {
      for (const route of model.routes) {
        File({ name: route + (model.typescript ? '.ts' : '.js') }, () => {
          Content('export const name = "' + route + '"\n')
        })
      }
    })
  })
})
```

<!-- test: out -->
```text
acme/routes/health.ts
acme/routes/login.ts
acme/tsconfig.json
```

To skip a component, do not call it. There is no no-op component to
substitute — `None` exists internally and is not exported — so the
branch is the mechanism.

`each` is available when you want its extras: it takes an object as
readily as an array, it can sort, and it wraps scalars so a uniform
callback works either way. A plain loop is otherwise fine and reads
better.

<!-- test: run -->
```js
import { Jostraca, Project, File, Content, each } from 'jostraca'

const services = { beta: { port: 2 }, alpha: { port: 1 } }

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'ports.txt' }, () => {
      each(services, (svc) => {
        Content(svc.key$ + '=' + svc.port + '\n')
      })
    })
  })
})
```

The generated `ports.txt`:

<!-- test: file out/ports.txt -->
```text
alpha=1
beta=2
```

Note the order. `each` visits object keys **sorted**, not in insertion
order, so that the TypeScript and Go implementations produce the same
bytes. `svc.key$` is the key, stamped on by `each`.

## See also

- [Generate one file per item](../reference-components.md#list) using
  the `List` component, when the repetition is inside one file.
