package jostraca

import (
	"os"
	"path"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
	"time"
)

// Global `control` precedence. The TS side had a defect here: OptionsShape
// declared dryrun/duplicate/version as literal defaults, so shape injected them
// into every per-call options object and the merge let the injected default
// beat a global setting -- a global `dryrun: true` wrote the user's files.
//
// Control merges PER FIELD, defaults < global < per-call, as TS's deep merge
// does. A per-call Control that sets one flag leaves every other global flag
// in force; Go used to replace the whole global Control with any non-zero
// per-call one, which turned a global dryrun into a write.
//
// Mirrors the `global-control-precedence` block in ts/test/control.test.ts.
// See docs/design/PARITY_PLAN.md 1.1.

func controlVolKeys(m *MemFS) []string {
	out := []string{}
	for k := range m.Vol() {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func controlGen(t *testing.T, global []Option, call Options) []string {
	t.Helper()
	m := NewMemFS()
	opts := append([]Option{
		WithFS(m),
		WithFolder("/out"),
		WithNow(func() int64 { return 1735689600000 }),
	}, global...)

	if _, err := New(opts...).Generate(call, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("SECRET") })
		})
	}); err != nil {
		t.Fatal(err)
	}
	return controlVolKeys(m)
}

var controlAllFiles = []string{
	"/out/.jostraca/.gitignore",
	"/out/.jostraca/generated/a.txt",
	"/out/.jostraca/jostraca.meta.log",
	"/out/a.txt",
}

func controlWant(t *testing.T, got, want []string, what string) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got: %v\nwant: %v", what, got, want)
	}
}

func TestGlobalDryrunWritesNothing(t *testing.T) {
	got := controlGen(t, []Option{WithControl(Control{Dryrun: true})}, Options{})
	controlWant(t, got, []string{}, "global dryrun must write nothing")
}

func TestPerCallDryrunWritesNothing(t *testing.T) {
	got := controlGen(t, nil, Options{Control: Control{Dryrun: true}})
	controlWant(t, got, []string{}, "per-call dryrun must write nothing")
}

func TestNoControlWritesEverything(t *testing.T) {
	got := controlGen(t, nil, Options{})
	controlWant(t, got, controlAllFiles, "no control must write everything")
}

func TestGlobalNoDuplicateSkipsBaseline(t *testing.T) {
	got := controlGen(t, []Option{WithControl(Control{NoDuplicate: true})}, Options{})
	want := []string{
		"/out/.jostraca/.gitignore",
		"/out/.jostraca/jostraca.meta.log",
		"/out/a.txt",
	}
	controlWant(t, got, want, "global NoDuplicate must skip the baseline")
}

func TestGlobalVersionSkipsGitignore(t *testing.T) {
	got := controlGen(t, []Option{WithControl(Control{Version: true})}, Options{})
	want := []string{
		"/out/.jostraca/generated/a.txt",
		"/out/.jostraca/jostraca.meta.log",
		"/out/a.txt",
	}
	controlWant(t, got, want, "global Version must skip the .gitignore")
}

// KNOWN DEVIATION, pinned deliberately rather than fixed.
//
// TS can express "the global says dryrun, but re-enable writing for THIS call"
// because `{dryrun: false}` is distinguishable from `{}`. Go cannot: Control's
// fields are plain bools, so a per-call false is indistinguishable from "not
// supplied", and mergeOptions keeps the global true. The same holds for each
// flag: a per-call Version false or NoDuplicate false cannot clear a global
// true either.
//
// Closing this would mean pointer fields on Control, a breaking change to the
// public API, for a narrow case: globally disabling writes and then re-enabling
// them for one call. Recorded in the deviations list instead.
func TestPerCallCannotClearGlobalDryrun(t *testing.T) {
	got := controlGen(t,
		[]Option{WithControl(Control{Dryrun: true})},
		Options{Control: Control{Dryrun: false}})

	// Go keeps the global. TS would write controlAllFiles here.
	controlWant(t, got, []string{},
		"a per-call zero-value Control cannot clear a global dryrun in Go")
}

// A per-call Control never discards an unrelated global flag. Each case is
// one the old wholesale replacement got wrong.
func TestGlobalDryrunSurvivesPerCallVersion(t *testing.T) {
	got := controlGen(t,
		[]Option{WithControl(Control{Dryrun: true})},
		Options{Control: Control{Version: true}})
	controlWant(t, got, []string{},
		"a global dryrun must survive a per-call version")
}

func TestGlobalDryrunSurvivesPerCallNoDuplicate(t *testing.T) {
	got := controlGen(t,
		[]Option{WithControl(Control{Dryrun: true})},
		Options{Control: Control{NoDuplicate: true}})
	controlWant(t, got, []string{},
		"a global dryrun must survive a per-call duplicate:false")
}

func TestGlobalVersionSurvivesPerCallNoDuplicate(t *testing.T) {
	got := controlGen(t,
		[]Option{WithControl(Control{Version: true})},
		Options{Control: Control{NoDuplicate: true}})
	controlWant(t, got, []string{
		"/out/.jostraca/jostraca.meta.log",
		"/out/a.txt",
	}, "a global version must survive a per-call duplicate:false")
}

func TestGlobalNoDuplicateSurvivesPerCallVersion(t *testing.T) {
	got := controlGen(t,
		[]Option{WithControl(Control{NoDuplicate: true})},
		Options{Control: Control{Version: true}})
	controlWant(t, got, []string{
		"/out/.jostraca/jostraca.meta.log",
		"/out/a.txt",
	}, "a global duplicate:false must survive a per-call version")
}

// Build and Exclude follow the same precedence as every other option:
// per-call, else global, else the default. Go always honoured a global
// value; TS ignored both until OptionsShape stopped injecting literal
// defaults. Mirrors `global-build-and-exclude` in ts/test/control.test.ts.

func buildExcludeRoot(a, b string) func(*J) {
	return func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content(a) })
			j.File("b.txt", func(j *J) { j.Content(b) })
		})
	}
}

func TestGlobalBuildFalseWritesNothing(t *testing.T) {
	m := NewMemFS()
	res, err := New(WithFS(m), WithFolder("/out"), WithBuild(false)).
		Generate(Options{}, buildExcludeRoot("A", "B"))
	if err != nil {
		t.Fatal(err)
	}
	controlWant(t, controlVolKeys(m), []string{}, "global build:false must write nothing")
	if len(res.Files.Written) != 0 {
		t.Fatalf("written: %v", res.Files.Written)
	}
}

func TestPerCallBuildTrueOverridesGlobalFalse(t *testing.T) {
	m := NewMemFS()
	build := true
	res, err := New(WithFS(m), WithFolder("/out"), WithBuild(false)).
		Generate(Options{Build: &build}, buildExcludeRoot("A", "B"))
	if err != nil {
		t.Fatal(err)
	}
	controlWant(t, res.Files.Written, []string{"/out/a.txt", "/out/b.txt"},
		"per-call build:true must override a global false")
}

// excludeWindowRun generates, edits a.txt, sets the two mtimes on either
// side of the recorded `last`, and regenerates. A REAL FILESYSTEM, because
// the window compares an mtime with `last`.
func excludeWindowRun(t *testing.T, global []Option, call Options) (string, string, []string) {
	t.Helper()
	dir := fwd(t.TempDir())
	const start = int64(1735689600000)
	j := New(append([]Option{
		WithFolder(dir),
		WithNow(func() int64 { return start }),
	}, global...)...)

	if _, err := j.Generate(Options{}, buildExcludeRoot("A", "B")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("USER"), 0o644); err != nil {
		t.Fatal(err)
	}
	later := time.UnixMilli(start + 60000)
	earlier := time.UnixMilli(start - 60000)
	if err := os.Chtimes(filepath.Join(dir, "a.txt"), later, later); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(filepath.Join(dir, "b.txt"), earlier, earlier); err != nil {
		t.Fatal(err)
	}

	res, err := j.Generate(call, buildExcludeRoot("A2", "B2"))
	if err != nil {
		t.Fatal(err)
	}
	a, _ := os.ReadFile(filepath.Join(dir, "a.txt"))
	b, _ := os.ReadFile(filepath.Join(dir, "b.txt"))
	written := []string{}
	for _, p := range res.Files.Written {
		written = append(written, path.Base(p))
	}
	return string(a), string(b), written
}

func withGlobalExclude(o *Options) { o.Exclude = true }

func TestGlobalExcludeSkipsUserEditedFile(t *testing.T) {
	a, b, written := excludeWindowRun(t, []Option{withGlobalExclude}, Options{})
	if a != "USER" || b != "B2" {
		t.Fatalf("a=%q b=%q", a, b)
	}
	controlWant(t, written, []string{"b.txt"}, "a global exclude must skip a.txt")
}

func TestNoExcludeOverwritesUserEditedFile(t *testing.T) {
	a, b, written := excludeWindowRun(t, nil, Options{})
	if a != "A2" || b != "B2" {
		t.Fatalf("a=%q b=%q", a, b)
	}
	controlWant(t, written, []string{"a.txt", "b.txt"}, "no exclude writes both")
}

// KNOWN DEVIATION, the Exclude twin of TestPerCallCannotClearGlobalDryrun.
// Options.Exclude is a plain bool, so a per-call false is "not supplied"
// and the global true stays in force. TS writes both files here.
func TestPerCallCannotClearGlobalExclude(t *testing.T) {
	a, _, written := excludeWindowRun(t, []Option{withGlobalExclude},
		Options{Exclude: false})
	if a != "USER" {
		t.Fatalf("a=%q", a)
	}
	controlWant(t, written, []string{"b.txt"},
		"a per-call zero-value Exclude cannot clear a global exclude in Go")
}
