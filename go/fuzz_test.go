package jostraca

import (
	"strings"
	"testing"
)

// Go fuzz targets for the two engines that take arbitrary user text.
//
// The property tests next door explore a shape I chose: lines drawn from a
// small vocabulary, joined with \n. That distribution is what let the merge
// engines disagree on ~72% of non-trivial inputs while every test passed —
// the tests all lived in the corner where the two algorithms agree. Fuzzing
// picks the inputs instead of me, which is the point.
//
// These run as ordinary tests over their seed corpus during `go test`, and
// as real fuzzing on demand:
//
//	go test -run FuzzMerge -fuzz FuzzMerge -fuzztime 60s
//
// Anything a fuzz run finds lands in testdata/fuzz/<Target>/ and becomes a
// permanent seed. Commit it.
//
// The invariants asserted here are deliberately the ones that hold for ANY
// input, not the ones that describe a good merge. "Every generated line
// survives" is NOT one of them: if the user deleted a region the generator
// did not touch, the deletion wins, and asserting otherwise would be
// asserting a bug.

// knownLines is the set of lines the engine is allowed to emit for the
// given inputs.
//
// The `+ "\n"` variant is not slack in the property. When the last line of
// a region has no trailing newline, the engine adds one so the closing
// marker starts at column 0 — a marker glued to the end of a content line
// cannot be parsed by anything. That newline is the only content the
// engine is permitted to introduce.
func knownLines(sides ...string) map[string]bool {
	known := map[string]bool{}
	for _, side := range sides {
		for _, line := range Lines(side) {
			known[line] = true
			if !strings.HasSuffix(line, "\n") {
				known[line+"\n"] = true
			}
		}
	}
	return known
}

// mergeInvariants holds for every merge of every input.
func mergeInvariants(t *testing.T, gen, base, exi string, res MergeResult) {
	t.Helper()

	switch res.Outcome {
	case MergeSame, MergeClean, MergeUnresolved, MergeMerged:
	default:
		t.Fatalf("unknown outcome %q", res.Outcome)
	}

	// 1. Invents nothing. Every non-marker line came from one of the inputs.
	known := knownLines(gen, base, exi)
	for _, line := range Lines(res.Content) {
		if strings.HasPrefix(line, markStart) ||
			strings.HasPrefix(line, markEnd) || line == markMid {
			continue
		}
		if !known[line] {
			t.Fatalf("merge invented %q\n gen=%q\n base=%q\n exi=%q\n out=%q",
				line, gen, base, exi, res.Content)
		}
	}

	// 2. A reported conflict carries both sides' markers, or the user has
	//    no way to resolve it. Keyed on the marker prefixes, not on
	//    unresolvedMark, since the label is caller-supplied.
	if res.Conflict {
		if !strings.Contains(res.Content, markStart) {
			t.Fatalf("conflict without a start marker: %q", res.Content)
		}
		if !strings.Contains(res.Content, markEnd) {
			t.Fatalf("conflict without an end marker: %q", res.Content)
		}
	}

	// 3. Every marker the engine EMITS starts its own line. A marker glued
	//    to the end of a content line cannot be parsed by any tool or
	//    human — this was a real bug in the jsdiff render it replaced.
	markersStartTheirOwnLine(t, res.Content, gen, base, exi)
}

// markersStartTheirOwnLine checks the engine's own markers begin at column
// 0 — but only when no input already contains marker text.
//
// Fuzzing is what established that caveat. It found Merge("0", "0",
// "0<<<<<<< ") in under a second: the user changed the file and the
// generator did not, so their text is kept verbatim, marker lookalike and
// all. That is right. The engine cannot rewrite content to protect a
// marker it never emitted, and git does not either. My property was
// over-stated, not the code wrong — which is the thing a hand-written
// corpus would never have told me, because I would not have thought to
// write that input.
func markersStartTheirOwnLine(t *testing.T, content string, inputs ...string) {
	t.Helper()

	// Trailing whitespace trimmed off the markers: an input ending in
	// "0=======" with no newline still counts as carrying marker text.
	for _, in := range inputs {
		for _, mark := range []string{
			strings.TrimSpace(markStart),
			strings.TrimSpace(markMid),
			strings.TrimSpace(markEnd),
		} {
			if strings.Contains(in, mark) {
				return
			}
		}
	}

	for _, mark := range []string{markStart, markMid, markEnd} {
		at := 0
		for {
			i := strings.Index(content[at:], mark)
			if i < 0 {
				break
			}
			i += at
			if i > 0 && content[i-1] != '\n' {
				t.Fatalf("marker %q does not start its line at %d: %q",
					mark, i, content)
			}
			at = i + len(mark)
		}
	}
}

func FuzzMerge(f *testing.F) {
	seeds := [][3]string{
		{"", "", ""},
		{"a\n", "", ""},
		{"a\nb\nc\n", "a\nb\nc\n", "a\nb\nc\n"},
		{"a\nNEW\nc\n", "a\nORIG\nc\n", "a\nUSER\nc\n"},
		{"X", "", "Y"},
		{"\n\n\n", "\n", "\n\n"},
		{"a\r\nb\r\n", "a\r\n", "a\r\nc\r\n"},
		{"keep\ndrop\n", "keep\ndrop\n", "keep\n"},
		// Already holds an unresolved conflict: must be left alone.
		{"a\n", "a\n", "<<<<<<< GENERATED: x\na\n=======\nb\n>>>>>>> EXISTING: x\n"},
	}
	for _, s := range seeds {
		f.Add(s[0], s[1], s[2])
	}

	f.Fuzz(func(t *testing.T, gen, base, exi string) {
		res := Merge(gen, base, exi, DiffSpec{
			Labels: &DiffLabels{Generated: "G", Existing: "E"},
		})
		mergeInvariants(t, gen, base, exi, res)
	})
}

func FuzzDiff(f *testing.F) {
	seeds := [][2]string{
		{"", ""},
		{"a\n", ""},
		{"", "a\n"},
		{"a\nb\n", "a\nb\n"},
		{"a\nb\n", "a\nc\n"},
		{"X", "Y"},
		{"a\r\nb\r\n", "a\r\n"},
	}
	for _, s := range seeds {
		f.Add(s[0], s[1])
	}

	f.Fuzz(func(t *testing.T, gen, exi string) {
		res := Diff(gen, exi, DiffSpec{
			Labels: &DiffLabels{Generated: "G", Existing: "E"},
		})

		switch res.Outcome {
		case DiffSame, DiffChanged:
		default:
			t.Fatalf("unknown outcome %q", res.Outcome)
		}

		// Identical inputs must come back untouched, whatever they are.
		if gen == exi {
			if res.Outcome != DiffSame || res.Content != gen || res.Conflict {
				t.Fatalf("identical inputs annotated: %+v", res)
			}
		}

		known := knownLines(gen, exi)
		for _, line := range Lines(res.Content) {
			if strings.HasPrefix(line, markStart) ||
				strings.HasPrefix(line, markEnd) || line == markMid {
				continue
			}
			if !known[line] {
				t.Fatalf("diff invented %q\n gen=%q\n exi=%q\n out=%q",
					line, gen, exi, res.Content)
			}
		}

		markersStartTheirOwnLine(t, res.Content, gen, exi)
	})
}

func FuzzLines(f *testing.F) {
	for _, s := range []string{
		"", "\n", "a", "a\n", "a\nb", "a\nb\n", "\n\n\n", "a\r\nb\r\n",
		"no trailing newline", "\x00binary\x00",
	} {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, text string) {
		got := Lines(text)

		// Lines keeps the newline on each line precisely so a join
		// round-trips, including a final line without one. Everything
		// downstream depends on that.
		if joined := strings.Join(got, ""); joined != text {
			t.Fatalf("Lines round-trip lost data\n in=%q\n out=%q", text, joined)
		}

		for i, line := range got {
			if line == "" {
				t.Fatalf("Lines produced an empty element at %d: %q", i, got)
			}
			if at := strings.IndexByte(line, '\n'); at >= 0 && at != len(line)-1 {
				t.Fatalf("line %d holds an interior newline: %q", i, line)
			}
		}
	})
}

func FuzzLCS(f *testing.F) {
	// Fuzzing a []string means fuzzing its serialisation; splitting one
	// string on \n gives the engine exactly the shape it sees in practice.
	for _, s := range [][2]string{
		{"", ""},
		{"a", "a"},
		{"a\nb\nc", "a\nc"},
		{"a\na\nb", "b\na"},
		{"c\na\nb", "c\nb\na"},
		{"x\ny\nz", "z\ny\nx"},
	} {
		f.Add(s[0], s[1])
	}

	f.Fuzz(func(t *testing.T, sa, sb string) {
		a, b := strings.Split(sa, "\n"), strings.Split(sb, "\n")

		// Keep the fuzzer away from the quadratic core with huge inputs;
		// the interesting behaviour is in the shape, not the size.
		if len(a) > 200 || len(b) > 200 {
			t.Skip()
		}

		got := LCS(a, b)

		if len(got) > len(a) || len(got) > len(b) {
			t.Fatalf("LCS longer than an input: %d vs %d/%d",
				len(got), len(a), len(b))
		}

		for _, seq := range [][]string{a, b} {
			if !isSubsequenceOf(got, seq) {
				t.Fatalf("LCS %q is not a subsequence of %q", got, seq)
			}
		}

		// Deterministic: the same inputs must always give the same answer,
		// or the two stacks cannot stay byte-identical.
		again := LCS(a, b)
		if strings.Join(got, "\x00") != strings.Join(again, "\x00") {
			t.Fatalf("LCS is not deterministic: %q then %q", got, again)
		}
	})
}

func FuzzTemplate(f *testing.F) {
	for _, s := range []string{
		"", "plain text", "$$a$$", "$$a.b$$", "$$$$", "$$",
		"a$$a$$b$$a$$c", "$$\"literal\"$$", "$$__JOSTRACA_REPLACE__$$",
		"$$missing$$", "\x00$$a$$\x00",
	} {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, src string) {
		model := map[string]any{
			"a": "A",
			"b": map[string]any{"c": 1.5},
			"n": 42.0,
		}

		out, err := Template(src, model, nil)
		if err != nil {
			// A malformed user regex is a legitimate error; a panic is not,
			// and the fuzzer catches those on its own.
			return
		}

		// Text with no delimiter has nothing to substitute, so it must come
		// back exactly as it went in.
		if !strings.Contains(src, "$") && out != src {
			t.Fatalf("delimiter-free source changed\n in=%q\n out=%q", src, out)
		}
	})
}
