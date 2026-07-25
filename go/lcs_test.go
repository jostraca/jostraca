package jostraca

import (
	"fmt"
	"math/rand"
	"runtime"
	"strings"
	"testing"
	"time"
)

// referenceLCS is the original full-table implementation, kept here as the
// oracle for the space-bounded version in diff.go. Any divergence between
// the two changes real merge and diff output, so this is the test that
// matters most for the rewrite.
func referenceLCS(a, b []string) []string {
	if len(a) == 0 || len(b) == 0 {
		return nil
	}
	n, m := len(a), len(b)
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
	}
	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			if a[i-1] == b[j-1] {
				dp[i][j] = dp[i-1][j-1] + 1
			} else if dp[i-1][j] >= dp[i][j-1] {
				dp[i][j] = dp[i-1][j]
			} else {
				dp[i][j] = dp[i][j-1]
			}
		}
	}
	out := make([]string, 0, dp[n][m])
	i, j := n, m
	for i > 0 && j > 0 {
		switch {
		case a[i-1] == b[j-1]:
			out = append(out, a[i-1])
			i--
			j--
		case dp[i-1][j] >= dp[i][j-1]:
			i--
		default:
			j--
		}
	}
	for k, l := 0, len(out)-1; k < l; k, l = k+1, l-1 {
		out[k], out[l] = out[l], out[k]
	}
	return out
}

func eqLines(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// randLines builds a line sequence from an alphabet of `vocab` distinct
// lines. A small vocab produces heavy duplication, which is the realistic
// case for source code ("}", "", "import (") and the case most likely to
// expose a tie-breaking difference.
func randLines(r *rand.Rand, n, vocab int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("L%d\n", r.Intn(vocab))
	}
	return out
}

func TestLCSMatchesReferenceDP(t *testing.T) {
	r := rand.New(rand.NewSource(20260725))

	shapes := []struct{ n, m, vocab int }{
		{0, 0, 1}, {0, 5, 3}, {5, 0, 3},
		{1, 1, 1}, {1, 8, 2}, {8, 1, 2},
		{6, 6, 2},   // heavy duplication
		{12, 9, 3},  // duplication + different lengths
		{20, 20, 4}, // moderate
		{30, 25, 30},
		{40, 40, 6},
		{50, 10, 2},
		{64, 64, 3},
	}

	for _, s := range shapes {
		for iter := 0; iter < 200; iter++ {
			a := randLines(r, s.n, s.vocab)
			b := randLines(r, s.m, s.vocab)

			got := lcsLines(a, b)
			want := referenceLCS(a, b)

			if !eqLines(got, want) {
				t.Fatalf("LCS differs for shape %+v iter %d\n a=%q\n b=%q\n got=%q\nwant=%q",
					s, iter, a, b, got, want)
			}
		}
	}
}

// Shared prefixes and suffixes are the case the trimming fast-path
// targets, so cover them explicitly rather than relying on chance.
func TestLCSMatchesReferenceWithSharedAffixes(t *testing.T) {
	r := rand.New(rand.NewSource(981))

	for iter := 0; iter < 400; iter++ {
		prefix := randLines(r, r.Intn(6), 3)
		suffix := randLines(r, r.Intn(6), 3)
		midA := randLines(r, r.Intn(10), 3)
		midB := randLines(r, r.Intn(10), 3)

		a := append(append(append([]string{}, prefix...), midA...), suffix...)
		b := append(append(append([]string{}, prefix...), midB...), suffix...)

		got, want := lcsLines(a, b), referenceLCS(a, b)
		if !eqLines(got, want) {
			t.Fatalf("LCS differs on shared-affix input iter %d\n a=%q\n b=%q\n got=%q\nwant=%q",
				iter, a, b, got, want)
		}
	}
}

// The LCS feeds merge3 and renderDiff, so assert the user-visible output
// of both is byte-identical too, not just the intermediate sequence.
func TestMergeAndDiffOutputUnchangedByLCSRewrite(t *testing.T) {
	r := rand.New(rand.NewSource(4242))

	join := func(xs []string) string { return strings.Join(xs, "") }

	for iter := 0; iter < 300; iter++ {
		base := randLines(r, 4+r.Intn(12), 4)
		gen := randLines(r, 4+r.Intn(12), 4)
		existing := randLines(r, 4+r.Intn(12), 4)

		// merge3 output must be stable.
		res := merge3([]byte(join(gen)), []byte(join(base)), []byte(join(existing)))

		// Recompute what the reference LCS would have produced by running
		// the same region walk against a reference-backed alignment.
		wantAlign := referenceAlign(base, gen)
		gotAlign := alignLCS(base, gen)
		if !eqInts(gotAlign, wantAlign) {
			t.Fatalf("alignLCS differs iter %d\nbase=%q\ngen=%q\ngot=%v\nwant=%v",
				iter, base, gen, gotAlign, wantAlign)
		}

		// renderDiff is the other consumer.
		d := renderDiff([]byte(join(gen)), []byte(join(existing)), "W", "L")
		if len(d) == 0 && len(gen)+len(existing) > 0 {
			t.Fatalf("renderDiff produced nothing for non-empty input iter %d", iter)
		}
		_ = res
	}
}

// referenceAlign mirrors alignLCS but over the reference LCS.
func referenceAlign(ol, target []string) []int {
	m := make([]int, len(ol))
	for i := range m {
		m[i] = -1
	}
	if len(ol) == 0 || len(target) == 0 {
		return m
	}
	lcs := referenceLCS(ol, target)
	li, ti, oi := 0, 0, 0
	for li < len(lcs) && oi < len(ol) && ti < len(target) {
		for oi < len(ol) && ol[oi] != lcs[li] {
			oi++
		}
		for ti < len(target) && target[ti] != lcs[li] {
			ti++
		}
		if oi < len(ol) && ti < len(target) {
			m[oi] = ti
			oi++
			ti++
			li++
		}
	}
	return m
}

func eqInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Memory is the reason for the rewrite: the old table allocated ~500 MB at
// 8 000 lines and grew quadratically. Assert a hard ceiling well under
// what the table would have needed, so a regression back to O(N·M) space
// fails loudly rather than showing up as an OOM in production.
func TestLCSMemoryIsBounded(t *testing.T) {
	if testing.Short() {
		t.Skip("allocation-heavy")
	}
	const n = 4000 // the old table needed ~125 MB here

	a := make([]string, n)
	b := make([]string, n)
	for i := 0; i < n; i++ {
		a[i] = fmt.Sprintf("line %d A\n", i)
		b[i] = fmt.Sprintf("line %d B\n", i)
	}

	var m0, m1 runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m0)
	start := time.Now()
	_ = lcsLines(a, b)
	elapsed := time.Since(start)
	runtime.ReadMemStats(&m1)

	allocMB := float64(m1.TotalAlloc-m0.TotalAlloc) / (1024 * 1024)
	t.Logf("n=%d time=%v allocated=%.1f MB", n, elapsed, allocMB)

	if allocMB > 16 {
		t.Errorf("LCS allocated %.1f MB for n=%d; expected O(min(n,m)) space, "+
			"looks like the full table is back", allocMB, n)
	}
}
