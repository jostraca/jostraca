package jostraca

import (
	"os"
	"path/filepath"
	"runtime"
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

// A SOURCE path keeps its platform meaning. On POSIX a backslash is an
// ordinary name character, so a Copy source holding `b\in.png` and
// `we\ird.txt` is read at those names, binary and text alike; the
// DESTINATION names fold it, as every output path does. Windows cannot hold
// such a name. Twin of 'backslash-in-copy-source-names' in
// ts/test/filehandler.test.ts.
func TestBackslashInCopySourceNames(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("a backslash is a separator on Windows")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(src, 0o777); err != nil {
		t.Fatal(err)
	}
	png := []byte{0x89, 0x50, 1, 2}
	if err := os.WriteFile(filepath.Join(src, "b\\in.png"), png, 0o666); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "we\\ird.txt"), []byte("W $$m$$\n"), 0o666); err != nil {
		t.Fatal(err)
	}
	out := filepath.ToSlash(filepath.Join(dir, "out"))

	res, err := New(WithFolder(out), WithNow(func() int64 { return fhNow }),
		WithModel(map[string]any{"m": "M"})).
		Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.CopyFiles(CopyFilesProps{From: src, To: "d"})
				j.CopyFiles(CopyFilesProps{From: filepath.Join(src, "b\\in.png"), To: "one.png"})
			})
		})
	if err != nil {
		t.Fatal(err)
	}

	for rel, want := range map[string]string{
		"d/b/in.png":   string(png),
		"d/we/ird.txt": "W M\n",
		"one.png":      string(png),
	} {
		got, err := os.ReadFile(filepath.Join(dir, "out", filepath.FromSlash(rel)))
		if err != nil || string(got) != want {
			t.Errorf("%s = %q, %v; want %q", rel, got, err, want)
		}
	}
	written := make([]string, 0, len(res.Files.Written))
	for _, w := range res.Files.Written {
		written = append(written, strings.TrimPrefix(w, out))
	}
	sort.Strings(written)
	if strings.Join(written, ",") != "/d/b/in.png,/d/we/ird.txt,/one.png" {
		t.Errorf("written = %v", written)
	}
}

// A backslash `..` segment in the output folder or a Project folder is
// folded, then resolved, so the run leaves no stray directory for the
// segment it walked back out of, and its bookkeeping sits under the folder
// its files are written to. Twin of 'backslash-dot-dot-folders' in
// ts/test/filehandler.test.ts.
func TestBackslashDotDotFolders(t *testing.T) {
	dir := t.TempDir()
	base := filepath.ToSlash(dir)
	_, err := New(WithFolder(base+"/o\\..\\out"), WithNow(func() int64 { return fhNow })).
		Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("a.txt", func(j *J) { j.Content("A") })
			})
			j.Project(ProjectProps{Folder: "p\\..\\q"}, func(j *J) {
				j.File("b.txt", func(j *J) { j.Content("B") })
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
		"out/.jostraca/generated/a.txt",
		"out/.jostraca/generated/q/",
		"out/.jostraca/generated/q/b.txt",
		"out/.jostraca/jostraca.meta.log",
		"out/a.txt",
		"out/q/",
		"out/q/b.txt",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("tree:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	files, _ := fhMeta(t, OsFS{}, base+"/out/.jostraca/jostraca.meta.log")["files"].(map[string]any)
	keys := make([]string, 0, len(files))
	for k := range files {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if strings.Join(keys, ",") != "a.txt,q/b.txt" {
		t.Errorf("meta keys = %v", keys)
	}
}
