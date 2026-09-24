package jostraca

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// A backslash in an output-path component is a separator on every
// platform: the folded path is used for the directory, the read, the
// write, the baseline, the meta key and the files lists, and no literal
// backslash directory is left behind. Twin of 'backslash-in-output-names'
// in ts/test/filehandler.test.ts.
func TestBackslashInOutputNames(t *testing.T) {
	dir := t.TempDir()
	out := filepath.ToSlash(filepath.Join(dir, "out"))
	if err := os.MkdirAll(filepath.Join(dir, "out", "a"), 0o777); err != nil {
		t.Fatal(err)
	}
	seed := "<\n#--START--#\nold\n#--END--#\n>"
	if err := os.WriteFile(filepath.Join(dir, "out", "a", "t.txt"), []byte(seed), 0o666); err != nil {
		t.Fatal(err)
	}

	res, err := New(WithFolder(out), WithNow(func() int64 { return fhNow })).
		Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("a\\b.txt", func(j *J) { j.Content("B") })
				j.Folder("x\\y", func(j *J) {
					j.File("a.txt", func(j *J) { j.Content("A") })
				})
				j.Inject("a\\t.txt", func(j *J) { j.Content("NEW") })
			})
			j.Project(ProjectProps{Folder: "p\\q"}, func(j *J) {
				j.File("c.txt", func(j *J) { j.Content("C") })
			})
		})
	if err != nil {
		t.Fatal(err)
	}

	var got []string
	_ = filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err == nil && p != dir {
			rel, _ := filepath.Rel(dir, p)
			if info.IsDir() {
				rel += "/"
			}
			got = append(got, filepath.ToSlash(rel))
		}
		return nil
	})
	sort.Strings(got)
	want := []string{
		"out/",
		"out/.jostraca/",
		"out/.jostraca/.gitignore",
		"out/.jostraca/generated/",
		"out/.jostraca/generated/a/",
		"out/.jostraca/generated/a/b.txt",
		"out/.jostraca/generated/a/t.txt",
		"out/.jostraca/generated/p/",
		"out/.jostraca/generated/p/q/",
		"out/.jostraca/generated/p/q/c.txt",
		"out/.jostraca/generated/x/",
		"out/.jostraca/generated/x/y/",
		"out/.jostraca/generated/x/y/a.txt",
		"out/.jostraca/jostraca.meta.log",
		"out/a/",
		"out/a/b.txt",
		"out/a/t.txt",
		"out/p/",
		"out/p/q/",
		"out/p/q/c.txt",
		"out/x/",
		"out/x/y/",
		"out/x/y/a.txt",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("tree:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}

	inj, _ := os.ReadFile(filepath.Join(dir, "out", "a", "t.txt"))
	if string(inj) != "<\n#--START--#\nNEW\n#--END--#\n>" {
		t.Errorf("injected t.txt = %q", inj)
	}

	files, _ := fhMeta(t, OsFS{}, out+"/.jostraca/jostraca.meta.log")["files"].(map[string]any)
	keys := make([]string, 0, len(files))
	for k := range files {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if strings.Join(keys, ",") != "a/b.txt,a/t.txt,p/q/c.txt,x/y/a.txt" {
		t.Errorf("meta keys = %v", keys)
	}
	if e, _ := files["a/t.txt"].(map[string]any); e == nil || e["exists"] != true {
		t.Errorf("inject meta = %v, want exists true", files["a/t.txt"])
	}
	written := strings.Join(res.Files.Written, ",")
	for _, w := range []string{out + "/a/b.txt", out + "/x/y/a.txt", out + "/a/t.txt", out + "/p/q/c.txt"} {
		if !strings.Contains(written, w) {
			t.Errorf("written %v lacks %s", res.Files.Written, w)
		}
	}
}
