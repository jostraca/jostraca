package jostraca

import (
	"strings"
	"testing"
)

// Integration: diff mode end-to-end through Generate.

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
