package jostraca

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// Copy/meta robustness, mirroring ts/test/robustness.test.ts.

const robWhen int64 = 1735689600000

func robJ(fsys FS, folder string, extra ...Option) *J {
	o := []Option{WithFS(fsys), WithFolder(folder), WithNow(func() int64 { return robWhen })}
	return New(append(o, extra...)...)
}

func TestIsBinContent(t *testing.T) {
	if !IsBinContent([]byte{0x61, 0x62, 0x00, 0x63}) {
		t.Error("NUL byte should mark content binary")
	}
	if IsBinContent([]byte("plain text\n")) {
		t.Error("plain text should not be binary")
	}
	// Only the first 8 KB is sampled.
	late := append(bytes.Repeat([]byte("a"), 9000), 0x00)
	if IsBinContent(late) {
		t.Error("NUL past 8KB should not be sampled")
	}
}

// A binary whose extension is not on the (necessarily incomplete) list must
// survive Copy byte-for-byte. .wasm is absent from binaryExts.
func TestCopyPreservesBinaryWithUnlistedExtension(t *testing.T) {
	wasm := []byte{0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0xff, 0xfe}
	m := NewMemFS()
	_ = m.WriteFile("/tm/mod.wasm", wasm)
	_ = m.WriteFile("/tm/readme.txt", []byte("hello $$v$$\n"))

	j := robJ(m, "/out", WithModel(map[string]any{"v": "V"}))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.Copy(CopyProps{From: "/tm"})
		})
	}); err != nil {
		t.Fatal(err)
	}

	if got := m.Vol()["/out/p/mod.wasm"]; !bytes.Equal(got, wasm) {
		t.Errorf("binary corrupted: got % x want % x", got, wasm)
	}
	if got := string(m.Vol()["/out/p/readme.txt"]); got != "hello V\n" {
		t.Errorf("text not templated: %q", got)
	}
}

// Which of existing.txt / existing.bin governs is decided by the
// EXTENSION: an a.png holding ASCII is binary, so existing.bin governs it
// and a Copy never templates it. Go has always classified this way and TS
// classified by the type of the value handed to save, which inverted the
// two stacks against each other; this pins the agreed rule on both sides.
// Mirrors ts/test/robustness.test.ts:
// binary-classification-follows-the-extension.
func TestBinaryClassificationFollowsExtension(t *testing.T) {
	tr := true

	copied := func(ex Existing, tree bool) map[string][]byte {
		m := NewMemFS()
		_ = m.WriteFile("/src/a.png", []byte("hello $$v$$\n"))
		_ = m.WriteFile("/out/p/a.png", []byte("OLD\n"))

		j := robJ(m, "/out", WithModel(map[string]any{"v": "V"}))
		if _, err := j.Generate(Options{Existing: ex}, func(j *J) {
			j.Project(ProjectProps{Folder: "p"}, func(j *J) {
				if tree {
					j.Copy(CopyProps{From: "/src"})
				} else {
					j.Copy(CopyProps{From: "/src/a.png", To: "a.png"})
				}
			})
		}); err != nil {
			t.Fatal(err)
		}
		return m.Vol()
	}

	for _, tree := range []bool{false, true} {
		bin := copied(Existing{Bin: ExistingBin{Preserve: &tr}}, tree)
		if _, ok := bin["/out/p/a.old.png"]; !ok {
			t.Errorf("tree=%v: bin.preserve did not govern a.png", tree)
		}
		if got := string(bin["/out/p/a.png"]); got != "hello $$v$$\n" {
			t.Errorf("tree=%v: binary-extension file was templated: %q", tree, got)
		}

		txt := copied(Existing{Txt: ExistingTxt{Preserve: &tr}}, tree)
		if _, ok := txt["/out/p/a.old.png"]; ok {
			t.Errorf("tree=%v: txt.preserve governed a binary-extension file", tree)
		}
	}

	// A File component writing a plain string is classified the same way.
	m := NewMemFS()
	_ = m.WriteFile("/out/p/a.png", []byte("OLD\n"))
	j := robJ(m, "/out")
	if _, err := j.Generate(Options{Existing: Existing{
		Bin: ExistingBin{Preserve: &tr}, Txt: ExistingTxt{Diff: &tr}}}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.png", func(j *J) { j.Content("NEW\n") })
		})
	}); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.Vol()["/out/p/a.old.png"]; !ok {
		t.Error("bin.preserve did not govern a File-generated a.png")
	}
	// txt.diff must not reach a binary file.
	if got := string(m.Vol()["/out/p/a.png"]); got != "NEW\n" {
		t.Errorf("txt.diff reached a binary-extension file: %q", got)
	}
}

func TestCopyIgnoreAppliesToTextFiles(t *testing.T) {
	m := NewMemFS()
	_ = m.WriteFile("/tm/keep.txt", []byte("KEEP\n"))
	_ = m.WriteFile("/tm/skip.txt-jostraca-off", []byte("SKIP\n"))
	_ = m.WriteFile("/tm/backup.txt~", []byte("BACKUP\n"))

	j := robJ(m, "/out")
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.Copy(CopyProps{From: "/tm"})
		})
	}); err != nil {
		t.Fatal(err)
	}

	copied := []string{}
	for k := range m.Vol() {
		if strings.HasPrefix(k, "/out/p/") {
			copied = append(copied, k)
		}
	}
	sort.Strings(copied)
	if len(copied) != 1 || copied[0] != "/out/p/keep.txt" {
		t.Errorf("ignore rules not applied to text files: %v", copied)
	}
}

// A symlink pointing at one of its own ancestors must not hang or fail the
// copy. Needs a real filesystem: MemFS has no symlinks.
func TestCopySurvivesSymlinkCycle(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("A\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "b.txt"), []byte("B\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(src, filepath.Join(src, "sub", "loop")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	out := filepath.Join(dir, "out")
	j := New(WithFolder(fwd(out)), WithNow(func() int64 { return robWhen }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.Copy(CopyProps{From: fwd(src)})
		})
	}); err != nil {
		t.Fatalf("copy with symlink cycle failed: %v", err)
	}

	for p, want := range map[string]string{
		filepath.Join(out, "p", "a.txt"):        "A\n",
		filepath.Join(out, "p", "sub", "b.txt"): "B\n",
	} {
		got, err := os.ReadFile(p)
		if err != nil {
			t.Errorf("%s: %v", p, err)
			continue
		}
		if string(got) != want {
			t.Errorf("%s: got %q want %q", p, got, want)
		}
	}
}

// A truncated meta log is bookkeeping, not input: it must not block
// generation.
func TestCorruptMetaLogDoesNotBlockGeneration(t *testing.T) {
	m := NewMemFS()
	_ = m.WriteFile("/out/.jostraca/jostraca.meta.log", []byte(`{ "files": { trunca`))

	j := robJ(m, "/out")
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("A\n") })
		})
	}); err != nil {
		t.Fatalf("corrupt meta log blocked generation: %v", err)
	}

	if got := string(m.Vol()["/out/p/a.txt"]); got != "A\n" {
		t.Errorf("a.txt: got %q", got)
	}
	var meta map[string]any
	if err := json.Unmarshal(m.Vol()["/out/.jostraca/jostraca.meta.log"], &meta); err != nil {
		t.Fatalf("meta log not rewritten as valid JSON: %v", err)
	}
	files, _ := meta["files"].(map[string]any)
	if _, ok := files["p/a.txt"]; !ok {
		t.Errorf("meta log missing p/a.txt: %v", meta["files"])
	}
}

// A generated script has to be executable. Needs a real filesystem: MemFS
// does not track modes.
func TestFileModeIsApplied(t *testing.T) {
	dir := t.TempDir()

	j := New(WithFolder(fwd(dir)), WithNow(func() int64 { return robWhen }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.FileP(FileProps{Name: "run.sh", Mode: 0o755}, func(j *J) {
				j.Content("#!/bin/sh\necho hi\n")
			})
			// No Mode: platform default, and definitely not executable.
			j.File("plain.txt", func(j *J) { j.Content("hi\n") })
		})
	}); err != nil {
		t.Fatal(err)
	}

	// Content is checked everywhere; the mode assertions are skipped on
	// Windows, which has no execute bit — see posixModes.
	body, err := os.ReadFile(filepath.Join(dir, "p", "run.sh"))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "#!/bin/sh\necho hi\n" {
		t.Errorf("run.sh content: got %q", body)
	}

	fi, err := os.Stat(filepath.Join(dir, "p", "run.sh"))
	if err != nil {
		t.Fatal(err)
	}
	if posixModes && fi.Mode().Perm() != 0o755 {
		t.Errorf("run.sh mode = %v, want 0755", fi.Mode().Perm())
	}

	fi, err = os.Stat(filepath.Join(dir, "p", "plain.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if posixModes && fi.Mode().Perm()&0o111 != 0 {
		t.Errorf("plain.txt should not be executable: %v", fi.Mode().Perm())
	}
}

// An explicit Mode wins over the existing file's mode on regeneration —
// otherwise a mode change in the generator would never take effect.
func TestFileModeOverridesExisting(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "p", "run.sh")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	j := New(WithFolder(fwd(dir)), WithNow(func() int64 { return robWhen }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.FileP(FileProps{Name: "run.sh", Mode: 0o755}, func(j *J) {
				j.Content("new\n")
			})
		})
	}); err != nil {
		t.Fatal(err)
	}

	body, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "new\n" {
		t.Errorf("content: got %q", body)
	}

	fi, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	// Skipped on Windows, which has no execute bit — see posixModes.
	if posixModes && fi.Mode().Perm() != 0o755 {
		t.Errorf("mode = %v, want 0755 (explicit Mode must win)", fi.Mode().Perm())
	}
}
