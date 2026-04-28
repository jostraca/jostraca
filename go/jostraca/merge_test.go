package jostraca

import (
	"strings"
	"testing"
)

// Phase 11 — 3-way merge. The corpus mirrors test/merge.test.ts
// scenarios: clean merge (only one side changed), shared change
// (both sides changed identically), conflict (both sides changed
// differently).

func TestMerge3Clean(t *testing.T) {
	// Only the "new" side (a) changed; b matches the baseline.
	a := []byte("a\nNEW\nc\n")
	o := []byte("a\nORIG\nc\n")
	b := []byte("a\nORIG\nc\n")
	res := merge3(a, o, b)
	if res.Conflict {
		t.Errorf("clean merge flagged conflict")
	}
	if string(res.Content) != "a\nNEW\nc\n" {
		t.Errorf("got %q, want a\\nNEW\\nc\\n", res.Content)
	}
}

func TestMerge3SharedChange(t *testing.T) {
	// Both a and b changed identically.
	a := []byte("a\nSAME\nc\n")
	o := []byte("a\nORIG\nc\n")
	b := []byte("a\nSAME\nc\n")
	res := merge3(a, o, b)
	if res.Conflict {
		t.Errorf("shared change flagged conflict")
	}
	if string(res.Content) != "a\nSAME\nc\n" {
		t.Errorf("got %q", res.Content)
	}
}

func TestMerge3Conflict(t *testing.T) {
	a := []byte("a\nNEW\nc\n")
	o := []byte("a\nORIG\nc\n")
	b := []byte("a\nUSER\nc\n")
	res := merge3(a, o, b)
	if !res.Conflict {
		t.Errorf("expected conflict")
	}
	s := string(res.Content)
	if !strings.Contains(s, "<<<<<<< GENERATED:") {
		t.Errorf("missing GENERATED marker: %q", s)
	}
	if !strings.Contains(s, "||||||| BASELINE:") {
		t.Errorf("missing BASELINE marker: %q", s)
	}
	if !strings.Contains(s, ">>>>>>> EXISTING:") {
		t.Errorf("missing EXISTING marker: %q", s)
	}
	if !strings.Contains(s, "NEW") || !strings.Contains(s, "USER") {
		t.Errorf("missing change content: %q", s)
	}
}

func TestSaveMergeMode(t *testing.T) {
	mem := NewMemFS()
	// Existing file and a duplicate baseline (as if from a previous run).
	_ = mem.WriteFile("/out/x.txt", []byte("a\nUSER\nc\n"))
	_ = mem.WriteFile("/out/.jostraca/generated/x.txt", []byte("a\nORIG\nc\n"))

	j := New(WithFS(mem), WithFolder("/out"))
	mergeTrue := true
	res, err := j.Generate(Options{
		Existing: Existing{Txt: ExistingTxt{Merge: &mergeTrue}},
	}, func(j *J) {
		j.File("x.txt", func(j *J) { j.Content("a\nNEW\nc\n") })
	})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := mem.ReadFile("/out/x.txt")
	s := string(got)
	if !strings.Contains(s, "GENERATED") {
		t.Errorf("merged file missing markers: %q", s)
	}
	if len(res.Files.Merged) != 1 {
		t.Errorf("Files.Merged = %v, want 1 entry", res.Files.Merged)
	}
	if len(res.Files.Conflicted) != 1 {
		t.Errorf("Files.Conflicted = %v, want 1 entry", res.Files.Conflicted)
	}
}
