package jostraca

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

// Phase 9 — Copy: file and directory copy with template substitution
// for text files.

func TestCopySingleFile(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/tpl/hello.txt", []byte("Hello $$name$$"))
	j := New(WithFS(mem), WithFolder("/out"), WithModel(map[string]any{"name": "World"}))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Folder("dest", func(j *J) {
			j.Copy(CopyProps{From: "/tpl/hello.txt"})
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := mem.ReadFile("/out/dest/hello.txt")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(got) != "Hello World" {
		t.Errorf("got %q, want 'Hello World'", got)
	}
}

func TestCopyFileWithTo(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/tpl/src.txt", []byte("body"))
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Copy(CopyProps{From: "/tpl/src.txt", To: "renamed.txt"})
	})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := mem.ReadFile("/out/renamed.txt")
	if string(got) != "body" {
		t.Errorf("got %q, want 'body'", got)
	}
}

func TestCopyDirectoryRecursive(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/tpl/a.txt", []byte("A"))
	_ = mem.WriteFile("/tpl/sub/b.txt", []byte("B"))
	_ = mem.WriteFile("/tpl/sub/c.txt", []byte("C"))
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Folder("assets", func(j *J) {
			j.Copy(CopyProps{From: "/tpl"})
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"/out/assets/a.txt", "/out/assets/sub/b.txt", "/out/assets/sub/c.txt"} {
		if !mem.Exists(p) {
			t.Errorf("missing %s", p)
		}
	}
}

func TestCopyBinaryUntouched(t *testing.T) {
	mem := NewMemFS()
	bin := []byte{0x00, 0x01, 0x02, 0xff, '$', '$', 'a', '$', '$'}
	_ = mem.WriteFile("/tpl/blob.png", bin)
	j := New(WithFS(mem), WithFolder("/out"), WithModel(map[string]any{"a": "X"}))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Copy(CopyProps{From: "/tpl/blob.png"})
	})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := mem.ReadFile("/out/blob.png")
	if len(got) != len(bin) {
		t.Fatalf("got len %d, want %d", len(got), len(bin))
	}
	for i := range bin {
		if got[i] != bin[i] {
			t.Errorf("byte %d: got %x, want %x", i, got[i], bin[i])
		}
	}
}

// A directory Copy walks its source in JavaScript's string order, which
// TS gets from readdirSync().sort(): by UTF-16 code unit, so a name
// beginning with a supplementary-plane character (here U+1F600) sorts
// BEFORE one beginning with U+FF5A. Byte order puts it after. The walk
// order is what files.written and the meta log's key order record, so
// both providers are pinned.
var copyOrderNames = []string{
	"10.txt", "9.txt", "B.txt", "Z.txt", "_x.txt", "a.txt",
	"é.txt", "\U0001F600.txt", "ｚ.txt",
}

func checkCopyOrder(t *testing.T, fsys FS, out string, res Result) {
	t.Helper()
	want := make([]string, len(copyOrderNames))
	for i, n := range copyOrderNames {
		want[i] = out + "/" + n
	}
	if !reflect.DeepEqual(res.Files.Written, want) {
		t.Errorf("files.written\n got  %q\n want %q", res.Files.Written, want)
	}
	meta, err := fsys.ReadFile(out + "/.jostraca/jostraca.meta.log")
	if err != nil {
		t.Fatal(err)
	}
	last := -1
	for _, n := range copyOrderNames {
		at := strings.Index(string(meta), `"`+n+`": {`)
		if at <= last {
			t.Errorf("meta.log key %q out of order (at %d, previous %d)", n, at, last)
		}
		last = at
	}
}

func TestCopyDirectoryOrderIsUTF16MemFS(t *testing.T) {
	mem := NewMemFS()
	for _, n := range copyOrderNames {
		_ = mem.WriteFile("/tpl/order/"+n, []byte(n+"\n"))
	}
	res, err := New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return 0 })).
		Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{Folder: "."}, func(j *J) {
				j.Copy(CopyProps{From: "/tpl/order"})
			})
		})
	if err != nil {
		t.Fatal(err)
	}
	checkCopyOrder(t, mem, "/out", res)
}

func TestCopyDirectoryOrderIsUTF16OsFS(t *testing.T) {
	dir := fwd(t.TempDir())
	for _, n := range copyOrderNames {
		if err := os.MkdirAll(dir+"/tpl/order", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(dir+"/tpl/order/"+n, []byte(n+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	out := dir + "/out"
	res, err := New(WithFolder(out), WithNow(func() int64 { return 0 })).
		Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{Folder: "."}, func(j *J) {
				j.Copy(CopyProps{From: dir + "/tpl/order"})
			})
		})
	if err != nil {
		t.Fatal(err)
	}
	checkCopyOrder(t, OsFS{}, out, res)
}
