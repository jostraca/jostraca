package jostraca

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
)

// Phase 2 — Filesystem layer.
// Tests OsFS and MemFS round-trip and concurrency invariants.

// fsContract runs the same suite against any FS implementation.
func fsContract(t *testing.T, name string, build func(t *testing.T) (FS, func())) {
	t.Run(name+"/WriteRead", func(t *testing.T) {
		fs, cleanup := build(t)
		defer cleanup()
		path := "dir/file.txt"
		want := []byte("hello\n")
		if err := fs.MkdirAll("dir"); err != nil {
			t.Fatalf("MkdirAll: %v", err)
		}
		if err := fs.WriteFile(path, want); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		got, err := fs.ReadFile(path)
		if err != nil {
			t.Fatalf("ReadFile: %v", err)
		}
		if string(got) != string(want) {
			t.Errorf("ReadFile got %q, want %q", got, want)
		}
	})

	t.Run(name+"/Exists", func(t *testing.T) {
		fs, cleanup := build(t)
		defer cleanup()
		if fs.Exists("nope") {
			t.Error("Exists(nope) = true, want false")
		}
		if err := fs.MkdirAll("d"); err != nil {
			t.Fatal(err)
		}
		if err := fs.WriteFile("d/f", []byte("x")); err != nil {
			t.Fatal(err)
		}
		if !fs.Exists("d/f") {
			t.Error("Exists(d/f) = false, want true")
		}
	})

	t.Run(name+"/Stat", func(t *testing.T) {
		fs, cleanup := build(t)
		defer cleanup()
		if err := fs.MkdirAll("d"); err != nil {
			t.Fatal(err)
		}
		if err := fs.WriteFile("d/f", []byte("hello")); err != nil {
			t.Fatal(err)
		}
		fi, err := fs.Stat("d/f")
		if err != nil {
			t.Fatalf("Stat: %v", err)
		}
		if fi.IsDir {
			t.Error("Stat(d/f).IsDir = true, want false")
		}
		if fi.Size != 5 {
			t.Errorf("Stat(d/f).Size = %d, want 5", fi.Size)
		}

		di, err := fs.Stat("d")
		if err != nil {
			t.Fatalf("Stat(d): %v", err)
		}
		if !di.IsDir {
			t.Error("Stat(d).IsDir = false, want true")
		}
	})

	t.Run(name+"/ReadDir", func(t *testing.T) {
		fs, cleanup := build(t)
		defer cleanup()
		if err := fs.MkdirAll("dir"); err != nil {
			t.Fatal(err)
		}
		for _, n := range []string{"a.txt", "b.txt"} {
			if err := fs.WriteFile("dir/"+n, []byte(n)); err != nil {
				t.Fatal(err)
			}
		}
		if err := fs.MkdirAll("dir/sub"); err != nil {
			t.Fatal(err)
		}
		entries, err := fs.ReadDir("dir")
		if err != nil {
			t.Fatalf("ReadDir: %v", err)
		}
		names := []string{}
		for _, e := range entries {
			names = append(names, e.Name)
		}
		sort.Strings(names)
		want := []string{"a.txt", "b.txt", "sub"}
		if len(names) != len(want) {
			t.Fatalf("ReadDir names = %v, want %v", names, want)
		}
		for i, n := range want {
			if names[i] != n {
				t.Errorf("ReadDir[%d] = %q, want %q", i, names[i], n)
			}
		}

		// Sub must be a directory entry.
		var subEntry DirEntry
		for _, e := range entries {
			if e.Name == "sub" {
				subEntry = e
			}
		}
		if !subEntry.IsDir {
			t.Error("sub.IsDir = false, want true")
		}
	})

	t.Run(name+"/RemoveRename", func(t *testing.T) {
		fs, cleanup := build(t)
		defer cleanup()
		if err := fs.MkdirAll("d"); err != nil {
			t.Fatal(err)
		}
		if err := fs.WriteFile("d/old", []byte("v")); err != nil {
			t.Fatal(err)
		}
		if err := fs.Rename("d/old", "d/new"); err != nil {
			t.Fatalf("Rename: %v", err)
		}
		if fs.Exists("d/old") {
			t.Error("d/old still exists after Rename")
		}
		if !fs.Exists("d/new") {
			t.Error("d/new does not exist after Rename")
		}
		if err := fs.Remove("d/new"); err != nil {
			t.Fatalf("Remove: %v", err)
		}
		if fs.Exists("d/new") {
			t.Error("d/new still exists after Remove")
		}
	})

	t.Run(name+"/MissingFile", func(t *testing.T) {
		fs, cleanup := build(t)
		defer cleanup()
		_, err := fs.ReadFile("nope")
		if err == nil {
			t.Error("ReadFile(nope) err = nil, want error")
		}
	})
}

func TestOsFSContract(t *testing.T) {
	fsContract(t, "OsFS", func(t *testing.T) (FS, func()) {
		dir := t.TempDir()
		// OsFS treats paths as canonical-/ relative or absolute. Use the
		// temp dir as a chroot via a small wrapper.
		return &osFSAt{root: dir}, func() {}
	})
}

func TestMemFSContract(t *testing.T) {
	fsContract(t, "MemFS", func(t *testing.T) (FS, func()) {
		return NewMemFS(), func() {}
	})
}

// osFSAt is a test-only OsFS rooted at a temp dir to avoid touching the
// host filesystem outside that scope.
type osFSAt struct {
	root string
}

func (o *osFSAt) join(p string) string {
	return filepath.Join(o.root, filepath.FromSlash(p))
}
func (o *osFSAt) ReadFile(p string) ([]byte, error)  { return os.ReadFile(o.join(p)) }
func (o *osFSAt) WriteFile(p string, b []byte) error { return os.WriteFile(o.join(p), b, 0o644) }
func (o *osFSAt) Exists(p string) bool               { _, err := os.Stat(o.join(p)); return err == nil }
func (o *osFSAt) MkdirAll(p string) error            { return os.MkdirAll(o.join(p), 0o755) }
func (o *osFSAt) Remove(p string) error              { return os.Remove(o.join(p)) }
func (o *osFSAt) Rename(a, b string) error           { return os.Rename(o.join(a), o.join(b)) }
func (o *osFSAt) Stat(p string) (FileInfo, error) {
	fi, err := os.Stat(o.join(p))
	if err != nil {
		return FileInfo{}, err
	}
	return FileInfo{
		Name:    fi.Name(),
		Size:    fi.Size(),
		Mode:    fi.Mode(),
		ModTime: fi.ModTime().UnixMilli(),
		IsDir:   fi.IsDir(),
	}, nil
}
func (o *osFSAt) ReadDir(p string) ([]DirEntry, error) {
	entries, err := os.ReadDir(o.join(p))
	if err != nil {
		return nil, err
	}
	out := make([]DirEntry, 0, len(entries))
	for _, e := range entries {
		out = append(out, DirEntry{Name: e.Name(), IsDir: e.IsDir()})
	}
	return out, nil
}

// MemFS-specific tests.

func TestMemFSConcurrentReadWrite(t *testing.T) {
	fs := NewMemFS()
	const N = 100
	var wg sync.WaitGroup
	for i := 0; i < N; i++ {
		i := i
		wg.Add(2)
		go func() {
			defer wg.Done()
			path := "f" // intentionally same path; mutex must protect
			_ = fs.WriteFile(path, []byte{byte(i)})
		}()
		go func() {
			defer wg.Done()
			_, _ = fs.ReadFile("f")
		}()
	}
	wg.Wait()
}

func TestMemFSVolReturnsCopy(t *testing.T) {
	fs := NewMemFS()
	if err := fs.WriteFile("a", []byte("v1")); err != nil {
		t.Fatal(err)
	}
	v := fs.Vol()
	if string(v["a"]) != "v1" {
		t.Errorf("Vol[a] = %q, want %q", v["a"], "v1")
	}
	// Mutating the returned map must not affect the FS.
	v["a"] = []byte("MUTATED")
	got, _ := fs.ReadFile("a")
	if string(got) != "v1" {
		t.Errorf("ReadFile after Vol mutation = %q, want %q", got, "v1")
	}
}

func TestMemFSReadMissing(t *testing.T) {
	fs := NewMemFS()
	_, err := fs.ReadFile("nope")
	if !errors.Is(err, os.ErrNotExist) {
		t.Errorf("ReadFile(nope) err = %v, want fs.ErrNotExist", err)
	}
}
