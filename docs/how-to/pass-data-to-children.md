---
description: Give a custom component a body, and call that body once per item with data.
group: reuse
order: 20
---

# Pass data to child components

A component's second argument is its children. Call them with `each`,
and use `args` to hand each call some data.

<!-- test: scenario reuse-children -->

<!-- test: run -->
```js
import { Jostraca, Project, File, Content, cmp, each } from 'jostraca'

const ForEachRoute = cmp(function ForEachRoute(props, children) {
  each(props.routes, (route) => {
    each(children, { call: true, args: route })
  })
})

const routes = [
  { path: '/health', method: 'get' },
  { path: '/login', method: 'post' },
]

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'routes.js' }, () => {

      ForEachRoute({ routes }, (route) => {
        Content("route('" + route.method + "', '" + route.path + "')\n")
      })
    })
  })
})
```

The generated `routes.js`:

<!-- test: file out/routes.js -->
```js
route('get', '/health')
route('post', '/login')
```

`each(children, {call: true, args: route})` is the whole convention.
`args` is spread into the call, so a single non-array value arrives as
one argument, and an array arrives as several.

The model is reachable without threading it through, on `props.ctx$`:

<!-- test: run -->
```js
import { Jostraca, Project, File, Content, cmp } from 'jostraca'

const Header = cmp(function Header(props) {
  Content('/* ' + props.ctx$.model.service.name + ' */\n')
})

const jostraca = Jostraca({ model: { service: { name: 'acme' } } })

await jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'h.js' }, () => Header({}))
  })
})
```

The generated `h.js`:

<!-- test: file out/h.js -->
```js
/* acme */
```

`ctx$` also carries `meta`, the filesystem provider, and the resolved
output folder. Use `meta` for data that is about the run rather than
about the output—Jostraca never reads it.

One caution: `cmp()` sets `ctx$` on the props object you passed, rather
than on a copy. Do not reuse one props object across two component
calls and expect it to be untouched.

## See also

- [Make a reusable component](make-a-reusable-component.md) for the
  basics.
- [Utilities reference](../reference-utilities.md#each) for the rest of
  `each`.
