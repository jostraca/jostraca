package jostraca

import (
	"sync"
	"time"
)

// dLogEntry is one record in the package-level debug log. Mirrors the
// TS getdlog() entries collected on global.__dlog__.
type dLogEntry struct {
	Tag  string
	File string
	When int64
	Args []any
}

var (
	dLogMu      sync.Mutex
	dLogEntries []dLogEntry
)

// DLog returns a logger bound to a tag and source file. Call Log to
// append; call Entries to read back. Mirrors src/util/basic.ts:685-704
// without the JS-style global side channel — Entries returns a
// snapshot.
type DLog struct {
	tag  string
	file string
}

// NewDLog constructs a tagged logger.
func NewDLog(tag, file string) *DLog {
	return &DLog{tag: tag, file: file}
}

// Log appends an entry. Safe for concurrent use.
func (d *DLog) Log(args ...any) {
	if d == nil {
		return
	}
	dLogMu.Lock()
	defer dLogMu.Unlock()
	dLogEntries = append(dLogEntries, dLogEntry{
		Tag:  d.tag,
		File: d.file,
		When: time.Now().UnixMilli(),
		Args: append([]any(nil), args...),
	})
}

// Entries returns a snapshot of all entries (optionally filtered by
// file). The package buffer is never reset implicitly; callers wanting
// per-Generate isolation should snapshot before and after.
func (d *DLog) Entries(filterFile string) []dLogEntry {
	dLogMu.Lock()
	defer dLogMu.Unlock()
	if filterFile == "" {
		out := make([]dLogEntry, len(dLogEntries))
		copy(out, dLogEntries)
		return out
	}
	var out []dLogEntry
	for _, e := range dLogEntries {
		if e.File == filterFile {
			out = append(out, e)
		}
	}
	return out
}

// dLogReset is internal; tests use it to start with a clean buffer.
func dLogReset() {
	dLogMu.Lock()
	defer dLogMu.Unlock()
	dLogEntries = nil
}

// DLogSnapshot returns the current package-level dlog entries and
// optionally clears them. Convenience for callers that want to flush
// the buffer at end-of-Generate. TS uses a process-global __dlog__
// with the same caveat; cross-Generate calls share the buffer.
func DLogSnapshot(clear bool) []dLogEntry {
	dLogMu.Lock()
	defer dLogMu.Unlock()
	out := make([]dLogEntry, len(dLogEntries))
	copy(out, dLogEntries)
	if clear {
		dLogEntries = nil
	}
	return out
}
