---
description: Substitute values from the data model into file content with the double-dollar syntax.
group: compose
order: 20
---

# Insert values from your model

Pass a `model` to `Jostraca()`, and write `$$path$$` in content. The
path is resolved against the model and the value is substituted as
text.

<!-- test: scenario model-values -->

<!-- test: run -->
```js
import { Jostraca, Project, File, Content } from 'jostraca'

const model = {
  service: { name: 'acme-api', port: 8080 },
  owner: { team: 'platform' },
}

const jostraca = Jostraca({ model })

await jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'config.json' }, () => {
      Content('{\n')
      Content('  "name": "$$service.name$$",\n')
      Content('  "port": $$service.port$$,\n')
      Content('  "team": "$$owner.team$$"\n')
      Content('}\n')
    })
  })
})
```

The generated `config.json`:

<!-- test: file out/config.json -->
```json
{
  "name": "acme-api",
  "port": 8080,
  "team": "platform"
}
```

The port came out unquoted because substitution inserts the value as
text and the surrounding JSON was already written the way it wanted to
be. Quoting is yours to control, not the template's.

Three things the syntax does not do, all deliberate:

- **No conditionals, loops or expressions.** The code around the
  content is a programming language already; use it.
- **No substitution in names.** A file or folder name is an ordinary
  JavaScript expression, so build it with the language:
  `File({name: model.service.name + '.json'})`.
- **No blanking on a miss.** An unresolved `$$nope$$` is left in the
  output verbatim, so a typo is visible instead of silently gone.

For one value that is not in the model, pass `extra` — remembering that
`Content`'s second positional argument is children, so this needs the
props form:

<!-- test: run -->
```js
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({ model: { n: 5 } })

await jostraca.generate({ folder: './out' }, () => {
  Project({}, () => {
    File({ name: 'extra.txt' }, () => {
      Content({ src: 'n=$$n$$ m=$$m$$\n', extra: { m: 9 } })
    })
  })
})
```

The generated `extra.txt`:

<!-- test: file out/extra.txt -->
```text
n=5 m=9
```

## See also

- [Utilities reference](../reference-utilities.md#template) for the
  `replace` map, when the plain form is not enough.
- [Fill a template file's slots](fill-a-template-slot.md) to keep the
  text in a file you can open.
