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
import already gives you `jostraca.New`. Writing the alias out, as the
example below does, spares the next reader the same double-take. The
module needs Go 1.22 or newer, and brings `shape/go` with it.

## The version you get

`go get` without a version gets the newest Go release, which is not
always the newest npm release. The two stacks are tagged apart: npm
publishes from `vX.Y.Z` and the Go module from `go/vX.Y.Z`, so a release
that changed only TypeScript has no Go tag at all. Ask for one and Go
reports:

<!-- test: skip quoted go output; there is nothing here to run -->
```text
go: module github.com/jostraca/jostraca@v0.36.2 found, but does not contain package github.com/jostraca/jostraca/go
```

The message names the root module rather than the one you asked for,
which reads like a missing package and is a missing tag. Pin a version
that has one, or leave the version off.

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
- [Install Jostraca for TypeScript](install-typescript.md) for the other
  implementation.
