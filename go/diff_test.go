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

	text, res := modeRun(t, Existing{Txt: ExistingTxt{Diff: &yes}}, 1735689600000, "big.txt",
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

// modeRun generates one file into a fresh MemFS per step under a fixed
// clock, writing the step's user edit, when it has one, before its generate.
func modeRun(t *testing.T, ex Existing, now int64, name string, steps [][2]string) (string, Result) {
	t.Helper()
	mem := NewMemFS()
	var res Result
	for _, st := range steps {
		if st[1] != "" {
			_ = mem.WriteFile("/out/"+name, []byte(st[1]))
		}
		var err error
		res, err = New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return now })).
			Generate(Options{Existing: ex}, func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File(name, func(j *J) { j.Content(st[0]) })
				})
			})
		if err != nil {
			t.Fatal(err)
		}
	}
	b, _ := mem.ReadFile("/out/" + name)
	return string(b), res
}

// A clock outside years 0000-9999 labels conflicts in the extended-year
// form. Twin of 'extended-year-labels' in ts/test/merge.test.ts.
func TestExtendedYearLabels(t *testing.T) {
	yes := true

	d, _ := modeRun(t, Existing{Txt: ExistingTxt{Diff: &yes}}, 253402300800000, "a.txt",
		[][2]string{{"A\nB\n", ""}, {"A\nGEN\n", "A\nUSER\n"}})
	dl := "+010000-01-01T00:00:00.000Z/diff\n"
	eq(t, "diff", d, "A\n"+
		"<<<<<<< EXISTING: "+dl+"USER\n>>>>>>> EXISTING: "+dl+
		"<<<<<<< GENERATED: "+dl+"GEN\n>>>>>>> GENERATED: "+dl)

	m, _ := modeRun(t, Existing{Txt: ExistingTxt{Merge: &yes}}, -62198755200001, "a.txt",
		[][2]string{{"A\n", ""}, {"A\ngen\n", "A\nuser\n"}})
	ml := "-000002-12-31T23:59:59.999Z/merge\n"
	eq(t, "merge", m, "A\n<<<<<<< GENERATED: "+ml+"gen\n=======\nuser\n"+
		">>>>>>> EXISTING: "+ml)
}
