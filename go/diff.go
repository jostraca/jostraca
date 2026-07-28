package jostraca

import (
	"strings"
	"time"
)

// Line diff and three-way merge.
//
// This file mirrors ts/src/diff.ts directly, function for function. The
// two stacks previously ran different algorithms — TS delegated to
// `node-diff3`, Go hand-rolled its own — and disagreed on ~72% of
// non-trivial merges, both producing valid but different output. The only
// way two implementations stay byte-identical is to be the same algorithm,
// so any change here must be made in both files.
//
// Algorithm:
//
//   - Trim the common prefix and suffix. For a regenerated file, where
//     most content is unchanged, this collapses the quadratic core to
//     almost nothing.
//   - Run Hirschberg's algorithm on the remainder: O(N·M) time, but
//     O(min(N,M)) space rather than a full table.
//   - Split the three inputs into regions around the lines that survive in
//     both, and reconcile each region (the classic diff3 shape).
//
// Exactly one tie-break is load-bearing: on a tie, take the LARGEST split
// point. Several subsequences can be equally long but different, and that
// choice decides which of a user's lines are reported as kept, so both
// stacks fix the same rule.
//
// Two nearby lines look like tie-breaks and are not — the `>=` in lcsRow,
// which picks between two numbers already known to be equal, and the
// direction of the single-row base-case scan, which appends the same
// string whichever position matched. ts/tools/mutate-diff.js asserts all
// three claims against the corpus, including that the two decorative ones
// really are decorative.

// --- Public types ---------------------------------------------------------

// DiffLabels sets the conflict marker labels explicitly, overriding
// When/Last/Kind.
type DiffLabels struct {
	Generated string
	Existing  string
}

// DiffSpec configures label formatting.
type DiffSpec struct {
	// When is the epoch-ms stamped into the GENERATED label.
	When int64
	// Last is the epoch-ms stamped into the EXISTING label.
	Last int64
	// Kind is the label suffix, e.g. "merge" or "diff".
	Kind string
	// Labels, when non-nil, overrides the formatted labels entirely.
	Labels *DiffLabels
}

// MergeOutcome says why a merge produced what it did. These map straight
// onto jostraca's audit breadcrumbs, which is the point: the caller does
// not have to re-derive the decision the merge already made.
//
//	MergeSame       the file on disk already equals the new generate
//	MergeClean      the file on disk is untouched since the last generate
//	MergeUnresolved the file on disk still holds unresolved conflict markers
//	MergeMerged     a real three-way merge ran
type MergeOutcome string

const (
	MergeSame       MergeOutcome = "same"
	MergeClean      MergeOutcome = "clean"
	MergeUnresolved MergeOutcome = "unresolved"
	MergeMerged     MergeOutcome = "merged"
)

// MergeResult is the result of Merge.
type MergeResult struct {
	Content  string
	Conflict bool
	Outcome  MergeOutcome
}

// DiffOutcome says whether the two inputs differed.
//
//	DiffSame    generated and existing are identical
//	DiffChanged the two differ and the result is annotated
type DiffOutcome string

const (
	DiffSame    DiffOutcome = "same"
	DiffChanged DiffOutcome = "changed"
)

// DiffResult is the result of Diff.
type DiffResult struct {
	Content  string
	Conflict bool
	Outcome  DiffOutcome
}

// --- Markers --------------------------------------------------------------

const (
	markStart = "<<<<<<< "
	markMid   = "=======\n"
	markEnd   = ">>>>>>> "

	labelGenerated = "GENERATED"
	labelExisting  = "EXISTING"
)

// unresolvedMark is the closing marker for the EXISTING side. A file still
// holding this has an unresolved merge in it.
const unresolvedMark = markEnd + labelExisting + ":"

// HasConflicts reports whether text still holds an unresolved conflict from
// an earlier merge.
//
// Keyed on the closing EXISTING marker alone: a half-resolved file, where
// the opening marker was removed but the closing one was not, must still
// count as unresolved rather than being re-merged.
func HasConflicts(text string) bool {
	return strings.Contains(text, unresolvedMark)
}

func isoOf(when int64) string {
	return time.UnixMilli(when).UTC().Format("2006-01-02T15:04:05.000Z")
}

func labelsOf(spec DiffSpec, defaultKind string) DiffLabels {
	kind := spec.Kind
	if kind == "" {
		kind = defaultKind
	}

	out := DiffLabels{
		Generated: labelGenerated + ": " + isoOf(spec.When) + "/" + kind,
		Existing:  labelExisting + ": " + isoOf(spec.Last) + "/" + kind,
	}

	if spec.Labels != nil {
		if spec.Labels.Generated != "" {
			out.Generated = spec.Labels.Generated
		}
		if spec.Labels.Existing != "" {
			out.Existing = spec.Labels.Existing
		}
	}

	return out
}

// --- Line primitives ------------------------------------------------------

// Lines splits on \n, keeping the newline on each line so a join round-trips
// exactly, including a final line with no trailing newline.
func Lines(text string) []string {
	if text == "" {
		return nil
	}

	var out []string
	rest := text

	for {
		at := strings.IndexByte(rest, '\n')

		if at < 0 {
			out = append(out, rest)
			return out
		}

		out = append(out, rest[:at+1])
		rest = rest[at+1:]

		if rest == "" {
			return out
		}
	}
}

// LCS returns the longest common subsequence of two line slices.
func LCS(a, b []string) []string {
	if len(a) == 0 || len(b) == 0 {
		return nil
	}

	// Common prefix, then common suffix of what is left. Those lines are in
	// every optimal LCS, and skipping them is what makes the realistic case
	// (a mostly-unchanged regenerated file) fast.
	head := 0
	for head < len(a) && head < len(b) && a[head] == b[head] {
		head++
	}

	tail := 0
	for tail < len(a)-head && tail < len(b)-head &&
		a[len(a)-1-tail] == b[len(b)-1-tail] {
		tail++
	}

	out := make([]string, 0, len(a))
	out = append(out, a[:head]...)
	out = hirschberg(a[head:len(a)-tail], b[head:len(b)-tail], out)
	out = append(out, a[len(a)-tail:]...)

	return out
}

// hirschberg is divide and conquer over the halves of a, each step holding
// only two rows of the length table.
func hirschberg(a, b, out []string) []string {
	if len(a) == 0 || len(b) == 0 {
		return out
	}

	if len(a) == 1 {
		// Scanning backwards mirrors how a full-table walk recovers the
		// LCS (it starts at the end of b and steps back), which keeps this
		// readable against the oracle in the tests. It is not a tie-break:
		// a[0] is appended whichever position matched, so first and last
		// occurrence produce the same string.
		for i := len(b) - 1; i >= 0; i-- {
			if b[i] == a[0] {
				return append(out, a[0])
			}
		}
		return out
	}

	mid := len(a) / 2
	headRow := lcsRow(a[:mid], b, false)
	tailRow := lcsRow(a[mid:], b, true)

	// `>=` so a tie takes the LARGEST split. This is THE load-bearing
	// tie-break: changing it to `>` changes the merged content on 658 of
	// the 1 190 corpus cases. See the note at the top of this file.
	best, split := -1, 0
	for k := 0; k <= len(b); k++ {
		if sum := headRow[k] + tailRow[len(b)-k]; sum >= best {
			best, split = sum, k
		}
	}

	out = hirschberg(a[:mid], b[:split], out)
	return hirschberg(a[mid:], b[split:], out)
}

// lcsRow returns the final row of the LCS length table for a against b.
// With reverse, both sequences are walked back to front, so the result is
// indexed by suffix length rather than prefix length.
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
				// max(prev[j+1], cur[j]). The `>=` is not a tie-break: on
				// a tie both branches assign the same number.
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

// AlignLCS returns the anchor map: m[i] is the index in target where
// base[i] sits in the LCS of the two, or -1 when base[i] is not in it.
func AlignLCS(base, target []string) []int {
	m := make([]int, len(base))
	for i := range m {
		m[i] = -1
	}

	if len(base) == 0 || len(target) == 0 {
		return m
	}

	common := LCS(base, target)
	ci, ti, bi := 0, 0, 0

	for ci < len(common) && bi < len(base) && ti < len(target) {
		for bi < len(base) && base[bi] != common[ci] {
			bi++
		}
		for ti < len(target) && target[ti] != common[ci] {
			ti++
		}
		if bi < len(base) && ti < len(target) {
			m[bi] = ti
			bi++
			ti++
			ci++
		}
	}

	return m
}

func sameLines(a, b []string) bool {
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

// endsWithNewline reports whether the text accumulated so far ends with a
// newline, so a marker always starts on its own line.
//
// Precondition: out is non-empty and holds no empty strings. Both hold at
// every call site — writeConflict pushes its opening marker first, and
// Lines never yields an empty element.
func endsWithNewline(out []string) bool {
	last := out[len(out)-1]
	return strings.HasSuffix(last, "\n")
}

func writeConflict(out, generated, existing []string, labels DiffLabels) []string {
	out = append(out, markStart+labels.Generated+"\n")
	out = append(out, generated...)
	if !endsWithNewline(out) {
		out = append(out, "\n")
	}

	out = append(out, markMid)
	out = append(out, existing...)
	if !endsWithNewline(out) {
		out = append(out, "\n")
	}

	return append(out, markEnd+labels.Existing+"\n")
}

// --- Three-way merge ------------------------------------------------------

// Merge combines what was just generated with what is on disk, using the
// previous generate as the common ancestor.
//
//	generated - what this run produced
//	baseline  - what the last run produced (the merge base)
//	existing  - what is on disk now, possibly hand-edited
//
// Taking the previous generate as the ancestor is what preserves manual
// edits: anything in existing that is not in baseline is the user's.
func Merge(generated, baseline, existing string, spec DiffSpec) MergeResult {
	// Fast paths, in order. Each is semantics-identical to running the full
	// merge, and each avoids the quadratic core entirely.

	// Nothing changed on either side.
	if generated == existing {
		return MergeResult{Content: existing, Outcome: MergeSame}
	}

	// The file is untouched since the last generate, so there is nothing of
	// the user's to preserve: the new generate wins outright.
	if existing == baseline {
		return MergeResult{Content: generated, Outcome: MergeClean}
	}

	// Never merge into an unresolved merge — that stacks conflict markers
	// inside conflict markers and is unreadable. Leave it for the user.
	if HasConflicts(existing) {
		return MergeResult{Content: existing, Outcome: MergeUnresolved}
	}

	labels := labelsOf(spec, "merge")

	gl := Lines(generated)
	bl := Lines(baseline)
	el := Lines(existing)

	gMap := AlignLCS(bl, gl)
	eMap := AlignLCS(bl, el)

	var out []string
	conflict := false

	bi, gi, ei := 0, 0, 0

	for bi < len(bl) {
		if gMap[bi] >= 0 && eMap[bi] >= 0 {
			// Anchor: this baseline line survives on both sides. Reconcile
			// whatever each side inserted in front of it.
			gIns := gl[gi:gMap[bi]]
			eIns := el[ei:eMap[bi]]

			switch {
			case sameLines(gIns, eIns):
				out = append(out, gIns...)
			case len(gIns) == 0:
				out = append(out, eIns...)
			case len(eIns) == 0:
				out = append(out, gIns...)
			default:
				out = writeConflict(out, gIns, eIns, labels)
				conflict = true
			}

			out = append(out, bl[bi])
			gi = gMap[bi] + 1
			ei = eMap[bi] + 1
			bi++
			continue
		}

		// Not an anchor: run forward to the next one and reconcile the whole
		// region between.
		nextBi := bi
		for nextBi < len(bl) && (gMap[nextBi] < 0 || eMap[nextBi] < 0) {
			nextBi++
		}

		bRegion := bl[bi:nextBi]
		var gRegion, eRegion []string

		if nextBi < len(bl) {
			gRegion = gl[gi:gMap[nextBi]]
			eRegion = el[ei:eMap[nextBi]]
		} else {
			gRegion = gl[gi:]
			eRegion = el[ei:]
		}

		switch {
		case sameLines(bRegion, gRegion):
			// Only the user changed this region.
			out = append(out, eRegion...)
		case sameLines(bRegion, eRegion):
			// Only the generator changed this region.
			out = append(out, gRegion...)
		case sameLines(gRegion, eRegion):
			// Both made the same change.
			out = append(out, gRegion...)
		default:
			out = writeConflict(out, gRegion, eRegion, labels)
			conflict = true
		}

		if nextBi < len(bl) {
			gi = gMap[nextBi]
			ei = eMap[nextBi]
		} else {
			gi = len(gl)
			ei = len(el)
		}
		bi = nextBi
	}

	// Anything after the last anchor.
	if gi < len(gl) || ei < len(el) {
		gTail := gl[gi:]
		eTail := el[ei:]

		switch {
		case sameLines(gTail, eTail):
			out = append(out, gTail...)
		case len(gTail) == 0:
			out = append(out, eTail...)
		case len(eTail) == 0:
			out = append(out, gTail...)
		default:
			out = writeConflict(out, gTail, eTail, labels)
			conflict = true
		}
	}

	return MergeResult{
		Content:  strings.Join(out, ""),
		Conflict: conflict,
		Outcome:  MergeMerged,
	}
}

// --- Two-way diff ---------------------------------------------------------

const (
	hunkSame   = 0
	hunkChange = 1
)

// Hunk is one run of the comparison: either shared lines, or a changed
// region carrying both sides.
type Hunk struct {
	Kind      int
	Generated []string
	Existing  []string
}

// Hunks describes the difference between two line slices. Adjacent
// insertions and deletions merge into a single change hunk, so a modified
// region is reported once rather than as a delete followed by an add.
func Hunks(generated, existing []string) []Hunk {
	common := LCS(generated, existing)
	var out []Hunk

	gi, ei := 0, 0

	// Two change hunks can never end up adjacent: every flush in the loop
	// below is immediately followed by a same-hunk, and the trailing flush
	// is the last thing to run. So there is nothing to merge into.
	flush := func(g, e []string) {
		if len(g) == 0 && len(e) == 0 {
			return
		}
		out = append(out, Hunk{Kind: hunkChange, Generated: g, Existing: e})
	}

	for _, line := range common {
		var g, e []string

		for gi < len(generated) && generated[gi] != line {
			g = append(g, generated[gi])
			gi++
		}
		for ei < len(existing) && existing[ei] != line {
			e = append(e, existing[ei])
			ei++
		}
		flush(g, e)

		if n := len(out); n > 0 && out[n-1].Kind == hunkSame {
			out[n-1].Generated = append(out[n-1].Generated, line)
		} else {
			out = append(out, Hunk{Kind: hunkSame, Generated: []string{line}})
		}

		gi++
		ei++
	}

	flush(generated[gi:], existing[ei:])

	return out
}

// Diff produces an annotated view of the difference between the new
// generate and what is on disk. Unchanged text passes through; each changed
// region becomes a pair of marked blocks, the existing side first.
func Diff(generated, existing string, spec DiffSpec) DiffResult {
	if generated == existing {
		return DiffResult{Content: generated, Outcome: DiffSame}
	}

	labels := labelsOf(spec, "diff")
	var out []string

	block := func(blockLines []string, label string) {
		out = append(out, markStart+label+"\n")
		for _, line := range blockLines {
			out = append(out, line)
			if !strings.HasSuffix(line, "\n") {
				out = append(out, "\n")
			}
		}
		out = append(out, markEnd+label+"\n")
	}

	for _, hunk := range Hunks(Lines(generated), Lines(existing)) {
		if hunk.Kind == hunkSame {
			out = append(out, hunk.Generated...)
			continue
		}
		if len(hunk.Existing) > 0 {
			block(hunk.Existing, labels.Existing)
		}
		if len(hunk.Generated) > 0 {
			block(hunk.Generated, labels.Generated)
		}
	}

	return DiffResult{
		Content:  strings.Join(out, ""),
		Conflict: true,
		Outcome:  DiffChanged,
	}
}
