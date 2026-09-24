package jostraca

import (
	"strings"
	"testing"
)

// A cmp.Copy.ignore string is a regular expression source, applied to the
// Copy walk as a compiled pattern is. TS twin:
// a-string-ignore-entry-is-a-regexp-source in ts/test/generate.test.ts.
func TestOptionsFromMapIgnoreStringAppliesToCopy(t *testing.T) {
	o, err := OptionsFromMap(map[string]any{
		"cmp": map[string]any{"Copy": map[string]any{"ignore": []any{`\.log$`}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	res, err := New(func(g *Options) { *g = o }, WithMem(), WithFolder("/out"),
		WithVol(map[string][]byte{"/src/keep.txt": []byte("K"), "/src/skip.log": []byte("S")}),
		WithNow(func() int64 { return 1735689600000 })).
		Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) { j.CopyFiles(CopyFilesProps{From: "/src"}) })
		})
	if err != nil {
		t.Fatal(err)
	}
	vol := res.Vol()
	if _, ok := vol["/out/keep.txt"]; !ok {
		t.Errorf("keep.txt was not copied: %v", keysOf(vol))
	}
	if _, ok := vol["/out/skip.log"]; ok {
		t.Error("skip.log was copied")
	}

	// The engine's own message follows the prefix, in both ports.
	_, err = OptionsFromMap(map[string]any{
		"cmp": map[string]any{"Copy": map[string]any{"ignore": []any{"["}}},
	})
	if err == nil || !strings.HasPrefix(err.Error(),
		`Jostraca Options: property "cmp.Copy.ignore": `) {
		t.Fatalf("err %v", err)
	}
}

// The map form holds the Go values the typed options take: an FS, a
// func() int64 and a Log. A JSON value in their place is refused with
// TS's text (test/spec/options.tsv); a Go value of the wrong type, which
// JSON cannot hold, with Go's own.
func TestOptionsFromMapHostValues(t *testing.T) {
	o, err := OptionsFromMap(map[string]any{
		"fs":  NewMemFS(),
		"now": func() int64 { return 1 },
		"log": &warnLog{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if o.FS == nil || o.Now == nil || o.Log == nil {
		t.Fatalf("options: %+v", o)
	}

	for key, bad := range map[string]any{
		"fs":  func() {},
		"now": func() string { return "" },
	} {
		_, err := OptionsFromMap(map[string]any{key: bad})
		if err == nil || !strings.Contains(err.Error(), `property "`+key+`" must`) {
			t.Errorf("%s: err %v", key, err)
		}
	}

	_, err = OptionsFromMap(map[string]any{"log": struct{}{}})
	if err == nil || !strings.Contains(err.Error(), "is not a logger with a debug function") {
		t.Errorf("log: err %v", err)
	}
}
