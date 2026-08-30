---
description: Use Inject to replace the region between two markers in a file that already exists.
group: files
order: 40
---

# Edit a file you did not generate

`Inject` rewrites the region between two markers in a file that is
already there. Use it for the file your generator contributes to rather
than owns: a shared config, a registry of routes, a section of a
README.

<!-- test: scenario files-inject -->

The file to edit is `out/routes.js`, already carrying its markers:

<!-- test: input out/routes.js -->
```js
import { router } from './router.js'

// #--START--#
// #--END--#

export default router
```

<!-- test: run -->
```js
import { Jostraca, Project, Inject, Line, each } from 'jostraca'

const routes = ['health', 'login']

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    Inject({
      name: 'routes.js',
      markers: ['// #--START--#\n', '// #--END--#'],
    }, () => {
      each(routes, (route) => {
        Line("router.use('/" + route.val$ + "')")
      })
    })
  })
})
```

The rewritten `routes.js`:

<!-- test: file out/routes.js -->
```js
import { router } from './router.js'

// #--START--#
router.use('/health')
router.use('/login')
// #--END--#

export default router
```

The default markers are `#--START--#\n` and `\n#--END--#`; give your
own pair when the file's comment syntax needs it. Both are matched
literally, so regex metacharacters in a marker are safe, and **every**
matching pair in the file is replaced rather than only the first.

Two failure modes, and they differ:

- **The file does not exist**: `Inject` throws. It rewrites a file; use
  `File` to create one.
- **The markers are not in the file**: nothing happens. The file is
  left alone and a warning goes to `log.debug`. No error, no exit code.
  If you need to know, check the file afterwards, or generate the
  markers yourself the first time.

Generated content is inserted verbatim, so `$&`, `$1` and `$$` in your
output survive rather than being interpreted as replacement patterns.

`Inject` does not honour the `exclude` option, so a file the user has
edited recently is still injected into.

## See also

- [Component reference](../reference-components.md#inject).
