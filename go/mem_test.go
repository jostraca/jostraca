package jostraca

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// Options.Mem and Options.Vol used to be INERT: nothing constructed a
// filesystem from them, so `WithMem()` ran against the REAL filesystem and
// returned a Result whose Vol and FS were nil, with no error to say so. A
// test translated from TS by keeping those two options passed while writing
// into the working directory. See #37 and docs/design/PARITY_PLAN.md.
//
// TS's rules, mirrored here: `mem` is the switch and `vol` is the seed; an
// explicit filesystem beats both; and a GLOBAL mem is reused across
// Generate calls so a second run sees what the first wrote.

func memTree(name, body string) func(*J) {
	return func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File(name, func(j *J) { j.Content(body) })
		})
	}
}

func volKeys(t *testing.T, res Result) []string {
	t.Helper()
	if res.Vol == nil {
		t.Fatal("Result.Vol is nil; WithMem did not install a MemFS")
	}
	out := []string{}
	for k := range res.Vol() {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func TestWithMemDoesNotTouchTheRealFilesystem(t *testing.T) {
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	tmp := t.TempDir()
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(cwd)

	res, err := New(WithMem(), WithFolder("out"), WithNow(func() int64 { return 1 })).
		Generate(Options{}, memTree("a.txt", "A"))
	if err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(tmp, "out", "p", "a.txt")); err == nil {
		t.Error("WithMem wrote to the real filesystem")
	}
	if res.FS == nil {
		t.Error("Result.FS is nil")
	}

	found := false
	for _, k := range volKeys(t, res) {
		if k == "out/p/a.txt" {
			found = true
		}
	}
	if !found {
		t.Errorf("generated file missing from the volume: %v", volKeys(t, res))
	}
}

func TestWithVolSeedsTheMemFilesystem(t *testing.T) {
	res, err := New(WithMem(), WithFolder("/out"), WithNow(func() int64 { return 1 }),
		WithVol(map[string][]byte{"/seed.txt": []byte("S")})).
		Generate(Options{}, memTree("a.txt", "A"))
	if err != nil {
		t.Fatal(err)
	}

	if got := res.Vol()["/seed.txt"]; string(got) != "S" {
		t.Errorf("seed missing from the volume: got %q", got)
	}
}

// TS keeps one global memfs and hands it to every generate call unless that
// call supplies its own vol, so a second run regenerates over the first
// run's output. Without this, no regenerate-over-existing scenario could be
// written against `{mem: true}` at all.
func TestGlobalMemPersistsAcrossGenerateCalls(t *testing.T) {
	j := New(WithMem(), WithFolder("/out"), WithNow(func() int64 { return 1 }))

	if _, err := j.Generate(Options{}, memTree("first.txt", "1")); err != nil {
		t.Fatal(err)
	}
	res, err := j.Generate(Options{}, memTree("second.txt", "2"))
	if err != nil {
		t.Fatal(err)
	}

	vol := res.Vol()
	if string(vol["/out/p/first.txt"]) != "1" {
		t.Error("the first run's output is missing from the second run's volume")
	}
	if string(vol["/out/p/second.txt"]) != "2" {
		t.Error("the second run's own output is missing")
	}
}

// A per-call Vol seeds a FRESH volume rather than reusing the global one,
// which is TS's `null == opts.vol && null != gMemFs ? gMemFs : MemFs(vol)`.
func TestPerCallVolGetsAFreshVolume(t *testing.T) {
	j := New(WithMem(), WithFolder("/out"), WithNow(func() int64 { return 1 }))

	if _, err := j.Generate(Options{}, memTree("first.txt", "1")); err != nil {
		t.Fatal(err)
	}
	res, err := j.Generate(
		Options{Vol: map[string][]byte{"/seed.txt": []byte("S")}},
		memTree("second.txt", "2"))
	if err != nil {
		t.Fatal(err)
	}

	vol := res.Vol()
	if _, carried := vol["/out/p/first.txt"]; carried {
		t.Error("a per-call Vol should start from a fresh volume")
	}
	if string(vol["/seed.txt"]) != "S" {
		t.Error("per-call seed missing")
	}
}

// An explicit filesystem wins over Mem, as it does in TS where `opts.fs`
// comes first in the chain that picks one.
func TestExplicitFSBeatsMem(t *testing.T) {
	own := NewMemFS()
	res, err := New(WithMem(), WithFS(own), WithFolder("/out"), WithNow(func() int64 { return 1 })).
		Generate(Options{}, memTree("a.txt", "A"))
	if err != nil {
		t.Fatal(err)
	}

	if string(own.Vol()["/out/p/a.txt"]) != "A" {
		t.Error("output did not land in the caller's own filesystem")
	}
	if res.FS == nil {
		t.Fatal("Result.FS is nil")
	}
	if res.FS() != FS(own) {
		t.Error("Result.FS is not the filesystem the caller supplied")
	}
}

// A per-call Vol MERGES over the global seed rather than replacing it,
// which is TS's `deep({}, gVol, opts.vol)`. Replacing it dropped the global
// template sources a call was relying on.
func TestPerCallVolMergesOverTheGlobalSeed(t *testing.T) {
	j := New(WithMem(), WithFolder("/out"), WithNow(func() int64 { return 1 }),
		WithVol(map[string][]byte{
			"/tpl/global.txt": []byte("G"),
			"/tpl/both.txt":   []byte("global"),
		}))

	res, err := j.Generate(
		Options{Vol: map[string][]byte{
			"/tpl/call.txt": []byte("C"),
			"/tpl/both.txt": []byte("call"),
		}},
		memTree("a.txt", "A"))
	if err != nil {
		t.Fatal(err)
	}

	vol := res.Vol()
	if string(vol["/tpl/global.txt"]) != "G" {
		t.Error("the global seed was dropped by a per-call Vol")
	}
	if string(vol["/tpl/call.txt"]) != "C" {
		t.Error("the per-call seed is missing")
	}
	if got := string(vol["/tpl/both.txt"]); got != "call" {
		t.Errorf("per-call value should win: got %q, want %q", got, "call")
	}
}

// Mem is tri-state, so a call can turn OFF a builder's memory mode. TS
// distinguishes the same three cases: `null == opts.mem ? gUseMemFs :
// !!opts.mem`. With a plain bool a call could switch it on and never off.
func TestPerCallMemFalseDisablesGlobalMem(t *testing.T) {
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	tmp := t.TempDir()
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(cwd)

	off := false
	res, err := New(WithMem(), WithFolder("out"), WithNow(func() int64 { return 1 })).
		Generate(Options{Mem: &off}, memTree("a.txt", "A"))
	if err != nil {
		t.Fatal(err)
	}

	if res.Vol != nil {
		t.Error("Mem:false should fall back to the real filesystem")
	}
	if _, err := os.Stat(filepath.Join(tmp, "out", "p", "a.txt")); err != nil {
		t.Errorf("nothing was written to the real filesystem: %v", err)
	}
}

// The in-memory handles are attached whether or not the build phase runs,
// as they are in TS. A define-only run still has a filesystem -- the seeded
// one -- and returning nil left a caller unable to inspect even that.
func TestMemHandlesPresentWhenBuildIsDisabled(t *testing.T) {
	build := false
	res, err := New(WithMem(), WithFolder("/out"), WithNow(func() int64 { return 1 }),
		WithVol(map[string][]byte{"/seed.txt": []byte("S")})).
		Generate(Options{Build: &build}, memTree("a.txt", "A"))
	if err != nil {
		t.Fatal(err)
	}

	if res.Vol == nil || res.FS == nil {
		t.Fatal("Result.Vol/FS are nil on a define-only run")
	}
	if string(res.Vol()["/seed.txt"]) != "S" {
		t.Error("the seeded volume is not reachable")
	}
	if _, built := res.Vol()["/out/p/a.txt"]; built {
		t.Error("Build:false should not have written anything")
	}
}
