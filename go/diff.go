package jostraca

import (
	"bytes"
	"strings"
)

// renderDiff produces a TS-compatible conflict-marker view of two text
// inputs. Each added or removed region is emitted as its own paired
// block:
//
//	<<<<<<< GENERATED: <isoWhen>/diff
//	{added lines}
//	>>>>>>> GENERATED: <isoWhen>/diff
//
// or for removals:
//
//	<<<<<<< EXISTING: <isoLast>/diff
//	{removed lines}
//	>>>>>>> EXISTING: <isoLast>/diff
//
// Equal regions pass through verbatim. The line-diff is computed via
// a tiny LCS so we avoid an external dependency.
func renderDiff(generated, existing []byte, isoWhen, isoLast string) []byte {
	if bytes.Equal(generated, existing) {
		return generated
	}
	a := splitLinesKeepNL(string(generated))
	b := splitLinesKeepNL(string(existing))
	hunks := lineDiff(a, b)

	var buf bytes.Buffer
	addLabel := "GENERATED: " + isoWhen + "/diff"
	delLabel := "EXISTING: " + isoLast + "/diff"

	for _, h := range hunks {
		switch h.kind {
		case hunkEqual:
			for _, l := range h.aLines {
				buf.WriteString(l)
			}
		case hunkChange:
			// TS (kpdecker/jsdiff) emits removed-then-added per hunk;
			// match that order so output is byte-equal.
			if len(h.bLines) > 0 {
				buf.WriteString("<<<<<<< ")
				buf.WriteString(delLabel)
				buf.WriteByte('\n')
				for _, l := range h.bLines {
					buf.WriteString(l)
					if !strings.HasSuffix(l, "\n") {
						buf.WriteByte('\n')
					}
				}
				buf.WriteString(">>>>>>> ")
				buf.WriteString(delLabel)
				buf.WriteByte('\n')
			}
			if len(h.aLines) > 0 {
				buf.WriteString("<<<<<<< ")
				buf.WriteString(addLabel)
				buf.WriteByte('\n')
				for _, l := range h.aLines {
					buf.WriteString(l)
					if !strings.HasSuffix(l, "\n") {
						buf.WriteByte('\n')
					}
				}
				buf.WriteString(">>>>>>> ")
				buf.WriteString(addLabel)
				buf.WriteByte('\n')
			}
		}
	}
	return buf.Bytes()
}

const (
	hunkEqual  = 0
	hunkChange = 1
)

type hunk struct {
	kind   int
	aLines []string
	bLines []string
}

// lineDiff returns a list of hunks describing how to turn b into a (or
// equivalently, a into b). It's a simple LCS-based diff merging
// adjacent insertions+deletions into single change hunks.
func lineDiff(a, b []string) []hunk {
	lcs := lcsLines(a, b)

	var hunks []hunk
	ai, bi := 0, 0
	flush := func(aLines, bLines []string) {
		if len(aLines) == 0 && len(bLines) == 0 {
			return
		}
		// Merge into the previous change hunk if one is open.
		if n := len(hunks); n > 0 && hunks[n-1].kind == hunkChange {
			hunks[n-1].aLines = append(hunks[n-1].aLines, aLines...)
			hunks[n-1].bLines = append(hunks[n-1].bLines, bLines...)
			return
		}
		hunks = append(hunks, hunk{kind: hunkChange, aLines: aLines, bLines: bLines})
	}
	for _, line := range lcs {
		// Collect mismatches before the matching line.
		var aDel, bDel []string
		for ai < len(a) && a[ai] != line {
			aDel = append(aDel, a[ai])
			ai++
		}
		for bi < len(b) && b[bi] != line {
			bDel = append(bDel, b[bi])
			bi++
		}
		flush(aDel, bDel)
		// Emit the matching line as an Equal hunk.
		if n := len(hunks); n > 0 && hunks[n-1].kind == hunkEqual {
			hunks[n-1].aLines = append(hunks[n-1].aLines, line)
		} else {
			hunks = append(hunks, hunk{kind: hunkEqual, aLines: []string{line}})
		}
		ai++
		bi++
	}
	// Trailing diff.
	var aTail, bTail []string
	for ai < len(a) {
		aTail = append(aTail, a[ai])
		ai++
	}
	for bi < len(b) {
		bTail = append(bTail, b[bi])
		bi++
	}
	flush(aTail, bTail)
	return hunks
}

// lcsLines returns the longest common subsequence of two string slices.
//
// The previous implementation built the full O(N·M) DP table. That is
// O(N·M) *memory*, not just time: two 8 000-line files allocated 500 MB,
// and growth is quadratic, so ~16 000 lines needed ~2 GB and anything
// larger was an OOM rather than a slowdown. Regenerating a large SDK is
// exactly the workload that hits it.
//
// This version keeps the same result but bounds memory:
//
//  1. Trim the common prefix and suffix first. Those lines are in every
//     optimal LCS, and for a regenerated file — where most content is
//     unchanged — this usually reduces the quadratic core to almost
//     nothing.
//  2. Run Hirschberg's algorithm on what remains: still O(N·M) time, but
//     O(min(N,M)) space, because each divide step only ever holds two
//     rows.
//
// Tie-breaking is chosen to match the old table walk exactly, so the
// emitted LCS — and therefore every merge and diff byte — is unchanged.
// TestLCSMatchesReferenceDP pins that against the original algorithm over
// randomised inputs.
func lcsLines(a, b []string) []string {
	if len(a) == 0 || len(b) == 0 {
		return nil
	}

	// 1. Common prefix.
	p := 0
	for p < len(a) && p < len(b) && a[p] == b[p] {
		p++
	}
	// 2. Common suffix of what is left.
	s := 0
	for s < len(a)-p && s < len(b)-p &&
		a[len(a)-1-s] == b[len(b)-1-s] {
		s++
	}

	prefix, suffix := a[:p], a[len(a)-s:]
	midA, midB := a[p:len(a)-s], b[p:len(b)-s]

	out := make([]string, 0, p+s+min(len(midA), len(midB)))
	out = append(out, prefix...)
	out = hirschbergLCS(midA, midB, out)
	out = append(out, suffix...)
	return out
}

// hirschbergLCS appends the LCS of a and b to out and returns it, using
// O(min(len(a),len(b))) working space.
func hirschbergLCS(a, b []string, out []string) []string {
	switch {
	case len(a) == 0 || len(b) == 0:
		return out

	case len(a) == 1:
		// For a single row the old walk starts at j = len(b) and steps j
		// down until it finds a match, so it lands on the *last*
		// occurrence of a[0] in b.
		for i := len(b) - 1; i >= 0; i-- {
			if b[i] == a[0] {
				return append(out, a[0])
			}
		}
		return out
	}

	mid := len(a) / 2
	// Length of the LCS of a[:mid] with each prefix of b, and of a[mid:]
	// with each suffix of b. Two rows each, not a table.
	head := lcsRow(a[:mid], b, false)
	tail := lcsRow(a[mid:], b, true)

	// On a tie take the *largest* split. Several splits can yield an
	// equally long LCS but a different one, and this is the choice that
	// reproduces the old table walk's preference for stepping i down
	// before j. TestLCSMatchesReferenceDP pins it; `sum > best` here
	// silently changes merge output.
	best, split := -1, 0
	for k := 0; k <= len(b); k++ {
		if sum := head[k] + tail[len(b)-k]; sum >= best {
			best, split = sum, k
		}
	}

	out = hirschbergLCS(a[:mid], b[:split], out)
	return hirschbergLCS(a[mid:], b[split:], out)
}

// lcsRow returns the final row of the LCS length table for a against b.
// With reverse set, both sequences are walked back-to-front, so the
// result is indexed by suffix length rather than prefix length.
func lcsRow(a, b []string, reverse bool) []int {
	prev := make([]int, len(b)+1)
	cur := make([]int, len(b)+1)

	at := func(xs []string, i int) string {
		if reverse {
			return xs[len(xs)-1-i]
		}
		return xs[i]
	}

	for i := 0; i < len(a); i++ {
		ai := at(a, i)
		cur[0] = 0
		for j := 0; j < len(b); j++ {
			if ai == at(b, j) {
				cur[j+1] = prev[j] + 1
			} else if prev[j+1] >= cur[j] {
				cur[j+1] = prev[j+1]
			} else {
				cur[j+1] = cur[j]
			}
		}
		prev, cur = cur, prev
	}
	return prev
}

// splitLinesKeepNL splits on \n, retaining the trailing newline on
// each line so the round-trip is lossless.
func splitLinesKeepNL(s string) []string {
	if s == "" {
		return nil
	}
	var out []string
	for {
		i := strings.IndexByte(s, '\n')
		if i < 0 {
			out = append(out, s)
			return out
		}
		out = append(out, s[:i+1])
		s = s[i+1:]
		if s == "" {
			return out
		}
	}
}
