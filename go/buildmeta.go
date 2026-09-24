package jostraca

import (
	"bytes"
	"encoding/json"
	"path"
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

// newBuildMeta loads the previous meta log, as TS's BuildMeta
// constructor does. An unreadable log is not fatal; a refused path is.
func newBuildMeta(fh *fileHandler) (*buildMeta, error) {
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
	if err := bm.load(); err != nil {
		return nil, err
	}
	return bm, nil
}

func (bm *buildMeta) metaPath() string {
	return path.Join(bm.fh.folder, ".jostraca", "jostraca.meta.log")
}

func (bm *buildMeta) gitignorePath() string {
	return path.Join(bm.fh.folder, ".jostraca", ".gitignore")
}

// maxJSTime is the largest absolute epoch-ms a JS Date holds.
const maxJSTime = 8.64e15

// last returns the previous build's epoch-ms. Defaults to -1 when no
// prior meta exists, matching TS BuildMeta default at
// src/build/BuildMeta.ts. Used by FileHandler for conflict-marker
// timestamps.
func (bm *buildMeta) last() int64 {
	if bm == nil || bm.prev == nil {
		return -1
	}
	// Only a value a JS Date can carry, as TS's loadMetaData requires:
	// int64(1e20) is a garbage timestamp.
	if v, ok := bm.prev["last"].(float64); ok && v >= -maxJSTime && v <= maxJSTime {
		return int64(v)
	}
	return -1
}

// load reads the previous meta log through the audited low-level calls,
// as TS's loadMetaData does.
func (bm *buildMeta) load() error {
	metapath := bm.metaPath()
	has, err := bm.fh.existsFile(metapath, "")
	if err != nil || !has {
		return err
	}
	prev, err := bm.fh.loadJSON(metapath, "")
	if err != nil {
		// A truncated or hand-edited meta log must not block generation:
		// the file is bookkeeping, regenerated on every run. Reset to empty
		// rather than carrying a half-decoded map forward. Mirrors the
		// recovery in ts/src/build/BuildMeta.ts.
		bm.fh.st.warn(metaDlog, "meta", "unreadable meta log, continuing with empty state: "+
			metapath+" err="+err.Error())
		prev = map[string]any{}
	}
	bm.prev = prev
	return nil
}

// metaDlog records non-fatal meta-log weirdness.
var metaDlog = NewDLog("jostraca", "buildmeta.go")

// add records one save's entry, as TS's addmeta assigning the key does: a
// path already recorded this run keeps its position and takes the new
// values, so it carries the LAST save's.
func (bm *buildMeta) add(e *metaEntry) {
	if bm == nil {
		return
	}
	if prev, ok := bm.next.byPath[e.Path]; ok {
		*prev = *e
		return
	}
	bm.next.files = append(bm.next.files, e)
	bm.next.byPath[e.Path] = e
}

// done writes the meta file and a sibling .gitignore that excludes the
// meta log and generated/ baseline copies from version control, through
// the same atomic, audited writer as the outputs. A failure writing either
// is returned.
func (bm *buildMeta) done() error {
	if bm == nil {
		return nil
	}

	// Stamp at the end of the build, so a file this run generated is never
	// newer than `last` and the Exclude mtime window only ever catches edits
	// made after the build finished.
	bm.next.last = bm.fh.now()

	if err := bm.fh.saveJSON(bm.metaPath(), bm.encode(), ""); err != nil {
		return err
	}
	if !bm.fh.control.Version {
		return bm.fh.saveFile(bm.gitignorePath(),
			[]byte("\njostraca.meta.log\ngenerated\n"), 0, "")
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

// jsonStr quotes s as JSON.stringify does; encoding/json would escape
// '&', '<', '>' and U+2028/U+2029, which TS writes raw.
func jsonStr(s string) string {
	return jsQuote(s)
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
