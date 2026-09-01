package jostraca

import (
	"reflect"
	"sort"
	"testing"
)

// Directory-only state used to be invisible to every gate in the repo.
// MemFS.Vol() returned map[string][]byte -- files only -- so there was no
// representation for a directory at all. Two findings hid behind that:
//
//	an EMPTY Folder was materialised by TS's FolderOp and not by Go's
//	folderBefore, and no snapshot could compare the two;
//
//	a dry run created the whole output directory tree while writing no
//	files, and TestDryrunWritesNothing passed on a volume that could not
//	see them.
//
// Vol() now reports an empty directory as a NIL value, mirroring TS's
// memfs toJSON(), which writes null for one. A directory appears only
// while empty -- otherwise its children stand for it. See #41 and the
// empty_folder parity snapshot.

// volEntries splits a snapshot into files and directories.
func volEntries(m *MemFS) (files, dirs []string) {
	for k, v := range m.Vol() {
		if v == nil {
			dirs = append(dirs, k)
		} else {
			files = append(files, k)
		}
	}
	sort.Strings(files)
	sort.Strings(dirs)
	return
}

func dirGen(t *testing.T, control Control, body func(*J)) *MemFS {
	t.Helper()
	m := NewMemFS()
	j := New(WithFS(m), WithFolder("/out"), WithControl(control),
		WithNow(func() int64 { return 1735689600000 }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, body)
	}); err != nil {
		t.Fatal(err)
	}
	return m
}

// An empty directory is reported, a populated one is not.
func TestVolReportsEmptyDirectoriesOnly(t *testing.T) {
	m := dirGen(t, Control{}, func(j *J) {
		j.Folder("empty", func(j *J) {})
		j.Folder("full", func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("A\n") })
		})
	})

	_, dirs := volEntries(m)
	want := []string{"/out/app/empty"}
	if !reflect.DeepEqual(dirs, want) {
		t.Errorf("directories:\n got: %v\nwant: %v\n"+
			"a directory is reported only while empty; /out/app/full has a "+
			"child, so its child stands for it", dirs, want)
	}
}

// The regression: an empty Folder reaches the filesystem, as it does in TS.
func TestEmptyFolderIsMaterialised(t *testing.T) {
	m := dirGen(t, Control{}, func(j *J) {
		j.Folder("empty", func(j *J) {})
	})

	if !m.Exists("/out/app/empty") {
		t.Error("an empty Folder was not created; TS's FolderOp calls " +
			"ensureFolder and folderBefore has to as well")
	}
}

// Nesting: the outer folder holds a child so is absent, the inner one is
// empty and is recorded. Pins the recursive half.
func TestNestedEmptyFolder(t *testing.T) {
	m := dirGen(t, Control{}, func(j *J) {
		j.Folder("outer", func(j *J) {
			j.Folder("inner", func(j *J) {})
		})
	})

	_, dirs := volEntries(m)
	want := []string{"/out/app/outer/inner"}
	if !reflect.DeepEqual(dirs, want) {
		t.Errorf("directories:\n got: %v\nwant: %v", dirs, want)
	}
}

// An empty FILE is not a directory. bytes.Equal calls nil and a
// zero-length slice equal, so this distinction has to be carried by the
// nil-ness itself -- which is also why assertVol compares kinds before
// bytes.
func TestEmptyFileIsNotADirectory(t *testing.T) {
	m := dirGen(t, Control{}, func(j *J) {
		j.File("empty.txt", func(j *J) {})
	})

	v, ok := m.Vol()["/out/app/empty.txt"]
	if !ok {
		t.Fatal("empty file missing from Vol()")
	}
	if v == nil {
		t.Error("an empty file reported as nil; nil means directory")
	}
	if len(v) != 0 {
		t.Errorf("expected zero-length content, got %q", v)
	}
}

// The second finding: a dry run creates NOTHING, directories included.
// ensureDirOf sat outside the dryrun guard in write, present, diff, merge,
// the duplicate baseline and BuildMeta.done, so `dryrun: true` laid down
// the whole output tree while writing no file.
func TestDryrunCreatesNoDirectories(t *testing.T) {
	m := dirGen(t, Control{Dryrun: true}, func(j *J) {
		j.Folder("sub", func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("SECRET\n") })
		})
	})

	files, dirs := volEntries(m)
	if len(files) != 0 {
		t.Errorf("dryrun wrote files: %v", files)
	}
	if len(dirs) != 0 {
		t.Errorf("dryrun created directories: %v -- ensureFolder has to be "+
			"a no-op under a dry run, as TS's is", dirs)
	}
}

// A dry run must not create the PROJECT folder either. projectBefore calls
// ensureFolder before any component runs, so it is the first thing that
// would leak.
func TestDryrunCreatesNoProjectFolder(t *testing.T) {
	m := dirGen(t, Control{Dryrun: true}, func(j *J) {
		j.File("a.txt", func(j *J) { j.Content("X\n") })
	})

	if len(m.Vol()) != 0 {
		t.Errorf("dryrun left %v behind", m.Vol())
	}
}

// The other side of the guard: without dryrun the directories are real, so
// the tests above are measuring the guard and not an inert code path.
func TestWithoutDryrunDirectoriesAreCreated(t *testing.T) {
	m := dirGen(t, Control{}, func(j *J) {
		j.Folder("sub", func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("X\n") })
		})
	})

	if !m.Exists("/out/app/sub") {
		t.Error("/out/app/sub was not created")
	}
	if string(m.Vol()["/out/app/sub/a.txt"]) != "X\n" {
		t.Errorf("got %q", m.Vol()["/out/app/sub/a.txt"])
	}
}
