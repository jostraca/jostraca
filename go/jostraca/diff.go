package jostraca

import (
	"bytes"
	"strings"
)

// renderDiff produces a conflict-marker view of two text inputs. Equal
// regions pass through verbatim; differing regions are wrapped:
//
//	<<<<<<< GENERATED:
//	{generated lines}
//	=======
//	{existing lines}
//	>>>>>>> EXISTING:
//
// The line-diff is computed via a tiny LCS (Hunt-McIlroy style) so we
// avoid an external dependency. For the small text files Jostraca
// targets, the O(N·M) cost is fine.
func renderDiff(generated, existing []byte) []byte {
	if bytes.Equal(generated, existing) {
		return generated
	}
	a := splitLinesKeepNL(string(generated))
	b := splitLinesKeepNL(string(existing))
	hunks := lineDiff(a, b)

	var buf bytes.Buffer
	for _, h := range hunks {
		switch h.kind {
		case hunkEqual:
			for _, l := range h.aLines {
				buf.WriteString(l)
			}
		case hunkChange:
			buf.WriteString("<<<<<<< GENERATED:\n")
			for _, l := range h.aLines {
				buf.WriteString(l)
			}
			buf.WriteString("=======\n")
			for _, l := range h.bLines {
				buf.WriteString(l)
			}
			buf.WriteString(">>>>>>> EXISTING:\n")
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
func lcsLines(a, b []string) []string {
	if len(a) == 0 || len(b) == 0 {
		return nil
	}
	// Standard O(N·M) DP table.
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
	// Reconstruct.
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
	// Reverse.
	for k, l := 0, len(out)-1; k < l; k, l = k+1, l-1 {
		out[k], out[l] = out[l], out[k]
	}
	return out
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
