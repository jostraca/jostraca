package jostraca

import (
	"strings"
	"testing"
)

// Phase 10 — 2-way diff render.

func TestRenderDiffNoChange(t *testing.T) {
	out := renderDiff([]byte("a\nb\nc\n"), []byte("a\nb\nc\n"), "T1", "T0")
	if string(out) != "a\nb\nc\n" {
		t.Errorf("equal inputs: got %q", out)
	}
}

func TestRenderDiffSingleHunk(t *testing.T) {
	gen := []byte("a\nNEW\nc\n")
	exi := []byte("a\nOLD\nc\n")
	out := string(renderDiff(gen, exi, "T1", "T0"))
	// TS-compatible paired-region format:
	if !strings.Contains(out, "<<<<<<< GENERATED: T1/diff") {
		t.Errorf("missing GENERATED open marker in %q", out)
	}
	if !strings.Contains(out, ">>>>>>> GENERATED: T1/diff") {
		t.Errorf("missing GENERATED close marker in %q", out)
	}
	if !strings.Contains(out, "<<<<<<< EXISTING: T0/diff") {
		t.Errorf("missing EXISTING open marker in %q", out)
	}
	if !strings.Contains(out, ">>>>>>> EXISTING: T0/diff") {
		t.Errorf("missing EXISTING close marker in %q", out)
	}
	if !strings.Contains(out, "NEW") || !strings.Contains(out, "OLD") {
		t.Errorf("missing change content: %q", out)
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
	// TS-style diff: the target file is overwritten with the rendered
	// conflict-marker content; no .diff.<ext> sidecar.
	got, _ := mem.ReadFile("/out/x.txt")
	if !strings.Contains(string(got), "GENERATED") {
		t.Errorf("target should contain rendered diff markers: %q", got)
	}
	if !strings.Contains(string(got), "OLD") || !strings.Contains(string(got), "NEW") {
		t.Errorf("missing change content: %q", got)
	}
	if len(res.Files.Diffed) != 1 {
		t.Errorf("Files.Diffed = %v, want 1 entry", res.Files.Diffed)
	}
	if len(res.Files.Conflicted) != 1 {
		t.Errorf("Files.Conflicted = %v, want 1 entry", res.Files.Conflicted)
	}
}
