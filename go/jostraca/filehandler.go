package jostraca

import (
	"bytes"
	"path"
	"path/filepath"
	"strings"
	"time"
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
	if p == "" {
		return ErrInvalidPath
	}
	p = fwd(p)
	rpath := fh.relative(p)
	isText := !IsBinExt(p)
	modes := fh.modesFor(isText)

	exists := fh.fs.Exists(p)
	// New file: simple write (modes.write == true is implied by default).
	if !exists {
		return fh.write(p, content, rpath, whence, false)
	}

	existing, err := fh.fs.ReadFile(p)
	if err != nil {
		return err
	}

	if isText && bytes.Contains(existing, []byte(protectMarker)) {
		fh.filelog(&fh.files.Preserved, rpath)
		fh.appendAudit("protect", map[string]any{"path": rpath, "whence": whence})
		if fh.bmeta != nil {
			fh.bmeta.recordAction(rpath, "skip", exists, false, true)
		}
		// TS still writes the duplicate baseline even when protected.
		if !fh.control.Dryrun && fh.control.Duplicate() {
			dup := fh.duplicateFolder + "/" + rpath
			_ = fh.ensureDirOf(dup)
			_ = fh.fs.WriteFile(dup, content)
		}
		return nil
	}

	contentEqual := bytes.Equal(existing, content)

	// merge and diff are exclusive write paths.
	if isText && modes.merge {
		return fh.saveMerge(p, content, existing, rpath, whence)
	}
	if isText && modes.diff {
		return fh.saveDiff(p, content, existing, rpath, whence)
	}

	// preserve: write the .old.<ext> backup before falling through to write.
	if modes.preserve && !contentEqual {
		if err := fh.savePreserveBackup(p, existing, rpath, whence); err != nil {
			return err
		}
	}
	// present: write the .new.<ext> sidecar when write is OFF.
	if modes.present && !modes.write {
		return fh.savePresent(p, content, rpath, whence)
	}

	// Default: overwrite (or write new). When content is equal we still
	// record a write intent (matches TS) but skip the actual fs call.
	if modes.write {
		if contentEqual {
			fh.filelog(&fh.files.Unchanged, rpath)
			fh.appendAudit("unchanged", map[string]any{"path": rpath, "whence": whence})
			if fh.bmeta != nil {
				fh.bmeta.recordAction(rpath, "write", exists, false, false)
			}
			// Still keep the duplicate baseline current.
			if !fh.control.Dryrun && fh.control.Duplicate() {
				dup := fh.duplicateFolder + "/" + rpath
				_ = fh.ensureDirOf(dup)
				_ = fh.fs.WriteFile(dup, content)
			}
			return nil
		}
		return fh.write(p, content, rpath, whence, exists)
	}
	fh.filelog(&fh.files.Unchanged, rpath)
	return nil
}

func (fh *fileHandler) write(p string, content []byte, rpath, whence string, exists bool) error {
	if err := fh.ensureDirOf(p); err != nil {
		return err
	}
	if !fh.control.Dryrun {
		if err := fh.fs.WriteFile(p, content); err != nil {
			return err
		}
		// Side-write a duplicate copy for next-run merge baseline.
		if fh.control.Duplicate() {
			dup := fh.duplicateFolder + "/" + rpath
			_ = fh.ensureDirOf(dup)
			_ = fh.fs.WriteFile(dup, content)
		}
	}
	fh.filelog(&fh.files.Written, rpath)
	fh.appendAudit("save", map[string]any{
		"path":   rpath,
		"size":   len(content),
		"whence": whence,
	})
	if fh.bmeta != nil {
		fh.bmeta.recordAction(rpath, "write", exists, false, false)
	}
	return nil
}

func (fh *fileHandler) savePresent(p string, content []byte, rpath, whence string) error {
	out := annotatedPath(p, "new")
	if err := fh.ensureDirOf(out); err != nil {
		return err
	}
	if !fh.control.Dryrun {
		if err := fh.fs.WriteFile(out, content); err != nil {
			return err
		}
	}
	fh.filelog(&fh.files.Presented, fh.relative(out))
	fh.appendAudit("present", map[string]any{"path": rpath, "out": fh.relative(out), "whence": whence})
	if fh.bmeta != nil {
		fh.bmeta.recordAction(rpath, "present", true, false, false)
	}
	return nil
}

// saveMerge runs a 3-way merge using the duplicate-folder baseline as
// the common ancestor. If no baseline exists (first generation, or
// duplicate disabled), saveMerge falls back to a 2-way diff render.
func (fh *fileHandler) saveMerge(p string, content, existing []byte, rpath, whence string) error {
	dpath := fh.duplicateFolder + "/" + rpath
	var baseline []byte
	if fh.fs.Exists(dpath) {
		var err error
		baseline, err = fh.fs.ReadFile(dpath)
		if err != nil {
			return err
		}
	} else {
		// No baseline: degrade to 2-way diff.
		return fh.saveDiff(p, content, existing, rpath, whence)
	}
	isoWhen := time.UnixMilli(fh.when).UTC().Format("2006-01-02T15:04:05.000Z")
	isoLast := time.UnixMilli(fh.bmeta.last()).UTC().Format("2006-01-02T15:04:05.000Z")
	res := merge3Labelled(content, baseline, existing, mergeLabels{
		A: "GENERATED: " + isoWhen + "/merge",
		B: "EXISTING: " + isoLast + "/merge",
	})
	if err := fh.ensureDirOf(p); err != nil {
		return err
	}
	if !fh.control.Dryrun {
		if err := fh.fs.WriteFile(p, res.Content); err != nil {
			return err
		}
		if fh.control.Duplicate() {
			dup := fh.duplicateFolder + "/" + rpath
			_ = fh.ensureDirOf(dup)
			_ = fh.fs.WriteFile(dup, content)
		}
	}
	fh.filelog(&fh.files.Merged, rpath)
	if res.Conflict {
		fh.filelog(&fh.files.Conflicted, rpath)
	}
	fh.appendAudit("merge", map[string]any{
		"path":     rpath,
		"conflict": res.Conflict,
		"whence":   whence,
	})
	if fh.bmeta != nil {
		fh.bmeta.recordAction(rpath, "merge", true, res.Conflict, false)
	}
	return nil
}

func (fh *fileHandler) saveDiff(p string, content, existing []byte, rpath, whence string) error {
	rendered := renderDiff(content, existing)
	out := annotatedPath(p, "diff")
	if err := fh.ensureDirOf(out); err != nil {
		return err
	}
	if !fh.control.Dryrun {
		if err := fh.fs.WriteFile(out, rendered); err != nil {
			return err
		}
	}
	fh.filelog(&fh.files.Diffed, fh.relative(out))
	if !bytes.Equal(rendered, content) {
		fh.filelog(&fh.files.Conflicted, rpath)
	}
	conflict := !bytes.Equal(rendered, content)
	fh.appendAudit("diff", map[string]any{
		"path":   rpath,
		"out":    fh.relative(out),
		"whence": whence,
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
		if err := fh.fs.WriteFile(backup, existing); err != nil {
			return err
		}
	}
	fh.filelog(&fh.files.Preserved, fh.relative(backup))
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

func (fh *fileHandler) savePreserve(p string, content, existing []byte, rpath, whence string) error {
	if err := fh.savePreserveBackup(p, existing, rpath, whence); err != nil {
		return err
	}
	if !fh.control.Dryrun {
		if err := fh.fs.WriteFile(p, content); err != nil {
			return err
		}
	}
	fh.filelog(&fh.files.Written, rpath)
	if fh.bmeta != nil {
		fh.bmeta.recordAction(rpath, "write", true, false, false)
	}
	return nil
}

func (fh *fileHandler) relative(p string) string {
	p = fwd(p)
	if strings.HasPrefix(p, fh.folder) {
		rest := p[len(fh.folder):]
		return strings.TrimLeft(rest, "/")
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

func (fh *fileHandler) filelog(slot *[]string, rpath string) {
	*slot = append(*slot, rpath)
}

func (fh *fileHandler) appendAudit(tag string, data map[string]any) {
	*fh.audit = append(*fh.audit, AuditEntry{Tag: tag, Data: data})
}

// annotatedPath rewrites foo/bar.txt → foo/bar.<kind>.txt (kind without
// surrounding dots).
func annotatedPath(target, kind string) string {
	dir, base := path.Split(target)
	ext := path.Ext(base)
	name := base
	if ext != "" {
		name = base[:len(base)-len(ext)]
		ext = ext[1:] // drop the leading dot
	}
	if ext == "" {
		return dir + name + "." + kind
	}
	return dir + name + "." + kind + "." + ext
}
