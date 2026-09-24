package jostraca

import (
	"fmt"
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

// A region past about 125k lines used to reject the whole generate in TS.
// Twin of 'large-file-diff-and-merge' in ts/test/merge.test.ts.
func TestSaveDiffModeLargeFile(t *testing.T) {
	var sb strings.Builder
	for i := 0; i < 130000; i++ {
		fmt.Fprintf(&sb, "x%d\n", i)
	}
	big := sb.String()
	yes := true

	text, res := largeFileRun(t, Existing{Txt: ExistingTxt{Diff: &yes}},
		[][2]string{{big + "A\n", ""}, {big + "GEN\n", big + "USER\n"}})
	if strings.Join(res.Files.Diffed, ",") != "/out/big.txt" ||
		strings.Join(res.Files.Conflicted, ",") != "/out/big.txt" {
		t.Errorf("diffed=%v conflicted=%v", res.Files.Diffed, res.Files.Conflicted)
	}
	if !strings.HasPrefix(text, big+"<<<<<<< EXISTING: ") ||
		!strings.Contains(text, "\nUSER\n") || !strings.Contains(text, "\nGEN\n") {
		t.Errorf("big.txt tail = %q", text[len(text)-200:])
	}
}

// largeFileRun generates big.txt once per step into a fresh MemFS, writing
// the step's user edit, when there is one, before its generate.
func largeFileRun(t *testing.T, ex Existing, steps [][2]string) (string, Result) {
	t.Helper()
	mem := NewMemFS()
	var res Result
	for _, st := range steps {
		if st[1] != "" {
			_ = mem.WriteFile("/out/big.txt", []byte(st[1]))
		}
		var err error
		res, err = New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return 1735689600000 })).
			Generate(Options{Existing: ex}, func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File("big.txt", func(j *J) { j.Content(st[0]) })
				})
			})
		if err != nil {
			t.Fatal(err)
		}
	}
	b, _ := mem.ReadFile("/out/big.txt")
	return string(b), res
}
