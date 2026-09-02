---
description: Drive the Go port from your own program, and know where its surface differs.
group: embed
order: 40
---

# Call Jostraca from Go

The Go port is the same generator with a Go-shaped surface. Components
are methods on `*J` rather than free functions, and each callback
receives a `*J` bound to the node it is inside—that shadowing is what
replaces the ambient context the TypeScript components use.

<!-- test: skip a Go sample; the API is pinned by go/builder_test.go -->
```go
package main

import (
	"fmt"

	jostraca "github.com/jostraca/jostraca/go"
)

func main() {
	j := jostraca.New(
		jostraca.WithFolder("./out"),
		jostraca.WithModel(map[string]any{
			"app": map[string]any{"name": "acme"},
		}),
	)

	res, err := j.Generate(jostraca.Options{}, func(j *jostraca.J) {
		j.Project(jostraca.ProjectProps{Folder: "acme"}, func(j *jostraca.J) {
			j.File("package.json", func(j *jostraca.J) {
				j.Content("{ \"name\": \"$$app.name$$\" }\n")
			})
		})
	})
	if err != nil {
		return
	}
	fmt.Println(res.Files.Written)
}
```

Three differences to expect coming from TypeScript:

- **Errors are returned, not thrown.** `Generate` gives you
  `(Result, error)`. Component methods short-circuit once an error is
  set, so a failing tree stops rather than compounding.
- **Options are a struct plus functional options.** `New(WithFolder(…))`
  for globals, an `Options` value for the call.
  `OptionsFromMap` builds one from decoded JSON or YAML.
- **Three flags are inverted** so that Go's zero value matches the
  TypeScript default: `EachSpec.Raw`, `ListProps.NoLine` and
  `Control.NoDuplicate`.

One option does not do what its name promises: a per-call `Cmp` is
dropped by the option merge, so `cmp.Copy.ignore` has to be set on `New`.
It is in the [Go reference](../reference-go.md#options).

`WithMem()` and `WithVol()` work as their names suggest—`Mem` switches
an in-memory filesystem on, `Vol` seeds it, and the result carries `Vol`
and `FS`. They were inert before v0.35.0, writing real files while
returning `nil` for both handles.

Concurrent `Generate` calls are isolated—the builder state hangs off
the `*J` the callback receives rather than off a process-global—so
two generates can run at once without seeing each other's trees. That
is one place the Go design is plainly better than the TypeScript one.

Output is byte-identical for the same logical input, held there by a
shared test corpus both stacks read.

## See also

- [Go reference](../reference-go.md) for the full surface and every
  deviation.
