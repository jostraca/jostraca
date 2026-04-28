package jostraca

import (
	"embed"
	"encoding/json"
	"sort"
	"strings"
	"testing"
)

//go:embed testdata/parity/*.json
var parityFS embed.FS

// parityCase mirrors the JSON dumped by tools/extract-parity.js. It
// records the TS-side scenario name, options, prepopulated FS state,
// and the expected vol.toJSON() output produced by running the same
// component tree through the TS package.
type parityCase struct {
	Scenario    string            `json:"scenario"`
	Opts        map[string]any    `json:"opts"`
	Prepopulate map[string]string `json:"prepopulate"`
	Vol         map[string]string `json:"vol"`
}

// scenarioRunner builds the component tree for a named scenario. The
// runners here mirror the tree shapes in tools/extract-parity.js so a
// byte-equal parity assertion is meaningful.
var scenarioRunners = map[string]func(j *J){
	"quickstart": func(j *J) {
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
	},
	"template_model": func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.File("config.txt", func(j *J) {
				j.Content("App: $$app.name$$ v$$app.version$$\n")
			})
		})
	},
	"fragment_slot": func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.File("index.html", func(j *J) {
				j.Fragment(FragmentProps{From: "/templates/page.html"}, func(j *J) {
					j.Slot("head", func(j *J) { j.Content("<title>X</title>") })
					j.Slot("body", func(j *J) { j.Content("<h1>Hello</h1>") })
				})
			})
		})
	},
	"inject_basic": func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.Inject("foo.txt", func(j *J) { j.Content("new content") })
		})
	},
	"copy_file": func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.Copy(CopyProps{From: "/tpl/hello.txt"})
		})
	},
	"list_basic": func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.File("out.txt", func(j *J) {
				j.List([]any{"a", "b", "c"}, func(j *J, item any) {
					j.Line(item.(string))
				})
			})
		})
	},
	"line_basic": func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.File("out.txt", func(j *J) {
				j.Line("hello")
			})
		})
	},
	"protect": func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.File("cfg.txt", func(j *J) { j.Content("regenerated\n") })
		})
	},
	"unchanged": func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("A") })
		})
	},
	"preserve_mode": func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("NEW") })
		})
	},
	"present_mode": func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("NEW") })
		})
	},
	"diff_mode": func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("NEW\n") })
		})
	},
	"happy_multifile": func(j *J) {
		j.Project(ProjectProps{Folder: "sdk"}, func(j *J) {
			j.Folder("js", func(j *J) {
				j.File("foo.js", func(j *J) { j.Content("// custom-foo\n") })
				j.File("bar.js", func(j *J) { j.Content("// custom-bar\n") })
			})
			j.Folder("go", func(j *J) {
				j.File("zed.go", func(j *J) { j.Content("// custom-zed\n") })
			})
		})
	},
	"content_empty_folder": func(j *J) {
		j.Folder("", func(j *J) {
			j.File("foo.txt", func(j *J) { j.Content("A") })
		})
	},
	"basic_copy": func(j *J) {
		j.Project(ProjectProps{Folder: "sdk"}, func(j *J) {
			j.Folder("js", func(j *J) {
				j.File("foo.js", func(j *J) { j.Content("// custom-foo\n") })
				j.Copy(CopyProps{From: "/tm/bar.txt", To: "bar.txt"})
				j.Copy(CopyProps{From: "/tm/sub"})
			})
		})
	},
}

// scenarioOptions returns per-scenario Options additions; merged on top
// of the WithFS+WithFolder+WithNow base.
func scenarioOptions(scenario string) []Option {
	switch scenario {
	case "template_model":
		return []Option{WithModel(map[string]any{
			"app": map[string]any{"name": "Acme", "version": "1.0.0"},
		})}
	case "copy_file":
		return []Option{WithModel(map[string]any{"name": "World"})}
	case "preserve_mode":
		t := true
		return []Option{WithExisting(Existing{Txt: ExistingTxt{Preserve: &t}})}
	case "present_mode":
		t := true
		return []Option{WithExisting(Existing{Txt: ExistingTxt{Present: &t}})}
	case "diff_mode":
		t := true
		return []Option{WithExisting(Existing{Txt: ExistingTxt{Diff: &t}})}
	case "basic_copy":
		return []Option{WithModel(map[string]any{"x": map[string]any{"y": "Y", "z": "Z"}})}
	}
	return nil
}

const frozenNow int64 = 1735689600000

func TestParityScenarios(t *testing.T) {
	entries, err := parityFS.ReadDir("testdata/parity")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		name := strings.TrimSuffix(e.Name(), ".json")
		t.Run(name, func(t *testing.T) {
			runParityCase(t, "testdata/parity/"+e.Name(), name)
		})
	}
}

func runParityCase(t *testing.T, path, name string) {
	t.Helper()
	body, err := parityFS.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var c parityCase
	if err := json.Unmarshal(body, &c); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}

	// Multi-phase scenarios live in scenarioMultiPhase and own their
	// own MemFS lifecycle.
	if mp, ok := scenarioMultiPhase[name]; ok {
		mem := mp(t)
		assertVol(t, mem, c.Vol)
		return
	}

	runner, ok := scenarioRunners[name]
	if !ok {
		t.Skipf("scenario %s has no Go runner; add one to scenarioRunners", name)
		return
	}

	mem := NewMemFS()
	for k, v := range c.Prepopulate {
		_ = mem.WriteFile(k, []byte(v))
	}

	opts := []Option{WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return frozenNow })}
	opts = append(opts, scenarioOptions(name)...)
	j := New(opts...)

	if _, err := j.Generate(Options{}, runner); err != nil {
		t.Fatalf("Generate: %v", err)
	}

	assertVol(t, mem, c.Vol)
}

func assertVol(t *testing.T, mem *MemFS, want map[string]string) {
	t.Helper()
	got := mem.Vol()
	gotS := make(map[string]string, len(got))
	for k, v := range got {
		gotS[k] = string(v)
	}

	missing := []string{}
	mismatched := []string{}
	for p, w := range want {
		actual, ok := gotS[p]
		if !ok {
			missing = append(missing, p)
			continue
		}
		if actual != w {
			mismatched = append(mismatched, p)
		}
	}
	extra := []string{}
	for p := range gotS {
		if _, ok := want[p]; !ok {
			extra = append(extra, p)
		}
	}
	sort.Strings(missing)
	sort.Strings(mismatched)
	sort.Strings(extra)

	if len(missing) > 0 {
		t.Errorf("Go output missing %d paths from TS reference: %v", len(missing), missing)
	}
	if len(extra) > 0 {
		t.Errorf("Go output has %d extra paths not in TS reference: %v", len(extra), extra)
	}
	for _, p := range mismatched {
		t.Errorf("path %s: bytes differ\nGo:\n%s\nTS:\n%s\n", p, gotS[p], want[p])
	}
}

// scenarioMultiPhase holds runners that can't be expressed as a single
// Generate call. Each runner builds the FS state (running multiple
// generations + external edits) and returns the MemFS for assertion.
var scenarioMultiPhase = map[string]func(*testing.T) *MemFS{
	"merge_basic":  func(t *testing.T) *MemFS { return mergeRunner(t, "AAA\n", "AAA\nuser-line\n", "BBB\n", "$$body$$") },
	"merge_update": func(t *testing.T) *MemFS { return mergeRunner(t, "AAA\n", "// header\nAAA\n// user-comment\n", "BBB\n", "// header\n$$body$$") },
	"merge_clean":  func(t *testing.T) *MemFS { return mergeRunnerNoEdit(t, "AAA\n", "CCC\n", "$$body$$") },
}

// mergeRunner runs the canonical 2-phase merge scenario: gen A, user
// edit, regen B with merge mode.
func mergeRunner(t *testing.T, bodyA, userEdit, bodyB, srcTpl string) *MemFS {
	t.Helper()
	mem := NewMemFS()
	now := func() int64 { return frozenNow }
	gen := func(body string, opts Options) {
		j := New(WithFS(mem), WithFolder("/out"), WithNow(now), WithModel(map[string]any{"body": body}))
		_, err := j.Generate(opts, func(j *J) {
			j.Project(ProjectProps{Folder: "sdk"}, func(j *J) {
				j.File("foo.txt", func(j *J) { j.Content(srcTpl) })
			})
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	gen(bodyA, Options{})
	_ = mem.WriteFile("/out/sdk/foo.txt", []byte(userEdit))
	mergeTrue := true
	gen(bodyB, Options{Existing: Existing{Txt: ExistingTxt{Merge: &mergeTrue}}})
	return mem
}

// mergeRunnerNoEdit skips the user edit between generations - exercises
// the clean-merge path where existing matches the prior baseline.
func mergeRunnerNoEdit(t *testing.T, bodyA, bodyB, srcTpl string) *MemFS {
	t.Helper()
	mem := NewMemFS()
	now := func() int64 { return frozenNow }
	gen := func(body string, opts Options) {
		j := New(WithFS(mem), WithFolder("/out"), WithNow(now), WithModel(map[string]any{"body": body}))
		_, err := j.Generate(opts, func(j *J) {
			j.Project(ProjectProps{Folder: "sdk"}, func(j *J) {
				j.File("foo.txt", func(j *J) { j.Content(srcTpl) })
			})
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	gen(bodyA, Options{})
	mergeTrue := true
	gen(bodyB, Options{Existing: Existing{Txt: ExistingTxt{Merge: &mergeTrue}}})
	return mem
}
