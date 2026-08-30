---
description: Use eject to take one marked region out of a larger template file.
group: templates
order: 20
---

# Extract part of a template

Sometimes the file you want to borrow from is a working file — one that
compiles, or runs, or that somebody maintains for its own sake — and you
want one region of it. `eject` takes the region between two markers and
discards everything else, markers included.

<!-- test: scenario eject -->

The template is `tpl/example.js`, a file that works on its own:

<!-- test: input tpl/example.js -->
```js
import { setup } from './harness.js'

// EXTRACT-START
export function handler(req) {
  return { ok: true }
}
// EXTRACT-END

setup(handler)
```

Take just the middle:

<!-- test: run -->
```js
import { Jostraca, Project, File, Fragment } from 'jostraca'

await Jostraca().generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'handler.js' }, () => {
      Fragment({
        from: '../tpl/example.js',
        eject: ['// EXTRACT-START\n', '// EXTRACT-END\n'],
      })
    })
  })
})
```

The generated `handler.js`:

<!-- test: file out/handler.js -->
```js
export function handler(req) {
  return { ok: true }
}
```

The markers themselves are removed, so the extracted region needs no
cleaning up afterwards.

`eject` is forgiving in one direction only, and quietly: if either
marker is missing from the file, or the end marker comes before the
start, or you pass a one-element array, the **whole** source is used
instead. There is no error. Check the output the first time, and pin it
with a test if the template is maintained by somebody else.

Both markers may be regular expressions instead of strings, which is
what you want when the region boundary varies.

## See also

- [Fill a template file's slots](fill-a-template-slot.md) when you want
  to put content into the template rather than take content out.
- [Component reference](../reference-components.md#fragment) for the
  rest of `Fragment`'s props.
