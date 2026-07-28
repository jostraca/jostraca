package jostraca

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// FS is the read+write filesystem interface used internally. Paths are
// canonical-/ at every callsite; OsFS converts to OS-native at the
// boundary via filepath.FromSlash.
type FS interface {
	ReadFile(path string) ([]byte, error)
	WriteFile(path string, data []byte) error
	Exists(path string) bool
	Stat(path string) (FileInfo, error)
	MkdirAll(path string) error
	ReadDir(path string) ([]DirEntry, error)
	Remove(path string) error
	Rename(oldpath, newpath string) error
}

// realpathFS is an optional capability: a provider that implements it lets
// the copy walk resolve a directory to its canonical path, so a symlink
// and its target compare equal and a cycle can be detected. Providers
// without it (MemFS has no symlinks) fall back to the depth cap.
type realpathFS interface {
	Realpath(path string) (string, error)
}

// chmodFS is an optional capability: a provider that implements it lets
// the atomic write-then-rename preserve an existing target's mode, which
// rename would otherwise drop along with the replaced inode. Providers
// that do not implement it simply keep the default mode.
type chmodFS interface {
	Chmod(path string, mode fs.FileMode) error
}

// exclusiveFS is an optional capability: a provider that implements it can
// create a file ONLY if it does not already exist, the way TS passes the
// `wx` flag to writeFileSync.
//
// The atomic write needs this. Checking Exists and then writing is a
// check-then-act race — another process can create the path in between —
// and, more simply, a check that ends up occupied must not fall through to
// a clobbering write. Providers without the capability get the Exists
// check plus a hard error on exhaustion, which closes the deterministic
// hole even though it cannot close the race.
type exclusiveFS interface {
	WriteFileExcl(path string, data []byte) error
}

// FileInfo is a small subset of os.FileInfo we surface across the FS
// boundary. Times are unix milliseconds for stable JSON serialisation.
type FileInfo struct {
	Name    string
	Size    int64
	Mode    fs.FileMode
	ModTime int64
	IsDir   bool
}

type DirEntry struct {
	Name  string
	IsDir bool
}

// OsFS adapts the host filesystem to the FS interface. Paths are
// converted from canonical-/ to OS-native at the boundary.
type OsFS struct{}

func (OsFS) sys(p string) string { return filepath.FromSlash(p) }

func (o OsFS) ReadFile(p string) ([]byte, error)  { return os.ReadFile(o.sys(p)) }
func (o OsFS) WriteFile(p string, b []byte) error { return os.WriteFile(o.sys(p), b, 0o644) }
func (o OsFS) Exists(p string) bool {
	_, err := os.Stat(o.sys(p))
	return err == nil
}
func (o OsFS) MkdirAll(p string) error { return os.MkdirAll(o.sys(p), 0o755) }

// WriteFileExcl implements exclusiveFS: O_EXCL fails with fs.ErrExist
// rather than truncating an existing file.
func (o OsFS) WriteFileExcl(p string, b []byte) error {
	f, err := os.OpenFile(o.sys(p), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
func (o OsFS) Remove(p string) error { return os.Remove(o.sys(p)) }
func (o OsFS) Chmod(p string, mode fs.FileMode) error {
	return os.Chmod(o.sys(p), mode)
}
func (o OsFS) Realpath(p string) (string, error) {
	r, err := filepath.EvalSymlinks(o.sys(p))
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(r), nil
}
func (o OsFS) Rename(a, b string) error {
	return os.Rename(o.sys(a), o.sys(b))
}
func (o OsFS) Stat(p string) (FileInfo, error) {
	fi, err := os.Stat(o.sys(p))
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
func (o OsFS) ReadDir(p string) ([]DirEntry, error) {
	entries, err := os.ReadDir(o.sys(p))
	if err != nil {
		return nil, err
	}
	out := make([]DirEntry, 0, len(entries))
	for _, e := range entries {
		out = append(out, DirEntry{Name: e.Name(), IsDir: e.IsDir()})
	}
	return out, nil
}

// MemFS is an in-process filesystem backed by a string-keyed map. Safe
// for concurrent use. Paths are canonical-/ throughout.
type MemFS struct {
	mu    sync.RWMutex
	files map[string][]byte
	times map[string]int64
	dirs  map[string]bool
}

// NewMemFS constructs an empty MemFS.
func NewMemFS() *MemFS {
	return &MemFS{
		files: map[string][]byte{},
		times: map[string]int64{},
		dirs:  map[string]bool{},
	}
}

// memClean normalises a memfs path: forward slashes, no trailing /,
// no . or .. segments. Leading / is preserved (matching Node memfs's
// toJSON() output) so absolute paths like "/out/foo" are stored as
// "/out/foo", not "out/foo".
func memClean(p string) string {
	p = filepath.ToSlash(p)
	if p == "" || p == "." {
		return ""
	}
	abs := strings.HasPrefix(p, "/")
	p = strings.TrimLeft(p, "/")
	parts := []string{}
	for _, part := range strings.Split(p, "/") {
		switch part {
		case "", ".":
			continue
		case "..":
			if len(parts) > 0 {
				parts = parts[:len(parts)-1]
			}
		default:
			parts = append(parts, part)
		}
	}
	out := strings.Join(parts, "/")
	if abs {
		out = "/" + out
	}
	return out
}

func (m *MemFS) ReadFile(p string) ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cp := memClean(p)
	b, ok := m.files[cp]
	if !ok {
		return nil, &fs.PathError{Op: "open", Path: p, Err: os.ErrNotExist}
	}
	out := make([]byte, len(b))
	copy(out, b)
	return out, nil
}

// WriteFileExcl implements exclusiveFS: it fails rather than replacing an
// existing entry. The existence test and the store happen under one lock,
// so unlike an Exists-then-Write pair it is genuinely atomic.
func (m *MemFS) WriteFileExcl(p string, data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := memClean(p)
	if _, exists := m.files[cp]; exists {
		return &os.PathError{Op: "open", Path: p, Err: fs.ErrExist}
	}
	return m.writeLocked(cp, data)
}

func (m *MemFS) WriteFile(p string, data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.writeLocked(memClean(p), data)
}

// writeLocked stores data at an already-cleaned path. Caller holds m.mu.
func (m *MemFS) writeLocked(cp string, data []byte) error {
	stored := make([]byte, len(data))
	copy(stored, data)
	m.files[cp] = stored
	m.times[cp] = time.Now().UnixMilli()
	// Implicitly create parent directories.
	if i := strings.LastIndex(cp, "/"); i > 0 {
		m.markDirsLocked(cp[:i])
	}
	return nil
}

func (m *MemFS) Exists(p string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cp := memClean(p)
	if cp == "" {
		return true
	}
	if _, ok := m.files[cp]; ok {
		return true
	}
	return m.dirs[cp]
}

func (m *MemFS) Stat(p string) (FileInfo, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cp := memClean(p)
	if cp == "" {
		return FileInfo{Name: "", IsDir: true, Mode: fs.ModeDir | 0o755}, nil
	}
	if b, ok := m.files[cp]; ok {
		return FileInfo{
			Name:    pathBase(cp),
			Size:    int64(len(b)),
			Mode:    0o644,
			ModTime: m.times[cp],
			IsDir:   false,
		}, nil
	}
	if m.dirs[cp] {
		return FileInfo{
			Name:  pathBase(cp),
			Mode:  fs.ModeDir | 0o755,
			IsDir: true,
		}, nil
	}
	return FileInfo{}, &fs.PathError{Op: "stat", Path: p, Err: os.ErrNotExist}
}

func (m *MemFS) MkdirAll(p string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := memClean(p)
	if cp == "" {
		return nil
	}
	m.markDirsLocked(cp)
	return nil
}

// markDirsLocked records every prefix of p as a directory. Caller must
// hold m.mu (write). Preserves the leading / for absolute paths so the
// stored directory keys match the form ReadDir/Stat will lookup with.
func (m *MemFS) markDirsLocked(p string) {
	if p == "" || p == "/" {
		return
	}
	abs := strings.HasPrefix(p, "/")
	inner := strings.TrimLeft(p, "/")
	if inner == "" {
		return
	}
	cur := ""
	for i, part := range strings.Split(inner, "/") {
		if i == 0 {
			if abs {
				cur = "/" + part
			} else {
				cur = part
			}
		} else {
			cur = cur + "/" + part
		}
		m.dirs[cur] = true
	}
}

func (m *MemFS) ReadDir(p string) ([]DirEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cp := memClean(p)
	if cp != "" && !m.dirs[cp] {
		return nil, &fs.PathError{Op: "readdir", Path: p, Err: os.ErrNotExist}
	}
	prefix := cp
	if prefix != "" {
		prefix += "/"
	}
	seen := map[string]DirEntry{}
	for f := range m.files {
		if !strings.HasPrefix(f, prefix) {
			continue
		}
		rest := f[len(prefix):]
		if rest == "" {
			continue
		}
		name := rest
		isDir := false
		if i := strings.Index(rest, "/"); i >= 0 {
			name = rest[:i]
			isDir = true
		}
		if _, ok := seen[name]; !ok {
			seen[name] = DirEntry{Name: name, IsDir: isDir}
		}
	}
	for d := range m.dirs {
		if !strings.HasPrefix(d, prefix) {
			continue
		}
		rest := d[len(prefix):]
		if rest == "" {
			continue
		}
		name := rest
		if i := strings.Index(rest, "/"); i >= 0 {
			name = rest[:i]
		}
		if _, ok := seen[name]; !ok {
			seen[name] = DirEntry{Name: name, IsDir: true}
		}
	}
	names := make([]string, 0, len(seen))
	for n := range seen {
		names = append(names, n)
	}
	sort.Strings(names)
	out := make([]DirEntry, 0, len(names))
	for _, n := range names {
		out = append(out, seen[n])
	}
	return out, nil
}

func (m *MemFS) Remove(p string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := memClean(p)
	if _, ok := m.files[cp]; ok {
		delete(m.files, cp)
		delete(m.times, cp)
		return nil
	}
	if m.dirs[cp] {
		// Refuse to remove non-empty dirs to mirror os.Remove semantics.
		prefix := cp + "/"
		for f := range m.files {
			if strings.HasPrefix(f, prefix) {
				return &fs.PathError{Op: "remove", Path: p, Err: errors.New("directory not empty")}
			}
		}
		for d := range m.dirs {
			if d != cp && strings.HasPrefix(d, prefix) {
				return &fs.PathError{Op: "remove", Path: p, Err: errors.New("directory not empty")}
			}
		}
		delete(m.dirs, cp)
		return nil
	}
	return &fs.PathError{Op: "remove", Path: p, Err: os.ErrNotExist}
}

func (m *MemFS) Rename(oldpath, newpath string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	o := memClean(oldpath)
	n := memClean(newpath)
	b, ok := m.files[o]
	if !ok {
		return &fs.PathError{Op: "rename", Path: oldpath, Err: os.ErrNotExist}
	}
	delete(m.files, o)
	t := m.times[o]
	delete(m.times, o)
	m.files[n] = b
	m.times[n] = t
	if i := strings.LastIndex(n, "/"); i > 0 {
		m.markDirsLocked(n[:i])
	}
	return nil
}

// Vol returns a defensive copy of the underlying file map. Mutating the
// returned map does not affect the MemFS.
func (m *MemFS) Vol() map[string][]byte {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make(map[string][]byte, len(m.files))
	for k, v := range m.files {
		dup := make([]byte, len(v))
		copy(dup, v)
		out[k] = dup
	}
	return out
}

func pathBase(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}
