package jostraca

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Durability tests: atomic write-then-rename, and error propagation from
// the merge-baseline write. Mirrors ts/test/durability.test.ts.

const durWhen int64 = 1735689600000

// failFS wraps a MemFS and fails writes whose path contains `failOn`.
type failFS struct {
	*MemFS
	failOn string
	err    error
}

func (f *failFS) WriteFile(p string, data []byte) error {
	if f.failOn != "" && strings.Contains(p, f.failOn) {
		return f.err
	}
	return f.MemFS.WriteFile(p, data)
}

var errDiskFull = errors.New("simulated: no space left on device")

func durJ(fsys FS, extra ...Option) *J {
	o := []Option{WithFS(fsys), WithFolder("/out"), WithNow(func() int64 { return durWhen })}
	return New(append(o, extra...)...)
}

// The temp file used by the atomic replace must never survive a run.
func TestAtomicWriteLeavesNoTempFiles(t *testing.T) {
	m := NewMemFS()
	_ = m.WriteFile("/out/p/a.txt", []byte("OLD\n"))

	if _, err := durJ(m).Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("NEW\n") })
			j.File("b.txt", func(j *J) { j.Content("B\n") })
		})
	}); err != nil {
		t.Fatal(err)
	}

	for k := range m.Vol() {
		if strings.Contains(k, tmpSuffix) {
			t.Errorf("temp file survived the run: %s", k)
		}
	}
	if got := string(m.Vol()["/out/p/a.txt"]); got != "NEW\n" {
		t.Errorf("a.txt: got %q want %q", got, "NEW\n")
	}
}

// A failed write must leave the user's existing file untouched, not
// truncated — the whole point of the temp-then-rename.
func TestFailedWriteLeavesExistingFileIntact(t *testing.T) {
	m := NewMemFS()
	_ = m.WriteFile("/out/p/a.txt", []byte("USER-EDITED\n"))
	f := &failFS{MemFS: m, failOn: "/out/p/a.txt", err: errDiskFull}

	_, err := durJ(f).Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("GENERATED\n") })
		})
	})
	if !errors.Is(err, errDiskFull) {
		t.Fatalf("expected the write error to surface, got %v", err)
	}
	if got := string(m.Vol()["/out/p/a.txt"]); got != "USER-EDITED\n" {
		t.Errorf("existing content was damaged: got %q", got)
	}
}

// The merge baseline is what makes edit-preserving merges work. A failure
// writing it must surface: silently dropping it means the next run finds
// no baseline and overwrites the user's edits.
func TestBaselineWriteErrorSurfaces(t *testing.T) {
	m := NewMemFS()
	f := &failFS{MemFS: m, failOn: "/.jostraca/generated/", err: errDiskFull}

	_, err := durJ(f).Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("GEN\n") })
		})
	})
	if !errors.Is(err, errDiskFull) {
		t.Fatalf("baseline write failure was swallowed; got err=%v", err)
	}
}

// Dryrun must not write anything at all, baseline included.
func TestDryrunWritesNothing(t *testing.T) {
	m := NewMemFS()
	if _, err := durJ(m, WithControl(Control{Dryrun: true})).Generate(
		Options{}, func(j *J) {
			j.Project(ProjectProps{Folder: "p"}, func(j *J) {
				j.File("a.txt", func(j *J) { j.Content("NEW\n") })
			})
		}); err != nil {
		t.Fatal(err)
	}
	for k := range m.Vol() {
		t.Errorf("dryrun wrote %s", k)
	}
}

// On a real filesystem, replacing a file must keep its mode: rename swaps
// the inode, so without the chmod an executable would silently lose +x.
func TestAtomicWritePreservesMode(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "p", "run.sh")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("#!/bin/sh\necho old\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	j := New(WithFolder(fwd(dir)), WithNow(func() int64 { return durWhen }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("run.sh", func(j *J) { j.Content("#!/bin/sh\necho new\n") })
		})
	}); err != nil {
		t.Fatal(err)
	}

	fi, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	// Skipped on Windows, which has no execute bit — see posixModes.
	if posixModes && fi.Mode().Perm()&0o111 == 0 {
		t.Errorf("executable bit lost: mode now %v", fi.Mode().Perm())
	}
	body, _ := os.ReadFile(target)
	if string(body) != "#!/bin/sh\necho new\n" {
		t.Errorf("content: got %q", body)
	}

	// And no temp file left behind on a real fs.
	entries, _ := os.ReadDir(filepath.Dir(target))
	for _, e := range entries {
		if strings.Contains(e.Name(), tmpSuffix) {
			t.Errorf("temp file survived: %s", e.Name())
		}
	}
}

// OsFS must satisfy the optional chmod capability; MemFS need not.
func TestOsFSImplementsChmod(t *testing.T) {
	var f FS = OsFS{}
	if _, ok := f.(chmodFS); !ok {
		t.Error("OsFS should implement chmodFS so modes survive an atomic replace")
	}
	var _ fs.FileMode // keep the io/fs import honest
}
