package jostraca

import (
	"regexp"
	"testing"
)

// A File exclude applies only when the target exists. true skips it; a
// string, or a list holding a string, skips it when equal to the
// component path: the Project name, the Folder names, the File name.
// Never the Project folder. A regexp entry matches nothing. Twin of
// 'file-exclude-string-and-list' in ts/test/filehandler.test.ts.
func TestFileExcludeStringAndList(t *testing.T) {
	type row struct {
		name     string
		out      string
		excluded bool
		root     func(j *J)
		tree     map[string]any
	}
	file := func(name string, ex any) map[string]any {
		return map[string]any{
			"cmp": "File", "props": map[string]any{"name": name, "exclude": ex},
			"children": []any{map[string]any{
				"cmp": "Content", "props": map[string]any{"src": "NEW"},
			}},
		}
	}
	rows := []row{
		{"string", "/out/keep.txt", true, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.FileP(FileProps{Name: "keep.txt", Exclude: "keep.txt"},
					func(j *J) { j.Content("NEW") })
			})
		}, map[string]any{"cmp": "Project", "props": map[string]any{},
			"children": []any{file("keep.txt", "keep.txt")}}},
		{"list-in-folder", "/out/sub/keep2.txt", true, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Folder("sub", func(j *J) {
					j.FileP(FileProps{Name: "keep2.txt", Exclude: []any{"sub/keep2.txt"}},
						func(j *J) { j.Content("NEW") })
				})
			})
		}, map[string]any{"cmp": "Project", "props": map[string]any{},
			"children": []any{map[string]any{
				"cmp": "Folder", "props": map[string]any{"name": "sub"},
				"children": []any{file("keep2.txt", []any{"sub/keep2.txt"})},
			}}}},
		{"named-project", "/out/a.txt", true, func(j *J) {
			j.Project(ProjectProps{Name: "pn"}, func(j *J) {
				j.FileP(FileProps{Name: "a.txt", Exclude: "pn/a.txt"},
					func(j *J) { j.Content("NEW") })
			})
		}, map[string]any{"cmp": "Project", "props": map[string]any{"name": "pn"},
			"children": []any{file("a.txt", "pn/a.txt")}}},
		{"project-folder-is-not-the-path", "/out/x/a.txt", false, func(j *J) {
			j.Project(ProjectProps{Folder: "x"}, func(j *J) {
				j.FileP(FileProps{Name: "a.txt", Exclude: "x/a.txt"},
					func(j *J) { j.Content("NEW") })
			})
		}, map[string]any{"cmp": "Project", "props": map[string]any{"folder": "x"},
			"children": []any{file("a.txt", "x/a.txt")}}},
		{"regexp-matches-nothing", "/out/a.txt", false, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.FileP(FileProps{Name: "a.txt", Exclude: []any{regexp.MustCompile("a")}},
					func(j *J) { j.Content("NEW") })
			})
		}, nil},
		{"string-string-list", "/out/a.txt", true, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.FileP(FileProps{Name: "a.txt", Exclude: []string{"b.txt", "a.txt"}},
					func(j *J) { j.Content("NEW") })
			})
		}, nil},
		{"other-values-do-not-exclude", "/out/a.txt", false, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.FileP(FileProps{Name: "a.txt", Exclude: []any{}},
					func(j *J) { j.Content("NEW") })
			})
		}, map[string]any{"cmp": "Project", "props": map[string]any{},
			"children": []any{file("a.txt", []any{})}}},
	}

	for _, r := range rows {
		for _, via := range []string{"typed", "tree"} {
			root := r.root
			if via == "tree" {
				if r.tree == nil {
					continue
				}
				var err error
				if root, err = CmpTree(r.tree); err != nil {
					t.Fatalf("%s: %v", r.name, err)
				}
			}
			mem := NewMemFS()
			_ = mem.WriteFile(r.out, []byte("OLD"))
			res, err := New(WithFS(mem), WithFolder("/out"),
				WithNow(func() int64 { return fhNow })).Generate(Options{}, root)
			if err != nil {
				t.Fatalf("%s/%s: %v", r.name, via, err)
			}
			got, _ := mem.ReadFile(r.out)
			rel := r.out[len("/out/"):]
			hasBaseline := mem.Exists("/out/.jostraca/generated/" + rel)
			files, _ := fhMeta(t, mem, "/out/.jostraca/jostraca.meta.log")["files"].(map[string]any)
			_, hasMeta := files[rel]
			if r.excluded {
				if string(got) != "OLD" || len(res.Files.Written) != 0 || hasBaseline || hasMeta {
					t.Errorf("%s/%s: content=%q written=%v baseline=%v meta=%v, want excluded",
						r.name, via, got, res.Files.Written, hasBaseline, hasMeta)
				}
			} else if string(got) != "NEW" || len(res.Files.Written) != 1 {
				t.Errorf("%s/%s: content=%q written=%v, want written",
					r.name, via, got, res.Files.Written)
			}
		}
	}
}

// A Project's name joins the node path; its folder does not.
func TestProjectNamePushesThePath(t *testing.T) {
	build := false
	var root *Node
	_, _ = New().Generate(Options{Build: &build}, func(j *J) {
		j.Project(ProjectProps{Name: "pn", Folder: "f"}, func(j *J) {
			j.File("a.txt", func(j *J) {})
		})
		root = j.st.root
	})
	// st.root is the first node attached, the Project itself.
	file := root.Children[0]
	if got := file.Path; len(got) != 2 || got[0] != "pn" || got[1] != "a.txt" {
		t.Errorf("Path = %v, want [pn a.txt]", got)
	}
}
