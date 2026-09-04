---
description: Add the Go port to a module, and run a generator to check the install.
group: install
order: 20
---

# Install Jostraca for Go

The Go port lives in the `go/` directory of the same repository, so its
module path ends in `/go`:

<!-- test: skip environment setup; go is outside the scenario vocabulary -->
```sh
go get github.com/jostraca/jostraca/go
```

The package it declares is called `jostraca`, not `go`, so a plain
import already gives you `jostraca.New`. Writing the alias out, as
`main.go` does, spares the next reader the same double-take. The
module needs Go 1.22 or newer, and brings `shape/go` with it.

`go get` without a version gets the newest release the Go module has,
which is what most projects want. Asking for a specific one has a wrinkle,
because the two implementations are tagged apart: see
[two implementations](../explanation.md#two-implementations).

## Check it works

Write this as `main.go`:

<!-- test: skip a Go sample; the API is pinned by go/builder_test.go -->
```go
package main

import (
	"fmt"

	jostraca "github.com/jostraca/jostraca/go"
)

func main() {
	j := jostraca.New(jostraca.WithFolder("./out"))

	res, err := j.Generate(jostraca.Options{}, func(j *jostraca.J) {
		j.Project(jostraca.ProjectProps{Folder: "acme"}, func(j *jostraca.J) {
			j.File("README.md", func(j *jostraca.J) {
				j.Content("# Acme\n")
			})
		})
	})
	if err != nil {
		fmt.Println("error:", err)
		return
	}
	fmt.Println(res.Files.Written)
}
```

`go run .` prints the paths it wrote:

<!-- test: skip quoted program output; there is nothing here to run -->
```text
[out/acme/README.md]
```

Run it a second time and the list comes back empty, because the content
has not changed. That is the generator comparing against the copy it
kept under `out/.jostraca/`, and it is the behaviour the whole design is
for.

`err` is the other thing to notice. The Go port returns errors where the
TypeScript one throws, and component methods stop once an error is set.

## See also

- [Call Jostraca from Go](call-jostraca-from-go.md) for the rest of the
  differences from the TypeScript API.
- [Go reference](../reference-go.md) for the full surface.
- [Two implementations](../explanation.md#two-implementations) for how the
  Go module is versioned and tagged against the npm package.
- [Install Jostraca for TypeScript](install-typescript.md) for the other
  implementation.
