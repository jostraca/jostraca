package jostraca

import (
	"strings"
	"testing"
)

// Documents a KNOWN, UNRESOLVED divergence between the stacks: the Go
// merge3/renderDiff and the TS `node-diff3`/`diff` dependencies produce
// different — both valid — output for the same inputs.
//
// Measured over randomised inputs with a small line vocabulary (heavily
// repeated lines, the realistic shape for generated config and reference
// output): the two disagree on ~72% of 3-way merges and ~21% of 2-way
// diffs. Every parity scenario in testdata/parity passes because all six
// merge/diff scenarios there are simple — one changed region, distinct
// lines — which is exactly the case where the two agree.
//
// Both outputs are correct 3-way merges: each preserves the conflicting
// content inside markers. They differ in how regions are split, which
// changes the bytes written into a user's file.
//
// This is NOT fixed here because resolving it is a maintainer decision
// with a real trade-off (see CODE_REVIEW.md, G17):
//
//   - Make Go match TS byte-for-byte by porting node-diff3's region
//     splitter. Restores strict parity, but gives Go node-diff3's
//     performance, which is 62 s on a 10 000-line repeated-vocabulary
//     merge and effectively unbounded beyond that.
//   - Adopt this (much faster) algorithm in TS as well. Restores parity
//     and fixes the performance wall, at the cost of a one-time change to
//     the merge output existing users see.
//
// These tests pin the current Go behaviour so the divergence is visible
// and any change to it is deliberate.

// mergeDivergenceCase is the smallest input found where the two stacks
// disagree. TS (node-diff3) produces the `tsWant` string below.
func TestMergeDivergenceIsPinned(t *testing.T) {
	a := "L0\nL1\nL0\nL0\n"
	o := "L1\nL1\nL0\nL1\n"
	b := "L1\nL1\nL1\nL0\n"

	goWant := "L0\nL1\n" +
		"<<<<<<< GENERATED: T/merge\n" +
		"=======\nL1\nL1\n" +
		">>>>>>> EXISTING: T/merge\n" +
		"L0\n" +
		"<<<<<<< GENERATED: T/merge\nL0\n" +
		"=======\n" +
		">>>>>>> EXISTING: T/merge\n"

	// For the record, what TS emits for the same input:
	const tsWant = "<<<<<<< GENERATED: T/merge\nL0\n" +
		"=======\nL1\nL1\n" +
		">>>>>>> EXISTING: T/merge\n" +
		"L1\n" +
		"<<<<<<< GENERATED: T/merge\nL0\nL0\n" +
		"=======\nL0\n" +
		">>>>>>> EXISTING: T/merge\n"

	res := merge3Labelled([]byte(a), []byte(o), []byte(b),
		mergeLabels{A: "GENERATED: T/merge", B: "EXISTING: T/merge"})

	if got := string(res.Content); got != goWant {
		t.Errorf("Go merge output changed.\n got: %q\nwant: %q", got, goWant)
	}
	if goWant == tsWant {
		t.Error("goWant and tsWant are equal — if the stacks now agree, " +
			"remove this test and add the case to the parity corpus")
	}
	if !res.Conflict {
		t.Error("expected a conflict for this input")
	}
}

// Both sides of a divergent merge must still be *valid*: the conflicting
// content from each input has to survive into the output, so a user can
// resolve it by hand. A merge that silently drops content would be a bug
// regardless of which region split is chosen.
func TestDivergentMergeStillPreservesBothSides(t *testing.T) {
	cases := []struct{ a, o, b string }{
		{"L0\nL1\nL0\nL0\n", "L1\nL1\nL0\nL1\n", "L1\nL1\nL1\nL0\n"},
		{"X\nY\n", "A\nB\n", "P\nQ\n"},
		{"one\ntwo\n", "one\n", "one\nuser\n"},
	}

	for _, c := range cases {
		res := merge3([]byte(c.a), []byte(c.o), []byte(c.b))
		out := string(res.Content)

		// Every line unique to a or b must appear somewhere in the output.
		for _, side := range []string{c.a, c.b} {
			for _, line := range splitLinesKeepNL(side) {
				if !strings.Contains(out, line) {
					t.Errorf("merge dropped %q\n a=%q o=%q b=%q\n out=%q",
						line, c.a, c.o, c.b, out)
				}
			}
		}
	}
}
