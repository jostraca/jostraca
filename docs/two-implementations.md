# Two implementations, two release trains

Jostraca exists twice: an npm package written in TypeScript, and a Go
module that ports it. They implement one specification and are held to one
shared test corpus, but they are released separately, and that is the part
that surprises people.

This page is about the seam between them. If you only use one
implementation you can ignore all of it: the install guides
([TypeScript](how-to/install-typescript.md),
[Go](how-to/install-go.md)) say nothing about the other, deliberately.

## One repository, two tags

Both live in the same repository. npm publishes from a `vX.Y.Z` tag, and
the Go module ships from a `go/vX.Y.Z` tag. The module proxy serves it
straight from the tag, so for Go, cutting the tag is the release.

A `*` glob does not cross `/`, which is what keeps the two tag prefixes
apart in the release workflow.

The consequence is that **a version number is not a promise that both
implementations have it**. A release that changed only TypeScript gets a
`vX.Y.Z` tag and no `go/vX.Y.Z` at all, because there was no Go change to
ship. The version numbers are shared, the releases are not.

## Asking for a version the Go module does not have

`go get` without a version gets the newest release the Go module has, and
that is usually what you want. Name a version that npm has and Go does not,
and the error is worth recognising:

<!-- test: skip quoted go output; there is nothing here to run -->
```text
go: module github.com/jostraca/jostraca@v0.36.2 found, but does not contain package github.com/jostraca/jostraca/go
```

It names the *root* module rather than the one you asked for, so it reads
like a missing package. It is a missing tag. Pin a version that has one, or
leave the version off.

## What parity means, and what it does not

The two are kept in feature parity, and it is enforced rather than
intended: the pure helpers are pinned by a language-neutral corpus that
both test suites read, so a case added there is asserted by both, and an
unknown case is a hard failure in both rather than a silent skip.

Parity is not sameness. The Go port returns errors where TypeScript throws,
and a handful of behaviours differ on purpose. Those are enumerated in the
[Go reference](reference-go.md#deviations-from-typescript). That page is
the list, and it is the one to check before assuming a difference is a bug.

TypeScript is the canonical implementation. When the two disagree, the
TypeScript behaviour is the specification and the Go port is the side that
moves.

## See also

- [Install Jostraca for TypeScript](how-to/install-typescript.md)
- [Install Jostraca for Go](how-to/install-go.md)
- [Go reference](reference-go.md) for the full Go surface
- [Explanation](explanation.md#two-implementations) for why the port exists
