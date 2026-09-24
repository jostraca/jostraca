//go:build !windows

package jostraca

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// New files and directories take 0666 and 0777 less the process umask, as
// Node's defaults do, so under umask 002 every artefact is group-writable
// in both stacks. Twin of 'umask-default-modes' in
// ts/test/filehandler.test.ts.
func TestUmaskDefaultModes(t *testing.T) {
	old := syscall.Umask(0o002)
	defer syscall.Umask(old)

	dir := t.TempDir()
	out := filepath.Join(dir, "out")
	_, err := New(WithFolder(out), WithNow(func() int64 { return fhNow })).
		Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Folder("sub", func(j *J) {
					j.File("a.txt", func(j *J) { j.Content("A") })
				})
			})
		})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]os.FileMode{
		"sub/a.txt":                     0o664,
		"sub":                           0o775,
		".jostraca/generated/sub/a.txt": 0o664,
		".jostraca/generated/sub":       0o775,
		".jostraca/jostraca.meta.log":   0o664,
		".jostraca/.gitignore":          0o664,
		".jostraca":                     0o775,
	}
	for rel, mode := range want {
		fi, err := os.Stat(filepath.Join(out, rel))
		if err != nil {
			t.Errorf("%s: %v", rel, err)
			continue
		}
		if got := fi.Mode().Perm(); got != mode {
			t.Errorf("%s: mode %o, want %o", rel, got, mode)
		}
	}
}

// The in-memory provider reports 0666 for a new file and 0777 for a
// directory, as ts/src/util/memfs.ts does.
func TestMemFSDefaultModes(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/d/a.txt", []byte("A"))
	fi, _ := mem.Stat("/d/a.txt")
	if fi.Mode.Perm() != 0o666 {
		t.Errorf("file mode %o, want 666", fi.Mode.Perm())
	}
	di, _ := mem.Stat("/d")
	if di.Mode.Perm() != 0o777 {
		t.Errorf("dir mode %o, want 777", di.Mode.Perm())
	}
}
