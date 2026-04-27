package jostraca

import "io/fs"

// FS is the read+write filesystem interface used internally. The full
// implementation (OsFS, MemFS) lands in Phase 2; for Phase 1 only the
// type needs to exist so Options.FS compiles.
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
