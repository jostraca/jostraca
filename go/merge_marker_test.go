package jostraca

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The merge engine decides the outcome. A clean merge over a file whose
// generated text contains the marker sentinel is written; a file still
// holding an earlier merge's markers is left byte-for-byte untouched, a
// requested mode still applied, and reported merged AND conflicted. Twin
// of 'merge-marker-files' in ts/test/filehandler.test.ts.
func TestMergeMarkerFiles(t *testing.T) {
	yes := true
	merge := Existing{Txt: ExistingTxt{Merge: &yes}}

	t.Run("clean-over-sentinel", func(t *testing.T) {
		mem := NewMemFS()
		gen := func(v string) Result {
			res, err := New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return fhNow })).
				Generate(Options{Existing: merge}, func(j *J) {
					j.Project(ProjectProps{}, func(j *J) {
						j.File("doc.md", func(j *J) {
							j.Content("How a conflict looks:\n>>>>>>> EXISTING: " +
								"2020-01-01T00:00:00.000Z/merge\n" + v + "\n")
						})
					})
				})
			if err != nil {
				t.Fatal(err)
			}
			return res
		}
		gen("v1")
		for _, v := range []string{"v2", "v3"} {
			res := gen(v)
			got, _ := mem.ReadFile("/out/doc.md")
			if !strings.HasSuffix(string(got), v+"\n") {
				t.Errorf("%s: doc.md = %q", v, got)
			}
			if strings.Join(res.Files.Merged, ",") != "/out/doc.md" || len(res.Files.Conflicted) != 0 {
				t.Errorf("%s: merged=%v conflicted=%v", v, res.Files.Merged, res.Files.Conflicted)
			}
			if e := fhMetaEntry(t, mem, "/out/.jostraca/jostraca.meta.log", "doc.md"); e["action"] != "merge" {
				t.Errorf("%s: meta = %v", v, e)
			}
			found := false
			for _, a := range res.Audit() {
				if why, ok := a.Data["why"].([]string); ok && a.Data["action"] == "merge" {
					found = strings.Contains(strings.Join(why, " "), "merge-clean-0")
				}
			}
			if !found {
				t.Errorf("%s: no merge record with merge-clean-0", v)
			}
		}
	})

	dir := t.TempDir()
	stat := func(p string) os.FileInfo {
		fi, err := os.Stat(p)
		if err != nil {
			t.Fatal(err)
		}
		return fi
	}
	gen := func(out, body string, opts Options, mode fs.FileMode) Result {
		res, err := New(WithFolder(out), WithNow(func() int64 { return fhNow })).
			Generate(opts, func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.FileP(FileProps{Name: "a.txt", Mode: mode}, func(j *J) { j.Content(body) })
				})
			})
		if err != nil {
			t.Fatal(err)
		}
		return res
	}

	for _, c := range []struct {
		name    string
		opts    Options
		mode    fs.FileMode
		actions string
	}{
		{"plain", Options{Existing: merge}, 0, "merge"},
		{"mode", Options{Existing: merge}, 0o755, "merge"},
		{"preserve", Options{Existing: Existing{Txt: ExistingTxt{Merge: &yes, Preserve: &yes}}}, 0,
			"preserve,merge"},
	} {
		out := filepath.ToSlash(filepath.Join(dir, c.name))
		a := out + "/a.txt"
		gen(out, "A\n", Options{}, 0)
		_ = os.WriteFile(a, []byte("A\nuser\n"), 0o666)
		gen(out, "A\ngen\n", Options{Existing: merge}, 0)
		before, _ := os.ReadFile(a)
		fi := stat(a)
		res := gen(out, "A\ngen2\n", c.opts, c.mode)
		after, _ := os.ReadFile(a)
		if !bytes.Equal(before, after) || !os.SameFile(fi, stat(a)) {
			t.Errorf("%s: unresolved file rewritten: %q", c.name, after)
		}
		if strings.Join(res.Files.Merged, ",") != a || strings.Join(res.Files.Conflicted, ",") != a {
			t.Errorf("%s: merged=%v conflicted=%v", c.name, res.Files.Merged, res.Files.Conflicted)
		}
		e := fhMetaEntry(t, OsFS{}, out+"/.jostraca/jostraca.meta.log", "a.txt")
		acts := []string{}
		for _, x := range e["actions"].([]any) {
			acts = append(acts, x.(string))
		}
		if e["action"] != "merge" || strings.Join(acts, ",") != c.actions || e["conflict"] != true {
			t.Errorf("%s: meta = %v", c.name, e)
		}
		if c.mode != 0 && runtime.GOOS != "windows" {
			if fi, _ := os.Stat(a); fi.Mode().Perm() != c.mode {
				t.Errorf("%s: mode %o, want %o", c.name, fi.Mode().Perm(), c.mode)
			}
		}
		if b, _ := os.ReadFile(out + "/.jostraca/generated/a.txt"); string(b) != "A\ngen2\n" {
			t.Errorf("%s: baseline = %q", c.name, b)
		}
	}

	// Diff-mode markers followed by a merge run.
	diff := Existing{Txt: ExistingTxt{Diff: &yes}}
	out := filepath.ToSlash(filepath.Join(dir, "diffthen"))
	a := out + "/a.txt"
	gen(out, "A\nB\n", Options{Existing: diff}, 0)
	_ = os.WriteFile(a, []byte("A\nU\n"), 0o666)
	gen(out, "A\nG\n", Options{Existing: diff}, 0)
	before, _ := os.ReadFile(a)
	res := gen(out, "A\nG2\n", Options{Existing: merge}, 0)
	if after, _ := os.ReadFile(a); !bytes.Equal(before, after) {
		t.Errorf("diffthen: rewritten: %q", after)
	}
	if strings.Join(res.Files.Merged, ",") != a || strings.Join(res.Files.Conflicted, ",") != a {
		t.Errorf("diffthen: merged=%v conflicted=%v", res.Files.Merged, res.Files.Conflicted)
	}

	// An unresolved file holding a non-UTF-8 byte keeps it.
	out = filepath.ToSlash(filepath.Join(dir, "latin1"))
	a = out + "/a.txt"
	gen(out, "A\n", Options{}, 0)
	_ = os.WriteFile(a, []byte("A\nuser\n"), 0o666)
	gen(out, "A\ngen\n", Options{Existing: merge}, 0)
	marked, _ := os.ReadFile(a)
	marked = append(marked, 0xe9, '\n')
	_ = os.WriteFile(a, marked, 0o666)
	gen(out, "A\ngen2\n", Options{Existing: merge}, 0)
	if after, _ := os.ReadFile(a); !bytes.Equal(after, marked) {
		t.Errorf("latin1: %q, want %q", after, marked)
	}
}

// The existing file is handled as bytes: bytes a user saved in Latin-1
// survive merge and diff exactly, and a file holding 0xFF where the
// generator emits U+FFFD counts as changed. Twin of 'utf8-lossy' in
// ts/test/filehandler.test.ts.
func TestUTF8Lossy(t *testing.T) {
	yes := true
	merge := Existing{Txt: ExistingTxt{Merge: &yes}}
	diff := Existing{Txt: ExistingTxt{Diff: &yes}}
	type gen struct {
		body string
		ex   Existing
	}
	run := func(steps ...any) (Result, []byte) {
		mem := NewMemFS()
		var res Result
		for _, st := range steps {
			switch v := st.(type) {
			case []byte:
				_ = mem.WriteFile("/out/a.txt", v)
			case gen:
				var err error
				res, err = New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return fhNow })).
					Generate(Options{Existing: v.ex}, func(j *J) {
						j.Project(ProjectProps{}, func(j *J) {
							j.File("a.txt", func(j *J) { j.Content(v.body) })
						})
					})
				if err != nil {
					t.Fatal(err)
				}
			}
		}
		b, _ := mem.ReadFile("/out/a.txt")
		return res, b
	}
	latin1 := []byte{0x41, 0x0a, 0xe9, 0x74, 0xe9, 0x0a, 0x42, 0x0a}

	if _, b := run(gen{"A\nB\n", Existing{}}, latin1, gen{"A\nB\nC\n", merge}); !bytes.Equal(b,
		[]byte{0x41, 0x0a, 0xe9, 0x74, 0xe9, 0x0a, 0x42, 0x0a, 0x43, 0x0a}) {
		t.Errorf("merge: %q", b)
	}

	res, b := run(gen{"A\nB\n", Existing{}}, latin1, gen{"A\nB\nC\n", diff})
	if !bytes.Contains(b, []byte{0xe9, 0x74, 0xe9}) || strings.Join(res.Files.Conflicted, ",") != "/out/a.txt" {
		t.Errorf("diff: %q conflicted=%v", b, res.Files.Conflicted)
	}

	ff := []byte{0x41, 0x0a, 0xff, 0x0a}
	res, b = run(gen{"A\n�\n", Existing{}}, ff, gen{"A\n�\n", merge})
	if strings.Join(res.Files.Merged, ",") != "/out/a.txt" || len(res.Files.Unchanged) != 0 ||
		!bytes.Equal(b, ff) {
		t.Errorf("ffsame merge: merged=%v unchanged=%v %q", res.Files.Merged, res.Files.Unchanged, b)
	}

	res, b = run(gen{"A\n�\n", Existing{}}, ff, gen{"A\n�\n", Existing{}})
	if strings.Join(res.Files.Written, ",") != "/out/a.txt" || string(b) != "A\n�\n" {
		t.Errorf("ffsame write: written=%v %q", res.Files.Written, b)
	}
}
