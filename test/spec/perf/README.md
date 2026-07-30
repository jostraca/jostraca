# Performance baselines

Shared workloads timed by both stacks, with committed baselines so a
change that costs performance shows up as a number rather than a hunch.

```bash
make perf            # run both harnesses, compare against baseline.tsv
make perf-baseline   # re-record baseline.tsv from the current run
```

Not part of `make test`. It takes around 40 seconds, and wall-clock
numbers do not belong in a correctness gate.

## Files

| File | |
|---|---|
| `workloads.tsv` | What to time. Same `fn`/`args` schema as the correctness corpus, so both harnesses reuse the adapters they already have. |
| `baseline.tsv` | Committed reference ratios, with the recording machine and toolchain in the header comments. |
| `latest-ts.tsv`, `latest-go.tsv` | Per-run output. Gitignored. |

The harnesses are `ts/tools/bench.js` and `go/perf_test.go`
(`TestPerfBaseline`, skipped unless `JOSTRACA_PERF` is set). The comparison
is `tools/perf-check.js`.

## Why ratios, not milliseconds

A raw ns/op figure says as much about the machine that produced it as
about the code. Committing raw numbers gives you a baseline that fails on
anything slower than the laptop it was recorded on.

So each harness also times a **calibration loop** — a fixed pure-CPU hash
loop, identical in both languages, with no dependency on any jostraca
code — and reports every workload as `workload_ns / calibration_ns`. The
machine largely divides out, and what remains is the cost of the workload
relative to a known quantity.

The calibration loop deliberately touches none of the code under test. An
anchor built from, say, `camelify` would drift with any regression in
`camelify` and mask it.

Raw ns/op is recorded in `latest-*.tsv` anyway, because it is what you
actually want when investigating.

## Reading the output

`make perf` prints a row per workload per stack, with the current ratio,
the baseline ratio, and the change. A workload over **2.5×** its baseline
fails the run; override with `PERF_TOLERANCE=3 make perf`.

The threshold is loose on purpose. These are wall-clock measurements on a
machine that is also doing other things, and a checker that cries wolf is
a checker somebody disables.

Three things are reported but never failed on, because silence would be
worse than noise:

- **New workloads** with no baseline entry — re-record.
- **Baseline entries with no result** — a harness did not run.
- **Workloads under 50ns** — too fast to time reliably, so not compared.

## Comparing the two stacks

Don't, at least not from these numbers alone. Each stack is measured
against its own baseline, which is the useful question ("did this change
cost anything?"). Cross-stack ratios are not apples to apples: `deep` is
one clear case, where TS mutates its first argument and Go builds a new
map, so the two are not doing the same amount of work per call.

## Adding a workload

Append a row to `workloads.tsv`, using an `fn` both harnesses already
dispatch, then `make perf-baseline`. Re-record baselines in their own
commit with the reason in the message — a baseline quietly rewritten
alongside a behaviour change cannot show what that change cost.
