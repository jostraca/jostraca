package jostraca

import (
	"bytes"
	"strings"
)

// mergeResult is returned by merge3.
type mergeResult struct {
	Content  []byte
	Conflict bool
}

// mergeLabels customises the conflict marker labels. When zero, the
// labels match TS exactly: "GENERATED: <isoWhen>/merge" and
// "EXISTING: <isoLast>/merge".
type mergeLabels struct {
	A string // "GENERATED: ..." goes after `<<<<<<< `
	B string // "EXISTING: ..." goes after `>>>>>>> `
}

// merge3 performs a 3-way merge of three byte streams treated as
// newline-separated text. Output uses TS-compatible 2-side markers
// (no BASELINE block) so output is byte-equal to the TS reference.
//
// The algorithm is the classic diff3 region splitter built on top
// of LCS(O, A) and LCS(O, B): O lines that survive both LCS pairs
// are anchors. Between anchors, regions of A, O, B are reconciled.
func merge3(a, o, b []byte) mergeResult {
	return merge3Labelled(a, o, b, mergeLabels{A: "GENERATED:", B: "EXISTING:"})
}

func merge3Labelled(a, o, b []byte, lbl mergeLabels) mergeResult {
	al := splitLinesKeepNL(string(a))
	ol := splitLinesKeepNL(string(o))
	bl := splitLinesKeepNL(string(b))

	aMap := alignLCS(ol, al)
	bMap := alignLCS(ol, bl)

	var buf bytes.Buffer
	conflict := false

	oi, ai, bi := 0, 0, 0
	for oi < len(ol) {
		if aMap[oi] >= 0 && bMap[oi] >= 0 {
			// oi is a triple-anchor: the same O line survives in both A and B.
			// Pre-anchor insertions in A and B may need reconciliation.
			aIns := al[ai:aMap[oi]]
			bIns := bl[bi:bMap[oi]]
			switch {
			case sliceEq(aIns, bIns):
				writeAll(&buf, aIns)
			case len(aIns) == 0:
				writeAll(&buf, bIns)
			case len(bIns) == 0:
				writeAll(&buf, aIns)
			default:
				writeConflictTS(&buf, aIns, bIns, lbl)
				conflict = true
			}
			buf.WriteString(ol[oi])
			ai = aMap[oi] + 1
			bi = bMap[oi] + 1
			oi++
			continue
		}
		// Find the next triple-anchor.
		nextOi := oi
		for nextOi < len(ol) && (aMap[nextOi] < 0 || bMap[nextOi] < 0) {
			nextOi++
		}
		oRegion := ol[oi:nextOi]
		var aRegion, bRegion []string
		if nextOi < len(ol) {
			aRegion = al[ai:aMap[nextOi]]
			bRegion = bl[bi:bMap[nextOi]]
		} else {
			aRegion = al[ai:]
			bRegion = bl[bi:]
		}
		switch {
		case sliceEq(oRegion, aRegion):
			writeAll(&buf, bRegion)
		case sliceEq(oRegion, bRegion):
			writeAll(&buf, aRegion)
		case sliceEq(aRegion, bRegion):
			writeAll(&buf, aRegion)
		default:
			writeConflictTS(&buf, aRegion, bRegion, lbl)
			conflict = true
		}
		if nextOi < len(ol) {
			ai = aMap[nextOi]
			bi = bMap[nextOi]
		} else {
			ai = len(al)
			bi = len(bl)
		}
		oi = nextOi
	}
	// Trailing insertions after the last anchor.
	if ai < len(al) || bi < len(bl) {
		aTail := al[ai:]
		bTail := bl[bi:]
		switch {
		case sliceEq(aTail, bTail):
			writeAll(&buf, aTail)
		case len(aTail) == 0:
			writeAll(&buf, bTail)
		case len(bTail) == 0:
			writeAll(&buf, aTail)
		default:
			writeConflictTS(&buf, aTail, bTail, lbl)
			conflict = true
		}
	}
	return mergeResult{Content: buf.Bytes(), Conflict: conflict}
}

// writeConflictTS writes TS-compatible 2-side conflict markers.
func writeConflictTS(buf *bytes.Buffer, a, b []string, lbl mergeLabels) {
	buf.WriteString("<<<<<<< ")
	buf.WriteString(lbl.A)
	buf.WriteString("\n")
	writeAll(buf, a)
	if !endsWithNL(buf.Bytes()) {
		buf.WriteString("\n")
	}
	buf.WriteString("=======\n")
	writeAll(buf, b)
	if !endsWithNL(buf.Bytes()) {
		buf.WriteString("\n")
	}
	buf.WriteString(">>>>>>> ")
	buf.WriteString(lbl.B)
	buf.WriteString("\n")
}

// alignLCS returns a slice m of length len(ol) where m[i] is the
// position in target at which ol[i] appears in the LCS of ol and
// target, or -1 if ol[i] is not in the LCS. This gives a
// position-preserving anchor map.
func alignLCS(ol, target []string) []int {
	m := make([]int, len(ol))
	for i := range m {
		m[i] = -1
	}
	if len(ol) == 0 || len(target) == 0 {
		return m
	}
	lcs := lcsLines(ol, target)
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

func sliceEq(a, b []string) bool {
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

func writeAll(buf *bytes.Buffer, lines []string) {
	for _, l := range lines {
		buf.WriteString(l)
	}
}

func endsWithNL(b []byte) bool {
	return len(b) > 0 && b[len(b)-1] == '\n'
}

// stringsHasMergeMarkers detects whether content already contains the
// 3-way merge conflict markers (used by saveMerge to know whether the
// merge produced clean content).
// TS's unresolved-conflict guard keys on the end marker alone
// (ts/src/build/FileHandler.ts merge()), so a half-resolved file — the user
// removed the opening marker but not the closing one — is skipped by both
// stacks rather than re-merged by one of them.
func stringsHasMergeMarkers(s string) bool {
	return strings.Contains(s, ">>>>>>> EXISTING:")
}
