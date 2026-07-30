package jostraca

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Performance baselines for the shared workloads in
// test/spec/perf/workloads.tsv, which ts/tools/bench.js also runs.
//
// Skipped unless JOSTRACA_PERF is set, so an ordinary `go test` stays
// fast and deterministic. `make perf` drives it.
//
// Results are reported as a ratio against a calibration loop rather than
// as raw ns/op. Raw times say as much about the machine as about the code;
// the ratio divides the machine out, so a baseline recorded on a laptop
// still means something in CI. Raw ns/op is written alongside for context.

const perfWorkloads = "../test/spec/perf/workloads.tsv"
const perfLatest = "../test/spec/perf/latest-go.tsv"

type perfWorkload struct {
	id   string
	fn   string
	args []any
}

func loadPerfWorkloads(t *testing.T) []perfWorkload {
	t.Helper()

	raw, err := os.ReadFile(perfWorkloads)
	if err != nil {
		t.Fatalf("cannot read %s: %v", perfWorkloads, err)
	}

	out := []perfWorkload{}
	header := false

	for i, row := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
		if "" == strings.TrimSpace(row) || strings.HasPrefix(row, "#") {
			continue
		}

		cells := strings.Split(row, "\t")

		if !header {
			want := "id\tfn\targs"
			if row != want {
				t.Fatalf("%s: header is %q, want %q", perfWorkloads, row, want)
			}
			header = true
			continue
		}

		if 3 != len(cells) {
			t.Fatalf("%s:%d: %d cells, want 3", perfWorkloads, i+1, len(cells))
		}

		w := perfWorkload{id: cells[0], fn: cells[1]}
		if err := json.Unmarshal([]byte(cells[2]), &w.args); err != nil {
			t.Fatalf("%s:%d %s: bad args JSON: %v", perfWorkloads, i+1, w.id, err)
		}
		out = append(out, w)
	}

	return out
}

// perfCalibrate is a fixed pure-CPU loop with no dependency on any code
// under test, so a regression in jostraca itself cannot move the anchor
// and mask itself. Must stay byte-for-byte equivalent to the same
// function in ts/tools/bench.js.
func perfCalibrate() uint32 {
	var h uint32 = 2166136261
	for round := 0; round < 200; round++ {
		for i := 0; i < 1000; i++ {
			h ^= uint32(i & 0xff)
			h *= 16777619
		}
	}
	return h
}

func TestPerfBaseline(t *testing.T) {
	if "" == os.Getenv("JOSTRACA_PERF") {
		t.Skip("set JOSTRACA_PERF=1 to run performance baselines (make perf)")
	}

	workloads := loadPerfWorkloads(t)

	anchor := testing.Benchmark(func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			perfCalibrate()
		}
	})
	anchorNs := float64(anchor.NsPerOp())
	if 0 >= anchorNs {
		t.Fatalf("calibration measured %v ns/op", anchorNs)
	}
	t.Logf("calibration: %.0f ns/op", anchorNs)

	rows := []string{"id\tstack\tns_per_op\tratio"}

	for _, w := range workloads {
		fn, ok := specFns[w.fn]
		if !ok {
			t.Fatalf("%s: fn %q is not dispatched", w.id, w.fn)
		}

		// Fail rather than time a broken call.
		if _, err := fn(w.args); err != nil {
			t.Fatalf("%s: workload returned an error: %v", w.id, err)
		}

		res := testing.Benchmark(func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				//nolint:errcheck // checked once above
				fn(w.args)
			}
		})

		ns := float64(res.NsPerOp())
		ratio := ns / anchorNs

		rows = append(rows,
			fmt.Sprintf("%s\tgo\t%.1f\t%.6f", w.id, ns, ratio))
		t.Logf("%-18s %10.1f ns/op  ratio %.6f", w.id, ns, ratio)
	}

	if err := os.MkdirAll(filepath.Dir(perfLatest), 0o755); err != nil {
		t.Fatalf("cannot create %s: %v", filepath.Dir(perfLatest), err)
	}
	out := strings.Join(rows, "\n") + "\n"
	if err := os.WriteFile(perfLatest, []byte(out), 0o644); err != nil {
		t.Fatalf("cannot write %s: %v", perfLatest, err)
	}

	t.Logf("wrote %s (%d workloads)", perfLatest, len(workloads))
}
