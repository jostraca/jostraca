package jostraca

import (
	"errors"
	"fmt"
	"io/fs"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// After a successful Generate, each non-fatal warning raised during THAT
// call is replayed to that call's Log.Debug, one call per warning, with
// TS's payload {point, dlogentry, note}. A refused run replays nothing,
// and a concurrent call's warnings never reach this call's log.
//
// Go assigned the Log option and never called it, so a caller's logger saw
// nothing at all. Mirrors the `warnings` block in ts/test/generate.test.ts.

type warnLog struct {
	mu    sync.Mutex
	calls [][]any
}

func (l *warnLog) add(level string, args []any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.calls = append(l.calls, append([]any{level}, args...))
}

func (l *warnLog) Trace(a ...any) { l.add("trace", a) }
func (l *warnLog) Debug(a ...any) { l.add("debug", a) }
func (l *warnLog) Info(a ...any)  { l.add("info", a) }
func (l *warnLog) Warn(a ...any)  { l.add("warn", a) }
func (l *warnLog) Error(a ...any) { l.add("error", a) }
func (l *warnLog) Fatal(a ...any) { l.add("fatal", a) }

// warned is the args of each replayed warning, checking the payload shape
// on the way: only the args are portable, the rest of the entry is the
// runtime's own.
func (l *warnLog) warned(t *testing.T) [][]any {
	t.Helper()
	l.mu.Lock()
	defer l.mu.Unlock()
	out := [][]any{}
	for _, c := range l.calls {
		if c[0] != "debug" || len(c) != 2 {
			t.Fatalf("not one debug payload: %v", c)
		}
		payload, ok := c[1].(map[string]any)
		if !ok || payload["point"] != "jostraca-warning" {
			t.Fatalf("payload: %#v", c[1])
		}
		entry, ok := payload["dlogentry"].(dLogEntry)
		if !ok || entry.Tag != "jostraca" {
			t.Fatalf("dlogentry: %#v", payload["dlogentry"])
		}
		if note, _ := payload["note"].(string); note != entry.String() {
			t.Fatalf("note: %q", payload["note"])
		}
		out = append(out, entry.Args)
	}
	return out
}

func warnGen(vol map[string][]byte, root func(*J), log Log) error {
	_, err := New(WithMem(), WithVol(vol), WithFolder("/out"),
		WithNow(func() int64 { return 1735689600000 }), WithLog(log)).
		Generate(Options{}, root)
	return err
}

func TestInjectIntoUnmarkedFileWarnsOnce(t *testing.T) {
	log := &warnLog{}
	if err := warnGen(map[string][]byte{"/out/t.txt": []byte("no markers here\n")},
		func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Inject("t.txt", func(j *J) { j.Content("X") })
			})
		}, log); err != nil {
		t.Fatal(err)
	}
	want := [][]any{{"inject", `markers not found, nothing injected: path=/out/t.txt ` +
		`markers=["#--START--#\n","\n#--END--#"]`}}
	if got := log.warned(t); !reflect.DeepEqual(got, want) {
		t.Fatalf("\n got: %q\nwant: %q", got, want)
	}
}

func TestUnreadableMetaLogWarnsOnce(t *testing.T) {
	log := &warnLog{}
	if err := warnGen(
		map[string][]byte{"/out/.jostraca/jostraca.meta.log": []byte("{not json")},
		func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("a.txt", func(j *J) { j.Content("A") })
			})
		}, log); err != nil {
		t.Fatal(err)
	}
	got := log.warned(t)
	if len(got) != 1 || len(got[0]) != 2 || got[0][0] != "meta" {
		t.Fatalf("warned: %q", got)
	}
	text := fmt.Sprint(got[0][1])
	// The parser's own message after the last err= is the runtime's.
	if !strings.HasPrefix(text, "unreadable meta log, continuing with empty state: "+
		"/out/.jostraca/jostraca.meta.log err=FileHandler:loadJSON: "+
		"path=/out/.jostraca/jostraca.meta.log err=") {
		t.Fatalf("text: %q", text)
	}
}

// TS also warns `filelog written duplicate: <path>` here; that entry
// belongs to the files-list de-duplication, so only the first is held.
func TestSecondSaveOfOnePathWarns(t *testing.T) {
	log := &warnLog{}
	if err := warnGen(nil, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("t.txt", func(j *J) { j.Content("a\n#--START--#\nold\n#--END--#\nz\n") })
			j.Inject("t.txt", func(j *J) { j.Content("NEW") })
		})
	}, log); err != nil {
		t.Fatal(err)
	}
	got := log.warned(t)
	want := []any{"save", "duplicate save, later content wins: /out/t.txt"}
	if len(got) == 0 || !reflect.DeepEqual(got[0], want) {
		t.Fatalf("warned: %q", got)
	}
}

// failChmodFS is a MemFS whose Chmod fails once told to.
type failChmodFS struct {
	*MemFS
	fail bool
}

func (f *failChmodFS) Chmod(p string, mode fs.FileMode) error {
	if f.fail {
		return errors.New("EPERM")
	}
	return nil
}

func TestFailedChmodOfUnchangedFileWarns(t *testing.T) {
	provider := &failChmodFS{MemFS: NewMemFS()}
	j := New(WithFS(provider), WithFolder("/out"),
		WithNow(func() int64 { return 1735689600000 }))
	root := func(mode fs.FileMode) func(*J) {
		return func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.FileP(FileProps{Name: "a.sh", Mode: mode}, func(j *J) { j.Content("X") })
			})
		}
	}

	if _, err := j.Generate(Options{}, root(0o755)); err != nil {
		t.Fatal(err)
	}
	provider.fail = true
	log := &warnLog{}
	res, err := j.Generate(Options{Log: log}, root(0o700))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(res.Files.Unchanged, []string{"/out/a.sh"}) {
		t.Fatalf("unchanged: %v", res.Files.Unchanged)
	}
	want := [][]any{{"save", "chmod of unchanged file failed: /out/a.sh"}}
	if got := log.warned(t); !reflect.DeepEqual(got, want) {
		t.Fatalf("\n got: %q\nwant: %q", got, want)
	}
}

// cleanupFS fails a temp write or the rename, and optionally the removal
// of the temp file.
type cleanupFS struct {
	*MemFS
	writeErr  error
	partial   bool
	renameErr error
	removeErr error
}

func isTmp(p string) bool { return strings.Contains(p, ".jostraca-tmp-") }

func (c *cleanupFS) failWrite(p string) error {
	if c.partial {
		_ = c.MemFS.WriteFile(p, []byte("partial"))
	}
	return c.writeErr
}

func (c *cleanupFS) WriteFileExcl(p string, b []byte) error {
	if c.writeErr != nil && isTmp(p) {
		return c.failWrite(p)
	}
	return c.MemFS.WriteFileExcl(p, b)
}

func (c *cleanupFS) WriteFile(p string, b []byte) error {
	if c.writeErr != nil && isTmp(p) {
		return c.failWrite(p)
	}
	return c.MemFS.WriteFile(p, b)
}

func (c *cleanupFS) Rename(from, to string) error {
	if c.renameErr != nil {
		return c.renameErr
	}
	return c.MemFS.Rename(from, to)
}

func (c *cleanupFS) Remove(p string) error {
	if c.removeErr != nil && isTmp(p) {
		return c.removeErr
	}
	return c.MemFS.Remove(p)
}

// plainFS hides the exclusive create, so the write takes the
// check-then-write branch.
type plainFS struct{ FS }

// A failed write refuses the run, so a temp file it could not remove is
// recorded in the package buffer and replayed to no logger. A temp file
// that is already gone was not left behind, so is not reported. TS twin:
// a-failed-temp-cleanup-is-recorded.
func TestFailedTempCleanupIsRecorded(t *testing.T) {
	eio, eperm, eacces := errors.New("EIO"), errors.New("EPERM"), fs.ErrPermission
	exdev := errors.New("EXDEV")

	cases := []struct {
		name  string
		fs    *cleanupFS
		warns bool
	}{
		{"partial-write-unremovable",
			&cleanupFS{writeErr: eio, partial: true, removeErr: eperm}, true},
		{"create-failed-nothing-to-remove",
			&cleanupFS{writeErr: eacces}, false},
		{"rename-failed-unremovable",
			&cleanupFS{renameErr: exdev, removeErr: eperm}, true},
		{"rename-failed-removed",
			&cleanupFS{renameErr: exdev}, false},
	}

	for _, c := range cases {
		for _, branch := range []string{"exclusive", "plain"} {
			name := c.name + "-" + branch
			cfs := *c.fs
			cfs.MemFS = NewMemFS()
			var provider FS = &cfs
			if branch == "plain" {
				provider = plainFS{&cfs}
			}
			folder := "/" + name
			log := &warnLog{}

			_, err := New(WithFS(provider), WithFolder(folder), WithLog(log),
				WithNow(func() int64 { return 1735689600000 })).
				Generate(Options{}, memTree("a.txt", "A"))
			if err == nil {
				t.Fatalf("%s: the failed write must refuse the run", name)
			}

			prefix := "temp cleanup failed: " + folder + "/p/a.txt.jostraca-tmp-"
			got := 0
			for _, e := range DLogSnapshot(false) {
				if len(e.Args) == 2 && e.Args[0] == "writeFileAtomic" &&
					strings.HasPrefix(fmt.Sprint(e.Args[1]), prefix) {
					got++
				}
			}
			if want := map[bool]int{true: 1, false: 0}[c.warns]; got != want {
				t.Errorf("%s: %d cleanup warnings, want %d", name, got, want)
			}
			if len(log.calls) != 0 {
				t.Errorf("%s: a refused run logged: %v", name, log.calls)
			}
			if !c.warns {
				for k := range cfs.MemFS.Vol() {
					if isTmp(k) {
						t.Errorf("%s: a temp file was left behind: %s", name, k)
					}
				}
			}
		}
	}
}

func TestRefusedRunReplaysNothing(t *testing.T) {
	log := &warnLog{}
	err := warnGen(map[string][]byte{"/out/t.txt": []byte("no markers here\n")},
		func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Inject("t.txt", func(j *J) { j.Content("X") })
				j.Inject("missing.txt", func(j *J) { j.Content("X") })
			})
		}, log)
	if err == nil {
		t.Fatal("an Inject into a missing file must be refused")
	}
	if len(log.calls) != 0 {
		t.Fatalf("a refused run logged: %v", log.calls)
	}
}

// gateFS is a MemFS whose first WriteFile announces itself on reached and
// then waits for release.
type gateFS struct {
	*MemFS
	once    sync.Once
	reached chan struct{}
	release chan struct{}
}

func (g *gateFS) hold() {
	g.once.Do(func() {
		close(g.reached)
		<-g.release
	})
}

func (g *gateFS) WriteFile(path string, data []byte) error {
	g.hold()
	return g.MemFS.WriteFile(path, data)
}

// Every write is atomic, through an exclusive create, so that is where
// the build is held.
func (g *gateFS) WriteFileExcl(path string, data []byte) error {
	g.hold()
	return g.MemFS.WriteFileExcl(path, data)
}

// The calls are forced to overlap: call two is held inside its build until
// call one, started only once call two is held, has raised its warning and
// returned. A replay scoped by a mark in a shared buffer then leaks into
// call two every time, not only when the scheduler happens to interleave.
func TestConcurrentCallKeepsItsOwnWarnings(t *testing.T) {
	j := New(WithMem(), WithVol(map[string][]byte{"/one/t.txt": []byte("no markers\n")}),
		WithNow(func() int64 { return 1735689600000 }))
	one, two := &warnLog{}, &warnLog{}
	gate := &gateFS{MemFS: NewMemFS(),
		reached: make(chan struct{}), release: make(chan struct{})}

	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		defer close(gate.release)
		<-gate.reached
		_, errs[0] = j.Generate(Options{Folder: "/one", Log: one}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("x.txt", func(j *J) { j.Content("x") })
				j.Inject("t.txt", func(j *J) { j.Content("X") })
			})
		})
	}()
	go func() {
		defer wg.Done()
		_, errs[1] = j.Generate(Options{Folder: "/two", Log: two, FS: gate}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				for i := 0; i < 5; i++ {
					j.File(fmt.Sprintf("f%d.txt", i), func(j *J) { j.Content("y") })
				}
			})
		})
	}()
	wg.Wait()

	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if got := one.warned(t); len(got) != 1 {
		t.Fatalf("one: %q", got)
	}
	if len(two.calls) != 0 {
		t.Fatalf("two received another call's warnings: %v", two.calls)
	}
}
