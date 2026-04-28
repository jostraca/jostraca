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

// merge3 performs a 3-way merge of three byte streams treated as
// newline-separated text. Output is a single byte sequence with
// conflict regions wrapped in:
//
//	<<<<<<< GENERATED:
//	{a-side lines}
//	||||||| BASELINE:
//	{o-side lines}
//	=======
//	{b-side lines}
//	>>>>>>> EXISTING:
//
// The algorithm is the classic diff3 region splitter built on top
// of LCS(O, A) and LCS(O, B): O lines that survive both LCS pairs
// are anchors. Between anchors, regions of A, O, B are reconciled.
func merge3(a, o, b []byte) mergeResult {
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
				writeConflict(&buf, aIns, nil, bIns)
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
			writeConflict(&buf, aRegion, oRegion, bRegion)
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
			writeConflict(&buf, aTail, nil, bTail)
			conflict = true
		}
	}
	return mergeResult{Content: buf.Bytes(), Conflict: conflict}
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

func writeConflict(buf *bytes.Buffer, a, o, b []string) {
	buf.WriteString("<<<<<<< GENERATED:\n")
	writeAll(buf, a)
	if !endsWithNL(buf.Bytes()) {
		buf.WriteString("\n")
	}
	if o != nil {
		buf.WriteString("||||||| BASELINE:\n")
		writeAll(buf, o)
		if !endsWithNL(buf.Bytes()) {
			buf.WriteString("\n")
		}
	}
	buf.WriteString("=======\n")
	writeAll(buf, b)
	if !endsWithNL(buf.Bytes()) {
		buf.WriteString("\n")
	}
	buf.WriteString(">>>>>>> EXISTING:\n")
}

func endsWithNL(b []byte) bool {
	return len(b) > 0 && b[len(b)-1] == '\n'
}

// stringsHasMergeMarkers detects whether content already contains the
// 3-way merge conflict markers (used by saveMerge to know whether the
// merge produced clean content).
func stringsHasMergeMarkers(s string) bool {
	return strings.Contains(s, "<<<<<<< GENERATED:") &&
		strings.Contains(s, ">>>>>>> EXISTING:")
}
