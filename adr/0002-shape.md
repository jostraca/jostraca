# 0002. `shape` is accepted as a production dependency

- Status: Accepted
- Date: 2026-09-02

Satisfies ADR [0001](0001-production-dependencies-require-an-adr.md), which
requires this record before the dependency may stay.

## Context

`shape` validates the options and component props that reach the generator from
a caller. It is the only production dependency on either side.

| | package | version | files | size | transitive |
|---|---|---|---|---|---|
| TypeScript | `shape` (peer, `>=11`) | 11.3.0 | 12 | 583 KB unpacked, 620 KB on disk | **none** |
| Go | `github.com/rjrodger/shape/go` | v0.5.0 | 21 | 7,182 lines, non-test | **none** |

`npm view shape dependencies peerDependencies` returns nothing, and `go list -m
all` for this module returns two entries: itself and shape. Nothing arrives
behind it, on either side.

**Used surface, TypeScript.** Four files import it:

| file | imports |
|---|---|
| `src/jostraca.ts` | `Shape`, `Skip`, `One` |
| `src/cmp/Fragment.ts` | `Shape`, `One`, `Optional`, `Check`, `Empty` |
| `src/cmp/Copy.ts` | `Shape`, `One`, `Optional`, `Check` |
| `src/util/point.ts` | `Shape`, `Skip`, `Any` |

**Used surface, Go.** One schema, three lines, in `go/template.go`:

```go
var templateSpecSchema = shape.MustShape(map[string]any{
	"replace": shape.Optional(map[string]any{}),
	"eject":   shape.Optional([]any{shape.String}),
})
```

The honest complication is that **removal was already shown to work on the Go
side.** `DEPENDENCY_PLAN.md` §5 records a sandbox where the import, the schema
and the `require` were deleted and `ParseTemplateSpec` was replaced with a
hand-written key switch. With zero test files touched, `gofmt`, `go build`, `go
vet`, `go test` and `go test -race` all passed, and `diff -rq` reported three
changed files and no additions. That plan estimates a Go replacement at roughly
40 lines and a TypeScript one at 200 to 300.

So this is not a decision made because removal looked hard. It is a decision
made against a measured, working removal.

## Decision

**`shape` stays, on both sides, on the grounds that it is controlled by the
same author as this project.**

`shape` and `jostraca` share an author, a maintainer account and a licence:

```
shape     author = 'Richard Rodger'  maintainers = 'rjrodger'  license = MIT
jostraca  author = 'Richard Rodger'  maintainers = 'rjrodger'  license = MIT
```

The Go module is `github.com/rjrodger/shape/go`, under the same account.

That is the whole justification, and it is a supply-chain argument rather than a
size one. The risk ADR 0001 is written against is a package this project does
not control changing under it: an owner transfer, a compromised publish, a
maintainer who stops caring, a version that adds a dependency of its own. For
`shape`, the answer to "who controls it" is the same answer as for the
generator itself. A supply-chain compromise of `shape` is a supply-chain
compromise of `jostraca`, and the second one does not become safer by
reimplementing the first.

The remaining trade is 583 KB and one install entry against roughly 300 lines
this project would have to own, test and keep in parity across two stacks. With
the control question answered, that trade favours the dependency.

## Consequences

The consumer-facing tree stays at one package. It does not go to zero, so
"dependency-free" is not a claim this project can make, and `DEPENDENCY_PLAN.md`
should be read as analysis of a question now settled rather than as a plan
awaiting execution.

The `>=11` peer range stays deliberately loose, and that looseness is only
tolerable because of this decision. A loose range on a package under someone
else's control is an open door; on this one it is a maintenance convenience.
The floor moves when a release requires it, as it did from `>=10` in 0.36.0.

Both stacks must keep tracking `shape` releases, because a divergence in what
each side pins is a parity risk in its own right. That already produced work:
the v0.1.3 to v0.5.0 jump in 0.36.0 changed how an absent `Optional` array
validates and forced the eject schema to be rewritten.

**This decision is void the moment its premise is.** If `shape` changes hands,
gains a dependency, or is published by an account this project does not
control, the justification is gone and the sandbox in `DEPENDENCY_PLAN.md` §5
is the exit. That exit is cheap and has been rehearsed once, which is what makes
accepting the dependency reasonable rather than merely convenient.

## Alternatives considered

**Reimplement on both sides**, as `DEPENDENCY_PLAN.md` recommends. Verified
achievable for Go and estimated for TypeScript. Rejected because it buys
independence from a party this project is already identical to, at the cost of
about 300 lines of validation code to own in two languages, plus the parity
surface between them. It would remove the dependency without removing any risk.

**Reimplement in Go only**, since that side is one schema and already proven.
Rejected for a worse reason than it first appears: it would leave the two
stacks validating by different mechanisms, and `DEPENDENCY_PLAN.md` §3.4 already
records `shape` as a source of TypeScript/Go divergence. Removing it from one
side widens that gap rather than closing it.

**Vendor it.** Takes on the maintenance of code this project does not write,
loses upstream fixes, and answers a control question that is not being asked
here.

**Accept it with no record**, on the grounds that everyone involved already
knows the author is the same person. Rejected because that is precisely the
knowledge that does not survive a contributor change, and because ADR 0001
would be a rule with an unexplained exception in it from the day it was
written.
