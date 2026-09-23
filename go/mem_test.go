package jostraca

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// Options.Mem and Options.Vol used to be INERT: nothing constructed a
// filesystem from them, so `WithMem()` ran against the REAL filesystem and
// returned a Result whose Vol and FS were nil, with no error to say so. A
// test translated from TS by keeping those two options passed while writing
// into the working directory. See #37 and docs/design/PARITY_PLAN.md.
//
// TS's rules, mirrored here: `mem` is the switch and `vol` is the seed; a
// per-call filesystem beats both, and both beat a global filesystem; and a
// GLOBAL mem is reused across Generate calls so a second run sees what the
// first wrote.

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

// The provider is chosen per call, in TS's order: the per-call FS, else
// the in-memory volume when Mem is on for the call, else the global FS,
// else OsFS. A per-call FS beats Mem...
func TestPerCallFSBeatsMem(t *testing.T) {
	own := NewMemFS()
	j := New(WithMem(), WithFolder("/out"), WithNow(func() int64 { return 1 }))
	res, err := j.Generate(Options{FS: own}, memTree("a.txt", "A"))
	if err != nil {
		t.Fatal(err)
	}

	if string(own.Vol()["/out/p/a.txt"]) != "A" {
		t.Error("output did not land in the per-call filesystem")
	}
	if res.FS == nil || res.FS() != FS(own) {
		t.Error("Result.FS must be the provider actually used")
	}
	if res.Vol == nil {
		t.Fatal("Result.Vol is nil with Mem on")
	}
	if _, leaked := res.Vol()["/out/p/a.txt"]; leaked {
		t.Error("Result.Vol must be the untouched instance volume")
	}
}

// ...but a GLOBAL FS does not: TS reads `opts.fs || memfs || gOpts.fs`,
// so an instance with both writes to memory. Go ranked the global FS
// first until this was measured.
func TestGlobalMemBeatsGlobalFS(t *testing.T) {
	own := NewMemFS()
	res, err := New(WithMem(), WithFS(own), WithFolder("/out"), WithNow(func() int64 { return 1 })).
		Generate(Options{}, memTree("a.txt", "A"))
	if err != nil {
		t.Fatal(err)
	}

	if len(own.Vol()) != 0 {
		t.Errorf("the global FS was written: %v", keysOf(own.Vol()))
	}
	if res.Vol == nil || string(res.Vol()["/out/p/a.txt"]) != "A" {
		t.Fatal("output did not land in the instance volume")
	}
	if res.FS() == FS(own) {
		t.Error("Result.FS must be the instance volume")
	}
}

// The instance volume is built from Mem alone, whatever FS says, so calls
// share it; a fresh volume per call would lose the first call's output.
// TS twin: global-mem-beside-global-fs-is-shared-across-calls.
func TestGlobalMemBesideGlobalFSIsSharedAcrossCalls(t *testing.T) {
	own := NewMemFS()
	j := New(WithMem(), WithFS(own), WithFolder("/out"), WithNow(func() int64 { return 1 }))
	one, err := j.Generate(Options{}, memTree("a.txt", "A"))
	if err != nil {
		t.Fatal(err)
	}
	two, err := j.Generate(Options{}, memTree("b.txt", "B"))
	if err != nil {
		t.Fatal(err)
	}

	vol := two.Vol()
	if string(vol["/out/p/a.txt"]) != "A" || string(vol["/out/p/b.txt"]) != "B" {
		t.Fatalf("the second call did not see the first call's output: %v", keysOf(vol))
	}
	if two.FS() != one.FS() {
		t.Error("the two calls used different volumes")
	}
	if len(own.Vol()) != 0 {
		t.Errorf("the global FS was written: %v", keysOf(own.Vol()))
	}
}

// A per-call Mem:true beats a global FS the same way.
func TestPerCallMemBeatsGlobalFS(t *testing.T) {
	own := NewMemFS()
	on := true
	res, err := New(WithFS(own), WithFolder("/out"), WithNow(func() int64 { return 1 })).
		Generate(Options{Mem: &on}, memTree("a.txt", "A"))
	if err != nil {
		t.Fatal(err)
	}
	if len(own.Vol()) != 0 {
		t.Errorf("the global FS was written: %v", keysOf(own.Vol()))
	}
	if res.Vol == nil || string(res.Vol()["/out/p/a.txt"]) != "A" {
		t.Fatal("output did not land in memory")
	}
}

// A caller-supplied provider, even a MemFS, gets no accessors: they are
// present exactly when Mem is on, as vol() and fs() are in TS.
func TestExplicitMemFSHasNoAccessors(t *testing.T) {
	own := NewMemFS()
	res, err := New(WithFS(own), WithFolder("/out"), WithNow(func() int64 { return 1 })).
		Generate(Options{}, memTree("a.txt", "A"))
	if err != nil {
		t.Fatal(err)
	}
	if string(own.Vol()["/out/p/a.txt"]) != "A" {
		t.Error("output did not land in the caller's own filesystem")
	}
	if res.Vol != nil || res.FS != nil {
		t.Error("a supplied provider must get no Vol or FS accessor")
	}
}

// Every Files category is a list, empty rather than nil, on a basic run,
// a define-only run, an empty define and a refused one, so the serialised
// Files has TS's shape and no null.
func TestFilesListsAreEmptyNotNil(t *testing.T) {
	off := false
	runs := map[string]func() (Result, error){
		"basic": func() (Result, error) {
			return New(WithMem(), WithFolder("/out")).
				Generate(Options{}, memTree("a.txt", "A"))
		},
		"build-false": func() (Result, error) {
			return New(WithMem(), WithFolder("/out")).
				Generate(Options{Build: &off}, memTree("a.txt", "A"))
		},
		"empty-define": func() (Result, error) {
			return New(WithMem(), WithFolder("/out")).
				Generate(Options{}, func(j *J) {})
		},
		"nil-root": func() (Result, error) {
			return New(WithMem()).Generate(Options{}, nil)
		},
	}
	for name, run := range runs {
		res, _ := run()
		f := res.Files
		for cat, l := range map[string][]string{
			"preserved": f.Preserved, "written": f.Written,
			"presented": f.Presented, "diffed": f.Diffed, "merged": f.Merged,
			"conflicted": f.Conflicted, "unchanged": f.Unchanged,
		} {
			if l == nil {
				t.Errorf("%s: %s is nil", name, cat)
			}
		}
		b, err := json.Marshal(f)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), "null") {
			t.Errorf("%s: %s", name, b)
		}
		if name == "basic" && string(b) != `{"preserved":[],"written":["/out/p/a.txt"],`+
			`"presented":[],"diffed":[],"merged":[],"conflicted":[],"unchanged":[]}` {
			t.Errorf("basic: %s", b)
		}
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
