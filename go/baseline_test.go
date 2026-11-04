package jostraca

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

const baselinePath = "/out/.jostraca/generated/a.txt"

// baselineRig is one output file, a.txt, regenerated under txt on a volume
// kept across runs. Twin of rig in ts/test/baseline.test.ts.
type baselineRig struct {
	t   *testing.T
	mem *MemFS
}

func newBaselineRig(t *testing.T) *baselineRig {
	return &baselineRig{t: t, mem: NewMemFS()}
}

func (r *baselineRig) run(body string, txt ExistingTxt, control Control) (Result, error) {
	return New(WithFS(r.mem), WithFolder("/out"), WithNow(func() int64 { return fhNow })).
		Generate(Options{Existing: Existing{Txt: txt}, Control: control}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("a.txt", func(j *J) { j.Content(body) })
			})
		})
}

func (r *baselineRig) must(body string, txt ExistingTxt) Result {
	r.t.Helper()
	res, err := r.run(body, txt, Control{})
	if err != nil {
		r.t.Fatal(err)
	}
	return res
}

func (r *baselineRig) read(p string) string {
	b, _ := r.mem.ReadFile(p)
	return string(b)
}

func (r *baselineRig) write(p, s string) { _ = r.mem.WriteFile(p, []byte(s)) }

func (r *baselineRig) fingerprints() any {
	var log struct {
		Files map[string]map[string]any `json:"files"`
	}
	_ = json.Unmarshal([]byte(r.read("/out/.jostraca/jostraca.meta.log")), &log)
	return log.Files["a.txt"]["fingerprints"]
}

// lastWhy is the breadcrumbs of the run's last decision record.
func lastWhy(res Result) string {
	why := ""
	for _, e := range res.Audit() {
		if strings.HasPrefix(e.Tag, "FileHandler:save:") {
			why = strings.Join(e.Data["why"].([]string), " ")
		}
	}
	return why
}

func ptr(b bool) *bool { return &b }

// The baseline moves only when the generate lands in the file. Twin of
// 'moves-only-when-landed'.
func TestBaselineMovesOnlyWhenLanded(t *testing.T) {
	merge := ExistingTxt{Merge: ptr(true)}
	for _, c := range []struct {
		name  string
		txt   ExistingTxt
		edit  string
		base  string
		holds bool
	}{
		{"write-off", ExistingTxt{Write: ptr(false)}, "A\n", "A\n", true},
		{"protect", merge, "A\nJOSTRACA_PROTECT\n", "A\n", true},
		// A present record is made before the baseline is reached.
		{"present", ExistingTxt{Write: ptr(false), Present: ptr(true)}, "A\n", "A\n", false},
		{"write", ExistingTxt{Write: ptr(true)}, "U\n", "B\n", false},
		{"merge-clean", merge, "A\n", "B\n", false},
		{"merge-markers", merge, "U\n", "B\n", false},
		{"diff", ExistingTxt{Diff: ptr(true)}, "U\n", "B\n", false},
		// A file already holding the generate holds it whatever the mode.
		{"write-off-same", ExistingTxt{Write: ptr(false)}, "B\n", "B\n", false},
		{"present-same", ExistingTxt{Write: ptr(false), Present: ptr(true)}, "B\n", "B\n", false},
	} {
		r := newBaselineRig(t)
		r.must("A\n", merge)
		r.write("/out/a.txt", c.edit)
		res := r.must("B\n", c.txt)
		eq(t, c.name+" base", r.read(baselinePath), c.base)
		if got := strings.HasSuffix(lastWhy(res), "within-0 hold-0"); got != c.holds {
			t.Errorf("%s: hold-0 = %v, want %v (%s)", c.name, got, c.holds, lastWhy(res))
		}
	}
}

// A file left with an earlier merge's markers keeps the baseline those
// markers came from. Twin of 'unresolved-keeps-its-baseline'.
func TestUnresolvedKeepsItsBaseline(t *testing.T) {
	merge := ExistingTxt{Merge: ptr(true)}
	r := newBaselineRig(t)
	r.must("a\nb\nc\n", merge)
	r.write("/out/a.txt", "a\nUSER\nc\n")
	r.must("a\nGEN1\nc\n", merge)

	res := r.must("a\nGEN2\nc\nd\n", merge)
	eq(t, "conflicted", strings.Join(res.Files.Conflicted, ","), "/out/a.txt")
	eq(t, "base", r.read(baselinePath), "a\nGEN1\nc\n")

	r.write("/out/a.txt", "a\nGEN1\nc\n")
	r.must("a\nGEN2\nc\nd\n", merge)
	eq(t, "resolved", r.read("/out/a.txt"), "a\nGEN2\nc\nd\n")
}

// A file that is one of its own earlier generates takes the new one whole.
// Twin of 'earlier-generate'.
func TestEarlierGenerateTakesNewOne(t *testing.T) {
	merge := ExistingTxt{Merge: ptr(true)}
	r := newBaselineRig(t)
	r.must("A\nB\nC\n", merge)
	r.must("A\nB2\nC\n", merge)

	r.write("/out/a.txt", "A\nB\nC\n")
	res := r.must("A\nB2\nC\nD\n", merge)
	eq(t, "checkout", r.read("/out/a.txt"), "A\nB2\nC\nD\n")
	eq(t, "merged", strings.Join(res.Files.Merged, ","), "/out/a.txt")
	if !strings.Contains(lastWhy(res), "merge-earlier-0") {
		t.Errorf("why = %s", lastWhy(res))
	}

	_ = r.mem.Remove(baselinePath)
	r.write("/out/a.txt", "A\nB2\nC\n")
	res = r.must("A\nB3\nC\nD\n", merge)
	eq(t, "no baseline", r.read("/out/a.txt"), "A\nB3\nC\nD\n")
	if len(res.Files.Unmerged) != 0 {
		t.Errorf("unmerged = %v", res.Files.Unmerged)
	}

	r.write("/out/a.txt", "A\nB3\nC\nD\nUSER\n")
	r.must("A\nB4\nC\nD\n", merge)
	eq(t, "edit", r.read("/out/a.txt"), "A\nB4\nC\nD\nUSER\n")
}

// The fingerprints of the generates that landed, newest last, at most
// eight, each once. Twin of 'fingerprint-history'.
func TestFingerprintHistory(t *testing.T) {
	merge := ExistingTxt{Merge: ptr(true)}
	fps := func(vs ...string) []any {
		out := []any{}
		for _, v := range vs {
			out = append(out, fingerprint([]byte(v+"\n")))
		}
		return out
	}
	same := func(what string, got any, want []any) {
		t.Helper()
		g, _ := json.Marshal(got)
		w, _ := json.Marshal(want)
		eq(t, what, string(g), string(w))
	}

	r := newBaselineRig(t)
	for _, v := range []string{"v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v4"} {
		r.must(v+"\n", merge)
	}
	same("history", r.fingerprints(), fps("v2", "v3", "v5", "v6", "v7", "v8", "v9", "v4"))

	// A held generate is not one that landed.
	r.write("/out/a.txt", "JOSTRACA_PROTECT\n")
	r.must("held\n", merge)
	same("held", r.fingerprints(), fps("v2", "v3", "v5", "v6", "v7", "v8", "v9", "v4"))

	// Anything in a hand-edited log that is not a fingerprint is dropped.
	r.write("/out/.jostraca/jostraca.meta.log", `{"files":{"a.txt":{"fingerprints":`+
		`["nope",7,"`+fingerprint([]byte("v4\n"))+`"]}}}`)
	r.must("v4\n", merge)
	same("filtered", r.fingerprints(), fps("v4"))

	// Only merge records them.
	r.must("w\n", ExistingTxt{Write: ptr(false)})
	if nil != r.fingerprints() {
		t.Errorf("fingerprints without merge: %v", r.fingerprints())
	}
}

// No baseline: the file is listed, write overwrites it, no write leaves it,
// and the baseline is recorded only when the generate landed. Twin of
// 'no-baseline'.
func TestNoBaselineIsListed(t *testing.T) {
	r := newBaselineRig(t)
	r.write("/out/a.txt", "USER\n")
	res := r.must("GEN\n", ExistingTxt{Merge: ptr(true)})
	eq(t, "unmerged", strings.Join(res.Files.Unmerged, ","), "/out/a.txt")
	eq(t, "written", strings.Join(res.Files.Written, ","), "/out/a.txt")
	eq(t, "overwritten", r.read("/out/a.txt"), "GEN\n")
	if !strings.Contains(lastWhy(res), "merge-nobase-0") {
		t.Errorf("why = %s", lastWhy(res))
	}
	eq(t, "base", r.read(baselinePath), "GEN\n")

	off := ExistingTxt{Merge: ptr(true), Write: ptr(false)}
	r = newBaselineRig(t)
	r.write("/out/a.txt", "USER\n")
	for i := 0; i < 2; i++ {
		res = r.must("GEN\n", off)
		eq(t, "unmerged", strings.Join(res.Files.Unmerged, ","), "/out/a.txt")
		eq(t, "left", r.read("/out/a.txt"), "USER\n")
		if r.mem.Exists(baselinePath) {
			t.Error("a baseline the file never held")
		}
	}

	r = newBaselineRig(t)
	r.write("/out/a.txt", "USER\n")
	res, err := r.run("GEN\n", ExistingTxt{Merge: ptr(true)}, Control{NoDuplicate: true})
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "no duplicate", strings.Join(res.Files.Unmerged, ","), "/out/a.txt")
}

// ConflictFail leaves every file it cannot merge as it was, with its
// baseline, writes the rest, and fails once the build is done. Twin of
// 'conflict-fail'.
func TestConflictFail(t *testing.T) {
	mem := NewMemFS()
	run := func(b, c string, txt ExistingTxt) (Result, error) {
		return New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return fhNow })).
			Generate(Options{Existing: Existing{Txt: txt}}, func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File("b.txt", func(j *J) { j.Content(b) })
					j.File("c.txt", func(j *J) { j.Content(c) })
				})
			})
	}
	read := func(p string) string { b, _ := mem.ReadFile(p); return string(b) }
	fail := ExistingTxt{Merge: ptr(true), Conflict: ConflictFail}

	if _, err := run("b\n", "c\n", ExistingTxt{Merge: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	_ = mem.WriteFile("/out/b.txt", []byte("USER\n"))

	res, err := run("B2\n", "C2\n", fail)
	var mce *MergeConflictError
	if !errors.As(err, &mce) || !errors.Is(err, ErrMergeConflict) {
		t.Fatalf("err = %v", err)
	}
	eq(t, "message", err.Error(), "jostraca: 3-way merge produced conflicts, "+
		"left unchanged: /out/b.txt (conflict)")
	if len(mce.Conflicts) != 1 || mce.Conflicts[0] != (MergeConflict{Path: "/out/b.txt", Reason: "conflict"}) {
		t.Errorf("conflicts = %+v", mce.Conflicts)
	}
	eq(t, "conflicted", strings.Join(res.Files.Conflicted, ","), "/out/b.txt")
	eq(t, "merged", strings.Join(res.Files.Merged, ","), "/out/b.txt,/out/c.txt")
	eq(t, "b", read("/out/b.txt"), "USER\n")
	eq(t, "b base", read("/out/.jostraca/generated/b.txt"), "b\n")
	eq(t, "c", read("/out/c.txt"), "C2\n")
	eq(t, "c base", read("/out/.jostraca/generated/c.txt"), "C2\n")

	if _, err := run("B2\n", "C2\n", fail); !errors.Is(err, ErrMergeConflict) {
		t.Errorf("rerun err = %v", err)
	}

	_ = mem.WriteFile("/out/b.txt", []byte("B2\n"))
	if res, err := run("B2\n", "C2\n", fail); err != nil || len(res.Files.Conflicted) != 0 {
		t.Errorf("resolved: %v %v", err, res.Files.Conflicted)
	}

	_ = mem.WriteFile("/out/b.txt", []byte("<<<<<<< EXISTING: X/merge\nU\n=======\nB2\n"+
		">>>>>>> GENERATED: X/merge\n"))
	_ = mem.Remove("/out/.jostraca/generated/c.txt")
	_ = mem.WriteFile("/out/c.txt", []byte("EDIT\n"))
	_, err = run("B3\n", "C3\n", fail)
	if err == nil {
		t.Fatal("no error")
	}
	eq(t, "message", err.Error(), "jostraca: 3-way merge produced conflicts, left unchanged: "+
		"/out/b.txt (unresolved conflict markers), /out/c.txt (no baseline)")
	eq(t, "c left", read("/out/c.txt"), "EDIT\n")
	if mem.Exists("/out/.jostraca/generated/c.txt") {
		t.Error("c has a baseline it never held")
	}
}

// An unknown Conflict value is refused with TS's text. Twin of
// 'conflict-option'.
func TestConflictOption(t *testing.T) {
	r := newBaselineRig(t)
	_, err := r.run("A\n", ExistingTxt{Merge: ptr(true), Conflict: "skip"}, Control{})
	if err == nil || err.Error() != "Jostraca Options (`existing` property): Value \"skip\" "+
		"for property \"txt.conflict\" must be exactly one of: markers, fail" {
		t.Errorf("err = %v", err)
	}
}
