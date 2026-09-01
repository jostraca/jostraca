package jostraca

import (
	"strings"
	"testing"
)

// buildTemplateRE used to build its key slice with `for k := range replace`.
// Go randomises map iteration per process, and sortReplaceKeys is a STABLE
// sort whose every comparison ends in `len(b) < len(a)` -- so two keys of the
// same length are a tie and kept in whatever order the map yielded. Those keys
// become alternation branches in one assembled regex and alternation order
// picks the winner, so identical input produced different output between runs.
// Measured before the fix: 20 processes, 19 "xPLUSx" and 1 "xPAIRx".
//
// The slice is now built with sortedKeys, so ties resolve alphabetically and
// the result is fixed. See issue #42 and PARITY_PLAN.md.
//
// NOTE ON PARITY. This does NOT make Go match TS in every ordering. TS sorts
// Object.keys() with a stable sort, and Object.keys() is insertion order, so
// TS's tie-break is DECLARATION order -- verified in separate processes:
// {"/A+/","/AA/"} gives "xPLUSx" and {"/AA/","/A+/"} gives "xPAIRx". A Go map
// has no declaration order to reproduce, exactly as with OMap, so Go takes the
// alphabetical rule. Deterministic-and-documented beats matching-and-random.
// The two agree whenever declaration order happens to be alphabetical, which
// is what test/spec/template.tsv's template-replace-equal-length-keys pins.

func TestTemplateEqualLengthKeysAreDeterministic(t *testing.T) {
	// Both keys are 4 characters and both match "AA" at the same offset, so
	// only the alternation order can decide.
	const src = "xAAx"
	replace := map[string]any{"/A+/": "PLUS", "/AA/": "PAIR"}

	first, err := Template(src, map[string]any{}, &TemplateSpec{Replace: replace})
	if err != nil {
		t.Fatal(err)
	}

	// Alphabetically "/A+/" precedes "/AA/" ('+' is 0x2B, 'A' is 0x41), so the
	// A+ branch wins. Asserting the VALUE, not merely self-consistency: a cache
	// hit would make a "call it twice" check pass even while the rule was
	// random across processes.
	if want := "xPLUSx"; first != want {
		t.Errorf("got %q, want %q -- ties must resolve to the alphabetically "+
			"first key", first, want)
	}
}

// The same map written in the other order must give the same answer. Under the
// old code this was a coin flip; the ordering of a Go map literal has no
// meaning, which is the whole point.
func TestTemplateEqualLengthKeysIgnoreLiteralOrder(t *testing.T) {
	a, err := Template("xAAx", map[string]any{},
		&TemplateSpec{Replace: map[string]any{"/A+/": "PLUS", "/AA/": "PAIR"}})
	if err != nil {
		t.Fatal(err)
	}
	b, err := Template("xAAx", map[string]any{},
		&TemplateSpec{Replace: map[string]any{"/AA/": "PAIR", "/A+/": "PLUS"}})
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Errorf("literal order changed the result: %q vs %q", a, b)
	}
	if want := "xPLUSx"; a != want {
		t.Errorf("got %q, want %q", a, want)
	}
}

// Three-way tie. `/A*/` can match empty, so the engine's empty-match guard
// fires -- and the error carries the assembled regex, which is direct evidence
// of the branch order. Asserting on that is stronger than asserting on output:
// it shows the ordering itself, not just its consequence.
func TestTemplateThreeEqualLengthKeysOrderAlphabetically(t *testing.T) {
	_, err := Template("xAAx", map[string]any{}, &TemplateSpec{
		Replace: map[string]any{"/A+/": "ONE", "/AA/": "TWO", "/A*/": "THREE"},
	})
	if err == nil {
		t.Fatal("expected the empty-match guard to fire for /A*/")
	}

	// "/A*/" < "/A+/" < "/AA/"  ('*' 0x2A, '+' 0x2B, 'A' 0x41), so the branches
	// must appear in that order regardless of map literal order.
	msg := err.Error()
	iStar := strings.Index(msg, "A*)")
	iPlus := strings.Index(msg, "A+)")
	iPair := strings.Index(msg, "AA)")
	if iStar < 0 || iPlus < 0 || iPair < 0 {
		t.Fatalf("could not locate all three branches in: %s", msg)
	}
	if !(iStar < iPlus && iPlus < iPair) {
		t.Errorf("branches are not in alphabetical key order (A* then A+ then AA): %s", msg)
	}
}
