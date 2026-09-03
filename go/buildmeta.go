package jostraca

import (
	"bytes"
	"encoding/json"
	"sort"
)

// buildMeta persists per-output-path metadata to <folder>/.jostraca/.
// Mirrors src/build/BuildMeta.ts. Output JSON ordering matches TS
// exactly (foldername/filename/last/hlast/files at the top level;
// action/path/exists/actions/protect/conflict/when/hwhen per entry)
// so meta files round-trip byte-equal between TS and Go.
type buildMeta struct {
	fh   *fileHandler
	prev map[string]any
	next metaSnapshot
}

type metaSnapshot struct {
	foldername string
	filename   string
	last       int64
	files      []*metaEntry
	byPath     map[string]*metaEntry
}

// metaEntry is one per-file record. Field order in the JSON output
// matches TS literal order.
type metaEntry struct {
	Path     string
	Action   string
	Exists   bool
	Actions  []string
	Protect  bool
	Conflict bool
	When     int64
}

func newBuildMeta(fh *fileHandler) *buildMeta {
	bm := &buildMeta{
		fh: fh,
		next: metaSnapshot{
			foldername: ".jostraca",
			filename:   "jostraca.meta.log",
			// `last` is stamped in done(), at the END of the build, NOT here.
			// Stamping it at construction put it BEFORE every generated file's
			// mtime, so the Options.Exclude window (`mtime > last`, build.go)
			// then skipped the files this build had just written. See
			// docs/design/PARITY_PLAN.md 1.2. Mirrors ts/src/build/BuildMeta.ts done().
			byPath: map[string]*metaEntry{},
		},
	}
	bm.load()
	return bm
}

func (bm *buildMeta) metaPath() string {
	return bm.fh.folder + "/.jostraca/jostraca.meta.log"
}

func (bm *buildMeta) gitignorePath() string {
	return bm.fh.folder + "/.jostraca/.gitignore"
}

// last returns the previous build's epoch-ms. Defaults to -1 when no
// prior meta exists, matching TS BuildMeta default at
// src/build/BuildMeta.ts. Used by FileHandler for conflict-marker
// timestamps.
func (bm *buildMeta) last() int64 {
	if bm == nil || bm.prev == nil {
		return -1
	}
	if v, ok := bm.prev["last"].(float64); ok {
		return int64(v)
	}
	return -1
}

func (bm *buildMeta) load() {
	if bm == nil {
		return
	}
	if !bm.fh.fs.Exists(bm.metaPath()) {
		return
	}
	b, err := bm.fh.fs.ReadFile(bm.metaPath())
	if err != nil {
		return
	}
	bm.prev = map[string]any{}
	if err := json.Unmarshal(b, &bm.prev); err != nil {
		// A truncated or hand-edited meta log must not block generation:
		// the file is bookkeeping, regenerated on every run. Reset to empty
		// rather than carrying a half-decoded map forward. Mirrors the
		// recovery in ts/src/build/BuildMeta.ts.
		metaDlog.Log("meta", "unreadable meta log, continuing with empty state: "+
			bm.metaPath()+" err="+err.Error())
		bm.prev = map[string]any{}
	}
}

// metaDlog records non-fatal meta-log weirdness.
var metaDlog = NewDLog("jostraca", "buildmeta.go")

// recordAction is called by FileHandler each time a save touches a path.
// kind is the action token (write/preserve/present/diff/merge/protect/
// unchanged); the entry's Action is the *primary* action and Actions[]
// records every applied action in order.
// recordProtect flags the entry for rpath as protected. TS sets
// meta.protect once for the whole save() (as soon as the marker is seen),
// independent of which action later fires, so it is applied here at the
// end of save() rather than threaded through every action helper.
func (bm *buildMeta) recordProtect(rpath string, protect bool) {
	if bm == nil || !protect {
		return
	}
	if e, ok := bm.next.byPath[rpath]; ok {
		e.Protect = true
	}
}

func (bm *buildMeta) recordAction(rpath, action string, exists, conflict, protect bool) {
	if bm == nil {
		return
	}
	e, ok := bm.next.byPath[rpath]
	if !ok {
		e = &metaEntry{
			Path:    rpath,
			Action:  action,
			Exists:  exists,
			Actions: []string{},
			When:    bm.fh.now(),
		}
		bm.next.files = append(bm.next.files, e)
		bm.next.byPath[rpath] = e
	}
	e.Action = action
	e.Actions = append(e.Actions, action)
	if conflict {
		e.Conflict = true
	}
	if protect {
		e.Protect = true
	}
}

// done writes the meta file and a sibling .gitignore that excludes
// the meta log and generated/ baseline copies from version control.
func (bm *buildMeta) done() error {
	if bm == nil {
		return nil
	}

	// Stamp at the end of the build, so a file this run generated is never
	// newer than `last` and the Exclude mtime window only ever catches edits
	// made after the build finished.
	bm.next.last = bm.fh.now()

	out := bm.encode()
	if err := bm.fh.ensureDirOf(bm.metaPath()); err != nil {
		return err
	}
	if !bm.fh.control.Dryrun {
		if err := bm.fh.fs.WriteFile(bm.metaPath(), out); err != nil {
			return err
		}
		if !bm.fh.control.Version {
			_ = bm.fh.fs.WriteFile(
				bm.gitignorePath(),
				[]byte("\njostraca.meta.log\ngenerated\n"),
			)
		}
	}
	return nil
}

// encode produces JSON with the exact field order TS uses.
func (bm *buildMeta) encode() []byte {
	now := bm.next.last
	hlast := Humanify(now, HumanifyFlags{}).(int64)

	var buf bytes.Buffer
	buf.WriteString("{\n")
	writeKV := func(key, val string, last bool) {
		buf.WriteString("  ")
		buf.WriteString(jsonStr(key))
		buf.WriteString(": ")
		buf.WriteString(val)
		if !last {
			buf.WriteByte(',')
		}
		buf.WriteByte('\n')
	}
	writeKV("foldername", jsonStr(bm.next.foldername), false)
	writeKV("filename", jsonStr(bm.next.filename), false)
	writeKV("last", jsonNum(now), false)
	writeKV("hlast", jsonNum(hlast), false)

	// files object.
	buf.WriteString("  \"files\": {")
	if len(bm.next.files) == 0 {
		buf.WriteString("}\n")
	} else {
		buf.WriteString("\n")
		paths := make([]string, 0, len(bm.next.files))
		for _, e := range bm.next.files {
			paths = append(paths, e.Path)
		}
		// Preserve insertion order to match TS object-literal ordering.
		// (TS emits in the order keys were added; we follow suit by
		// using the slice rather than the map.)
		_ = sort.IsSorted // referenced to keep import clean
		for i, e := range bm.next.files {
			buf.WriteString("    ")
			buf.WriteString(jsonStr(e.Path))
			buf.WriteString(": {\n")
			hwhen := Humanify(e.When, HumanifyFlags{}).(int64)
			fields := []struct {
				k string
				v string
			}{
				{"action", jsonStr(e.Action)},
				{"path", jsonStr(e.Path)},
				{"exists", jsonBool(e.Exists)},
				{"actions", jsonStrSlice(e.Actions)},
				{"protect", jsonBool(e.Protect)},
				{"conflict", jsonBool(e.Conflict)},
				{"when", jsonNum(e.When)},
				{"hwhen", jsonNum(hwhen)},
			}
			for j, f := range fields {
				buf.WriteString("      ")
				buf.WriteString(jsonStr(f.k))
				buf.WriteString(": ")
				buf.WriteString(f.v)
				if j < len(fields)-1 {
					buf.WriteByte(',')
				}
				buf.WriteByte('\n')
			}
			buf.WriteString("    }")
			if i < len(bm.next.files)-1 {
				buf.WriteByte(',')
			}
			buf.WriteByte('\n')
		}
		buf.WriteString("  }\n")
	}
	buf.WriteString("}")
	return buf.Bytes()
}

func jsonStr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func jsonNum[T int64 | int](n T) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func jsonBool(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func jsonStrSlice(ss []string) string {
	if len(ss) == 0 {
		return "[]"
	}
	var b bytes.Buffer
	b.WriteString("[\n")
	for i, s := range ss {
		b.WriteString("        ")
		b.WriteString(jsonStr(s))
		if i < len(ss)-1 {
			b.WriteByte(',')
		}
		b.WriteByte('\n')
	}
	b.WriteString("      ]")
	return b.String()
}
