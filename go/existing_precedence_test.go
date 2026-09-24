package jostraca

import (
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// Global `existing` precedence. existing.Txt and existing.Bin overlay PER
// FLAG over the global values: a nil per-call pointer inherits the global
// flag. Go used to replace the whole global Existing with any non-zero
// per-call one, so a global merge met by a per-call preserve overwrote the
// user's edit.
//
// Mirrors the `global-existing-precedence` block in ts/test/control.test.ts.

type existingRun struct {
	files   Files
	text    string
	vol     []string
	actions []string
}

func existingGen(
	t *testing.T, global, call Existing, first, user, second string,
) existingRun {
	t.Helper()
	m := NewMemFS()
	j := New(
		WithFS(m),
		WithFolder("/out"),
		WithNow(func() int64 { return 1735689600000 }),
		WithExisting(global),
	)
	gen := func(body string) func(*J) {
		return func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("a.txt", func(j *J) { j.Content(body) })
			})
		}
	}

	if _, err := j.Generate(Options{}, gen(first)); err != nil {
		t.Fatal(err)
	}
	if err := m.WriteFile("/out/a.txt", []byte(user)); err != nil {
		t.Fatal(err)
	}
	res, err := j.Generate(Options{Existing: call}, gen(second))
	if err != nil {
		t.Fatal(err)
	}

	text, _ := m.ReadFile("/out/a.txt")
	raw, err := m.ReadFile("/out/.jostraca/jostraca.meta.log")
	if err != nil {
		t.Fatal(err)
	}
	var meta struct {
		Files map[string]struct {
			Actions []string `json:"actions"`
		} `json:"files"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}

	vol := []string{}
	for k, v := range m.Vol() {
		if v != nil && !strings.Contains(k, ".jostraca") {
			vol = append(vol, k)
		}
	}
	sort.Strings(vol)

	return existingRun{
		files:   res.Files,
		text:    string(text),
		vol:     vol,
		actions: meta.Files["a.txt"].Actions,
	}
}

func existingWant(t *testing.T, what string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got: %#v\nwant: %#v", what, got, want)
	}
}

func existingFlag(b bool) *bool { return &b }

func TestGlobalMergeWithPerCallPreserveMerges(t *testing.T) {
	r := existingGen(t,
		Existing{Txt: ExistingTxt{Merge: existingFlag(true)}},
		Existing{Txt: ExistingTxt{Preserve: existingFlag(true)}},
		"L1\nL2\nL3\n", "L1\nUSER\nL3\n", "L1\nGEN\nL3\n")

	existingWant(t, "text", r.text, "L1\n"+
		"<<<<<<< GENERATED: 2025-01-01T00:00:00.000Z/merge\n"+
		"GEN\n=======\nUSER\n"+
		">>>>>>> EXISTING: 2025-01-01T00:00:00.000Z/merge\n"+
		"L3\n")
	existingWant(t, "merged", r.files.Merged, []string{"/out/a.txt"})
	existingWant(t, "conflicted", r.files.Conflicted, []string{"/out/a.txt"})
	existingWant(t, "written", len(r.files.Written), 0)
	existingWant(t, "preserved", len(r.files.Preserved), 1)
	existingWant(t, "actions", r.actions, []string{"preserve", "merge"})
	existingWant(t, "vol", r.vol, []string{"/out/a.old.txt", "/out/a.txt"})
}

func TestGlobalMergeWithPerCallWriteStillMerges(t *testing.T) {
	r := existingGen(t,
		Existing{Txt: ExistingTxt{Merge: existingFlag(true)}},
		Existing{Txt: ExistingTxt{Write: existingFlag(true)}},
		"L1\nL2\nL3\n", "L1\nUSER\nL3\n", "L1\nL2\nL3\nL4\n")

	existingWant(t, "text", r.text, "L1\nUSER\nL3\nL4\n")
	existingWant(t, "merged", r.files.Merged, []string{"/out/a.txt"})
	existingWant(t, "conflicted", len(r.files.Conflicted), 0)
	existingWant(t, "written", len(r.files.Written), 0)
	existingWant(t, "actions", r.actions, []string{"merge"})
}

func TestGlobalTxtWriteFalseWithPerCallBinSkips(t *testing.T) {
	r := existingGen(t,
		Existing{Txt: ExistingTxt{Write: existingFlag(false)}},
		Existing{Bin: ExistingBin{Preserve: existingFlag(true)}},
		"A1\n", "USER\n", "A2\n")

	existingWant(t, "text", r.text, "USER\n")
	existingWant(t, "written", len(r.files.Written), 0)
	existingWant(t, "preserved", len(r.files.Preserved), 0)
	existingWant(t, "actions", r.actions, []string{"skip"})
	existingWant(t, "vol", r.vol, []string{"/out/a.txt"})
}

func TestGlobalTxtPreserveWithPerCallBinPreserves(t *testing.T) {
	r := existingGen(t,
		Existing{Txt: ExistingTxt{Preserve: existingFlag(true)}},
		Existing{Bin: ExistingBin{Write: existingFlag(true)}},
		"A1\n", "USER\n", "A2\n")

	existingWant(t, "text", r.text, "A2\n")
	existingWant(t, "written", r.files.Written, []string{"/out/a.txt"})
	existingWant(t, "preserved", len(r.files.Preserved), 1)
	existingWant(t, "actions", r.actions, []string{"preserve", "write"})
	existingWant(t, "vol", r.vol, []string{"/out/a.old.txt", "/out/a.txt"})
}

// The overlay itself, flag by flag: a nil per-call pointer inherits, a
// non-nil one replaces, including an explicit false.
func TestMergeOptionsExistingOverlaysPerFlag(t *testing.T) {
	out := mergeOptions(
		Options{Existing: Existing{
			Txt: ExistingTxt{Merge: existingFlag(true), Write: existingFlag(false)},
			Bin: ExistingBin{Preserve: existingFlag(true)},
		}},
		Options{Existing: Existing{
			Txt: ExistingTxt{Preserve: existingFlag(true), Write: existingFlag(true)},
			Bin: ExistingBin{Preserve: existingFlag(false)},
		}},
	)
	x := out.Existing
	if x.Txt.Merge == nil || !*x.Txt.Merge {
		t.Error("txt.merge must be inherited")
	}
	if x.Txt.Preserve == nil || !*x.Txt.Preserve {
		t.Error("txt.preserve must come from the call")
	}
	if x.Txt.Write == nil || !*x.Txt.Write {
		t.Error("txt.write true must replace the global false")
	}
	if x.Bin.Preserve == nil || *x.Bin.Preserve {
		t.Error("bin.preserve false must replace the global true")
	}
	if x.Txt.Diff != nil || x.Txt.Present != nil || x.Bin.Write != nil {
		t.Error("flags neither side set must stay nil")
	}
}
