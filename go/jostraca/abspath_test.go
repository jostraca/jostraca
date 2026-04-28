package jostraca

import (
	"testing"
)

// Absolute / relative path composition for Project.Folder and
// Folder name. Mirrors test/merge.test.ts:'path' shape.

func TestProjectAbsoluteFolder(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/global"))
	_, err := j.Generate(Options{}, func(j *J) {
		// Absolute Project.Folder ignores the global folder option.
		j.Project(ProjectProps{Folder: "/elsewhere/sdk"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("hi") })
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	if !mem.Exists("/elsewhere/sdk/a.txt") {
		t.Errorf("absolute Project.Folder ignored: vol = %v", mem.Vol())
	}
	if mem.Exists("/global/elsewhere/sdk/a.txt") {
		t.Errorf("absolute Project.Folder was mistakenly joined to global folder")
	}
}

func TestFolderNameWithLeadingSlash(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/top"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "/top/sdk"}, func(j *J) {
			j.Folder("/code/js", func(j *J) {
				j.File("foo.js", func(j *J) { j.Content("// foo\n") })
			})
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	// Path normalisation collapses the double slash.
	if !mem.Exists("/top/sdk/code/js/foo.js") {
		t.Errorf("composed path missing or wrong-form: %v", mem.Vol())
	}
	// Specifically the dirty form should NOT be a separate key.
	if _, hasDirty := mem.Vol()["/top/sdk//code/js/foo.js"]; hasDirty {
		t.Errorf("double-slash path leaked into output keys")
	}
}

func TestRelativeProjectFolderJoinsGlobal(t *testing.T) {
	// Sanity: relative Project.Folder still joins to the global folder.
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/top"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "sdk"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("hi") })
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	if !mem.Exists("/top/sdk/a.txt") {
		t.Errorf("relative Project.Folder didn't join: %v", mem.Vol())
	}
}
