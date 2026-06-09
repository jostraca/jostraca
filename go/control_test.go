package jostraca

import (
	"testing"
)

// Phase 12 — control tests ported from test/control.test.ts.

func TestControlDryrun(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{
		Control: Control{Dryrun: true},
	}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("hi") })
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	// In dryrun mode the file must NOT be written.
	if mem.Exists("/out/p/a.txt") {
		t.Errorf("dryrun wrote file to disk")
	}
}

func TestControlVersionKeepsMetaInGit(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{
		Control: Control{Version: true},
	}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("hi") })
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	// With Version=true, no .gitignore should be written.
	if mem.Exists("/out/.jostraca/.gitignore") {
		t.Errorf("Version=true should suppress .gitignore")
	}
}

func TestControlNoDuplicateSkipsBaselineCopy(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{
		Control: Control{NoDuplicate: true},
	}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("hi") })
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	// File should be written, but no duplicate baseline.
	if !mem.Exists("/out/p/a.txt") {
		t.Errorf("primary write missing")
	}
	if mem.Exists("/out/.jostraca/generated/p/a.txt") {
		t.Errorf("NoDuplicate should suppress baseline copy")
	}
}

func TestControlBuildFalseSkipsBuild(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	build := false
	res, err := j.Generate(Options{Build: &build}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("hi") })
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	if mem.Exists("/out/p/a.txt") {
		t.Errorf("Build:false wrote a file")
	}
	if len(res.Files.Written) != 0 {
		t.Errorf("Files.Written = %v, want empty", res.Files.Written)
	}
}
