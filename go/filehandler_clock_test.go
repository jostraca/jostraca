package jostraca

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

// The clock is sampled as TS samples it: once for Result.When when the
// build context is constructed, once per low-level file call, once per
// recorded action, and once for `last`. Twins in ts/test/filehandler.test.ts
// ('clock-sampling').

func counterClock(start int64) (func() int64, func() int64) {
	n := start
	return func() int64 { v := n; n++; return v }, func() int64 { return n - start }
}

func TestClockSampling(t *testing.T) {
	const t0 = int64(1735689600000)
	two := func(a, b string) func(*J) {
		return func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("a.txt", func(j *J) { j.Content(a) })
				j.Folder("sub", func(j *J) {
					j.File("b.txt", func(j *J) { j.Content(b) })
				})
			})
		}
	}

	t.Run("two-fresh-files", func(t *testing.T) {
		now, calls := counterClock(t0)
		mem := NewMemFS()
		res, err := New(WithFS(mem), WithFolder("/out"), WithNow(now)).
			Generate(Options{}, two("A\n", "B\n"))
		if err != nil {
			t.Fatal(err)
		}
		meta := fhMeta(t, mem, "/out/.jostraca/jostraca.meta.log")
		files := meta["files"].(map[string]any)
		got := []int64{res.When,
			int64(files["a.txt"].(map[string]any)["when"].(float64)),
			int64(files["sub/b.txt"].(map[string]any)["when"].(float64)),
			int64(meta["last"].(float64)), calls()}
		want := []int64{t0, t0 + 3, t0 + 5, t0 + 6, 10}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("when/a/b/last/calls = %v, want %v", got, want)
				break
			}
		}
	})

	t.Run("build-false-then-build", func(t *testing.T) {
		now, calls := counterClock(t0)
		mem := NewMemFS()
		j := New(WithFS(mem), WithFolder("/out"), WithNow(now))
		off := false
		res, err := j.Generate(Options{Build: &off}, two("A\n", "B\n"))
		if err != nil {
			t.Fatal(err)
		}
		// The build context and the meta log's existsFile, nothing else.
		if res.When != t0 || calls() != 2 || len(res.Audit()) != 1 ||
			res.Audit()[0].Tag != "FileHandler:existsFile:" {
			t.Errorf("build:false: when=%d calls=%d audit=%v", res.When, calls(), res.Audit())
		}
		res, err = j.Generate(Options{}, two("A\n", "B\n"))
		if err != nil {
			t.Fatal(err)
		}
		if res.When != t0+2 || calls() != 12 {
			t.Errorf("build: when=%d calls=%d", res.When, calls())
		}
	})

	t.Run("empty-define", func(t *testing.T) {
		now, calls := counterClock(t0)
		res, err := New(WithFS(NewMemFS()), WithFolder("/out"), WithNow(now)).
			Generate(Options{}, func(j *J) {})
		if err != nil {
			t.Fatal(err)
		}
		a := res.Audit()
		if a == nil || len(a) != 1 || a[0].Tag != "FileHandler:existsFile:" || calls() != 2 {
			t.Errorf("empty define: audit=%v calls=%d", a, calls())
		}
	})

	// The apidef pattern: three runs sharing one clock, the last over a
	// user edit.
	t.Run("three-runs", func(t *testing.T) {
		now, calls := counterClock(t0)
		mem := NewMemFS()
		gen := func(a, b string) Result {
			res, err := New(WithFS(mem), WithFolder("/out"), WithNow(now)).
				Generate(Options{}, func(j *J) {
					j.Project(ProjectProps{}, func(j *J) {
						j.Folder("model", func(j *J) {
							j.File("a.aontu", func(j *J) { j.Content(a) })
						})
						j.File("b.txt", func(j *J) { j.Content(b) })
					})
				})
			if err != nil {
				t.Fatal(err)
			}
			return res
		}
		whens := []string{}
		for _, r := range [][2]string{{"x: 1\n", "B\n"}, {"x: 2\n", "B\n"}, {"x: 2\n", "B\n"}} {
			if len(whens) == 2 {
				_ = mem.WriteFile("/out/b.txt", []byte("USER EDIT\n"))
			}
			res := gen(r[0], r[1])
			meta := fhMeta(t, mem, "/out/.jostraca/jostraca.meta.log")
			whens = append(whens, strconv.FormatInt(res.When-t0, 10)+"/"+
				strconv.FormatInt(int64(meta["last"].(float64))-t0, 10))
		}
		if got := strings.Join(whens, " ") + " " + strconv.FormatInt(calls(), 10); got !=
			"0/6 10/19 23/32 36" {
			t.Errorf("when/last per run, calls = %s", got)
		}
	})
}

// The handler refuses a path whose directory has more than 22 segments,
// counted as composed. The run fails after the Folder directories exist
// and before any file, meta log or .gitignore is written. Twin of
// 'path-depth' in ts/test/filehandler.test.ts.
func TestPathDepth(t *testing.T) {
	deep := func(n int) func(*J) {
		return func(j *J) {
			var nest func(j *J, i int)
			nest = func(j *J, i int) {
				if i == n {
					j.File("deep.txt", func(j *J) { j.Content("D") })
					return
				}
				j.Folder("d"+strconv.Itoa(i), func(j *J) { nest(j, i+1) })
			}
			j.Project(ProjectProps{}, func(j *J) { nest(j, 0) })
		}
	}
	cwd := memCwd()

	mem := NewMemFS()
	if _, err := New(WithFS(mem), WithFolder("out"), WithNow(func() int64 { return fhNow })).
		Generate(Options{}, deep(21)); err != nil {
		t.Fatalf("21 folders: %v", err)
	}

	mem = NewMemFS()
	_, err := New(WithFS(mem), WithFolder("out"), WithNow(func() int64 { return fhNow })).
		Generate(Options{}, deep(22))
	want := "saveFile: path too deep, path=out/d0/d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/" +
		"d11/d12/d13/d14/d15/d16/d17/d18/d19/d20/d21/deep.txt"
	if err == nil || !strings.Contains(err.Error(), want) || !errors.Is(err, ErrInvalidPath) {
		t.Fatalf("22 folders: err = %v", err)
	}
	for k, v := range mem.Vol() {
		if v != nil {
			t.Errorf("a file was written: %s", k)
		}
	}
	if !mem.Exists(cwd + "/out/d0/d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d12/d13/d14/d15/d16/d17/d18/d19/d20/d21") {
		t.Error("the Folder directories were not made")
	}

	// An absolute folder's own segments count.
	mem = NewMemFS()
	root := "/r1/r2/r3/r4/r5/r6/r7/r8/r9/r10/r11/r12/r13/r14/r15/r16/r17/r18/r19"
	if _, err := New(WithFS(mem), WithFolder(root), WithNow(func() int64 { return fhNow })).
		Generate(Options{}, deep(3)); err != nil {
		t.Fatalf("abs 19+3: %v", err)
	}
	mem = NewMemFS()
	_, err = New(WithFS(mem), WithFolder(root), WithNow(func() int64 { return fhNow })).
		Generate(Options{}, deep(4))
	if err == nil || !strings.Contains(err.Error(), "saveFile: path too deep, path="+root+"/d0/d1/d2/d3/deep.txt") {
		t.Fatalf("abs 19+4: err = %v", err)
	}
}

// canDenyRead reports whether permission bits are enforced here: not as
// root with CAP_DAC_OVERRIDE, and not on Windows.
func canDenyRead(t *testing.T) bool {
	if runtime.GOOS == "windows" {
		return false
	}
	p := filepath.Join(t.TempDir(), "probe")
	_ = os.WriteFile(p, []byte("x"), 0o666)
	_ = os.Chmod(p, 0)
	_, err := os.ReadFile(p)
	return err != nil
}

// The meta log and .gitignore go through the atomic, audited writer: a
// failure writing either is returned, and an unreadable previous meta log
// is not fatal. Twin of 'meta-atomic' in ts/test/filehandler.test.ts.
func TestMetaAtomic(t *testing.T) {
	root := func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("A") })
		})
	}
	gen := func(out string) error {
		_, err := New(WithFolder(out), WithNow(func() int64 { return fhNow })).
			Generate(Options{}, root)
		return err
	}

	t.Run("gitignore-is-a-directory", func(t *testing.T) {
		out := filepath.Join(t.TempDir(), "out")
		_ = os.MkdirAll(filepath.Join(out, ".jostraca", ".gitignore"), 0o777)
		err := gen(out)
		if err == nil || !strings.Contains(err.Error(), "FileHandler:saveFile: path=") {
			t.Fatalf("err = %v", err)
		}
		if _, err := os.Stat(filepath.Join(out, ".jostraca", "jostraca.meta.log")); err != nil {
			t.Errorf("meta log not written first: %v", err)
		}
	})

	if !canDenyRead(t) {
		t.Skip("permission bits are not enforced here")
	}

	t.Run("unreadable-meta-log", func(t *testing.T) {
		out := filepath.Join(t.TempDir(), "out")
		if err := gen(out); err != nil {
			t.Fatal(err)
		}
		meta := filepath.Join(out, ".jostraca", "jostraca.meta.log")
		_ = os.Chmod(meta, 0)
		defer func() { _ = os.Chmod(meta, 0o666) }()
		if err := gen(out); err != nil {
			t.Fatalf("unreadable meta log was fatal: %v", err)
		}
		if fi, _ := os.Stat(meta); fi.Mode().Perm() != 0 {
			t.Errorf("new meta log mode %o, want 0", fi.Mode().Perm())
		}
	})

	t.Run("read-only-meta-folder", func(t *testing.T) {
		out := filepath.Join(t.TempDir(), "out")
		if err := gen(out); err != nil {
			t.Fatal(err)
		}
		meta := filepath.Join(out, ".jostraca", "jostraca.meta.log")
		before, _ := os.ReadFile(meta)
		_ = os.Chmod(filepath.Join(out, ".jostraca"), 0o555)
		defer func() { _ = os.Chmod(filepath.Join(out, ".jostraca"), 0o777) }()
		_ = os.WriteFile(filepath.Join(out, "a.txt"), []byte("EDIT"), 0o666)
		if err := gen(out); err == nil {
			t.Fatal("a read-only meta folder did not fail the run")
		}
		if after, _ := os.ReadFile(meta); string(after) != string(before) {
			t.Error("the old meta log was not left intact")
		}
	})
}
