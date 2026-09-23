package jostraca

import (
	"reflect"
	"sort"
	"testing"
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
