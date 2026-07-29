package jostraca

import (
	"errors"
	"sort"
	"strings"
	"testing"
)

// Regression tests for output-path containment and backup-file naming,
// mirroring ts/test/containment.test.ts.

const containWhen int64 = 1735689600000

func outKeys(m *MemFS) []string {
	keys := []string{}
	for k := range m.Vol() {
		if !strings.Contains(k, ".jostraca") {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}

func eqKeys(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("keys: got %v want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("keys: got %v want %v", got, want)
		}
	}
}

func containJ(m *MemFS, extra ...Option) *J {
	o := []Option{WithFS(m), WithFolder("/out"), WithNow(func() int64 { return containWhen })}
	return New(append(o, extra...)...)
}

// A File with no enclosing Project must stay under the output folder.
// (The Go port already resolved this correctly; the test locks it in so
// the TS fix and the port cannot drift apart again.)
func TestFileWithoutProjectStaysInOutputFolder(t *testing.T) {
	m := NewMemFS()
	if _, err := containJ(m).Generate(Options{}, func(j *J) {
		j.File("x.txt", func(j *J) { j.Content("hi\n") })
	}); err != nil {
		t.Fatal(err)
	}
	eqKeys(t, outKeys(m), []string{"/out/x.txt"})
}

func TestFolderWithoutProjectStaysInOutputFolder(t *testing.T) {
	m := NewMemFS()
	if _, err := containJ(m).Generate(Options{}, func(j *J) {
		j.Folder("sub", func(j *J) {
			j.File("y.txt", func(j *J) { j.Content("hi\n") })
		})
	}); err != nil {
		t.Fatal(err)
	}
	eqKeys(t, outKeys(m), []string{"/out/sub/y.txt"})
}

func TestFileNameRejectsTraversal(t *testing.T) {
	m := NewMemFS()
	_, err := containJ(m).Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("../../../../etc/pwned.txt", func(j *J) { j.Content("OWNED\n") })
		})
	})
	if !errors.Is(err, ErrNameTraversal) {
		t.Fatalf("expected ErrNameTraversal, got %v", err)
	}
	if len(outKeys(m)) != 0 {
		t.Fatalf("no file should have been written, got %v", outKeys(m))
	}
}

func TestFolderNameRejectsTraversal(t *testing.T) {
	m := NewMemFS()
	_, err := containJ(m).Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.Folder("../..", func(j *J) {
				j.File("e.txt", func(j *J) { j.Content("X\n") })
			})
		})
	})
	if !errors.Is(err, ErrNameTraversal) {
		t.Fatalf("expected ErrNameTraversal, got %v", err)
	}
}

// A leading "/" in a Folder name composes with the Project folder and
// must keep working — see the absolute_paths parity scenario.
func TestAbsoluteFolderNameStillComposes(t *testing.T) {
	m := NewMemFS()
	j := New(WithFS(m), WithFolder("/top"), WithNow(func() int64 { return containWhen }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "/top/sdk"}, func(j *J) {
			j.Folder("/code/js", func(j *J) {
				j.File("foo.js", func(j *J) { j.Content("// foo\n") })
			})
		})
	}); err != nil {
		t.Fatal(err)
	}
	eqKeys(t, outKeys(m), []string{"/top/sdk/code/js/foo.js"})
}

// Every dotfile in a folder must get its own backup path.
func TestPreserveBacksUpDotfilesDistinctly(t *testing.T) {
	m := NewMemFS()
	_ = m.WriteFile("/out/p/.env", []byte("OLD-ENV\n"))
	_ = m.WriteFile("/out/p/.npmrc", []byte("OLD-NPMRC\n"))

	tr := true
	j := containJ(m, WithExisting(Existing{Txt: ExistingTxt{Preserve: &tr}}))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File(".env", func(j *J) { j.Content("NEW-ENV\n") })
			j.File(".npmrc", func(j *J) { j.Content("NEW-NPMRC\n") })
		})
	}); err != nil {
		t.Fatal(err)
	}

	vol := m.Vol()
	for p, want := range map[string]string{
		"/out/p/.env.old":   "OLD-ENV\n",
		"/out/p/.npmrc.old": "OLD-NPMRC\n",
		"/out/p/.env":       "NEW-ENV\n",
		"/out/p/.npmrc":     "NEW-NPMRC\n",
	} {
		if got := string(vol[p]); got != want {
			t.Errorf("%s: got %q want %q", p, got, want)
		}
	}
}

func TestPreserveBackupNamingUnchangedForNormalFiles(t *testing.T) {
	m := NewMemFS()
	_ = m.WriteFile("/out/p/a.txt", []byte("OLD\n"))
	_ = m.WriteFile("/out/p/b.min.js", []byte("OLDJS\n"))

	tr := true
	j := containJ(m, WithExisting(Existing{Txt: ExistingTxt{Preserve: &tr}}))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("NEW\n") })
			j.File("b.min.js", func(j *J) { j.Content("NEWJS\n") })
		})
	}); err != nil {
		t.Fatal(err)
	}

	vol := m.Vol()
	for p, want := range map[string]string{
		"/out/p/a.old.txt":    "OLD\n",
		"/out/p/b.min.old.js": "OLDJS\n",
	} {
		if got := string(vol[p]); got != want {
			t.Errorf("%s: got %q want %q", p, got, want)
		}
	}
}

func TestAnnotatedPath(t *testing.T) {
	cases := []struct{ in, kind, want string }{
		{"foo/bar.txt", "old", "foo/bar.old.txt"},
		{"foo/bar.txt", "new", "foo/bar.new.txt"},
		{"foo/.env", "old", "foo/.env.old"},
		{"foo/.npmrc", "old", "foo/.npmrc.old"},
		{"foo/noext", "old", "foo/noext.old"},
		{"foo/a.b.txt", "old", "foo/a.b.old.txt"},
		{"bar.txt", "old", "bar.old.txt"},
	}
	for _, c := range cases {
		if got := annotatedPath(c.in, c.kind); got != c.want {
			t.Errorf("annotatedPath(%q,%q) = %q want %q", c.in, c.kind, got, c.want)
		}
	}
}

func TestValidName(t *testing.T) {
	ok := []string{"a.txt", "sub/a.txt", "/code/js", "...", "..foo", "foo..", ""}
	for _, n := range ok {
		if err := validName(n, "File"); err != nil {
			t.Errorf("validName(%q) unexpectedly rejected: %v", n, err)
		}
	}
	bad := []string{"..", "../x", "a/../../x", "..\\x", "sub/.."}
	for _, n := range bad {
		if err := validName(n, "File"); !errors.Is(err, ErrNameTraversal) {
			t.Errorf("validName(%q) should have been rejected, got %v", n, err)
		}
	}
}
