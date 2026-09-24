package jostraca

import (
	"reflect"
	"sort"
	"strings"
	"testing"
)

// A Project's folder applies only to its own subtree. When it closes the
// enclosing folder state comes back, so a later sibling lands where it would
// have without the Project, and nothing is written outside the output
// folder. Go used to keep every later sibling inside the nested Project's
// folder; TS popped the enclosing Folder's segment off the Project's path
// instead, and with the Project two Folders deep wrote above the output
// folder. Mirrors the 'project-*' tests in the `components` block of
// ts/test/jostraca.test.ts.

func projectScopeGen(t *testing.T, folder string, root func(*J)) (files, written []string) {
	t.Helper()
	m := NewMemFS()
	res, err := New(WithFS(m), WithFolder(folder),
		WithNow(func() int64 { return 1735689600000 })).Generate(Options{}, root)
	if err != nil {
		t.Fatal(err)
	}
	for k := range m.Vol() {
		if !strings.Contains(k, "/.jostraca/") {
			files = append(files, k)
		}
	}
	sort.Strings(files)
	written = append(written, res.Files.Written...)
	sort.Strings(written)
	return files, written
}

func expectFiles(t *testing.T, got, want []string) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %q\nwant %q", got, want)
	}
}

func TestProjectNestedInFolder(t *testing.T) {
	files, written := projectScopeGen(t, "/out", func(j *J) {
		j.Project(ProjectProps{Folder: "."}, func(j *J) {
			j.Folder("a", func(j *J) {
				j.Project(ProjectProps{Folder: "p2"}, func(j *J) {
					j.File("x.txt", func(j *J) { j.Content("x") })
				})
			})
			j.File("y.txt", func(j *J) { j.Content("y") })
		})
	})
	expectFiles(t, files, []string{"/out/a", "/out/p2/x.txt", "/out/y.txt"})
	expectFiles(t, written, []string{"/out/p2/x.txt", "/out/y.txt"})
}

func TestProjectNestedTwoFolders(t *testing.T) {
	files, _ := projectScopeGen(t, "/w/out", func(j *J) {
		j.Project(ProjectProps{Folder: "."}, func(j *J) {
			j.Folder("a", func(j *J) {
				j.Folder("b", func(j *J) {
					j.Project(ProjectProps{Folder: "p2"}, func(j *J) {
						j.File("x.txt", func(j *J) { j.Content("x") })
					})
				})
				j.File("z.txt", func(j *J) { j.Content("z") })
			})
			j.File("y.txt", func(j *J) { j.Content("y") })
		})
	})
	expectFiles(t, files, []string{
		"/w/out/a/b", "/w/out/a/z.txt", "/w/out/p2/x.txt", "/w/out/y.txt"})
}

// #26: a File after a sibling Project lands in the enclosing folder, not in
// the Project's, whether the two sit in an outer Project or at the top.
func TestProjectThenSiblingFile(t *testing.T) {
	files, _ := projectScopeGen(t, "/out", func(j *J) {
		j.Project(ProjectProps{Folder: "."}, func(j *J) {
			j.Project(ProjectProps{Folder: "p"}, func(j *J) {
				j.File("a.txt", func(j *J) { j.Content("a") })
			})
			j.File("y.txt", func(j *J) { j.Content("y") })
		})
	})
	expectFiles(t, files, []string{"/out/p/a.txt", "/out/y.txt"})

	files, _ = projectScopeGen(t, "/out", func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("a") })
		})
		j.File("y.txt", func(j *J) { j.Content("y") })
	})
	expectFiles(t, files, []string{"/out/p/a.txt", "/out/y.txt"})
}

func TestTwoSiblingProjects(t *testing.T) {
	files, _ := projectScopeGen(t, "/out", func(j *J) {
		j.Project(ProjectProps{Folder: "a"}, func(j *J) {
			j.File("x.txt", func(j *J) { j.Content("x") })
		})
		j.Project(ProjectProps{Folder: "b"}, func(j *J) {
			j.File("y.txt", func(j *J) { j.Content("y") })
		})
	})
	expectFiles(t, files, []string{"/out/a/x.txt", "/out/b/y.txt"})
}
