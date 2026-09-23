package jostraca

import (
	"encoding/json"
	"testing"
)

// File-handler behaviour pinned across both stacks. Each test here has a
// TS twin in ts/test/filehandler.test.ts.

const fhNow int64 = 1735689600000

func fhMeta(t *testing.T, fsys FS, p string) map[string]any {
	t.Helper()
	b, err := fsys.ReadFile(p)
	if err != nil {
		t.Fatalf("read meta %s: %v", p, err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("decode meta: %v", err)
	}
	return m
}

func fhMetaEntry(t *testing.T, fsys FS, p, key string) map[string]any {
	t.Helper()
	files, _ := fhMeta(t, fsys, p)["files"].(map[string]any)
	e, _ := files[key].(map[string]any)
	if e == nil {
		t.Fatalf("no meta entry %q in %v", key, files)
	}
	return e
}

// A JOSTRACA_PROTECT marker protects a target whatever its
// classification: text, binary by extension, or binary by content.
func TestBinaryProtect(t *testing.T) {
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff}
	yes := true
	runs := []struct {
		name     string
		existing Existing
		root     func(j *J)
	}{
		{"file", Existing{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("a.png", func(j *J) { j.Content("P2") })
			})
		}},
		{"copy-one", Existing{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Copy(CopyProps{From: "/src/one/a.png", To: "a.png"})
			})
		}},
		{"copy-tree", Existing{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Copy(CopyProps{From: "/src/tree"})
			})
		}},
		{"file-preserve", Existing{Bin: ExistingBin{Preserve: &yes}}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("a.png", func(j *J) { j.Content("P2") })
			})
		}},
		{"copy-preserve", Existing{Bin: ExistingBin{Preserve: &yes}}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Copy(CopyProps{From: "/src/one/a.png", To: "a.png"})
			})
		}},
	}
	for _, r := range runs {
		t.Run(r.name, func(t *testing.T) {
			mem := NewMemFS()
			_ = mem.WriteFile("/src/one/a.png", png)
			_ = mem.WriteFile("/src/tree/a.png", png)
			_ = mem.WriteFile("/out/a.png", []byte("JOSTRACA_PROTECT"))
			res, err := New(WithFS(mem), WithFolder("/out"),
				WithNow(func() int64 { return fhNow })).
				Generate(Options{Existing: r.existing}, r.root)
			if err != nil {
				t.Fatal(err)
			}
			if got, _ := mem.ReadFile("/out/a.png"); string(got) != "JOSTRACA_PROTECT" {
				t.Errorf("protected target overwritten: %q", got)
			}
			if len(res.Files.Written) != 0 || len(res.Files.Preserved) != 0 {
				t.Errorf("written=%v preserved=%v, want both empty",
					res.Files.Written, res.Files.Preserved)
			}
			if mem.Exists("/out/a.old.png") {
				t.Error("a protected target got a .old backup")
			}
			e := fhMetaEntry(t, mem, "/out/.jostraca/jostraca.meta.log", "a.png")
			if e["action"] != "skip" || e["protect"] != true {
				t.Errorf("meta = %v, want action skip, protect true", e)
			}
		})
	}
}
