# Fuzz seeds

Inputs Go's fuzzer found and `go/fuzz_test.go` now runs on every
`go test`. Each file is a permanent regression seed — do not delete them
to make a test pass.

They exist because the hand-written corpora next door all share one
shape: lines drawn from a small vocabulary, joined with `\n`. That
distribution is what let the two merge engines disagree on ~72% of
non-trivial inputs while every test passed. The fuzzer picks inputs
nobody would think to write.

| target | input | what it pinned |
|---|---|---|
| `FuzzMerge` | `("0", "0", "0<<<<<<< ")` | The user's file contains conflict-marker text and the generator did not change anything, so their text is kept verbatim. The engine cannot rewrite a marker it never emitted. |
| `FuzzDiff` | `("0=======", "0")` | Same, mid-line and with no trailing newline: `=======` inside generated content is content, not a marker. |

Both were *my property being wrong*, not the code — "every marker starts
its own line" holds only for markers the engine emitted. The invariant is
now scoped that way, and both inputs are also pinned in
`testdata/parity/diff_corpus.json` so the TypeScript side is held to the
same handling rather than only the stack that found it.

To add more:

```bash
make fuzz               # 30s per target
make fuzz FUZZTIME=5m   # a real soak
```

A failure writes its input here. Commit it.
