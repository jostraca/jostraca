package jostraca

import (
	"strings"
	"testing"
)

// Phase 6 — FileHandler write/preserve/present/protect/unchanged modes.
// Diff and merge land in Phases 10 and 11.

// quickStart exercises the full build pipeline end-to-end with a
// known tree, asserting Vol contents byte-for-byte.
func TestFilesWrittenFullPaths(t *testing.T) {
	// Files.Written contains full paths (matching TS) so users can
	// do Result.Files.Written[i] without needing to prepend Folder.
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	res, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("hi") })
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Files.Written) != 1 {
		t.Fatalf("want 1 written, got %v", res.Files.Written)
	}
	if res.Files.Written[0] != "/out/p/a.txt" {
		t.Errorf("got %q, want /out/p/a.txt", res.Files.Written[0])
	}
}

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
		"/out/my-app/src/index.js": "console.log(\"hello world\")\n",
		"/out/my-app/package.json": "{ \"name\": \"my-app\" }\n",
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
	// A protected file is not acted on at all: TS leaves every files.* list
	// empty and records a `skip` in the audit and meta log. (This used to
	// add the path to Preserved, which diverged from TS.)
	if len(res.Files.Preserved) != 0 {
		t.Errorf("Files.Preserved = %v, want empty", res.Files.Preserved)
	}
	if len(res.Files.Written) != 0 {
		t.Errorf("Files.Written = %v, want empty", res.Files.Written)
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
	// Match TS semantics: present mode requires write=false to take
	// effect; otherwise the default write overrides and there's no
	// .new.<ext> sidecar.
	mem := NewMemFS()
	_ = mem.WriteFile("/out/x.txt", []byte("untouched\n"))
	j := New(WithFS(mem), WithFolder("/out"))
	presentTrue := true
	writeFalse := false
	_, err := j.Generate(Options{
		Existing: Existing{Txt: ExistingTxt{Present: &presentTrue, Write: &writeFalse}},
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

// files.preserved and files.presented name the TARGET, the file that got
// the .old backup or the .new sidecar, never the sidecar itself. TS pins
// this in jostraca.test.ts; Go listed the sidecar path.
func TestSidecarListsNameTheTarget(t *testing.T) {
	yes, no := true, false
	src := map[string][]byte{
		"/src/img.png": {0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff},
	}
	cases := []struct {
		name     string
		existing Existing
		dryrun   bool
		seed     map[string]string
		root     func(j *J)
		want     func(f Files) []string
		expected []string
	}{
		{
			name:     "preserve-text-and-dotfile",
			existing: Existing{Txt: ExistingTxt{Preserve: &yes}},
			seed:     map[string]string{"/out/a.txt": "USER\n", "/out/.env": "EU\n"},
			root: func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File("a.txt", func(j *J) { j.Content("A2\n") })
					j.File(".env", func(j *J) { j.Content("E2\n") })
				})
			},
			want:     func(f Files) []string { return f.Preserved },
			expected: []string{"/out/a.txt", "/out/.env"},
		},
		{
			name:     "present-text",
			existing: Existing{Txt: ExistingTxt{Write: &no, Present: &yes}},
			seed:     map[string]string{"/out/a.txt": "USER\n"},
			root: func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File("a.txt", func(j *J) { j.Content("A2\n") })
				})
			},
			want:     func(f Files) []string { return f.Presented },
			expected: []string{"/out/a.txt"},
		},
		{
			name:     "preserve-binary-file",
			existing: Existing{Bin: ExistingBin{Preserve: &yes}},
			seed:     map[string]string{"/out/a.png": "PU"},
			root: func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File("a.png", func(j *J) { j.Content("P2") })
				})
			},
			want:     func(f Files) []string { return f.Preserved },
			expected: []string{"/out/a.png"},
		},
		{
			name:     "present-binary-file",
			existing: Existing{Bin: ExistingBin{Write: &no, Present: &yes}},
			seed:     map[string]string{"/out/a.png": "PU"},
			root: func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File("a.png", func(j *J) { j.Content("P2") })
				})
			},
			want:     func(f Files) []string { return f.Presented },
			expected: []string{"/out/a.png"},
		},
		{
			name:     "preserve-binary-copy",
			existing: Existing{Bin: ExistingBin{Preserve: &yes}},
			seed:     map[string]string{"/out/img.png": "\t\t\x00"},
			root: func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.Copy(CopyProps{From: "/src/img.png", To: "img.png"})
				})
			},
			want:     func(f Files) []string { return f.Preserved },
			expected: []string{"/out/img.png"},
		},
		{
			name:     "present-binary-copy",
			existing: Existing{Bin: ExistingBin{Write: &no, Present: &yes}},
			seed:     map[string]string{"/out/img.png": "\t\t\x00"},
			root: func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.Copy(CopyProps{From: "/src/img.png", To: "img.png"})
				})
			},
			want:     func(f Files) []string { return f.Presented },
			expected: []string{"/out/img.png"},
		},
		{
			name:     "preserve-dryrun",
			existing: Existing{Txt: ExistingTxt{Preserve: &yes}},
			dryrun:   true,
			seed:     map[string]string{"/out/a.txt": "USER\n"},
			root: func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File("a.txt", func(j *J) { j.Content("A2\n") })
				})
			},
			want:     func(f Files) []string { return f.Preserved },
			expected: []string{"/out/a.txt"},
		},
		{
			name:     "present-dryrun",
			existing: Existing{Txt: ExistingTxt{Write: &no, Present: &yes}},
			dryrun:   true,
			seed:     map[string]string{"/out/a.txt": "USER\n"},
			root: func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File("a.txt", func(j *J) { j.Content("A2\n") })
				})
			},
			want:     func(f Files) []string { return f.Presented },
			expected: []string{"/out/a.txt"},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			mem := NewMemFS()
			for k, v := range src {
				_ = mem.WriteFile(k, v)
			}
			for k, v := range c.seed {
				_ = mem.WriteFile(k, []byte(v))
			}
			j := New(WithFS(mem), WithFolder("/out"))
			res, err := j.Generate(Options{
				Existing: c.existing,
				Control:  Control{Dryrun: c.dryrun},
			}, c.root)
			if err != nil {
				t.Fatal(err)
			}
			got := c.want(res.Files)
			if strings.Join(got, "|") != strings.Join(c.expected, "|") {
				t.Errorf("got %v, want %v", got, c.expected)
			}
		})
	}
}

// The meta log quotes paths as JSON.stringify does, so '&', '<', '>' and
// U+2028 are written raw. encoding/json escaped all four, which gave a
// different meta.log from TS for the same tree. The expected bytes are
// TS's own output for this tree.
func TestMetaLogQuotesLikeJSONStringify(t *testing.T) {
	mem := NewMemFS()
	_, err := New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return 1735689600000 })).
		Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{Folder: "."}, func(j *J) {
				for _, n := range []string{"a&b.txt", "x<y>.txt", "u\u2028v.txt"} {
					j.File(n, func(j *J) { j.Content("A\n") })
				}
			})
		})
	if err != nil {
		t.Fatal(err)
	}
	got, err := mem.ReadFile("/out/.jostraca/jostraca.meta.log")
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n" +
		"  \"foldername\": \".jostraca\",\n" +
		"  \"filename\": \"jostraca.meta.log\",\n" +
		"  \"last\": 1735689600000,\n" +
		"  \"hlast\": 2025010100000000,\n" +
		"  \"files\": {\n" +
		"    \"a&b.txt\": {\n" +
		"      \"action\": \"write\",\n" +
		"      \"path\": \"a&b.txt\",\n" +
		"      \"exists\": false,\n" +
		"      \"actions\": [\n" +
		"        \"write\"\n" +
		"      ],\n" +
		"      \"protect\": false,\n" +
		"      \"conflict\": false,\n" +
		"      \"when\": 1735689600000,\n" +
		"      \"hwhen\": 2025010100000000\n" +
		"    },\n" +
		"    \"x<y>.txt\": {\n" +
		"      \"action\": \"write\",\n" +
		"      \"path\": \"x<y>.txt\",\n" +
		"      \"exists\": false,\n" +
		"      \"actions\": [\n" +
		"        \"write\"\n" +
		"      ],\n" +
		"      \"protect\": false,\n" +
		"      \"conflict\": false,\n" +
		"      \"when\": 1735689600000,\n" +
		"      \"hwhen\": 2025010100000000\n" +
		"    },\n" +
		"    \"u\u2028v.txt\": {\n" +
		"      \"action\": \"write\",\n" +
		"      \"path\": \"u\u2028v.txt\",\n" +
		"      \"exists\": false,\n" +
		"      \"actions\": [\n" +
		"        \"write\"\n" +
		"      ],\n" +
		"      \"protect\": false,\n" +
		"      \"conflict\": false,\n" +
		"      \"when\": 1735689600000,\n" +
		"      \"hwhen\": 2025010100000000\n" +
		"    }\n" +
		"  }\n" +
		"}"
	if string(got) != want {
		t.Errorf("meta.log\n got  %q\n want %q", got, want)
	}
}

// Mirrors ts/test/jostraca.test.ts now-zero-is-deterministic: a clock of
// 0 is the epoch, so the meta log is byte-stable.
func TestNowZeroIsDeterministic(t *testing.T) {
	run := func() string {
		mem := NewMemFS()
		_, err := New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return 0 })).
			Generate(Options{}, func(j *J) {
				j.Project(ProjectProps{Folder: "."}, func(j *J) {
					j.File("a.txt", func(j *J) { j.Content("A\n") })
				})
			})
		if err != nil {
			t.Fatal(err)
		}
		b, _ := mem.ReadFile("/out/.jostraca/jostraca.meta.log")
		return string(b)
	}
	first := run()
	for _, want := range []string{`"hlast": 1970010100000000,`, `"hwhen": 1970010100000000`} {
		if !strings.Contains(first, want) {
			t.Errorf("meta.log lacks %s:\n%s", want, first)
		}
	}
	if second := run(); second != first {
		t.Errorf("meta.log differs between runs:\n%s\n%s", first, second)
	}
}
