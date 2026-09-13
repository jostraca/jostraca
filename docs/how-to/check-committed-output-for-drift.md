---
description: Fail a build when committed generated files stop matching what the generator produces.
group: regenerate
order: 70
---

# Check committed output for drift

Generated code that lives in the repository shows up in reviews, in
searches and in diffs, and it goes stale the first time somebody edits
it by hand or changes the generator without rerunning it. `check` is the
gate for both: it generates into memory, compares with the folder, and
reports what no longer agrees.

<!-- test: scenario howto-check -->

Say `app/planet.rb` is committed, and somebody has edited it:

<!-- test: input app/planet.rb -->
```text
class Planet
  NAME = "EDITED BY HAND"
end
```

Run the generator through `check` instead of `generate`:

<!-- test: run -->
```js
import { Jostraca, File, Content } from 'jostraca'

const generator = () => {
  File({ name: 'planet.rb' }, () => {
    Content('class Planet\n  NAME = "earth"\nend\n')
  })
}

const res = await Jostraca().check({ folder: './app' }, generator)

for (const d of res.drift) {
  console.log(d.kind + ': ' + d.path)
}
console.log(res.drift.length + ' of ' + res.checked.length + ' drifted')
```

<!-- test: log -->
```text
content: planet.rb
1 of 1 drifted
```

A drift path is relative to the folder checked, so the file committed at
`app/planet.rb` is reported as `planet.rb`.

Nothing was written. `check` shadows the folder for the duration of the
run, so the files it is asking about cannot reach the generator and the
generator cannot reach them.

Each entry of `drift` carries both sides as buffers, so a build turns
them into whatever it reports:

<!-- test: skip one line of a build script, shown in place rather than run -->
```js
process.exitCode = 0 < res.drift.length ? 1 : 0
```

For a diff rather than a count, hand the two sides to
[`hunks`](../reference-utilities.md):

<!-- test: skip shown in place; the hunk format is pinned by the utilities reference -->
```js
import { DiffUtil } from 'jostraca'

for (const d of res.drift.filter((d) => 'content' === d.kind)) {
  DiffUtil.hunks(
    DiffUtil.lines(d.generated.toString()),
    DiffUtil.lines(d.existing.toString()))
}
```

Before you wire this into a build:

- **A file the generator does not claim is left alone.** One generator
  writing into a whole application is the normal case, so an unclaimed
  file is never drift. The cost is that a file which stops being
  generated lingers and is not reported.
- **Permission bits count**, where the tree stated them with
  [`mode`](../reference-components.md#mode). Right bytes and the wrong
  bits is drift.
- **`Inject` cannot run under a check.** It rewrites a file that already
  exists, and the folder is not visible to the run.

The [options reference](../reference-options.md#check) has the full
result shape and the reasoning behind each of those.
