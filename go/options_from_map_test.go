package jostraca

import (
	"os"
	"path/filepath"
	"testing"
)

// OptionsFromMap covers nested option groups (Existing, Control, Cmp,
// Name). The map is validated by the closed schema TS's OptionsShape and
// ExistingShape declare; the refusals themselves, with their message
// text, are rows in test/spec/options.tsv, which both stacks run.

func TestOptionsFromMapTopLevelScalars(t *testing.T) {
	build := true
	mem := true
	want := Options{Folder: "/out", Debug: "info", Mem: &mem, Exclude: true, Build: &build}

	o, err := OptionsFromMap(map[string]any{
		"folder":  "/out",
		"debug":   "info",
		"mem":     true,
		"exclude": true,
		"build":   true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if o.Folder != want.Folder || o.Debug != want.Debug ||
		o.Exclude != want.Exclude {
		t.Errorf("scalars wrong: got %+v", o)
	}
	// Mem is tri-state now, so an unset value is distinguishable from a
	// supplied false -- which is what lets a call turn OFF a builder's
	// memory mode, as TS's explicit `mem: false` does.
	if o.Mem == nil || *o.Mem != *want.Mem {
		t.Errorf("Mem = %v, want pointer to true", o.Mem)
	}
	if o.Build == nil || *o.Build != true {
		t.Errorf("Build = %v, want pointer to true", o.Build)
	}
}

func TestOptionsFromMapExistingNested(t *testing.T) {
	o, err := OptionsFromMap(map[string]any{
		"existing": map[string]any{
			"txt": map[string]any{
				"write":    false,
				"preserve": true,
				"merge":    true,
			},
			"bin": map[string]any{
				"present": true,
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if o.Existing.Txt.Write == nil || *o.Existing.Txt.Write != false {
		t.Errorf("Txt.Write = %v", o.Existing.Txt.Write)
	}
	if o.Existing.Txt.Preserve == nil || *o.Existing.Txt.Preserve != true {
		t.Errorf("Txt.Preserve = %v", o.Existing.Txt.Preserve)
	}
	if o.Existing.Txt.Merge == nil || *o.Existing.Txt.Merge != true {
		t.Errorf("Txt.Merge = %v", o.Existing.Txt.Merge)
	}
	if o.Existing.Bin.Present == nil || *o.Existing.Bin.Present != true {
		t.Errorf("Bin.Present = %v", o.Existing.Bin.Present)
	}
}

func TestOptionsFromMapControlInverted(t *testing.T) {
	// TS field 'duplicate' → Go's NoDuplicate inverted.
	o, err := OptionsFromMap(map[string]any{
		"control": map[string]any{
			"dryrun":    true,
			"duplicate": false,
			"version":   true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !o.Control.Dryrun || !o.Control.Version || !o.Control.NoDuplicate {
		t.Errorf("Control = %+v", o.Control)
	}
	if o.Control.Duplicate() {
		t.Errorf("Duplicate() = true, want false (TS duplicate=false)")
	}
}

func TestOptionsFromMapCmpIgnore(t *testing.T) {
	o, err := OptionsFromMap(map[string]any{
		"cmp": map[string]any{
			"Copy": map[string]any{
				"ignore": []any{"~$", `\.tmp$`},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(o.Cmp.Copy.Ignore) != 2 {
		t.Fatalf("ignore len = %d, want 2", len(o.Cmp.Copy.Ignore))
	}
	if !o.Cmp.Copy.Ignore[0].MatchString("foo~") {
		t.Errorf("first ignore pattern doesn't match ~$")
	}
}

func TestOptionsFromMapName(t *testing.T) {
	o, err := OptionsFromMap(map[string]any{
		"name": map[string]any{
			"file":   map[string]any{"prefix": "pre-", "suffix": ".gen"},
			"folder": map[string]any{"prefix": "f-"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if o.Name.File.Prefix != "pre-" || o.Name.File.Suffix != ".gen" {
		t.Errorf("File affixes = %+v", o.Name.File)
	}
	if o.Name.Folder.Prefix != "f-" {
		t.Errorf("Folder.Prefix = %q", o.Name.Folder.Prefix)
	}
}

func TestOptionsFromMapVolStringAndBytes(t *testing.T) {
	o, err := OptionsFromMap(map[string]any{
		"vol": map[string]any{
			"/a.txt": "hello",
			"/b.bin": []byte{0x00, 0x01},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(o.Vol["/a.txt"]) != "hello" {
		t.Errorf("Vol[/a.txt] = %q", o.Vol["/a.txt"])
	}
	if len(o.Vol["/b.bin"]) != 2 {
		t.Errorf("Vol[/b.bin] len = %d", len(o.Vol["/b.bin"]))
	}
}

func TestOptionsFromMapTypeError(t *testing.T) {
	_, err := OptionsFromMap(map[string]any{"folder": 42})
	if err == nil {
		t.Errorf("expected type error for non-string folder")
	}
}

// A mistyped dryrun used to be dropped silently, so the Generate that
// followed WROTE the files the caller had asked to protect. It is now
// refused, and a caller generating only on a nil error writes nothing.
func TestOptionsFromMapMistypedDryrunWritesNothing(t *testing.T) {
	dir := t.TempDir()
	opts, err := OptionsFromMap(map[string]any{
		"folder":  fwd(dir),
		"control": map[string]any{"dryrun": "yes"},
	})
	want := `Jostraca Options: Validation failed for property "control.dryrun" ` +
		`with string "yes" because the string is not of type boolean.`
	if err == nil || err.Error() != want {
		t.Fatalf("err = %v, want %q", err, want)
	}
	if err == nil {
		if _, gerr := New().Generate(opts, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("A") })
		}); gerr != nil {
			t.Fatal(gerr)
		}
	}
	if _, serr := os.Stat(filepath.Join(dir, "a.txt")); !os.IsNotExist(serr) {
		t.Fatalf("a.txt was written: %v", serr)
	}
}

func TestOptionsFromMapRejectsUnknownKeys(t *testing.T) {
	for _, m := range []map[string]any{
		{"bogus": 1},
		{"control": map[string]any{"bogus": true}},
		{"existing": map[string]any{"txt": map[string]any{"bogus": 1}}},
		{"existing": map[string]any{"bin": map[string]any{"diff": true}}},
		{"cmp": map[string]any{"Copy": map[string]any{"bogus": 1}}},
	} {
		if _, err := OptionsFromMap(m); err == nil {
			t.Errorf("%v: accepted", m)
		}
	}
}

// A nil vol value is an empty directory, the memfs seed convention, and
// the form Vol() reports one in. A typed map[string][]byte is accepted too.
func TestOptionsFromMapVolNilIsADirectory(t *testing.T) {
	for _, vol := range []any{
		map[string]any{"/d": nil, "/e.txt": ""},
		map[string][]byte{"/d": nil, "/e.txt": {}},
	} {
		opts, err := OptionsFromMap(map[string]any{"vol": vol, "mem": true})
		if err != nil {
			t.Fatal(err)
		}
		if b, ok := opts.Vol["/d"]; !ok || b != nil {
			t.Fatalf("/d = %v, %v", b, ok)
		}
		if b := opts.Vol["/e.txt"]; b == nil || len(b) != 0 {
			t.Fatalf("/e.txt = %#v", b)
		}
		res, err := New().Generate(opts, func(j *J) {})
		if err != nil {
			t.Fatal(err)
		}
		v := res.Vol()
		if b, ok := v["/d"]; !ok || b != nil {
			t.Errorf("/d should be an empty directory: %v, %v", b, ok)
		}
		if b, ok := v["/e.txt"]; !ok || b == nil {
			t.Errorf("/e.txt should be an empty file: %#v, %v", b, ok)
		}
	}
}

// Injected schema defaults are not decoded: an absent meta stays nil, so
// it cannot replace a global Meta on the merge.
func TestOptionsFromMapKeepsAbsentGroupsUnset(t *testing.T) {
	o, err := OptionsFromMap(map[string]any{"folder": "/out"})
	if err != nil {
		t.Fatal(err)
	}
	if o.Meta != nil || o.Model != nil || o.Build != nil || o.Mem != nil ||
		o.Vol != nil || o.Existing != (Existing{}) || o.Control != (Control{}) {
		t.Fatalf("absent groups were set: %+v", o)
	}
}
