package jostraca

import (
	"fmt"
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

// A region past about 125k lines used to reject the whole generate in TS.
// Twin of 'large-file-diff-and-merge' in ts/test/merge.test.ts.
func TestSaveMergeModeLargeFile(t *testing.T) {
	var sb strings.Builder
	for i := 0; i < 130000; i++ {
		fmt.Fprintf(&sb, "x%d\n", i)
	}
	big := sb.String()
	yes := true

	text, res := modeRun(t, Existing{Txt: ExistingTxt{Merge: &yes}}, 1735689600000, "big.txt",
		[][2]string{{"head\n", ""}, {"head\n" + big, "head\nuser\n"}})
	if strings.Join(res.Files.Merged, ",") != "/out/big.txt" ||
		strings.Join(res.Files.Conflicted, ",") != "/out/big.txt" {
		t.Errorf("merged=%v conflicted=%v", res.Files.Merged, res.Files.Conflicted)
	}
	if !strings.HasPrefix(text, "head\n<<<<<<< GENERATED: ") ||
		!strings.Contains(text, big+"=======\nuser\n>>>>>>> EXISTING: ") {
		t.Errorf("big.txt tail = %q", text[len(text)-200:])
	}
}
