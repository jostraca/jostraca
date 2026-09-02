# 0001. Every production dependency requires its own ADR

- Status: Accepted
- Date: 2026-09-02

## Context

A code generator is infrastructure. It runs in other people's build pipelines,
writes into other people's repositories, and is installed transitively by
anything that uses it. Every package it depends on is installed by every one of
those consumers, and every one of those packages can reach the same files the
generator can.

The published surface is currently one runtime dependency on each side:

| stack | production dependency | resolved | transitive |
|---|---|---|---|
| TypeScript | `shape` (peer, `>=11`) | 11.3.0 | none |
| Go | `github.com/rjrodger/shape/go` | v0.5.0 | none |

`go.sum` has two lines. `npm ls --omit=dev` is one entry deep. That is not an
accident, and it did not stay that way on its own: `jsonic` and `memfs` were
both removed after the fact, and `oxc-parser` was a phantom that shipped in a
script nobody ran. `DEPENDENCY_PLAN.md` §2 has the measurements. Removing
`memfs` cost 469 lines of in-repo code and took 20 packages and 68,557 lines of
JavaScript out of every consumer's tree.

Each of those was easier to add than to remove, which is the asymmetry this
record exists to price in. A dependency is added in one line by one person in
one afternoon. It is removed by someone reading the whole used surface,
reimplementing it, and proving the suite still passes.

## Decision

**A production dependency may not be added to either stack without an ADR in
this directory that justifies it.**

Production means anything a consumer installs: `dependencies` and
`peerDependencies` in `ts/package.json`, and any `require` in `go/go.mod` that
is not test-only. A peer dependency counts—the consumer still installs it,
and `shape` is a peer.

The ADR must state, with numbers rather than adjectives:

1. **What surface is used.** The functions, types and behaviours actually
   called, not the package's feature list.
2. **What it costs a consumer.** Package count, install size, transitive tree.
3. **Why the used surface is not worth reimplementing**, given that this
   project has already done exactly that twice and recorded what it cost.
4. **Who controls it**, and what happens to this project if that changes.
5. **What the exit looks like** if the answer to 4 stops holding.

A pull request that adds a production dependency without its ADR should be
rejected on that basis alone, before the merits are discussed. The merits are
what the ADR is for.

Development dependencies are out of scope. `typescript` and `@types/node` do
not reach a consumer, and neither does the pinned Vale binary the prose gate
uses. They are governed by taste, not by this record.

## Consequences

Adding a dependency now costs an argument written down in advance. That is the
point: the cost lands on the person proposing it, at the moment the decision is
cheap to reverse, rather than on whoever removes it later.

The bar is deliberately high enough that the usual answer is to write the code.
Both removals this project has already made produced less code than the
dependency they replaced, and one of them closed a TypeScript/Go divergence in
passing.

This record does not grandfather anything. `shape` was already depended on when
this was written; ADR 0002 justifies it rather than exempting it, and if that
justification had failed, the dependency would have gone.

## Alternatives considered

**A dependency allowlist in `CLAUDE.md`.** A list records the outcome and loses
the reasoning, which is the half that matters when the next candidate arrives
and somebody has to judge whether it is like the ones already there.

**Reviewing dependencies at pull-request time, without a record.** This is what
was already happening, and it is how `oxc-parser` ended up declared in a script
that was never installed and never run. A review comment is not durable; the
next reviewer does not have it.

**Banning production dependencies outright.** Cleaner to state and worse to
live with: it would have forced `shape` out on a rule rather than on its
merits, and the merits (ADR 0002) point the other way. A rule that produces the
wrong answer in the one case it has been tested against is not ready to be a
rule.
