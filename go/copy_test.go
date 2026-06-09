package jostraca

import (
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
