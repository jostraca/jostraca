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

	got := mem.Vol()
	// Convert to map[string]string for comparison and to match the
	// TS-side JSON schema.
	gotS := make(map[string]string, len(got))
	for k, v := range got {
		gotS[k] = string(v)
	}

	missing := []string{}
	mismatched := []string{}
	for path, want := range c.Vol {
		actual, ok := gotS[path]
		if !ok {
			missing = append(missing, path)
			continue
		}
		if actual != want {
			mismatched = append(mismatched, path)
		}
	}
	extra := []string{}
	for path := range gotS {
		if _, ok := c.Vol[path]; !ok {
			extra = append(extra, path)
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
		t.Errorf("path %s: bytes differ\nGo:\n%s\nTS:\n%s\n", p, gotS[p], c.Vol[p])
	}
}
