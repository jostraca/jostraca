package jostraca

import (
	"strings"
	"testing"
)

// Phase 6 — FileHandler write/preserve/present/protect/unchanged modes.
// Diff and merge land in Phases 10 and 11.

// quickStart exercises the full build pipeline end-to-end with a
// known tree, asserting Vol contents byte-for-byte.
func TestQuickstartViaMemFS(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	res, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "my-app"}, func(j *J) {
			j.Folder("src", func(j *J) {
				j.File("index.js", func(j *J) {
					j.Content("console.log(\"hello world\")\n")
				})
			})
			j.File("package.json", func(j *J) {
				j.Content("{ \"name\": \"my-app\" }\n")
			})
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"/out/my-app/src/index.js":   "console.log(\"hello world\")\n",
		"/out/my-app/package.json":   "{ \"name\": \"my-app\" }\n",
	}
	for path, body := range want {
		got, err := mem.ReadFile(path)
		if err != nil {
			t.Errorf("%s: ReadFile err = %v", path, err)
			continue
		}
		if string(got) != body {
			t.Errorf("%s: got %q, want %q", path, got, body)
		}
	}
	// Files.Written should list both paths (relative to folder).
	if len(res.Files.Written) != 2 {
		t.Errorf("Files.Written = %v, want 2 entries", res.Files.Written)
	}
}

func TestUnchangedFile(t *testing.T) {
	mem := NewMemFS()
	// Pre-populate the destination with the same content we'll generate.
	_ = mem.WriteFile("/out/x.txt", []byte("hello\n"))
	j := New(WithFS(mem), WithFolder("/out"))
	res, err := j.Generate(Options{}, func(j *J) {
		j.File("x.txt", func(j *J) { j.Content("hello\n") })
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Files.Unchanged) != 1 {
		t.Errorf("Files.Unchanged = %v, want 1 entry", res.Files.Unchanged)
	}
	if len(res.Files.Written) != 0 {
		t.Errorf("Files.Written = %v, want empty", res.Files.Written)
	}
}

func TestProtectedFile(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/out/x.txt", []byte("# JOSTRACA_PROTECT\noriginal\n"))
	j := New(WithFS(mem), WithFolder("/out"))
	res, err := j.Generate(Options{}, func(j *J) {
		j.File("x.txt", func(j *J) { j.Content("new content\n") })
	})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := mem.ReadFile("/out/x.txt")
	if !strings.Contains(string(got), "original") {
		t.Errorf("protected file overwritten: %q", got)
	}
	if len(res.Files.Preserved) != 1 {
		t.Errorf("Files.Preserved = %v, want 1 entry", res.Files.Preserved)
	}
}

func TestPreserveMode(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/out/x.txt", []byte("old\n"))
	j := New(WithFS(mem), WithFolder("/out"))
	preserveTrue := true
	_, err := j.Generate(Options{
		Existing: Existing{Txt: ExistingTxt{Preserve: &preserveTrue}},
	}, func(j *J) {
		j.File("x.txt", func(j *J) { j.Content("new\n") })
	})
	if err != nil {
		t.Fatal(err)
	}
	// Original backed up to .old.txt; new content at the original path.
	current, _ := mem.ReadFile("/out/x.txt")
	if string(current) != "new\n" {
		t.Errorf("current = %q, want 'new\\n'", current)
	}
	old, _ := mem.ReadFile("/out/x.old.txt")
	if string(old) != "old\n" {
		t.Errorf("backup = %q, want 'old\\n'", old)
	}
}

func TestPresentMode(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/out/x.txt", []byte("untouched\n"))
	j := New(WithFS(mem), WithFolder("/out"))
	presentTrue := true
	_, err := j.Generate(Options{
		Existing: Existing{Txt: ExistingTxt{Present: &presentTrue}},
	}, func(j *J) {
		j.File("x.txt", func(j *J) { j.Content("proposed\n") })
	})
	if err != nil {
		t.Fatal(err)
	}
	current, _ := mem.ReadFile("/out/x.txt")
	if string(current) != "untouched\n" {
		t.Errorf("current modified: %q", current)
	}
	new_, _ := mem.ReadFile("/out/x.new.txt")
	if string(new_) != "proposed\n" {
		t.Errorf("new = %q", new_)
	}
}

func TestBuildMetaPersisted(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.File("x.txt", func(j *J) { j.Content("hi") })
	})
	if err != nil {
		t.Fatal(err)
	}
	// BuildMeta writes a JSON log under .jostraca/.
	if !mem.Exists("/out/.jostraca/jostraca.meta.log") {
		t.Error("meta log not persisted")
	}
	if !mem.Exists("/out/.jostraca/.gitignore") {
		t.Error(".gitignore not written")
	}
}
