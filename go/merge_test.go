package jostraca

import (
	"strings"
	"testing"
)

// Integration: merge mode end-to-end through Generate.

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
