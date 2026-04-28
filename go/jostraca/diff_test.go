package jostraca

import (
	"strings"
	"testing"
)

// Phase 10 — 2-way diff render.

func TestRenderDiffNoChange(t *testing.T) {
	out := renderDiff([]byte("a\nb\nc\n"), []byte("a\nb\nc\n"))
	if string(out) != "a\nb\nc\n" {
		t.Errorf("equal inputs: got %q", out)
	}
}

func TestRenderDiffSingleHunk(t *testing.T) {
	gen := []byte("a\nNEW\nc\n")
	exi := []byte("a\nOLD\nc\n")
	out := string(renderDiff(gen, exi))
	if !strings.Contains(out, "<<<<<<< GENERATED:") {
		t.Errorf("missing GENERATED marker in %q", out)
	}
	if !strings.Contains(out, "NEW") {
		t.Errorf("missing NEW in %q", out)
	}
	if !strings.Contains(out, "OLD") {
		t.Errorf("missing OLD in %q", out)
	}
	if !strings.Contains(out, ">>>>>>> EXISTING:") {
		t.Errorf("missing EXISTING marker in %q", out)
	}
}

func TestSaveDiffMode(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/out/x.txt", []byte("a\nOLD\nc\n"))
	j := New(WithFS(mem), WithFolder("/out"))
	diffTrue := true
	res, err := j.Generate(Options{
		Existing: Existing{Txt: ExistingTxt{Diff: &diffTrue}},
	}, func(j *J) {
		j.File("x.txt", func(j *J) { j.Content("a\nNEW\nc\n") })
	})
	if err != nil {
		t.Fatal(err)
	}
	// Original file untouched.
	got, _ := mem.ReadFile("/out/x.txt")
	if string(got) != "a\nOLD\nc\n" {
		t.Errorf("original modified: %q", got)
	}
	// Diff file written.
	diff, err := mem.ReadFile("/out/x.diff.txt")
	if err != nil {
		t.Fatalf("diff file missing: %v", err)
	}
	if !strings.Contains(string(diff), "GENERATED") {
		t.Errorf("diff file missing markers: %q", diff)
	}
	if len(res.Files.Diffed) != 1 {
		t.Errorf("Files.Diffed = %v, want 1 entry", res.Files.Diffed)
	}
	if len(res.Files.Conflicted) != 1 {
		t.Errorf("Files.Conflicted = %v, want 1 entry", res.Files.Conflicted)
	}
}
