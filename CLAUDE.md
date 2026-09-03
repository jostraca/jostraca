See [AGENTS.md](AGENTS.md) for the guide to working in this repository: which
stack is canonical, the layout, the build and test commands, the rule that a
production dependency needs an ADR, and the gotchas that have already cost
someone a day.

This file is deliberately near-empty. Guidance kept in two places drifts, and
AGENTS.md is the one that is maintained. Two rules are repeated here because
they govern work that starts before there is any reason to open it.

## TypeScript is the source of truth

Change behaviour in `ts/` first, then bring `go/` into parity. Never the other
way round, even when the Go code looks more correct — it has pre-empted a
latent TS bug more than once, and the fix is still to correct TypeScript first.
The one exception, and the reasoning, is in AGENTS.md.

## Prose follows docs/STYLE-GUIDE.md

[`docs/STYLE-GUIDE.md`](docs/STYLE-GUIDE.md) is normative for `docs/` and all
three package READMEs: the voice, the banned-phrase list, the em-dash
ration, and the rule that documentation never cites an internal working
document. Two gates enforce it, `vale` and `ts/test/docs.test.ts`, and both
run in CI. Read it before writing a sentence that ships.

`docs/design/` is exempt: plans and reviews are working documents, not
documentation, and neither gate reads them.
