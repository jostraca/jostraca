---
description: Assert on a generator's output without a temp directory, using in-memory generation.
group: embed
order: 30
---

# Test a generator

A generator is a program, so test it like one. Run it in memory and
assert on the volume: no temp directory, no cleanup, no cross-test
interference.

<!-- test: scenario embed-test -->

<!-- test: run -->
```js
import assert from 'node:assert'
import { Jostraca, Project, File, Content, each } from 'jostraca'

// The generator under test, as a plain function.
function apiGenerator(model) {
  return () => {
    Project({ folder: model.name }, () => {
      each(model.routes, (route) => {
        File({ name: route.val$ + '.js' }, () => {
          Content("export const name = '" + route.val$ + "'\n")
        })
      })
    })
  }
}

// The test.
const jostraca = Jostraca({ mem: true })
const model = { name: 'acme', routes: ['health', 'login'] }

const res = await jostraca.generate({ folder: '/out' }, apiGenerator(model))
const vol = res.vol().toJSON()

assert.deepEqual(
  Object.keys(vol).filter((p) => !p.includes('/.jostraca/')).sort(),
  ['/out/acme/health.js', '/out/acme/login.js'])

assert.equal(vol['/out/acme/health.js'], "export const name = 'health'\n")

console.log('ok')
```

<!-- test: log -->
```text
ok
```

Three habits make this work well:

- **Return the callback, do not call it.** `apiGenerator(model)` builds
  the function `generate()` will run. That keeps the generator
  callable from a test and from your command with no difference.
- **Filter out `.jostraca/`** before asserting on the file set, or pin
  it deliberately. It is bookkeeping, and it will change when the
  bookkeeping changes.
- **Pin `now`** if anything you assert on carries a timestamp—a merge
  or diff marker does.

To test a second run over an edited file, write into the volume between
generates. A global `mem: true` with no per-call `vol` keeps one volume
across `generate()` calls, which is what makes that possible:

<!-- test: run -->
```js
import { Jostraca, Project, File, Content } from 'jostraca'

const jostraca = Jostraca({
  mem: true,
  now: () => 1735689600000,
  existing: { txt: { write: true, merge: true } },
})

const run = (body) => jostraca.generate({ folder: '/out' }, () => {
  Project({}, () => File({ name: 'c.txt' }, () => Content(body)))
})

const first = await run('alpha\nbeta\ngamma\n')
first.fs().writeFileSync('/out/c.txt', 'alpha\nbeta\ngamma\nmine\n')

const res = await run('ALPHA\nbeta\ngamma\n')
console.log(JSON.stringify(res.vol().toJSON()['/out/c.txt']))
console.log(JSON.stringify(res.files.conflicted))
```

<!-- test: log -->
```text
"ALPHA\nbeta\ngamma\nmine\n"
[]
```

`res.fs()` is the filesystem the run used, so a test can write into it
the way a user would.

Keep the generator's change and the simulated edit **apart** in a test
like this. A merge works on regions, not lines, so an edit on the line
next to a changed one conflicts, and a test written that way asserts
conflict markers containing timestamps rather than the content you
meant to check.

## See also

- [Generate in memory](generate-in-memory.md).
- [Report what a run did](report-what-a-run-did.md).
