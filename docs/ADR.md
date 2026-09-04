# Architecture decision records

Decisions that would otherwise be re-argued from scratch, with the evidence
that produced them. One file, newest last.

A record is not a plan and not documentation. `docs/design/` measures,
compares and recommends, and changes as the code does; the rest of `docs/`
teaches a reader how to use the generator. A record states what was
**decided**, once, and stays as written. When a plan and a record disagree,
the record is the decision and the plan is the working that led to it.

Write one by adding a section here: a numbered heading, a status line, what
was decided, and why. **Record what was measured, not what was assumed**—a
record that says a thing is small should say how small, because the number is
what makes it re-checkable a year later. A reversal is a new record marked as
superseding the old one, never an edit to it: the reasoning that led to the
reversal needs something to point at.

## 0001. Every production dependency requires its own record

**Accepted, 2026-09-02.**

A code generator runs in other people's build pipelines and writes into their
repositories. Every package it depends on is installed by every consumer, and
reaches the same files the generator does.

**No production dependency is added to either stack without a record here
justifying it.** Production means anything a consumer installs:
`dependencies`, `peerDependencies` and `optionalDependencies` in
`ts/package.json`, and any non-test `require` in `go/go.mod`. The last two are
named because the obvious reading of "production dependency" misses them. A
peer is still installed, and npm attempts an optional one, so both land in the
tree with the same install weight and the same reach; only an optional one's
*failure* is tolerated. A field that is empty today is where a dependency
arrives without tripping this rule.

The record must state, with numbers rather than adjectives: the surface
actually used; what it costs a consumer in packages, size and transitive tree;
why that surface is not worth writing; who controls the package, and what
happens here if that changes; and what the exit looks like when the answer to
that stops holding.

A pull request that adds one without its record is rejected on that basis
alone, before the merits are discussed. The merits are what the record is for.

The bar is deliberately high enough that the usual answer is to write the
code. `jsonic` and `memfs` were both removed after the fact, and `oxc-parser`
was a phantom that shipped in a script nobody ran; removing `memfs` cost 469
lines of in-repo code and took 20 packages and 68,557 lines of JavaScript out
of every consumer's tree. That asymmetry is the point: a dependency is added
in one line by one person in an afternoon, and removed by someone reading the
whole used surface, reimplementing it, and proving the suite still passes.

Development dependencies are out of scope—`typescript`, `@types/node` and
the pinned Vale binary reach no consumer.

## 0002. `shape` is accepted as a production dependency

**Accepted, 2026-09-02.** Satisfies 0001, which requires this record before
the dependency may stay.

`shape` validates the options and component props that reach the generator
from a caller. It is the only production dependency on either side, and
nothing arrives behind it:

| | version | size | transitive |
|---|---|---|---|
| TypeScript, peer `>=11` | 11.4.1 | 12 files, 709 KB unpacked | none |
| Go | v0.5.3 | 23 files, 8,814 non-test lines | none |

Four TypeScript files import it (`jostraca.ts`, `cmp/Fragment.ts`,
`cmp/Copy.ts`, `util/point.ts`); Go uses one three-line schema in
`template.go`.

**It stays, on both sides, because it is controlled by the same author as this
project.** Same author, same maintainer account, same licence; the Go module
is `github.com/rjrodger/shape/go`, under that account too.

That is the whole justification, and it is a supply-chain argument rather than
a size one. The risk 0001 is written against is a package this project does
not control changing under it: an owner transfer, a compromised publish, a
version that adds a dependency of its own. For `shape`, "who controls it" has
the same answer as for the generator, and compromising one is compromising the
other. The remaining trade is 709 KB and one install entry against roughly 300
lines to own, test and keep in parity across two stacks.

This is not a decision made because removal looked hard. `docs/design/DEPENDENCY_PLAN.md`
§5 records a sandbox where the Go import, schema and `require` were deleted
and `ParseTemplateSpec` replaced with a hand-written key switch: with no test
files touched, `gofmt`, `go build`, `go vet`, `go test` and `go test -race` all
passed. Removal was measured and works. It was rejected because it buys
independence from a party this project is already identical to, and because
removing `shape` from Go alone would leave the two stacks validating by
different mechanisms—widening a known divergence rather than closing it.

**The decision is void the moment its premise is.** If `shape` changes hands,
gains a dependency of its own, or is published by an account this project does
not control, that sandbox is the exit—cheap, and rehearsed once, which is
what makes accepting the dependency reasonable rather than merely convenient.

Consequences: the consumer-facing tree stays at one package, so
"dependency-free" is not a claim this project can make. The `>=11` peer range
stays loose, and that is only tolerable because of this decision; the floor
moves when a release requires it, as it did from `>=10` in 0.36.0. Both stacks
must track `shape` releases together, because a divergence in what each side
pins is a parity risk of its own—the v0.1.3 to v0.5.0 jump in 0.36.0 changed
how an absent `Optional` array validates and forced the eject schema to be
rewritten.

Sizes are re-measured on each bump rather than carried forward, and the
0.5.0 to 0.5.1 patch is why that is worth doing: measured the same way
before and after, the npm tarball went from 583 KB to 698 KB unpacked and
the Go source from 7,182 to 8,500 non-test lines. No behaviour this project
relies on changed, and 460 TypeScript tests, `go vet`, `go test` and
`go test -race` all pass unaltered, so the bump was taken. A patch that adds
a fifth of a package is still worth noticing.

The v0.5.1 to v0.5.3 bump in 0.36.5 is the smaller kind, and this record's
table carries its measurement: 698 to 709 KB unpacked on npm across the
11.3.1 to 11.4.1 range the loose peer floats over, and 8,500 to 8,814
non-test lines in Go. The file counts and the transitive column are
unchanged, which is the part that matters to 0001. That release also
lowered `engines.node` from `>=24` to `>=20`, which is what let the website
track a current generator again.
