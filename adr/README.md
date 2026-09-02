# Architecture decision records

Decisions that would otherwise be re-argued from scratch, with the reasoning
that produced them and the evidence that was available at the time.

An ADR is not a plan and not documentation. `DEPENDENCY_PLAN.md` and
`PARITY_PLAN.md` are analysis: they measure, compare and recommend, and they
change as the code does. `docs/` teaches a reader how to use the generator. An
ADR records what was **decided**, once, and stays as written. When a plan and
an ADR disagree, the ADR is the decision and the plan is the working that led
up to it.

## The records

| | Decision | Status |
|---|---|---|
| [0001](0001-production-dependencies-require-an-adr.md) | Every production dependency requires its own ADR | Accepted |
| [0002](0002-shape.md) | `shape` is accepted as a production dependency | Accepted |

## Writing one

Number it in sequence, name the file after the decision rather than the
component, and keep the five headings below. Prose follows
`docs/STYLE-GUIDE.md`; the Vale gate covers this directory.

```
# NNNN. <the decision, as a statement>

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences

## Alternatives considered
```

**Status is a fact about the record, not a mood.** A decision that has been
reversed is not deleted and not edited into agreement with the present: it is
marked superseded and left where it is, so the reasoning that led to the
reversal has something to point at.

**Record what was measured, not what was assumed.** An ADR that says a thing
is small should say how small, and how that was established. The number is what
makes the record re-checkable a year later, and the absence of one is how a
decision becomes a habit nobody remembers choosing.
