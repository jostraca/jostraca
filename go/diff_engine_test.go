package jostraca

import (
	"fmt"
	"math/rand"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Unit tests for the diff/merge engine in diff.go, mirroring
// ts/test/diff.test.ts case for case. Both suites aim at full branch
// coverage of their respective file; a branch exercised on one side and not
// the other is exactly how the two stacks drifted apart before.

func eq(t *testing.T, what, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("%s:\n got: %q\nwant: %q", what, got, want)
	}
}

func eqSlice(t *testing.T, what string, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Errorf("%s: got %q want %q", what, got, want)
		return
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("%s: got %q want %q", what, got, want)
			return
		}
	}
}

// --- Lines ----------------------------------------------------------------

func TestLines(t *testing.T) {
	eqSlice(t, "empty", Lines(""), nil)
	eqSlice(t, "one line no newline", Lines("a"), []string{"a"})
	eqSlice(t, "one line newline", Lines("a\n"), []string{"a\n"})
	eqSlice(t, "two lines", Lines("a\nb\n"), []string{"a\n", "b\n"})
	eqSlice(t, "trailing partial", Lines("a\nb"), []string{"a\n", "b"})
	eqSlice(t, "blank line", Lines("\n\n"), []string{"\n", "\n"})
	eqSlice(t, "crlf kept", Lines("a\r\nb\r\n"), []string{"a\r\n", "b\r\n"})

	// Round-trip is lossless for every shape above.
	for _, s := range []string{"", "a", "a\n", "a\nb", "a\nb\n", "\n", "\n\n", "a\r\nb"} {
		if got := strings.Join(Lines(s), ""); got != s {
			t.Errorf("round-trip %q -> %q", s, got)
		}
	}
}

// --- LCS ------------------------------------------------------------------

// referenceLCS is the textbook full-table implementation, kept as the
// oracle for the space-bounded one. Any divergence changes merge output.
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

func TestLCSEdges(t *testing.T) {
	eqSlice(t, "empty a", LCS(nil, []string{"a"}), nil)
	eqSlice(t, "empty b", LCS([]string{"a"}, nil), nil)
	eqSlice(t, "identical", LCS([]string{"a", "b"}, []string{"a", "b"}), []string{"a", "b"})
	eqSlice(t, "disjoint", LCS([]string{"a"}, []string{"b"}), nil)
	eqSlice(t, "prefix only", LCS([]string{"a", "b"}, []string{"a", "z"}), []string{"a"})
	eqSlice(t, "suffix only", LCS([]string{"b", "a"}, []string{"z", "a"}), []string{"a"})

	// Single-row base case: found, and not found.
	eqSlice(t, "single found", LCS([]string{"x"}, []string{"a", "x", "b"}), []string{"x"})
	eqSlice(t, "single missing", LCS([]string{"x"}, []string{"a", "b"}), nil)

	// Single-row base case must take the LAST occurrence, so the LCS of a
	// following element can still be found after it.
	eqSlice(t, "interleaved", LCS([]string{"a", "b"}, []string{"a", "x", "a", "b"}),
		[]string{"a", "b"})
}

func TestLCSMatchesReferenceDP(t *testing.T) {
	r := rand.New(rand.NewSource(20260725))

	shapes := []struct{ n, m, vocab int }{
		{0, 0, 1}, {0, 5, 3}, {5, 0, 3},
		{1, 1, 1}, {1, 8, 2}, {8, 1, 2},
		{6, 6, 2}, {12, 9, 3}, {20, 20, 4},
		{30, 25, 30}, {40, 40, 6}, {50, 10, 2}, {64, 64, 3},
	}

	for _, s := range shapes {
		for iter := 0; iter < 200; iter++ {
			a := randLines(r, s.n, s.vocab)
			b := randLines(r, s.m, s.vocab)

			if got, want := LCS(a, b), referenceLCS(a, b); !sameLines(got, want) {
				t.Fatalf("LCS differs for %+v iter %d\n a=%q\n b=%q\n got=%q\nwant=%q",
					s, iter, a, b, got, want)
			}
		}
	}
}

// Shared prefixes and suffixes are what the trimming fast path targets.
func TestLCSMatchesReferenceWithSharedAffixes(t *testing.T) {
	r := rand.New(rand.NewSource(981))

	for iter := 0; iter < 400; iter++ {
		prefix := randLines(r, r.Intn(6), 3)
		suffix := randLines(r, r.Intn(6), 3)
		a := concat(prefix, randLines(r, r.Intn(10), 3), suffix)
		b := concat(prefix, randLines(r, r.Intn(10), 3), suffix)

		if got, want := LCS(a, b), referenceLCS(a, b); !sameLines(got, want) {
			t.Fatalf("LCS differs iter %d\n a=%q\n b=%q\n got=%q\nwant=%q",
				iter, a, b, got, want)
		}
	}
}

// Property: the result must actually be a subsequence of both inputs.
func TestLCSIsCommonSubsequence(t *testing.T) {
	r := rand.New(rand.NewSource(555))

	for iter := 0; iter < 600; iter++ {
		a := randLines(r, r.Intn(24), 4)
		b := randLines(r, r.Intn(24), 4)
		common := LCS(a, b)

		for _, seq := range [][]string{a, b} {
			at := 0
			for _, line := range common {
				found := -1
				for i := at; i < len(seq); i++ {
					if seq[i] == line {
						found = i
						break
					}
				}
				if found < 0 {
					t.Fatalf("LCS %q is not a subsequence of %q", common, seq)
				}
				at = found + 1
			}
		}
	}
}

func TestLCSTieBreakPrefersLargestSplit(t *testing.T) {
	// The one tie-break in this engine that changes what a user sees.
	//
	// a and b below have TWO longest common subsequences, both of length
	// 1: ["a"] and ["b"]. Neither is more correct. Hirschberg picks
	// between them by which split point it takes when two splits score
	// equally, and taking the LARGEST yields ["a"]. Flipping that one `>=`
	// to `>` yields ["b"] here, and changes the merged content on 658 of
	// the 1 190 corpus cases — i.e. it silently rewrites user files.
	//
	// The point of this test is to say so in one screen, rather than
	// leaving the rule to be inferred from a randomised oracle comparison.
	a := []string{"a", "a", "b"}
	b := []string{"b", "a"}

	got := LCS(a, b)
	if len(got) != 1 || got[0] != "a" {
		t.Fatalf("LCS(%q, %q) = %q, want [a]", a, b, got)
	}

	// ["b"] is an equally valid answer, which is what makes this a choice
	// and not a correctness question. Both are common subsequences of the
	// same length; the engine just has to pick the same one every time, in
	// both stacks.
	for _, alt := range [][]string{{"a"}, {"b"}} {
		if len(alt) != len(got) {
			t.Fatalf("alternative %q is not the same length as %q", alt, got)
		}
		for _, seq := range [][]string{a, b} {
			if !isSubsequenceOf(alt, seq) {
				t.Fatalf("alternative %q is not a subsequence of %q", alt, seq)
			}
		}
	}

	// A second case, so a change that happens to preserve the first does
	// not slip through: "ca" and "cb" are both length-2 subsequences here.
	got = LCS([]string{"c", "a", "b"}, []string{"c", "b", "a"})
	if len(got) != 2 || got[0] != "c" || got[1] != "a" {
		t.Fatalf("LCS(cab, cba) = %q, want [c a]", got)
	}
}

func isSubsequenceOf(sub, seq []string) bool {
	at := 0
	for _, line := range sub {
		found := -1
		for i := at; i < len(seq); i++ {
			if seq[i] == line {
				found = i
				break
			}
		}
		if found < 0 {
			return false
		}
		at = found + 1
	}
	return true
}

func TestAlignLCS(t *testing.T) {
	m := AlignLCS(nil, []string{"a"})
	if len(m) != 0 {
		t.Errorf("empty base: got %v", m)
	}

	m = AlignLCS([]string{"a", "b"}, nil)
	if len(m) != 2 || m[0] != -1 || m[1] != -1 {
		t.Errorf("empty target: got %v", m)
	}

	// b is absent from the target, so it has no anchor.
	m = AlignLCS([]string{"a", "b", "c"}, []string{"a", "c"})
	if len(m) != 3 || m[0] != 0 || m[1] != -1 || m[2] != 1 {
		t.Errorf("anchor map: got %v want [0 -1 1]", m)
	}
}

// --- Labels ---------------------------------------------------------------

func TestLabels(t *testing.T) {
	l := labelsOf(DiffSpec{When: 1735689600000, Last: 0}, "merge")
	eq(t, "generated", l.Generated, "GENERATED: 2025-01-01T00:00:00.000Z/merge")
	eq(t, "existing", l.Existing, "EXISTING: 1970-01-01T00:00:00.000Z/merge")

	// Explicit kind wins over the default.
	l = labelsOf(DiffSpec{Kind: "custom"}, "merge")
	if !strings.HasSuffix(l.Generated, "/custom") {
		t.Errorf("kind override: %q", l.Generated)
	}

	// Full override, each side independently.
	l = labelsOf(DiffSpec{Labels: &DiffLabels{Generated: "G"}}, "merge")
	eq(t, "generated override", l.Generated, "G")
	if !strings.HasPrefix(l.Existing, "EXISTING: ") {
		t.Errorf("existing should keep default: %q", l.Existing)
	}

	l = labelsOf(DiffSpec{Labels: &DiffLabels{Existing: "E"}}, "merge")
	eq(t, "existing override", l.Existing, "E")
	if !strings.HasPrefix(l.Generated, "GENERATED: ") {
		t.Errorf("generated should keep default: %q", l.Generated)
	}

	l = labelsOf(DiffSpec{Labels: &DiffLabels{Generated: "G", Existing: "E"}}, "merge")
	eq(t, "both override g", l.Generated, "G")
	eq(t, "both override e", l.Existing, "E")
}

func TestHasConflicts(t *testing.T) {
	if HasConflicts("plain\n") {
		t.Error("plain text should not report conflicts")
	}
	if !HasConflicts("a\n>>>>>>> EXISTING: X/merge\n") {
		t.Error("closing EXISTING marker should report a conflict")
	}
	// Half-resolved: the opening marker was removed but not the closing one.
	// Still unresolved, so it must not be re-merged.
	if !HasConflicts("a\n=======\nb\n>>>>>>> EXISTING: X/merge\n") {
		t.Error("half-resolved file should still report a conflict")
	}
	// A GENERATED marker alone is what a diff render emits, not an
	// unresolved merge.
	if HasConflicts("<<<<<<< GENERATED: X/diff\na\n>>>>>>> GENERATED: X/diff\n") {
		t.Error("diff markers are not an unresolved merge")
	}
}

// --- Merge outcomes -------------------------------------------------------

func TestMergeOutcomeSame(t *testing.T) {
	res := Merge("A\n", "B\n", "A\n", DiffSpec{})
	if res.Outcome != MergeSame || res.Conflict || res.Content != "A\n" {
		t.Errorf("got %+v", res)
	}
}

func TestMergeOutcomeClean(t *testing.T) {
	// On-disk file is untouched since the last generate, so the new
	// generate wins outright.
	res := Merge("NEW\n", "OLD\n", "OLD\n", DiffSpec{})
	if res.Outcome != MergeClean || res.Conflict || res.Content != "NEW\n" {
		t.Errorf("got %+v", res)
	}
}

func TestMergeOutcomeUnresolved(t *testing.T) {
	existing := "a\n>>>>>>> EXISTING: T/merge\n"
	res := Merge("NEW\n", "OLD\n", existing, DiffSpec{})
	if res.Outcome != MergeUnresolved || res.Conflict || res.Content != existing {
		t.Errorf("got %+v", res)
	}
}

func TestMergeOnlyGeneratorChanged(t *testing.T) {
	res := Merge("a\nNEW\nc\n", "a\nORIG\nc\n", "a\nORIG\nc\n", DiffSpec{})
	eq(t, "content", res.Content, "a\nNEW\nc\n")
	if res.Conflict {
		t.Error("unexpected conflict")
	}
}

func TestMergeOnlyUserChanged(t *testing.T) {
	res := Merge("a\nORIG\nc\n", "a\nORIG\nc\n", "a\nUSER\nc\n", DiffSpec{})
	eq(t, "content", res.Content, "a\nUSER\nc\n")
	if res.Conflict {
		t.Error("unexpected conflict")
	}
}

func TestMergeBothMadeSameChange(t *testing.T) {
	res := Merge("a\nSAME\nc\n", "a\nORIG\nc\n", "a\nSAME\nc\n", DiffSpec{})
	// Identical generated and existing short-circuits as `same`.
	if res.Outcome != MergeSame {
		t.Errorf("outcome: got %v", res.Outcome)
	}
	eq(t, "content", res.Content, "a\nSAME\nc\n")
}

// Same change on both sides, reached through the real merge rather than the
// `same` fast path (the files differ elsewhere).
func TestMergeSharedChangeThroughRegionPath(t *testing.T) {
	res := Merge("a\nSAME\nc\nG\n", "a\nORIG\nc\n", "a\nSAME\nc\n", DiffSpec{})
	if res.Outcome != MergeMerged {
		t.Errorf("outcome: got %v", res.Outcome)
	}
	if strings.Contains(res.Content, "ORIG") {
		t.Errorf("baseline content leaked: %q", res.Content)
	}
}

func TestMergeConflict(t *testing.T) {
	res := Merge("a\nNEW\nc\n", "a\nORIG\nc\n", "a\nUSER\nc\n", DiffSpec{
		Labels: &DiffLabels{Generated: "G", Existing: "E"},
	})
	if !res.Conflict || res.Outcome != MergeMerged {
		t.Fatalf("expected a merged conflict, got %+v", res)
	}
	eq(t, "content", res.Content, "a\n<<<<<<< G\nNEW\n=======\nUSER\n>>>>>>> E\nc\n")
}

// Insertions in front of a shared anchor line.
func TestMergeInsertionsBeforeAnchor(t *testing.T) {
	L := DiffSpec{Labels: &DiffLabels{Generated: "G", Existing: "E"}}

	// Only the generator inserted.
	res := Merge("X\nanchor\n", "anchor\n", "anchor\n", L)
	eq(t, "generator insert", res.Content, "X\nanchor\n")

	// Only the user inserted.
	res = Merge("anchor\n", "anchor\n", "Y\nanchor\n", L)
	eq(t, "user insert", res.Content, "Y\nanchor\n")

	// Both inserted the same thing.
	res = Merge("S\nanchor\nq\n", "anchor\n", "S\nanchor\n", L)
	if strings.Contains(res.Content, "<<<<<<<") {
		t.Errorf("identical insertions should not conflict: %q", res.Content)
	}

	// Both inserted, differently.
	res = Merge("X\nanchor\n", "anchor\n", "Y\nanchor\n", L)
	if !res.Conflict {
		t.Errorf("expected conflict, got %q", res.Content)
	}
	eq(t, "conflicting inserts", res.Content, "<<<<<<< G\nX\n=======\nY\n>>>>>>> E\nanchor\n")
}

// Appends after the last shared line exercise the tail branch.
func TestMergeTail(t *testing.T) {
	L := DiffSpec{Labels: &DiffLabels{Generated: "G", Existing: "E"}}

	// Only the generator appended.
	res := Merge("a\nX\n", "a\n", "a\n", L)
	eq(t, "generator append", res.Content, "a\nX\n")

	// Only the user appended.
	res = Merge("a\n", "a\n", "a\nY\n", L)
	eq(t, "user append", res.Content, "a\nY\n")

	// Both appended the same thing — reached via the region path because
	// the two inputs are otherwise identical, so guard with a difference.
	res = Merge("a\nS\nG\n", "a\n", "a\nS\n", L)
	if strings.Contains(res.Content, "=======") && !res.Conflict {
		t.Errorf("unexpected shape: %q", res.Content)
	}

	// Both appended, differently.
	res = Merge("a\nX\n", "a\n", "a\nY\n", L)
	if !res.Conflict {
		t.Errorf("expected conflict, got %q", res.Content)
	}
	eq(t, "conflicting appends", res.Content, "a\n<<<<<<< G\nX\n=======\nY\n>>>>>>> E\n")
}

// An empty baseline has no anchors at all, so the whole thing is one region.
func TestMergeEmptyBaseline(t *testing.T) {
	L := DiffSpec{Labels: &DiffLabels{Generated: "G", Existing: "E"}}
	res := Merge("X\n", "", "Y\n", L)
	if !res.Conflict {
		t.Errorf("expected conflict, got %q", res.Content)
	}
	eq(t, "content", res.Content, "<<<<<<< G\nX\n=======\nY\n>>>>>>> E\n")
}

// A conflicting region whose last line has no trailing newline: the closing
// marker must still start its own line.
func TestMergeConflictWithoutTrailingNewline(t *testing.T) {
	L := DiffSpec{Labels: &DiffLabels{Generated: "G", Existing: "E"}}
	res := Merge("X", "", "Y", L)
	eq(t, "content", res.Content, "<<<<<<< G\nX\n=======\nY\n>>>>>>> E\n")
}

// A deletion by the user, in a region the generator did not touch, must
// win — that is exactly what "preserve manual edits" means. Worth stating
// explicitly, because the obvious-looking property "every generated line
// survives" is FALSE for a three-way merge, and asserting it would be
// asserting a bug.
func TestMergeUserDeletionWins(t *testing.T) {
	res := Merge(
		"keep\ndrop-me\n", // generator: unchanged from baseline
		"keep\ndrop-me\n", // baseline
		"keep\n",          // user deleted the second line
		DiffSpec{})
	eq(t, "content", res.Content, "keep\n")
	if res.Conflict {
		t.Error("a clean deletion is not a conflict")
	}
}

// And the mirror: a deletion by the generator, in a region the user did not
// touch, also wins.
func TestMergeGeneratorDeletionWins(t *testing.T) {
	res := Merge("keep\n", "keep\ndrop-me\n", "keep\ndrop-me\n", DiffSpec{})
	eq(t, "content", res.Content, "keep\n")
	if res.Conflict {
		t.Error("a clean deletion is not a conflict")
	}
}

// Property: the merge never invents content. Every non-marker line in the
// output has to have come from one of the three inputs.
func TestMergeInventsNothing(t *testing.T) {
	r := rand.New(rand.NewSource(31337))

	for iter := 0; iter < 500; iter++ {
		base := strings.Join(randLines(r, 2+r.Intn(8), 4), "")
		gen := strings.Join(randLines(r, 2+r.Intn(8), 4), "")
		exi := strings.Join(randLines(r, 2+r.Intn(8), 4), "")

		res := Merge(gen, base, exi, DiffSpec{})

		known := map[string]bool{}
		for _, side := range []string{gen, base, exi} {
			for _, line := range Lines(side) {
				known[line] = true
			}
		}

		for _, line := range Lines(res.Content) {
			if strings.HasPrefix(line, markStart) ||
				strings.HasPrefix(line, markEnd) || line == markMid {
				continue
			}
			if !known[line] {
				t.Fatalf("merge invented %q\n gen=%q base=%q exi=%q\n out=%q",
					line, gen, base, exi, res.Content)
			}
		}
	}
}

// Property: a reported conflict always carries both sides' markers, so the
// user can actually resolve it.
func TestMergeConflictAlwaysMarked(t *testing.T) {
	r := rand.New(rand.NewSource(777))

	for iter := 0; iter < 500; iter++ {
		base := strings.Join(randLines(r, 2+r.Intn(8), 3), "")
		gen := strings.Join(randLines(r, 2+r.Intn(8), 3), "")
		exi := strings.Join(randLines(r, 2+r.Intn(8), 3), "")

		res := Merge(gen, base, exi, DiffSpec{
			Labels: &DiffLabels{Generated: "G", Existing: "E"},
		})
		if !res.Conflict {
			continue
		}
		for _, want := range []string{"<<<<<<< G\n", "=======\n", ">>>>>>> E\n"} {
			if !strings.Contains(res.Content, want) {
				t.Fatalf("conflict missing %q\n out=%q", want, res.Content)
			}
		}
	}
}

// Property: every conflict marker starts its own line. A marker glued onto
// the end of a content line cannot be parsed by anything.
func TestMergeMarkersStartTheirOwnLine(t *testing.T) {
	r := rand.New(rand.NewSource(2468))

	for iter := 0; iter < 400; iter++ {
		// Deliberately drop trailing newlines to stress the boundary.
		trim := func(s string) string { return strings.TrimSuffix(s, "\n") }
		base := trim(strings.Join(randLines(r, 1+r.Intn(5), 3), ""))
		gen := trim(strings.Join(randLines(r, 1+r.Intn(5), 3), ""))
		exi := trim(strings.Join(randLines(r, 1+r.Intn(5), 3), ""))

		res := Merge(gen, base, exi, DiffSpec{
			Labels: &DiffLabels{Generated: "G", Existing: "E"},
		})

		for _, line := range Lines(res.Content) {
			for _, mark := range []string{markStart, markEnd, "======="} {
				at := strings.Index(line, mark)
				if at > 0 {
					t.Fatalf("marker %q not at line start in %q\n out=%q",
						mark, line, res.Content)
				}
			}
		}
	}
}

// A clean merge (only one side changed) must never report a conflict.
func TestMergeCleanNeverConflicts(t *testing.T) {
	r := rand.New(rand.NewSource(909))

	for iter := 0; iter < 300; iter++ {
		base := strings.Join(randLines(r, 3+r.Intn(8), 5), "")
		gen := strings.Join(randLines(r, 3+r.Intn(8), 5), "")

		// existing == baseline: nothing of the user's to preserve.
		if res := Merge(gen, base, base, DiffSpec{}); res.Conflict {
			t.Fatalf("clean merge conflicted: gen=%q base=%q", gen, base)
		}
	}
}

// --- Diff -----------------------------------------------------------------

func TestDiffSame(t *testing.T) {
	res := Diff("a\nb\n", "a\nb\n", DiffSpec{})
	if res.Outcome != DiffSame || res.Conflict || res.Content != "a\nb\n" {
		t.Errorf("got %+v", res)
	}
}

func TestDiffChanged(t *testing.T) {
	res := Diff("a\nNEW\nc\n", "a\nOLD\nc\n", DiffSpec{
		Labels: &DiffLabels{Generated: "G", Existing: "E"},
	})
	if res.Outcome != DiffChanged || !res.Conflict {
		t.Fatalf("got %+v", res)
	}
	// Existing side first, then generated.
	eq(t, "content", res.Content,
		"a\n<<<<<<< E\nOLD\n>>>>>>> E\n<<<<<<< G\nNEW\n>>>>>>> G\na\nc\n"[0:0]+
			"a\n<<<<<<< E\nOLD\n>>>>>>> E\n<<<<<<< G\nNEW\n>>>>>>> G\nc\n")
}

func TestDiffPureInsertion(t *testing.T) {
	res := Diff("a\nb\n", "a\n", DiffSpec{
		Labels: &DiffLabels{Generated: "G", Existing: "E"},
	})
	// Only a generated block: nothing was removed.
	eq(t, "content", res.Content, "a\n<<<<<<< G\nb\n>>>>>>> G\n")
}

func TestDiffPureDeletion(t *testing.T) {
	res := Diff("a\n", "a\nb\n", DiffSpec{
		Labels: &DiffLabels{Generated: "G", Existing: "E"},
	})
	// Only an existing block: nothing was added.
	eq(t, "content", res.Content, "a\n<<<<<<< E\nb\n>>>>>>> E\n")
}

// A changed final line with no trailing newline: the closing marker must
// still start its own line.
func TestDiffWithoutTrailingNewline(t *testing.T) {
	res := Diff("a\nZ1", "a\nZ9", DiffSpec{
		Labels: &DiffLabels{Generated: "G", Existing: "E"},
	})
	eq(t, "content", res.Content, "a\n<<<<<<< E\nZ9\n>>>>>>> E\n<<<<<<< G\nZ1\n>>>>>>> G\n")
}

func TestDiffFromEmpty(t *testing.T) {
	res := Diff("a\n", "", DiffSpec{Labels: &DiffLabels{Generated: "G", Existing: "E"}})
	eq(t, "content", res.Content, "<<<<<<< G\na\n>>>>>>> G\n")
}

func TestDiffToEmpty(t *testing.T) {
	res := Diff("", "a\n", DiffSpec{Labels: &DiffLabels{Generated: "G", Existing: "E"}})
	eq(t, "content", res.Content, "<<<<<<< E\na\n>>>>>>> E\n")
}

func TestHunks(t *testing.T) {
	// Adjacent delete+insert merge into a single change hunk.
	hs := Hunks([]string{"a\n", "X\n", "c\n"}, []string{"a\n", "Y\n", "c\n"})
	if len(hs) != 3 {
		t.Fatalf("want 3 hunks, got %d: %+v", len(hs), hs)
	}
	if hs[0].Kind != hunkSame || hs[1].Kind != hunkChange || hs[2].Kind != hunkSame {
		t.Errorf("hunk kinds: %+v", hs)
	}
	eqSlice(t, "change generated", hs[1].Generated, []string{"X\n"})
	eqSlice(t, "change existing", hs[1].Existing, []string{"Y\n"})

	// Consecutive shared lines collapse into one same-hunk.
	hs = Hunks([]string{"a\n", "b\n"}, []string{"a\n", "b\n"})
	if len(hs) != 1 || hs[0].Kind != hunkSame {
		t.Fatalf("want one same hunk, got %+v", hs)
	}
	eqSlice(t, "same lines", hs[0].Generated, []string{"a\n", "b\n"})

	// Two changed regions separated by a shared line stay separate.
	hs = Hunks([]string{"X\n", "m\n", "Y\n"}, []string{"P\n", "m\n", "Q\n"})
	changes := 0
	for _, h := range hs {
		if h.Kind == hunkChange {
			changes++
		}
	}
	if changes != 2 {
		t.Errorf("want 2 change hunks, got %d: %+v", changes, hs)
	}

	// No shared lines at all: one change hunk from the trailing flush.
	hs = Hunks([]string{"X\n"}, []string{"Y\n"})
	if len(hs) != 1 || hs[0].Kind != hunkChange {
		t.Fatalf("want one change hunk, got %+v", hs)
	}

	// Both empty: no hunks (the flush is a no-op).
	if hs := Hunks(nil, nil); len(hs) != 0 {
		t.Errorf("want no hunks, got %+v", hs)
	}
}

// --- Performance ----------------------------------------------------------

// The reason this engine exists. The previous dependency took ~6.4 s at
// 5 000 lines and ~62 s at 10 000 on this shape.
func TestMergeLargeRepeatedVocabularyIsFast(t *testing.T) {
	if testing.Short() {
		t.Skip("slow")
	}
	const n = 8000
	mk := func(seed int64) string {
		s := seed
		var sb strings.Builder
		for i := 0; i < n; i++ {
			s = (s*1103515245 + 12345) & 0x7fffffff
			sb.WriteString(fmt.Sprintf("  key_%d: value_%d\n", s%40, s%40))
		}
		return sb.String()
	}

	var m0, m1 runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m0)
	start := time.Now()
	Merge(mk(2), mk(1), mk(3), DiffSpec{})
	elapsed := time.Since(start)
	runtime.ReadMemStats(&m1)

	allocMB := float64(m1.TotalAlloc-m0.TotalAlloc) / (1024 * 1024)
	t.Logf("n=%d time=%v allocated=%.1f MB", n, elapsed, allocMB)

	if elapsed > 30*time.Second {
		t.Errorf("merge took %v at %d lines", elapsed, n)
	}
	// Memory must stay O(min(N,M)); a full table would need ~500 MB here.
	if allocMB > 64 {
		t.Errorf("allocated %.1f MB at %d lines; looks like a full DP table", allocMB, n)
	}
}

// --- helpers --------------------------------------------------------------

// randLines builds a line sequence from an alphabet of `vocab` distinct
// lines. A small vocab produces heavy duplication, which is the realistic
// case for source code and the case most likely to expose a tie-breaking
// difference.
func randLines(r *rand.Rand, n, vocab int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("L%d\n", r.Intn(vocab))
	}
	return out
}

func concat(parts ...[]string) []string {
	var out []string
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}
