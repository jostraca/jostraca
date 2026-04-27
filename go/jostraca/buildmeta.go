package jostraca

import (
	"encoding/json"
	"sort"
)

// buildMeta persists per-output-path metadata to <folder>/.jostraca/.
// Mirrors src/build/BuildMeta.ts.
type buildMeta struct {
	fh   *fileHandler
	prev metaSnapshot
	next metaSnapshot
}

type metaSnapshot struct {
	Foldername string                    `json:"foldername"`
	Filename   string                    `json:"filename"`
	Last       int64                     `json:"last"`
	HLast      string                    `json:"hlast"`
	Files      map[string]map[string]any `json:"files"`
}

func newBuildMeta(fh *fileHandler) *buildMeta {
	bm := &buildMeta{
		fh: fh,
		next: metaSnapshot{
			Foldername: ".jostraca",
			Filename:   "jostraca.meta.log",
			Last:       fh.now(),
			Files:      map[string]map[string]any{},
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
	_ = json.Unmarshal(b, &bm.prev)
}

func (bm *buildMeta) add(file string, meta map[string]any) {
	if bm == nil {
		return
	}
	bm.next.Files[file] = meta
}

// done writes the meta file and a sibling .gitignore that excludes
// the .jostraca/ directory contents from version control.
func (bm *buildMeta) done() error {
	if bm == nil {
		return nil
	}
	bm.next.HLast = "" // Phase 4 deferred Humanify; leave blank for now.

	// Stable JSON output: sort the Files map by key on the way out so
	// .jostraca/jostraca.meta.log diffs cleanly across runs.
	stable := map[string]any{
		"foldername": bm.next.Foldername,
		"filename":   bm.next.Filename,
		"last":       bm.next.Last,
		"hlast":      bm.next.HLast,
		"files":      sortedFiles(bm.next.Files),
	}
	b, err := json.MarshalIndent(stable, "", "  ")
	if err != nil {
		return err
	}
	if err := bm.fh.ensureDirOf(bm.metaPath()); err != nil {
		return err
	}
	if !bm.fh.control.Dryrun {
		if err := bm.fh.fs.WriteFile(bm.metaPath(), b); err != nil {
			return err
		}
		if !bm.fh.control.Version {
			_ = bm.fh.fs.WriteFile(bm.gitignorePath(), []byte("*\n"))
		}
	}
	return nil
}

func sortedFiles(m map[string]map[string]any) map[string]map[string]any {
	out := make(map[string]map[string]any, len(m))
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		out[k] = m[k]
	}
	return out
}
