package jostraca

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
)

// fileHandler is the only place that touches the filesystem during the
// build phase. Ops in build.go push content through fh.save and fh.copy.
type fileHandler struct {
	fs       FS
	now      func() int64
	folder   string
	when     int64
	audit    *Audit
	existing Existing
	control  Control

	files       Files
	createdDirs map[string]struct{}

	bmeta           *buildMeta
	duplicateFolder string
	maxDepth        int

	// st receives this run's warnings; savedPaths detects a second save
	// of one path.
	st         *jstate
	savedPaths map[string]struct{}

	// filelogged holds, per files kind, the paths already listed.
	filelogged map[string]map[string]struct{}
}

const protectMarker = "JOSTRACA_PROTECT"

// metaFilename is the build meta log's basename. save() never duplicates
// it into the baseline folder (mirrors the guard in TS save()).
const metaFilename = "jostraca.meta.log"

// mergeWhy is the audit breadcrumb per merge outcome, so the `why` trail
// says which fast path (if any) the merge took. Mirrors MERGE_WHY in
// ts/src/build/FileHandler.ts.
var mergeWhy = map[MergeOutcome]string{
	MergeSame:       "merge-same-0",
	MergeClean:      "merge-clean-0",
	MergeUnresolved: "merge-unresolved-0",
	MergeMerged:     "merge-run-0",
}

// modeBits collapses the per-file mode booleans for one save call.
type modeBits struct {
	write    bool
	preserve bool
	present  bool
	diff     bool
	merge    bool
}

func boolOr(p *bool, def bool) bool {
	if p == nil {
		return def
	}
	return *p
}

func (fh *fileHandler) modesFor(isText bool) modeBits {
	if isText {
		return modeBits{
			write:    boolOr(fh.existing.Txt.Write, true),
			preserve: boolOr(fh.existing.Txt.Preserve, false),
			present:  boolOr(fh.existing.Txt.Present, false),
			diff:     boolOr(fh.existing.Txt.Diff, false),
			merge:    boolOr(fh.existing.Txt.Merge, false),
		}
	}
	return modeBits{
		write:    boolOr(fh.existing.Bin.Write, true),
		preserve: boolOr(fh.existing.Bin.Preserve, false),
		present:  boolOr(fh.existing.Bin.Present, false),
	}
}

func newFileHandler(b *buildCtx) (*fileHandler, error) {
	st := b.st
	fs := st.fs
	if fs == nil {
		fs = OsFS{}
	}
	folder := canonFolder(st.folder)
	fh := &fileHandler{
		fs:              fs,
		now:             st.now,
		folder:          folder,
		when:            b.when,
		audit:           &b.audit,
		existing:        st.opts.Existing,
		control:         st.opts.Control,
		createdDirs:     map[string]struct{}{},
		duplicateFolder: path.Join(folder, ".jostraca", "generated"),
		maxDepth:        22,
		st:              st,
		savedPaths:      map[string]struct{}{},
	}
	bm, err := newBuildMeta(fh)
	if err != nil {
		return nil, err
	}
	fh.bmeta = bm
	return fh, nil
}

// canonFolder is the output folder canonicalised once, as TS's canonFolder:
// cleaned, separators folded, and trailing separators stripped except
// from a filesystem root. A folder ending in a backslash kept it through
// filepath.Clean off Windows, and folding it left a trailing slash.
func canonFolder(folder string) string {
	norm := fwd(filepath.Clean(folder))
	if norm == "/" || isDriveKey(norm) && len(norm) == 3 {
		return norm
	}
	if s := strings.TrimRight(norm, "/"); s != "" {
		return s
	}
	return "."
}

// fwd normalises an OUTPUT path to canonical-/ form. A backslash is a
// separator on every platform, as TS's fwd folds it unconditionally;
// filepath.ToSlash does nothing off Windows. Source paths (Fragment and
// Copy `from`) keep their platform meaning and do not come through here.
func fwd(p string) string {
	return strings.ReplaceAll(p, "\\", "/")
}

// canonOutPath is the one canonical form of an output path, TS's canonPath:
// separators folded, `.` and `..` resolved.
func canonOutPath(p string) string {
	return path.Clean(fwd(p))
}

// wstrOf is TS's whence suffix: the whence and a colon, or nothing for an
// absent whence, which "" stands for here.
func wstrOf(whence string) string {
	if whence == "" {
		return ""
	}
	return whence + ":"
}

// save writes content under the configured existing-file mode. whence is
// the calling op's mark, as TS's save(path, content, whence) takes it: it
// reaches the low-level audit tags and not the decision record's.
func (fh *fileHandler) save(p string, content []byte, whence string) error {
	return fh.saveAs(p, content, whence, false, 0, !IsBinExt(canonOutPath(p)))
}

// saveBinary is save for content already KNOWN to be binary, whatever its
// extension says.
//
// Copy sniffs content for NUL bytes so an unlisted extension (.wasm and
// friends) is still treated as binary for templating — but save then
// re-derived the classification from the destination path alone and threw
// that knowledge away. A sniffed binary therefore took the `existing.txt`
// mode set: with txt.diff on, a diff render wrote textual conflict markers
// into binary data, and bin.preserve was ignored entirely.
//
// TS passes whence as save's fourth argument here, so the decision record's
// tag carries it too.
func (fh *fileHandler) saveBinary(p string, content []byte, whence string) error {
	return fh.saveAs(p, content, whence, true, 0, false)
}

// saveMode is save with explicit POSIX permission bits for the target.
// Zero means unset. The bits apply to the target only — the .old/.new
// sidecars and the merge baseline stay at the provider default, since they
// are jostraca's bookkeeping rather than the user's output.
func (fh *fileHandler) saveMode(p string, content []byte, whence string, mode fs.FileMode) error {
	return fh.saveAs(p, content, whence, false, mode, !IsBinExt(canonOutPath(p)))
}

// saveAs is TS's FileHandler.save, step for step: the same branches in the
// same order, the same `why` breadcrumbs, the same low-level calls (each
// one clock sample and one audit entry), and one whenify sample per
// recorded action. tagged says whence was passed as TS's fourth argument,
// which puts it in the decision record's tag.
func (fh *fileHandler) saveAs(
	p string, content []byte, whence string, tagged bool, mode fs.FileMode, isText bool,
) error {
	if p == "" {
		return ErrInvalidPath
	}
	dtag := "FileHandler:save:"
	if tagged {
		dtag += wstrOf(whence)
	}
	p = canonOutPath(p)
	modes := fh.modesFor(isText)
	within := fh.withinFolder(p)
	rpath := fh.relative(p)

	// Two components resolving to one output path is almost always a
	// mistake, and the second silently wins. Mirrors TS save().
	if _, again := fh.savedPaths[p]; again {
		fh.st.warn(fhDlog, "save", "duplicate save, later content wins: "+p)
	} else if fh.savedPaths != nil {
		fh.savedPaths[p] = struct{}{}
	}

	exists := fh.fs.Exists(p)
	write := !exists
	why := []string{"start<" + pick(write, "w", "W") + pick(exists, "x", "X") + ">"}

	meta := &metaEntry{Action: "init", Path: rpath, Exists: exists, Actions: []string{}}
	record := func(action string) {
		meta.Action = action
		fh.whenify(meta)
		meta.Actions = append(meta.Actions, action)
		fh.decision(dtag, meta, why, p)
	}

	// The modes are NOT mutually exclusive: `preserve` runs independently
	// of `diff`/`merge`, and `present` can still fire for a protected file.
	unchanged := false
	final := false

	if exists {
		why = append(why, "exists-0")

		existing, err := fh.loadFile(p, "")
		if err != nil {
			return err
		}
		// Any classification: a binary target carrying the marker is as
		// protected as a text one, as in TS.
		protect := bytes.Contains(existing, []byte(protectMarker))
		meta.Protect = protect
		unchanged = bytes.Equal(existing, content)

		if modes.preserve {
			why = append(why, "preserve-0")
			if protect {
				why = append(why, "protect-0")
				write = false
			} else if !unchanged {
				why = append(why, "content-0")
				if err := fh.copyFile(p, annotatedPath(p, "old"), whence+"preserve:"); err != nil {
					return err
				}
				fh.filelog("preserved", p)
				record("preserve")
			}
		}

		// write wins over present; present is the "write is off" path.
		if modes.write && !protect {
			why = append(why, "write-0")
			write = true
		} else if modes.present {
			why = append(why, "present-0")
			if !unchanged {
				why = append(why, "content-1")
				if err := fh.saveFile(annotatedPath(p, "new"), content, 0, whence+"present:"); err != nil {
					return err
				}
				fh.filelog("presented", p)
				record("present")
			}
		}

		if !protect {
			why = append(why, "not-protect-1")

			if modes.diff {
				why = append(why, "diff-0")
				write = false
				if !unchanged {
					why = append(why, "content-2")
					rendered := Diff(string(content), string(existing), DiffSpec{
						When: fh.when,
						Last: fh.bmeta.last(),
						Kind: "diff",
					}).Content
					if err := fh.saveFile(p, []byte(rendered), mode, whence+"diff"); err != nil {
						return err
					}
					fh.filelog("diffed", p)
					meta.Conflict = rendered != string(content)
					if meta.Conflict {
						fh.filelog("conflicted", p)
					}
					record("diff")
				} else {
					// Equal content is still not a no-op when an explicit
					// mode was asked for — and `write` was already cleared
					// above, so the chmod on the plain-write path below is
					// unreachable from here.
					if fh.chmodUnchanged(p, mode) {
						why = append(why, "chmod-0")
					}
					fh.filelog("unchanged", p)
				}
			} else if modes.merge {
				why = append(why, "merge-0")
				if !unchanged {
					why = append(why, "content-3")
					if fh.control.Duplicate() {
						why = append(why, "duplicate-0")
						dpath := path.Join(fh.duplicateFolder, rpath)
						has, err := fh.existsFile(dpath, "")
						if err != nil {
							return err
						}
						// No baseline: fall through to the write check, as TS
						// does.
						if has {
							why = append(why, "dupexists-0")
							write = false
							if err := fh.saveMerge(p, content, existing, dpath, whence, mode, meta, &why); err != nil {
								return err
							}
							record("merge")
						}
					}
				} else {
					why = append(why, "unchanged-0")
					write = false
					// As in the diff branch: `write` is cleared here, so an
					// explicit mode has to be applied on this path too.
					if fh.chmodUnchanged(p, mode) {
						why = append(why, "chmod-0")
					}
					fh.filelog("unchanged", p)
				}
			}
		}
	}

	if write {
		if unchanged {
			// Byte-identical rewrite: record the intent but do not touch the
			// file, so mtime is not bumped for nothing. Identical bytes are
			// not a complete no-op when an explicit mode was asked for.
			why = append(why, "unchanged-0")
			if fh.chmodUnchanged(p, mode) {
				why = append(why, "chmod-0")
			}
			fh.filelog("unchanged", p)
		} else {
			why = append(why, "write-1")
			if err := fh.saveFile(p, content, mode, whence+"write"); err != nil {
				return err
			}
			fh.filelog("written", p)
		}
		meta.Action = "write"
		meta.Actions = append(meta.Actions, "write")
		fh.whenify(meta)
		final = true
	} else if len(meta.Actions) == 0 {
		// A protected or write-disabled file is not "preserved" or
		// "unchanged"; it simply was not acted on.
		why = append(why, "skip-0")
		meta.Action = "skip"
		meta.Actions = append(meta.Actions, "skip")
		fh.whenify(meta)
		final = true
	}

	if fh.control.Duplicate() {
		why = append(why, "duplicate-1")
		// Only inside the output folder, and never the meta log itself.
		if within && path.Base(p) != metaFilename {
			why = append(why, "within-0")
			if err := fh.writeDuplicate(rpath, content); err != nil {
				return err
			}
		}
	}

	// The write or skip record is the save's last word, so it carries the
	// baseline breadcrumbs too.
	if final {
		fh.decision(dtag, meta, why, p)
	}

	fh.bmeta.add(meta)
	return nil
}

func pick(b bool, yes, no string) string {
	if b {
		return yes
	}
	return no
}

// whenify stamps the entry with one clock sample, as TS's whenify.
func (fh *fileHandler) whenify(m *metaEntry) {
	m.When = fh.now()
}

// decision pushes a save's decision record as a SNAPSHOT of the entry and
// the breadcrumbs so far, in TS's field set. path is the full path.
func (fh *fileHandler) decision(tag string, m *metaEntry, why []string, p string) {
	fh.appendAudit(tag+m.Action, map[string]any{
		"action":   m.Action,
		"path":     p,
		"exists":   m.Exists,
		"actions":  append([]string{}, m.Actions...),
		"protect":  m.Protect,
		"conflict": m.Conflict,
		"when":     m.When,
		"hwhen":    Humanify(m.When, HumanifyFlags{}).(int64),
		"why":      append([]string{}, why...),
	})
}

// withinFolder reports whether p resolves inside the configured output
// folder. Mirrors the guard in TS save().
//
// The comparison is on a separator boundary, not a raw string prefix:
// with folder "/out", the path "/output/x.txt" is *not* inside it.
func (fh *fileHandler) withinFolder(p string) bool {
	switch fh.folder {
	case ".":
		// isAbsFromPath, not isAbsPath: the TS `.` branch guards with
		// Path.isAbsolute, which is platform dispatched. The "/" branch
		// below deliberately stays slash-only, because TS's matching branch
		// is a literal startsWith('/'), not Path.isAbsolute.
		if isAbsFromPath(p) {
			return false
		}
		// "relative" is not the same as "inside". A `..` segment walks OUT
		// of the output folder, and returning true for it let the merge
		// baseline — duplicateFolder joined to the relative path —
		// normalize to a location outside the baseline directory entirely
		// and silently overwrite whatever was there. Mirrors
		// ts/src/build/FileHandler.ts.
		//
		// Backslashes are folded UNCONDITIONALLY, not via filepath.ToSlash.
		// On Windows a leading `..\\` is a real parent reference and must be
		// rejected, and Go's path.Clean is slash-only so it would let one
		// through. TS folds unconditionally (its `fwd` is a plain replace),
		// so matching that keeps the stacks identical on every platform. The
		// cost is rejecting a POSIX filename that genuinely contains a
		// backslash, which only means it gets no merge baseline.
		c := path.Clean(strings.ReplaceAll(p, "\\", "/"))
		return c != ".." && !strings.HasPrefix(c, "../")
	case "/":
		return isAbsPath(p)
	}
	return p == fh.folder || strings.HasPrefix(p, fh.folder+"/")
}

// saveMerge runs a 3-way merge using the duplicate-folder baseline at
// dpath as the common ancestor. The caller only dispatches here when the
// baseline exists.
//
// The diff engine decides the outcome; this never pre-empts it. A file
// still holding an earlier merge's markers (MergeUnresolved) is left
// byte-for-byte untouched, a requested mode still applied, and reported
// merged AND conflicted, as TS does. A clean merge over a file whose
// generated text happens to contain the marker sentinel is written.
func (fh *fileHandler) saveMerge(
	p string, content, existing []byte, dpath, whence string, mode fs.FileMode,
	meta *metaEntry, why *[]string,
) error {
	baseline, err := fh.loadFile(dpath, "")
	if err != nil {
		return err
	}
	res := Merge(string(content), string(baseline), string(existing), DiffSpec{
		When: fh.when,
		Last: fh.bmeta.last(),
		Kind: "merge",
	})
	*why = append(*why, mergeWhy[res.Outcome])

	unresolved := res.Outcome == MergeUnresolved
	if unresolved {
		if fh.chmodUnchanged(p, mode) {
			*why = append(*why, "chmod-0")
		}
	} else if err := fh.saveFile(p, []byte(res.Content), mode, whence+"merge"); err != nil {
		return err
	}
	fh.filelog("merged", p)
	meta.Conflict = res.Conflict || unresolved
	if meta.Conflict {
		fh.filelog("conflicted", p)
	}
	return nil
}

// The low-level methods below are TS's FileHandler methods of the same
// names. Each takes one clock sample and pushes one audit entry tagged
// `FileHandler:<method>:<whence>`, or an `ERROR:` entry carrying err. Paths
// are used as given (already folder-prefixed), never re-joined to the
// folder.

// existsFile is TS's existsFile.
func (fh *fileHandler) existsFile(p, whence string) (bool, error) {
	when := fh.now()
	wstr := wstrOf(whence)
	if err := fh.validPath(p, "FileHandler:existsFile:from:"+wstr); err != nil {
		return false, err
	}
	exists := fh.fs.Exists(canonOutPath(p))
	fh.appendAudit("FileHandler:existsFile:"+wstr, map[string]any{
		"path": p, "when": when, "exists": exists,
	})
	return exists, nil
}

// loadFile is TS's loadFile, reading bytes.
func (fh *fileHandler) loadFile(p, whence string) ([]byte, error) {
	return fh.load(p, canonOutPath(p), whence)
}

// loadSource is TS's loadSource: loadFile for the SOURCE of a copy, read at
// the path as given. A source keeps its platform meaning, so on POSIX a
// backslash in a source name is a name character, not a separator.
func (fh *fileHandler) loadSource(p, whence string) ([]byte, error) {
	return fh.load(p, p, whence)
}

func (fh *fileHandler) load(p, full, whence string) ([]byte, error) {
	when := fh.now()
	wstr := wstrOf(whence)
	if err := fh.validPath(p, "FileHandler:loadFile:"+wstr); err != nil {
		return nil, err
	}
	b, err := fh.fs.ReadFile(full)
	if err != nil {
		fh.appendAudit("ERROR:FileHandler:loadFile:"+wstr, map[string]any{
			"path": p, "when": when, "err": err,
		})
		return nil, &fhError{"FileHandler:loadFile:" + wstr + " path=" + p + " err=", err}
	}
	fh.appendAudit("FileHandler:loadFile:"+wstr, map[string]any{
		"path": p, "when": when, "size": len(b),
	})
	return b, nil
}

// loadJSON is TS's loadJSON. A document that is valid JSON but not an
// object decodes as an empty one, as TS's `json?.last` reads it.
func (fh *fileHandler) loadJSON(p, whence string) (map[string]any, error) {
	when := fh.now()
	wstr := wstrOf(whence)
	b, err := fh.loadFile(p, whence)
	var doc any
	if err == nil {
		err = json.Unmarshal(b, &doc)
	}
	if err != nil {
		fh.appendAudit("ERROR:FileHandler:loadJSON:"+wstr, map[string]any{
			"path": p, "when": when, "err": err,
		})
		return nil, &fhError{"FileHandler:loadJSON:" + wstr + " path=" + p + " err=", err}
	}
	fh.appendAudit("FileHandler:loadJSON:"+wstr, map[string]any{
		"path": p, "when": when, "size": len(b),
	})
	m, _ := doc.(map[string]any)
	if m == nil {
		m = map[string]any{}
	}
	return m, nil
}

// saveFile is TS's saveFile: an atomic write, skipped under a dry run,
// that keeps the target's mode unless mode is given.
func (fh *fileHandler) saveFile(p string, content []byte, mode fs.FileMode, whence string) error {
	when := fh.now()
	wstr := wstrOf(whence)
	if err := fh.validPath(p, "saveFile:"); err != nil {
		return err
	}
	full := canonOutPath(p)
	existed := fh.fs.Exists(full)
	err := fh.ensureDirOf(full)
	if err == nil && !fh.control.Dryrun {
		err = fh.writeAtomicMode(full, content, mode)
	}
	if err != nil {
		fh.appendAudit("ERROR:FileHandler:saveFile:"+wstr, map[string]any{
			"path": full, "when": when, "size": len(content), "err": err,
		})
		return &fhError{"FileHandler:saveFile:" + wstr + " path=" + full + ":", err}
	}
	fh.appendAudit("FileHandler:saveFile:"+wstr, map[string]any{
		"path": full, "when": when, "existed": existed, "size": len(content),
	})
	return nil
}

// saveJSON is TS's saveJSON, over an already encoded document.
func (fh *fileHandler) saveJSON(p string, doc []byte, whence string) error {
	when := fh.now()
	wstr := wstrOf(whence)
	if err := fh.saveFile(p, doc, 0, whence); err != nil {
		fh.appendAudit("ERROR:FileHandler:saveJSON:"+wstr, map[string]any{
			"path": p, "when": when, "err": err,
		})
		return &fhError{"FileHandler:saveJSON:" + wstr + " path=" + p + " err=", err}
	}
	fh.appendAudit("FileHandler:saveJSON:"+wstr, map[string]any{
		"path": p, "when": when, "size": len(doc),
	})
	return nil
}

// copyFile is TS's copyFile: bytes, never decoded, skipped under a dry
// run.
func (fh *fileHandler) copyFile(from, to, whence string) error {
	when := fh.now()
	wstr := wstrOf(whence)
	if err := fh.validPath(from, "FileHandler:copyFile:from:"+wstr); err != nil {
		return err
	}
	if err := fh.validPath(to, "FileHandler:copyFile:to:"+wstr); err != nil {
		return err
	}
	fullto, fullfrom := canonOutPath(to), canonOutPath(from)
	existed := fh.fs.Exists(fullto)
	content, err := fh.fs.ReadFile(fullfrom)
	if err == nil {
		err = fh.ensureDirOf(fullto)
	}
	if err == nil && !fh.control.Dryrun {
		err = fh.writeAtomic(fullto, content)
	}
	if err != nil {
		fh.appendAudit("ERROR:FileHandler:copyFile:"+wstr, map[string]any{
			"topath": to, "frompath": from, "when": when, "err": err,
		})
		return &fhError{"FileHandler:copyFile:" + wstr + " topath=" + to +
			" frompath=" + from + " err=", err}
	}
	fh.appendAudit("FileHandler:copyFile:"+wstr, map[string]any{
		"topath": to, "frompath": from, "when": when, "existed": existed, "size": len(content),
	})
	return nil
}

// copy is TS's copy, for a tree-walk entry with a binary extension: the
// source is read through loadSource, and saved as binary when the source is
// (the SOURCE decides, as in CopyOp).
func (fh *fileHandler) copy(from, to string) error {
	const whence = "copy:"
	raw, err := fh.loadSource(from, whence)
	if err != nil {
		return err
	}
	if IsBinExt(from) || IsBinContent(raw) {
		return fh.saveBinary(to, raw, whence)
	}
	return fh.save(to, raw, whence)
}

// fhError carries TS's message text for a failed low-level call and
// unwraps to the cause.
type fhError struct {
	prefix string
	err    error
}

func (e *fhError) Error() string { return e.prefix + e.err.Error() }
func (e *fhError) Unwrap() error { return e.err }

// pathError is a path the handler refuses, in TS's validPath text.
type pathError struct{ msg string }

func (e *pathError) Error() string { return e.msg }
func (e *pathError) Unwrap() error { return ErrInvalidPath }

// validPath is TS's validPath: an empty path is refused, and so is one
// whose normalised directory has more than maxDepth segments, counted as
// composed, so an absolute folder's own segments count.
func (fh *fileHandler) validPath(p, errmark string) error {
	if p == "" {
		return &pathError{"ERROR:" + errmark + " invalid path, path=" + p}
	}
	if fh.maxDepth > 0 && fh.maxDepth < pathDepth(p) {
		return &pathError{errmark + " path too deep, path=" + p}
	}
	return nil
}

// pathDepth counts the non-empty segments of p's normalised directory, as
// TS does over fwd(Path.normalize(Path.dirname(p))): `.` counts as one.
func pathDepth(p string) int {
	dir := path.Clean(path.Dir(fwd(p)))
	depth := 0
	for _, seg := range strings.Split(dir, "/") {
		if seg != "" {
			depth++
		}
	}
	return depth
}

// relative strips the output folder prefix from p. Matched on a separator
// boundary: a raw string prefix test would treat "/output/x.txt" as living
// under "/out" and yield the bogus relative path "put/x.txt", which then
// becomes a bogus baseline and meta key.
func (fh *fileHandler) relative(p string) string {
	p = fwd(p)
	// Boundary match, not a raw string prefix: TrimPrefix(p, ".") ate the
	// leading dot of `.env`, producing the same relative key as a sibling
	// `env` and collapsing their merge baselines onto one another. See the
	// note in ts/src/build/FileHandler.ts.
	if fh.folder == "." {
		if strings.HasPrefix(p, "./") {
			return strings.TrimLeft(p[1:], "/")
		}
		return p
	}
	if fh.folder == "/" {
		return strings.TrimLeft(p, "/")
	}
	if p == fh.folder {
		return ""
	}
	if strings.HasPrefix(p, fh.folder+"/") {
		return strings.TrimLeft(p[len(fh.folder):], "/")
	}
	return p
}

func (fh *fileHandler) ensureDirOf(p string) error {
	dir := path.Dir(p)
	if dir == "" || dir == "." || dir == "/" {
		return nil
	}
	return fh.ensureFolder(dir)
}

// ensureFolder creates p (treated as a directory path) and all
// missing parents. Cached against fh.createdDirs to avoid repeat
// MkdirAll calls.
func (fh *fileHandler) ensureFolder(p string) error {
	if p == "" || p == "." || p == "/" {
		return nil
	}
	// A dry run creates nothing, directories included. The guard lives here
	// rather than at each call site because every one of them - write,
	// present, diff, merge, the duplicate baseline and BuildMeta.done -
	// called ensureDirOf OUTSIDE its own dryrun guard, so `dryrun: true`
	// wrote no files and still laid down the whole output tree. It was
	// invisible until MemFS.Vol() learned to report directories: the test
	// asserting a dry run writes nothing passed on a volume that could not
	// see them. TS guards its own ensureFolder the same way. See #41.
	if fh.control.Dryrun {
		return nil
	}
	if _, ok := fh.createdDirs[p]; ok {
		return nil
	}
	if err := fh.fs.MkdirAll(p); err != nil {
		return err
	}
	fh.createdDirs[p] = struct{}{}
	return nil
}

// tmpSuffix prefixes the sibling temp file used by writeAtomic.
const tmpSuffix = ".jostraca-tmp"

// tmpPathAttempts is how many candidate temp paths an atomic write may try
// before giving up.
//
// MUST match TMP_PATH_ATTEMPTS in ts/src/build/FileHandler.ts — an
// identical collision schedule has to succeed or fail identically in both
// stacks. The R11 restructure moved the first candidate inside the loop and
// left the bound at 8, quietly dropping Go from 9 tries to 8.
const tmpPathAttempts = 9

// tmpSeq makes each temp path unique within this process.
var tmpSeq uint64

// tmppathFor builds a UNIQUE sibling temp path for an atomic write.
//
// Never a fixed name: a fixed one both destroys a user file that happens
// to sit at it, and lets two concurrent runs sharing an output folder
// publish each other's bytes onto the target while both report success.
// The rename is atomic, but atomicity is worthless if the source is
// shared. pid + counter + random keeps it unique across processes, across
// writes within a process, and across retries. Mirrors `tmppathFor` in
// ts/src/build/FileHandler.ts.
func tmppathFor(p string) string {
	var rnd [4]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		// Randomness is defence in depth here; pid+seq already make the
		// name unique within and across processes on one machine.
		binary.LittleEndian.PutUint32(rnd[:], uint32(atomic.LoadUint64(&tmpSeq)))
	}
	return p + tmpSuffix +
		"-" + strconv.Itoa(os.Getpid()) +
		"-" + strconv.FormatUint(atomic.AddUint64(&tmpSeq, 1), 36) +
		"-" + hex.EncodeToString(rnd[:])
}

// writeAtomic replaces p by writing a sibling temp file and renaming it
// over the target. Rename within a directory is atomic, so a crash or a
// full disk leaves the user's existing file intact rather than truncated
// or half-written. That matters most in merge and diff mode, where the
// file being rewritten holds the user's hand edits.
//
// Rename replaces the inode, so a hard link to the target is broken and
// the new file would otherwise take the provider's default mode — hence
// the best-effort mode copy. Same trade-off git and npm make.
func (fh *fileHandler) writeAtomic(p string, content []byte) error {
	return fh.writeAtomicMode(p, content, 0)
}

// chmodUnchanged applies an explicit mode to a file whose content did not
// chmodBits are the bits os.Chmod honours: the 9 permission bits plus the
// three special bits. Anything outside this mask cannot be applied by a chmod
// and must not take part in the "has the mode changed?" comparison.
const chmodBits = fs.ModePerm | fs.ModeSetuid | fs.ModeSetgid | fs.ModeSticky

// change, and reports whether it did anything.
//
// Best-effort: a provider without Chmod, or a target that vanished, is not
// worth failing the build over. Mirrors ts/src/build/FileHandler.ts.
func (fh *fileHandler) chmodUnchanged(p string, mode fs.FileMode) bool {
	if mode == 0 || fh.control.Dryrun {
		return false
	}
	cf, ok := fh.fs.(chmodFS)
	if !ok {
		return false
	}
	// Compare every bit Chmod can actually set, not just Perm(). Perm() is 9
	// bits, while os.Chmod also honours setuid, setgid and sticky, so a file
	// whose content is unchanged and whose mode went from 0755 to
	// 0755|ModeSetuid compared equal and never got the bit. See
	// docs/design/PARITY_PLAN.md 3.
	if fi, err := fh.fs.Stat(p); err == nil && fi.Mode&chmodBits == mode&chmodBits {
		return false
	}
	if err := cf.Chmod(p, mode); err != nil {
		fh.st.warn(fhDlog, "save", "chmod of unchanged file failed: "+p)
		return false
	}
	return true
}

// writeAtomicMode is writeAtomic with explicit permission bits; zero means
// preserve whatever the target already had.
func (fh *fileHandler) writeAtomicMode(p string, content []byte, mode fs.FileMode) error {
	// A unique name per write — see tmppathFor — created EXCLUSIVELY where
	// the provider supports it, mirroring TS's `wx` flag.
	//
	// The previous shape was `for attempt := 0; Exists(tmp) && attempt < 8`
	// followed by an unconditional WriteFile. Exhausting the retries left
	// the loop with `tmp` last known to EXIST and fell straight through to
	// a truncating write, so the one path that was supposed to protect an
	// occupied file was the path that destroyed it. Exhaustion is now an
	// error, never a write.
	tmp := ""
	var werr error
	xfs, exclusive := fh.fs.(exclusiveFS)

	for attempt := 0; attempt < tmpPathAttempts; attempt++ {
		cand := tmppathFor(p)

		if exclusive {
			werr = xfs.WriteFileExcl(cand, content)
			if werr == nil {
				tmp = cand
				break
			}
			if !errors.Is(werr, fs.ErrExist) {
				// The create may have succeeded and the WRITE failed, so a
				// partial file can be sitting at cand. OsFS.WriteFileExcl
				// cleans up after itself, but a third-party provider need
				// not, and this is the last point that knows the path —
				// the error returns before `tmp` is assigned, so the
				// cleanup below can never see it.
				fh.removeTemp(cand)
				return werr
			}
			continue
		}

		// No exclusive-create: check then write. Racy against another
		// process, but it must still never clobber a path it just saw
		// occupied.
		if fh.fs.Exists(cand) {
			continue
		}
		if err := fh.fs.WriteFile(cand, content); err != nil {
			// WriteFile creates before writing, so a mid-write failure
			// leaves a partial temp file that only this call knows about.
			fh.removeTemp(cand)
			return err
		}
		tmp = cand
		break
	}

	if tmp == "" {
		return fmt.Errorf(
			"jostraca: no free temp path for %s after %d attempts",
			p, tmpPathAttempts)
	}

	// An explicit mode wins; otherwise preserve whatever the target already
	// had, since rename replaces the inode.
	//
	// Best-effort: a provider may stat but not chmod, and losing a
	// permission bit is not worth failing the write over.
	if cf, ok := fh.fs.(chmodFS); ok {
		if mode != 0 {
			_ = cf.Chmod(tmp, mode)
		} else if fi, err := fh.fs.Stat(p); err == nil && !fi.IsDir {
			_ = cf.Chmod(tmp, fi.Mode)
		}
	}

	if err := fh.fs.Rename(tmp, p); err != nil {
		fh.removeTemp(tmp)
		return err
	}
	return nil
}

// removeTemp removes a failed write's temp file, warning when one is left
// behind. Already gone is not a failed cleanup: a create that failed, or an
// OsFS write that cleaned up after itself, left nothing.
func (fh *fileHandler) removeTemp(tmp string) {
	if err := fh.fs.Remove(tmp); err != nil && !errors.Is(err, fs.ErrNotExist) {
		fh.st.warn(fhDlog, "writeFileAtomic", "temp cleanup failed: "+tmp)
	}
}

// writeDuplicate refreshes the merge baseline under
// <folder>/.jostraca/generated.
//
// The baseline is what makes edit-preserving merges possible: if it is
// missing on the next run, save() takes the no-baseline path and
// overwrites the user's edits with generated content. A failure here must
// therefore surface rather than be discarded — a silent failure now is
// data loss on the next run, with nothing in the audit trail connecting
// the two.
// fhDlog records non-fatal FileHandler weirdness, mirroring the dlog in
// ts/src/build/FileHandler.ts.
var fhDlog = NewDLog("jostraca", "filehandler.go")

func (fh *fileHandler) writeDuplicate(rpath string, content []byte) error {
	if fh.control.Dryrun || !fh.control.Duplicate() {
		return nil
	}
	dup := fh.duplicateFolder + "/" + rpath

	// Clamp: withinFolder already gates this, but the baseline root is the
	// one place a stray `..` would do real damage, so containment is
	// re-checked here rather than trusted.
	//
	// Both sides are Cleaned before comparing — duplicateFolder is built as
	// `<folder>/.jostraca/generated`, so for the default folder it is
	// `./.jostraca/generated`, and comparing a cleaned path against that
	// raw prefix rejects everything.
	root := path.Clean(fh.duplicateFolder)
	if cleaned := path.Clean(dup); cleaned != root &&
		!strings.HasPrefix(cleaned, root+"/") {
		fh.st.warn(fhDlog, "save",
			"baseline path escapes the duplicate folder, skipping: "+dup)
		return nil
	}

	if err := fh.ensureDirOf(dup); err != nil {
		return err
	}
	return fh.writeAtomic(dup, content)
}

// filelog lists p under kind at most once, at its first position, as TS's
// filelog does; a repeat is logged.
func (fh *fileHandler) filelog(kind, p string) {
	var slot *[]string
	switch kind {
	case "preserved":
		slot = &fh.files.Preserved
	case "written":
		slot = &fh.files.Written
	case "presented":
		slot = &fh.files.Presented
	case "diffed":
		slot = &fh.files.Diffed
	case "merged":
		slot = &fh.files.Merged
	case "conflicted":
		slot = &fh.files.Conflicted
	case "unchanged":
		slot = &fh.files.Unchanged
	default:
		fh.st.warn(fhDlog, "filelog", "invalid kind: "+kind)
		return
	}
	if fh.filelogged == nil {
		fh.filelogged = map[string]map[string]struct{}{}
	}
	seen := fh.filelogged[kind]
	if seen == nil {
		seen = map[string]struct{}{}
		fh.filelogged[kind] = seen
	}
	if _, dup := seen[p]; dup {
		fh.st.warn(fhDlog, "filelog", kind, "duplicate: "+p)
		return
	}
	seen[p] = struct{}{}
	*slot = append(*slot, p)
}

func (fh *fileHandler) appendAudit(tag string, data map[string]any) {
	*fh.audit = append(*fh.audit, AuditEntry{Tag: tag, Data: data})
}

// annotatedPath rewrites foo/bar.txt → foo/bar.<kind>.txt, used for the
// `.old` (preserve) and `.new` (present) annotations.
//
// A leading-dot name has no extension to split off, so the whole basename
// is the stem: `.env` → `.env.old`, not `.old.env`. Go's path.Ext(".env")
// returns ".env" (the suffix from the final dot, which here is index 0),
// so that case needs an explicit guard. Mirrors annotatedPath in
// ts/src/build/FileHandler.ts, where Node's Path.extname(".env") is ""
// and produces the same result.
func annotatedPath(target, kind string) string {
	dir, base := path.Split(target)
	ext := path.Ext(base)
	// A dot at index 0 marks a dotfile, not an extension separator.
	if ext == base {
		ext = ""
	}
	stem := base[:len(base)-len(ext)]
	return dir + stem + "." + kind + ext
}
