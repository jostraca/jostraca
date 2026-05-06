package jostraca

import (
	"encoding/json"
	"regexp"
	"testing"
)

// TestMergeRetain mirrors test/merge.test.ts:'retain' phase-by-phase.
// Loads testdata/parity/merge_retain.json (extracted from the TS
// implementation by tools/extract-parity.js) and replays the same
// sequence in Go, asserting byte-equal /foo.txt at each phase
// modulo conflict-marker timestamps.
//
// Timestamps are normalised because TS calls now() ~10× per generate
// (build start, meta last, multiple audit entries) and Go calls it
// ~3× — both reach the same wall-clock instant on the production
// system, but the synthetic incrementing now() in tests advances at
// different rates. The merge logic and retain semantics are
// byte-identical; only the literal label timestamps differ.

type retainPhase struct {
	Label string `json:"label"`
	Foo   string `json:"foo"`
}

type retainCorpus struct {
	Scenario string        `json:"scenario"`
	Phases   []retainPhase `json:"phases"`
}

// stripTS replaces every ISO-8601 timestamp with a placeholder so
// outputs can be compared independent of how often each stack
// happened to call now().
var isoTSRE = regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z`)

func stripTS(s string) string { return isoTSRE.ReplaceAllString(s, "<TS>") }

func TestMergeRetainSequence(t *testing.T) {
	body, err := parityFS.ReadFile("testdata/parity/merge_retain.json")
	if err != nil {
		t.Fatal(err)
	}
	var c retainCorpus
	if err := json.Unmarshal(body, &c); err != nil {
		t.Fatal(err)
	}
	if len(c.Phases) != 10 {
		t.Fatalf("want 10 phases, got %d", len(c.Phases))
	}

	const start int64 = 1735689600000
	nowI := int64(0)
	now := func() int64 {
		nowI++
		return start + nowI*60_000
	}

	mem := NewMemFS()
	mergeTrue := true
	model := map[string]any{"foo": "aaa\n"}

	gen := func() {
		j := New(WithFS(mem), WithFolder("/"), WithNow(now), WithModel(model))
		_, err := j.Generate(Options{
			Existing: Existing{Txt: ExistingTxt{Merge: &mergeTrue}},
		}, func(j *J) {
			j.Project(ProjectProps{Folder: "."}, func(j *J) {
				j.File("foo.txt", func(j *J) {
					j.Content(model["foo"].(string))
				})
			})
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	got := func() string {
		b, _ := mem.ReadFile("/foo.txt")
		return string(b)
	}
	check := func(label string, idx int) string {
		gotS := got()
		want := c.Phases[idx].Foo
		if stripTS(gotS) != stripTS(want) {
			t.Errorf("%s shape mismatch:\n  got:  %q\n  want: %q", label, gotS, want)
		}
		return gotS
	}

	gen()
	check("G-0", 0)
	gen()
	check("G-1", 1)
	_ = mem.WriteFile("/foo.txt", []byte("aaa\nbbb\n"))
	gen()
	check("G-2", 2)
	gen()
	check("G-3", 3)
	gen()
	check("G-4", 4)
	model["foo"] = "aaa\nccc\n"
	gen()
	g5 := check("G-5", 5)
	_ = mem.WriteFile("/foo.txt", []byte("aaa\nbbb\nccc\n"))
	gen()
	check("G-6", 6)
	model["foo"] = "aaa\nddd\n"
	gen()
	g7 := check("G-7", 7)
	gen()
	g8 := check("G-8", 8)
	model["foo"] = "aaa\neee\n"
	gen()
	g9 := check("G-9", 9)

	// Retain invariant: G-7 == G-8 == G-9 (the file is unchanged
	// across model changes once it contains unresolved conflict
	// markers). Stripped because conflict-marker timestamps would
	// otherwise drift if Go re-rendered the file.
	if stripTS(g7) != stripTS(g8) {
		t.Errorf("retain broken: G-8 should equal G-7\n  G-7: %q\n  G-8: %q", g7, g8)
	}
	if stripTS(g7) != stripTS(g9) {
		t.Errorf("retain broken: G-9 should equal G-7\n  G-7: %q\n  G-9: %q", g7, g9)
	}
	// Sanity: G-5 mentions ccc and bbb; G-7+ mentions ddd; none
	// should mention eee.
	for _, s := range []string{g5, g7, g8, g9} {
		if !contains(s, "ddd") && !contains(s, "ccc") {
			t.Errorf("expected change content in: %q", s)
		}
		if contains(s, "eee") {
			t.Errorf("eee leaked into output: %q", s)
		}
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
