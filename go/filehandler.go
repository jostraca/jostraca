package jostraca

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
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

func newFileHandler(b *buildCtx) *fileHandler {
	st := b.st
	fs := st.fs
	if fs == nil {
		fs = OsFS{}
	}
	folder := fwd(filepath.Clean(st.folder))
	if folder == "" {
		folder = "."
	}
	dup := folder + "/.jostraca/generated"
	fh := &fileHandler{
		fs:              fs,
		now:             st.now,
		folder:          folder,
		when:            b.when,
		audit:           &b.audit,
		existing:        st.opts.Existing,
		control:         st.opts.Control,
		createdDirs:     map[string]struct{}{},
		duplicateFolder: dup,
		maxDepth:        22,
	}
	fh.bmeta = newBuildMeta(fh)
	return fh
}

// fwd normalises a path to canonical-/ form. (`filepath.ToSlash` only
// affects Windows; safe to apply unconditionally.)
func fwd(p string) string {
	return filepath.ToSlash(p)
}

// save writes content under the configured existing-file mode.
func (fh *fileHandler) save(p string, content []byte, whence string) error {
	return fh.saveMode(p, content, whence, 0)
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
// TS does not need this because its Buffer-vs-string argument type carries
// the bit; Go's []byte cannot, so it is an explicit parameter.
func (fh *fileHandler) saveBinary(p string, content []byte, whence string) error {
	return fh.saveClassified(p, content, whence, 0, false)
}

// saveMode is save with explicit POSIX permission bits for the target.
// Zero means unset. The bits apply to the target only — the .old/.new
// sidecars and the merge baseline stay at the provider default, since they
// are jostraca's bookkeeping rather than the user's output.
func (fh *fileHandler) saveMode(p string, content []byte, whence string, mode fs.FileMode) error {
	return fh.saveClassified(p, content, whence, mode, !IsBinExt(p))
}

// saveClassified is saveMode with the text/binary decision supplied rather
// than derived from the path. See saveBinary.
func (fh *fileHandler) saveClassified(
	p string, content []byte, whence string, mode fs.FileMode, isText bool,
) error {
	if p == "" {
		return ErrInvalidPath
	}
	p = fwd(p)
	rpath := fh.relative(p)
	modes := fh.modesFor(isText)

	exists := fh.fs.Exists(p)
	// why captures the mode-dispatch breadcrumbs accumulated during this
	// save. Mirrors the `why` array in TS at src/build/FileHandler.ts:162+.
	why := []string{}
	wTag := "wW"
	if modes.write {
		wTag = "w" + wTag[1:]
	}
	xTag := "X"
	if exists {
		xTag = "x"
	}
	why = append(why, "start<"+wTag[:1]+xTag+">")

	// Mirrors the block order of TS save() at src/build/FileHandler.ts:175+.
	// The modes are NOT mutually exclusive: `preserve` runs independently of
	// `diff`/`merge`, and `present` can still fire for a protected file.
	// Structuring these as early returns (as this used to) silently dropped
	// the backup whenever preserve was combined with diff or merge.
	write := !exists
	actions := 0

	var existing []byte
	protect := false
	contentEqual := false

	if exists {
		why = append(why, "exists-0")

		var err error
		existing, err = fh.fs.ReadFile(p)
		if err != nil {
			return err
		}
		if isText {
			protect = bytes.Contains(existing, []byte(protectMarker))
		}
		contentEqual = bytes.Equal(existing, content)

		// preserve: keep a .old.<ext> copy of what is being replaced.
		if modes.preserve {
			why = append(why, "preserve-0")
			if protect {
				why = append(why, "protect-0")
				write = false
			} else if !contentEqual {
				why = append(why, "content-0")
				if err := fh.savePreserveBackup(p, existing, rpath, whence); err != nil {
					return err
				}
				actions++
			}
		}

		// write wins over present; present is the "write is off" path.
		if modes.write && !protect {
			why = append(why, "write-0")
			write = true
		} else if modes.present {
			why = append(why, "present-0")
			if !contentEqual {
				why = append(why, "content-1")
				if err := fh.savePresent(p, content, rpath, whence, why); err != nil {
					return err
				}
				actions++
			}
		}

		if !protect {
			why = append(why, "not-protect-1")

			if isText && modes.diff {
				why = append(why, "diff-0")
				write = false
				if !contentEqual {
					why = append(why, "content-2")
					if err := fh.saveDiff(p, content, existing, rpath, whence, why, mode); err != nil {
						return err
					}
					actions++
				} else {
					// Equal content is still not a no-op when an explicit
					// mode was asked for — and `write` was already cleared
					// above, so the chmod on the plain-write path below is
					// unreachable from here.
					if fh.chmodUnchanged(p, mode) {
						why = append(why, "chmod-0")
					}
					fh.filelog(&fh.files.Unchanged, p)
				}
			} else if isText && modes.merge {
				why = append(why, "merge-0")
				if !contentEqual {
					why = append(why, "content-3")
					if fh.control.Duplicate() {
						why = append(why, "duplicate-0")
						dpath := fh.duplicateFolder + "/" + rpath
						if fh.fs.Exists(dpath) {
							why = append(why, "dupexists-0")
							write = false
							if err := fh.saveMerge(p, content, existing, rpath, whence, why, mode); err != nil {
								return err
							}
							actions++
						} else {
							// No baseline: TS leaves the merge block silently
							// and falls through to the regular write check.
							why = append(why, "no-baseline-0")
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
					fh.filelog(&fh.files.Unchanged, p)
				}
			}
		}
	}

	// Decide the duplicate baseline before emitting the write/skip audit, so
	// that entry carries the same breadcrumbs TS records. (TS pushes these
	// after the audit entry, but its entries alias one shared `why` array,
	// so they end up with the full set either way.)
	dup := false
	if fh.control.Duplicate() {
		why = append(why, "duplicate-1")
		// TS guards the baseline on the path being inside the output folder
		// and not being the meta log itself; without that a path resolved
		// outside the folder produces a nonsense baseline location.
		if fh.withinFolder(p) && path.Base(p) != metaFilename {
			why = append(why, "within-0")
			dup = true
		}
	}

	if write {
		if exists && contentEqual {
			// Byte-identical rewrite: record the intent but do not touch the
			// file, so mtime is not bumped for nothing.
			why = append(why, "unchanged-0")

			// Identical bytes are not a complete no-op when an explicit
			// mode was asked for — see the TS counterpart.
			if fh.chmodUnchanged(p, mode) {
				why = append(why, "chmod-0")
			}

			fh.filelog(&fh.files.Unchanged, p)
			fh.appendAudit("save:write", map[string]any{
				"action": "write", "path": rpath, "size": len(content),
				"whence": whence, "why": why, "exists": exists,
				"actions": []string{"write"},
			})
			if fh.bmeta != nil {
				fh.bmeta.recordAction(rpath, "write", exists, false, false)
			}
		} else {
			why = append(why, "write-1")
			if err := fh.write(p, content, rpath, whence, exists, why, mode); err != nil {
				return err
			}
		}
		actions++
	} else if actions == 0 {
		// TS records the skip in the audit and the meta log but adds nothing
		// to any files.* list — a protected or write-disabled file is not
		// "preserved" or "unchanged", it simply was not acted on.
		why = append(why, "skip-0")
		fh.appendAudit("save:skip", map[string]any{
			"action": "skip", "path": rpath, "whence": whence, "why": why,
			"exists": exists, "actions": []string{"skip"},
		})
		if fh.bmeta != nil {
			fh.bmeta.recordAction(rpath, "skip", exists, false, protect)
		}
	}

	fh.bmeta.recordProtect(rpath, protect)

	if dup {
		return fh.writeDuplicate(rpath, content)
	}
	return nil
}

// withinFolder reports whether p resolves inside the configured output
// folder. Mirrors the guard in TS save().
//
// The comparison is on a separator boundary, not a raw string prefix:
// with folder "/out", the path "/output/x.txt" is *not* inside it.
func (fh *fileHandler) withinFolder(p string) bool {
	switch fh.folder {
	case ".":
		if isAbsPath(p) {
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

func (fh *fileHandler) write(p string, content []byte, rpath, whence string, exists bool, why []string, mode fs.FileMode) error {
	if err := fh.ensureDirOf(p); err != nil {
		return err
	}
	if !fh.control.Dryrun {
		if err := fh.writeAtomicMode(p, content, mode); err != nil {
			return err
		}
	}
	fh.filelog(&fh.files.Written, p)
	fh.appendAudit("save:write", map[string]any{
		"action":  "write",
		"path":    rpath,
		"size":    len(content),
		"whence":  whence,
		"why":     why,
		"exists":  exists,
		"actions": []string{"write"},
	})
	if fh.bmeta != nil {
		fh.bmeta.recordAction(rpath, "write", exists, false, false)
	}
	return nil
}

func (fh *fileHandler) savePresent(p string, content []byte, rpath, whence string, why []string) error {
	out := annotatedPath(p, "new")
	if err := fh.ensureDirOf(out); err != nil {
		return err
	}
	if !fh.control.Dryrun {
		if err := fh.writeAtomic(out, content); err != nil {
			return err
		}
	}
	fh.filelog(&fh.files.Presented, out)
	fh.appendAudit("save:present", map[string]any{
		"action":  "present",
		"path":    rpath,
		"out":     fh.relative(out),
		"whence":  whence,
		"why":     why,
		"exists":  true,
		"actions": []string{"present"},
	})
	if fh.bmeta != nil {
		fh.bmeta.recordAction(rpath, "present", true, false, false)
	}
	return nil
}

// saveMerge runs a 3-way merge using the duplicate-folder baseline as
// the common ancestor. The caller (save()) only dispatches here when a
// baseline file exists; the no-baseline fall-through path is handled
// before dispatch and ends in the regular write logic, mirroring TS at
// FileHandler.ts:282-336.
//
// Skip semantics: if existing already contains conflict markers from
// a previous unresolved merge, the file is left untouched (TS
// "merge-unresolved" action at FileHandler.ts:429-433). The duplicate
// baseline is still refreshed so a future user-resolution can merge
// cleanly.
func (fh *fileHandler) saveMerge(p string, content, existing []byte, rpath, whence string, why []string, mode fs.FileMode) error {
	if HasConflicts(string(existing)) {
		// Existing has unresolved markers; do not re-merge. The baseline is
		// still refreshed by save()'s centralised duplicate write, so a
		// future user-resolution merges cleanly.
		fh.appendAudit("save:skip", map[string]any{
			"action":  "skip",
			"path":    rpath,
			"whence":  whence,
			"why":     append(why, "merge-unresolved-0"),
			"exists":  true,
			"actions": []string{"skip"},
		})
		if fh.bmeta != nil {
			fh.bmeta.recordAction(rpath, "skip", true, false, false)
		}
		return nil
	}
	dpath := fh.duplicateFolder + "/" + rpath
	// saveMerge is only entered when a baseline exists; the no-baseline
	// fall-through is handled in save() before dispatch.
	baseline, err := fh.fs.ReadFile(dpath)
	if err != nil {
		return err
	}
	// The fast paths and the choice between them live in the diff engine,
	// which reports an Outcome; record it as a breadcrumb.
	res := Merge(string(content), string(baseline), string(existing), DiffSpec{
		When: fh.when,
		Last: fh.bmeta.last(),
		Kind: "merge",
	})
	why = append(why, mergeWhy[res.Outcome])

	if err := fh.ensureDirOf(p); err != nil {
		return err
	}
	if !fh.control.Dryrun {
		// Forward the requested mode, as the TS branch does via modeopts().
		// These used to call writeAtomic, so an explicit FileProps.Mode was
		// silently dropped whenever merge or diff handled the file.
		if err := fh.writeAtomicMode(p, []byte(res.Content), mode); err != nil {
			return err
		}
	}
	fh.filelog(&fh.files.Merged, p)
	if res.Conflict {
		fh.filelog(&fh.files.Conflicted, p)
	}
	fh.appendAudit("save:merge", map[string]any{
		"action":   "merge",
		"path":     rpath,
		"conflict": res.Conflict,
		"whence":   whence,
		"why":      why,
		"exists":   true,
		"actions":  []string{"merge"},
	})
	if fh.bmeta != nil {
		fh.bmeta.recordAction(rpath, "merge", true, res.Conflict, false)
	}
	return nil
}

func (fh *fileHandler) saveDiff(p string, content, existing []byte, rpath, whence string, why []string, mode fs.FileMode) error {
	last := int64(0)
	if fh.bmeta != nil {
		last = fh.bmeta.last()
	}
	rendered := []byte(Diff(string(content), string(existing), DiffSpec{
		When: fh.when,
		Last: last,
		Kind: "diff",
	}).Content)
	if err := fh.ensureDirOf(p); err != nil {
		return err
	}
	// TS overwrites the target file with the rendered diff content;
	// no .diff.<ext> sidecar.
	if !fh.control.Dryrun {
		// Forward the requested mode, as the TS branch does via modeopts().
		if err := fh.writeAtomicMode(p, rendered, mode); err != nil {
			return err
		}
	}
	conflict := !bytes.Equal(rendered, content)
	fh.filelog(&fh.files.Diffed, p)
	if conflict {
		fh.filelog(&fh.files.Conflicted, p)
	}
	fh.appendAudit("save:diff", map[string]any{
		"action":   "diff",
		"path":     rpath,
		"conflict": conflict,
		"whence":   whence,
		"why":      why,
		"exists":   true,
		"actions":  []string{"diff"},
	})
	if fh.bmeta != nil {
		fh.bmeta.recordAction(rpath, "diff", true, conflict, false)
	}
	return nil
}

// savePreserveBackup writes the .old.<ext> copy of `existing` and
// records the preserve action. The caller is responsible for the
// subsequent `write` of new content.
func (fh *fileHandler) savePreserveBackup(p string, existing []byte, rpath, whence string) error {
	backup := annotatedPath(p, "old")
	if !fh.control.Dryrun {
		if err := fh.ensureDirOf(backup); err != nil {
			return err
		}
		if err := fh.writeAtomic(backup, existing); err != nil {
			return err
		}
	}
	fh.filelog(&fh.files.Preserved, backup)
	fh.appendAudit("preserve", map[string]any{
		"path":   rpath,
		"backup": fh.relative(backup),
		"whence": whence,
	})
	if fh.bmeta != nil {
		fh.bmeta.recordAction(rpath, "preserve", true, false, false)
	}
	return nil
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
	if fi, err := fh.fs.Stat(p); err == nil && fi.Mode.Perm() == mode.Perm() {
		return false
	}
	return cf.Chmod(p, mode) == nil
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
				_ = fh.fs.Remove(cand)
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
			_ = fh.fs.Remove(cand)
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
		_ = fh.fs.Remove(tmp)
		return err
	}
	return nil
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
		fhDlog.Log("save",
			"baseline path escapes the duplicate folder, skipping: "+dup)
		return nil
	}

	if err := fh.ensureDirOf(dup); err != nil {
		return err
	}
	return fh.writeAtomic(dup, content)
}

func (fh *fileHandler) filelog(slot *[]string, rpath string) {
	*slot = append(*slot, rpath)
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
