package jostraca

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Same scenarios, both filesystem providers. Mirrors ts/test/provider.test.ts.
//
// Why this suite exists: T0. In the canonical stack, `Jostraca()` with no
// fs and no mem could not write to the real filesystem at all — the
// library's primary documented use case, broken, in a suite that was
// green. It survived because EVERY test injected a memfs provider, so
// nothing ever exercised the production path the double stood in for.
//
// Go's default is correct (newFileHandler falls back to OsFS), but the
// same blind spot exists in the same shape here: almost every Go test
// runs on MemFS. A test double used universally hides defects in exactly
// the code it replaces.
//
// The comparison is differential — no expected output is transcribed —
// so adding a scenario covers both providers by construction.

type providerHarness struct {
	name   string
	folder string
	// opts returns the FS option plus folder for Generate.
	newJ func(opts ...Option) *J
	// put seeds a file before generating, as an existing user file would be.
	put func(t *testing.T, rel, text string)
	// tree returns the whole output tree, relative path -> content.
	tree    func(t *testing.T) map[string]string
	cleanup func()
}

func memProviderHarness() *providerHarness {
	mem := NewMemFS()
	folder := "/out"

	return &providerHarness{
		name:   "MemFS",
		folder: folder,
		newJ: func(opts ...Option) *J {
			return New(append([]Option{WithFS(mem), WithFolder(folder)}, opts...)...)
		},
		put: func(t *testing.T, rel, text string) {
			t.Helper()
			full := folder + "/" + rel
			if err := mem.MkdirAll(pathDir(full)); err != nil {
				t.Fatal(err)
			}
			if err := mem.WriteFile(full, []byte(text)); err != nil {
				t.Fatal(err)
			}
		},
		tree: func(t *testing.T) map[string]string {
			t.Helper()
			out := map[string]string{}
			for k, v := range mem.Vol() {
				if !strings.HasPrefix(k, folder+"/") {
					continue
				}
				out[k[len(folder)+1:]] = string(v)
			}
			return out
		},
		cleanup: func() {},
	}
}

func osProviderHarness(t *testing.T) *providerHarness {
	t.Helper()
	folder := t.TempDir()

	return &providerHarness{
		name:   "OsFS",
		folder: folder,
		// No WithFS: this is the default path a plain caller gets.
		newJ: func(opts ...Option) *J {
			return New(append([]Option{WithFolder(folder)}, opts...)...)
		},
		put: func(t *testing.T, rel, text string) {
			t.Helper()
			full := filepath.Join(append([]string{folder}, strings.Split(rel, "/")...)...)
			if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(full, []byte(text), 0o644); err != nil {
				t.Fatal(err)
			}
		},
		tree: func(t *testing.T) map[string]string {
			t.Helper()
			out := map[string]string{}
			err := filepath.Walk(folder, func(p string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				if info.IsDir() {
					return nil
				}
				rel, err := filepath.Rel(folder, p)
				if err != nil {
					return err
				}
				body, err := os.ReadFile(p)
				if err != nil {
					return err
				}
				out[filepath.ToSlash(rel)] = string(body)
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			return out
		},
		// t.TempDir cleans itself up.
		cleanup: func() {},
	}
}

func pathDir(p string) string {
	at := strings.LastIndexByte(p, '/')
	if at < 0 {
		return "."
	}
	return p[:at]
}

// normaliseTree strips the output folder from the meta log, whose
// absolute paths differ by provider by construction. Everything else must
// match byte for byte.
func normaliseTree(tree map[string]string, folder string) map[string]string {
	out := make(map[string]string, len(tree))
	for path, text := range tree {
		if strings.Contains(path, ".jostraca") {
			text = strings.ReplaceAll(text, folder, "<FOLDER>")
		}
		out[path] = text
	}
	return out
}

const providerNow = 1735689600000

type providerScenario struct {
	name string
	run  func(t *testing.T, h *providerHarness)
	// produces lists files the scenario must have written, so a scenario
	// that silently does nothing cannot pass by producing nothing on both
	// providers.
	produces []string
}

var providerScenarios = []providerScenario{
	{
		name:     "fresh-generate",
		produces: []string{"app/src/index.js", "app/package.json"},
		run: func(t *testing.T, h *providerHarness) {
			j := h.newJ(WithNow(func() int64 { return providerNow }))
			_, err := j.Generate(Options{}, func(j *J) {
				j.Project(ProjectProps{Folder: "app"}, func(j *J) {
					j.Folder("src", func(j *J) {
						j.File("index.js", func(j *J) { j.Content("console.log(1)\n") })
					})
					j.File("package.json", func(j *J) { j.Content("{\"name\":\"app\"}\n") })
				})
			})
			if err != nil {
				t.Fatal(err)
			}
		},
	},

	{
		name:     "regenerate-changed-content",
		produces: []string{"app/a.txt"},
		run: func(t *testing.T, h *providerHarness) {
			gen := func(body string) {
				j := h.newJ(WithNow(func() int64 { return providerNow }))
				_, err := j.Generate(Options{}, func(j *J) {
					j.Project(ProjectProps{Folder: "app"}, func(j *J) {
						j.File("a.txt", func(j *J) { j.Content(body) })
					})
				})
				if err != nil {
					t.Fatal(err)
				}
			}
			gen("ONE\n")
			gen("TWO\n")
		},
	},

	{
		name:     "preserve-user-edit",
		produces: []string{"app/a.txt"},
		run: func(t *testing.T, h *providerHarness) {
			h.put(t, "app/a.txt", "USER WROTE THIS\n")
			yes := true
			j := h.newJ(WithNow(func() int64 { return providerNow }))
			_, err := j.Generate(Options{
				Existing: Existing{Txt: ExistingTxt{Preserve: &yes}},
			}, func(j *J) {
				j.Project(ProjectProps{Folder: "app"}, func(j *J) {
					j.File("a.txt", func(j *J) { j.Content("GENERATED\n") })
				})
			})
			if err != nil {
				t.Fatal(err)
			}
		},
	},

	{
		name:     "merge-user-edit",
		produces: []string{"app/a.txt"},
		run: func(t *testing.T, h *providerHarness) {
			gen := func(body string, opts Options) {
				j := h.newJ(WithNow(func() int64 { return providerNow }))
				_, err := j.Generate(opts, func(j *J) {
					j.Project(ProjectProps{Folder: "app"}, func(j *J) {
						j.File("a.txt", func(j *J) { j.Content(body) })
					})
				})
				if err != nil {
					t.Fatal(err)
				}
			}

			// First pass lays down the baseline the merge needs.
			gen("line1\nline2\nline3\n", Options{})
			h.put(t, "app/a.txt", "line1\nline2\nUSER LINE\nline3\n")

			yes := true
			gen("line1\nCHANGED\nline3\n",
				Options{Existing: Existing{Txt: ExistingTxt{Merge: &yes}}})
		},
	},

	{
		name:     "diff-annotates",
		produces: []string{"app/a.txt"},
		run: func(t *testing.T, h *providerHarness) {
			h.put(t, "app/a.txt", "OLD\n")
			yes := true
			j := h.newJ(WithNow(func() int64 { return providerNow }))
			_, err := j.Generate(Options{
				Existing: Existing{Txt: ExistingTxt{Diff: &yes}},
			}, func(j *J) {
				j.Project(ProjectProps{Folder: "app"}, func(j *J) {
					j.File("a.txt", func(j *J) { j.Content("NEW\n") })
				})
			})
			if err != nil {
				t.Fatal(err)
			}
		},
	},

	{
		name:     "inject-into-existing",
		produces: []string{"app/a.txt"},
		run: func(t *testing.T, h *providerHarness) {
			h.put(t, "app/a.txt", "head\n#--START--#\nstale\n#--END--#\ntail\n")
			j := h.newJ(WithNow(func() int64 { return providerNow }))
			_, err := j.Generate(Options{}, func(j *J) {
				j.Project(ProjectProps{Folder: "app"}, func(j *J) {
					j.Inject("a.txt", func(j *J) { j.Content("injected\n") })
				})
			})
			if err != nil {
				t.Fatal(err)
			}
		},
	},

	{
		name:     "copy-tree",
		produces: []string{"app/lib/one.txt", "app/lib/deep/two.txt"},
		run: func(t *testing.T, h *providerHarness) {
			h.put(t, "src/one.txt", "ONE\n")
			h.put(t, "src/deep/two.txt", "TWO\n")
			j := h.newJ(WithNow(func() int64 { return providerNow }))
			_, err := j.Generate(Options{}, func(j *J) {
				j.Project(ProjectProps{Folder: "app"}, func(j *J) {
					j.Copy(CopyProps{From: h.folder + "/src", To: "lib"})
				})
			})
			if err != nil {
				t.Fatal(err)
			}
		},
	},

	{
		name:     "nested-folders",
		produces: []string{"app/a/b/c/deep.txt"},
		run: func(t *testing.T, h *providerHarness) {
			j := h.newJ(WithNow(func() int64 { return providerNow }))
			_, err := j.Generate(Options{}, func(j *J) {
				j.Project(ProjectProps{Folder: "app"}, func(j *J) {
					j.Folder("a", func(j *J) {
						j.Folder("b", func(j *J) {
							j.Folder("c", func(j *J) {
								j.File("deep.txt", func(j *J) { j.Content("DEEP\n") })
							})
						})
					})
				})
			})
			if err != nil {
				t.Fatal(err)
			}
		},
	},
}

func TestProviderParity(t *testing.T) {
	for _, scenario := range providerScenarios {
		t.Run(scenario.name, func(t *testing.T) {
			harnesses := []*providerHarness{
				memProviderHarness(),
				osProviderHarness(t),
			}

			trees := map[string]map[string]string{}
			for _, h := range harnesses {
				scenario.run(t, h)
				trees[h.name] = normaliseTree(h.tree(t), h.folder)
				defer h.cleanup()
			}

			first, second := harnesses[0].name, harnesses[1].name

			// Vacuity guard: a scenario that produces nothing would
			// otherwise "agree" on both providers.
			for _, name := range []string{first, second} {
				for _, rel := range scenario.produces {
					if _, ok := trees[name][rel]; !ok {
						t.Fatalf("%s: %s missing, tree = %v",
							name, rel, sortedKeys(trees[name]))
					}
				}
			}

			// The real assertion: same paths, same bytes, either provider.
			ka, kb := sortedKeys(trees[first]), sortedKeys(trees[second])
			if strings.Join(ka, ",") != strings.Join(kb, ",") {
				t.Fatalf("different files\n %s: %v\n %s: %v", first, ka, second, kb)
			}

			for _, rel := range ka {
				if trees[first][rel] != trees[second][rel] {
					t.Errorf("%s differs\n %s: %q\n %s: %q",
						rel, first, trees[first][rel], second, trees[second][rel])
				}
			}
		})
	}
}

// Mode bits only exist on the real filesystem, so this one cannot be a
// differential — but it is the same lesson, and it is the reason the
// atomic write has to chmod after rename.
func TestProviderFileModeSurvivesRegeneration(t *testing.T) {
	h := osProviderHarness(t)

	gen := func(body string) {
		j := h.newJ(WithNow(func() int64 { return providerNow }))
		_, err := j.Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{Folder: "app"}, func(j *J) {
				j.FileP(FileProps{Name: "run.sh", Mode: 0o755}, func(j *J) {
					j.Content(body)
				})
			})
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	target := filepath.Join(h.folder, "app", "run.sh")

	gen("#!/bin/sh\necho one\n")
	first, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if first.Mode()&0o111 == 0 {
		t.Fatalf("first write is not executable: %v", first.Mode())
	}

	gen("#!/bin/sh\necho two\n")
	second, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if second.Mode()&0o111 == 0 {
		t.Fatalf("regeneration dropped +x: %v", second.Mode())
	}

	// Rename swaps the inode; a leftover temp file means the swap did not
	// complete cleanly.
	entries, err := os.ReadDir(filepath.Join(h.folder, "app"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() != "run.sh" {
			t.Errorf("stray file left behind: %s", e.Name())
		}
	}
}
