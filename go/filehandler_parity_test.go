package jostraca

import (
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"testing"
)

// File-handler behaviour pinned across both stacks. Each test here has a
// TS twin in ts/test/filehandler.test.ts.

const fhNow int64 = 1735689600000

func fhMeta(t *testing.T, fsys FS, p string) map[string]any {
	t.Helper()
	b, err := fsys.ReadFile(p)
	if err != nil {
		t.Fatalf("read meta %s: %v", p, err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("decode meta: %v", err)
	}
	return m
}

func fhMetaEntry(t *testing.T, fsys FS, p, key string) map[string]any {
	t.Helper()
	files, _ := fhMeta(t, fsys, p)["files"].(map[string]any)
	e, _ := files[key].(map[string]any)
	if e == nil {
		t.Fatalf("no meta entry %q in %v", key, files)
	}
	return e
}

// A JOSTRACA_PROTECT marker protects a target whatever its
// classification: text, binary by extension, or binary by content.
func TestBinaryProtect(t *testing.T) {
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff}
	yes := true
	runs := []struct {
		name     string
		existing Existing
		root     func(j *J)
	}{
		{"file", Existing{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("a.png", func(j *J) { j.Content("P2") })
			})
		}},
		{"copy-one", Existing{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Copy(CopyProps{From: "/src/one/a.png", To: "a.png"})
			})
		}},
		{"copy-tree", Existing{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Copy(CopyProps{From: "/src/tree"})
			})
		}},
		{"file-preserve", Existing{Bin: ExistingBin{Preserve: &yes}}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("a.png", func(j *J) { j.Content("P2") })
			})
		}},
		{"copy-preserve", Existing{Bin: ExistingBin{Preserve: &yes}}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Copy(CopyProps{From: "/src/one/a.png", To: "a.png"})
			})
		}},
	}
	for _, r := range runs {
		t.Run(r.name, func(t *testing.T) {
			mem := NewMemFS()
			_ = mem.WriteFile("/src/one/a.png", png)
			_ = mem.WriteFile("/src/tree/a.png", png)
			_ = mem.WriteFile("/out/a.png", []byte("JOSTRACA_PROTECT"))
			res, err := New(WithFS(mem), WithFolder("/out"),
				WithNow(func() int64 { return fhNow })).
				Generate(Options{Existing: r.existing}, r.root)
			if err != nil {
				t.Fatal(err)
			}
			if got, _ := mem.ReadFile("/out/a.png"); string(got) != "JOSTRACA_PROTECT" {
				t.Errorf("protected target overwritten: %q", got)
			}
			if len(res.Files.Written) != 0 || len(res.Files.Preserved) != 0 {
				t.Errorf("written=%v preserved=%v, want both empty",
					res.Files.Written, res.Files.Preserved)
			}
			if mem.Exists("/out/a.old.png") {
				t.Error("a protected target got a .old backup")
			}
			e := fhMetaEntry(t, mem, "/out/.jostraca/jostraca.meta.log", "a.png")
			if e["action"] != "skip" || e["protect"] != true {
				t.Errorf("meta = %v, want action skip, protect true", e)
			}
		})
	}
}

// Inject exclude takes JavaScript truthiness, as TS's `!!props.exclude`
// does: a non-empty string skips the injection whatever it names.
func TestInjectExcludeIsTruthy(t *testing.T) {
	const seed = "a\n#--START--#\nold\n#--END--#\nz\n"
	const injected = "a\n#--START--#\nNEW\n#--END--#\nz\n"
	skip := []any{true, "other", []any{}, []any{"other"}, map[string]any{}, 1, float64(1), -1}
	inject := []any{nil, false, "", 0, float64(0)}

	run := func(t *testing.T, root func(*J)) (Result, *MemFS) {
		t.Helper()
		mem := NewMemFS()
		_ = mem.WriteFile("/out/t.txt", []byte(seed))
		res, err := New(WithFS(mem), WithFolder("/out"),
			WithNow(func() int64 { return fhNow })).Generate(Options{}, root)
		if err != nil {
			t.Fatal(err)
		}
		return res, mem
	}
	typed := func(ex any) func(*J) {
		return func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.InjectP(InjectProps{Name: "t.txt", Exclude: ex},
					func(j *J) { j.Content("NEW") })
			})
		}
	}
	tree := func(t *testing.T, ex any) func(*J) {
		t.Helper()
		props := map[string]any{"name": "t.txt"}
		if ex != nil {
			props["exclude"] = ex
		}
		root, err := CmpTree(map[string]any{
			"cmp": "Project", "props": map[string]any{},
			"children": []any{map[string]any{
				"cmp": "Inject", "props": props,
				"children": []any{map[string]any{
					"cmp": "Content", "props": map[string]any{"src": "NEW"},
				}},
			}},
		})
		if err != nil {
			t.Fatal(err)
		}
		return root
	}

	for _, ex := range skip {
		for _, via := range []string{"typed", "tree"} {
			root := typed(ex)
			if via == "tree" {
				if _, isInt := ex.(int); isInt {
					continue
				}
				root = tree(t, ex)
			}
			res, mem := run(t, root)
			got, _ := mem.ReadFile("/out/t.txt")
			if string(got) != seed || len(res.Files.Written) != 0 {
				t.Errorf("%s exclude %#v: t.txt=%q written=%v, want untouched",
					via, ex, got, res.Files.Written)
			}
			if mem.Exists("/out/.jostraca/generated/t.txt") {
				t.Errorf("%s exclude %#v: baseline written", via, ex)
			}
			if mem.Exists("/out/.jostraca/jostraca.meta.log") {
				files, _ := fhMeta(t, mem, "/out/.jostraca/jostraca.meta.log")["files"].(map[string]any)
				if _, has := files["t.txt"]; has {
					t.Errorf("%s exclude %#v: meta entry recorded", via, ex)
				}
			}
		}
	}
	for _, ex := range inject {
		for _, via := range []string{"typed", "tree"} {
			root := typed(ex)
			if via == "tree" {
				if _, isInt := ex.(int); isInt {
					continue
				}
				root = tree(t, ex)
			}
			_, mem := run(t, root)
			if got, _ := mem.ReadFile("/out/t.txt"); string(got) != injected {
				t.Errorf("%s exclude %#v: t.txt=%q, want injected", via, ex, got)
			}
		}
	}
}

func TestJSTruthy(t *testing.T) {
	var nilPtr *int
	var nilRe *regexp.Regexp
	one := 1
	cases := []struct {
		v    any
		want bool
	}{
		{nil, false}, {false, false}, {"", false}, {0, false}, {int64(0), false},
		{uint8(0), false}, {float64(0), false}, {math.NaN(), false},
		{nilPtr, false}, {nilRe, false},
		{true, true}, {"x", true}, {1, true}, {-1, true}, {0.5, true},
		{[]any{}, true}, {[]string{}, true}, {map[string]any{}, true},
		{regexp.MustCompile("a"), true}, {&one, true}, {struct{}{}, true},
	}
	for _, c := range cases {
		if got := jsTruthy(c.v); got != c.want {
			t.Errorf("jsTruthy(%#v) = %v, want %v", c.v, got, c.want)
		}
	}
}

// An Inject's children build the injected region exactly as they would
// build a File: Fragment output and a single-file Copy's spliced text
// included, in source order.
func TestInjectFragmentAndCopyChildren(t *testing.T) {
	const marked = "A\n#--START--#\nold1\n#--END--#\nB\n#--START--#\nold2\n#--END--#\nC\n"
	block := func(body string) string {
		return "A\n#--START--#\n" + body + "\n#--END--#\nB\n#--START--#\n" +
			body + "\n#--END--#\nC\n"
	}
	run := func(t *testing.T, root func(*J)) *MemFS {
		t.Helper()
		mem := NewMemFS()
		_ = mem.WriteFile("/tpl/model.txt", []byte("M=$$name$$\n"))
		_ = mem.WriteFile("/tpl/single.txt", []byte("single $$name$$ FOO\n"))
		_ = mem.WriteFile("/out/t.txt", []byte(marked))
		_, err := New(WithFS(mem), WithFolder("/out"),
			WithModel(map[string]any{"name": "World"}),
			WithNow(func() int64 { return fhNow })).Generate(Options{}, root)
		if err != nil {
			t.Fatal(err)
		}
		return mem
	}

	t.Run("fragment", func(t *testing.T) {
		mem := run(t, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Inject("t.txt", func(j *J) {
					j.Content("c1;")
					j.Fragment(FragmentProps{From: "/tpl/model.txt"}, nil)
					j.Content("c2;")
				})
			})
		})
		if got, _ := mem.ReadFile("/out/t.txt"); string(got) != block("c1;M=World\nc2;") {
			t.Errorf("t.txt = %q", got)
		}
	})

	t.Run("copy", func(t *testing.T) {
		mem := run(t, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Inject("t.txt", func(j *J) {
					j.Content("pre;")
					j.CopyFiles(CopyFilesProps{From: "/tpl/single.txt", To: "copied.txt"})
					j.Content("post;")
				})
			})
		})
		if got, _ := mem.ReadFile("/out/t.txt"); string(got) != block("pre;single World FOO\npost;") {
			t.Errorf("t.txt = %q", got)
		}
		if got, _ := mem.ReadFile("/out/copied.txt"); string(got) != "single World FOO\n" {
			t.Errorf("copied.txt = %q", got)
		}
	})
}

// A Slot outside a Fragment is transparent: its children render in place
// in the enclosing File or Inject.
func TestSlotOutsideFragment(t *testing.T) {
	wrap := func(j *J, body func(*J)) { j.Cmp("Wrap", body) }
	cases := []struct {
		name string
		body func(j *J)
		want string
	}{
		{"named", func(j *J) {
			j.Content("a")
			j.SlotP(SlotProps{Name: "x"}, func(j *J) { j.Content("S") })
			j.Content("b")
		}, "aSb"},
		{"unnamed", func(j *J) {
			j.Content("a")
			j.SlotP(SlotProps{}, func(j *J) { j.Content("S") })
			j.Content("b")
		}, "aSb"},
		{"nested", func(j *J) {
			j.Content("a")
			j.SlotP(SlotProps{Name: "x"}, func(j *J) {
				j.Content("S")
				j.SlotP(SlotProps{Name: "y"}, func(j *J) { j.Content("T") })
			})
			j.Content("b")
		}, "aSTb"},
		{"cmp-wrapped", func(j *J) {
			j.Content("a")
			wrap(j, func(j *J) {
				j.SlotP(SlotProps{Name: "x"}, func(j *J) { j.Content("S") })
			})
			j.Content("b")
		}, "aSb"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			mem := NewMemFS()
			_, err := New(WithFS(mem), WithFolder("/out"),
				WithNow(func() int64 { return fhNow })).Generate(Options{}, func(j *J) {
				j.Project(ProjectProps{}, func(j *J) { j.File("s.txt", c.body) })
			})
			if err != nil {
				t.Fatal(err)
			}
			if got, _ := mem.ReadFile("/out/s.txt"); string(got) != c.want {
				t.Errorf("s.txt = %q, want %q", got, c.want)
			}
		})
	}

	t.Run("inside-inject", func(t *testing.T) {
		mem := NewMemFS()
		_ = mem.WriteFile("/out/t.txt", []byte("<\n#--START--#\nold\n#--END--#\n>"))
		_, err := New(WithFS(mem), WithFolder("/out"),
			WithNow(func() int64 { return fhNow })).Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.Inject("t.txt", func(j *J) {
					j.Content("a")
					j.SlotP(SlotProps{Name: "x"}, func(j *J) { j.Content("S") })
					j.Content("b")
				})
			})
		})
		if err != nil {
			t.Fatal(err)
		}
		if got, _ := mem.ReadFile("/out/t.txt"); string(got) != "<\n#--START--#\naSb\n#--END--#\n>" {
			t.Errorf("t.txt = %q", got)
		}
	})
}

// In-memory keys are canonical absolute paths: backslashes folded, `.` and
// `..` resolved, a relative path resolved against the working directory.
// Twin of 'memfs-keys-resolve-against-cwd' in ts/test/filehandler.test.ts.
func TestMemCleanResolvesAgainstCwd(t *testing.T) {
	cwd := memCwd()
	parent := cwd[:strings.LastIndex(cwd, "/")]
	if parent == "" {
		parent = "/"
	}
	join := func(dir, rest string) string {
		if dir == "/" {
			return "/" + rest
		}
		return dir + "/" + rest
	}
	cases := [][2]string{
		{"a.txt", join(cwd, "a.txt")},
		{"", cwd},
		{".", cwd},
		{"./out/a.txt", join(cwd, "out/a.txt")},
		{"a\\b.txt", join(cwd, "a/b.txt")},
		{"../z", join(parent, "z")},
		{"/", "/"},
		{"/x/../y", "/y"},
		{"/a\\b", "/a/b"},
		{"/out//a/./b", "/out/a/b"},
		{"C:\\x\\y", "C:/x/y"},
		{"C:/x/../y", "C:/y"},
	}
	for _, c := range cases {
		if got := memClean(c[0]); got != c[1] {
			t.Errorf("memClean(%q) = %q, want %q", c[0], got, c[1])
		}
	}
}

// A vol seeded with the cwd-absolute key and generated with a relative
// folder addresses the same file: one key, the seed kept.
func TestMemRelativeFolderAddressesAbsoluteSeed(t *testing.T) {
	no := false
	abs := memCwd() + "/out/a.txt"
	res, err := New(WithMem(), WithVol(map[string][]byte{abs: []byte("OLD")}),
		WithFolder("out"), WithNow(func() int64 { return fhNow })).
		Generate(Options{Existing: Existing{Txt: ExistingTxt{Write: &no}}},
			func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File("a.txt", func(j *J) { j.Content("NEW") })
				})
			})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Files.Written) != 0 {
		t.Errorf("written = %v, want none", res.Files.Written)
	}
	n := 0
	for k, v := range res.Vol() {
		if strings.HasSuffix(k, "/a.txt") && !strings.Contains(k, ".jostraca") {
			n++
			if k != abs || string(v) != "OLD" {
				t.Errorf("%s = %q, want %s = OLD", k, v, abs)
			}
		}
		if !strings.HasPrefix(k, memCwd()+"/out/") {
			t.Errorf("key %s is not under %s/out/", k, memCwd())
		}
	}
	if n != 1 {
		t.Errorf("%d keys for a.txt, want 1", n)
	}
}

// An output folder with a trailing slash behaves exactly like the same
// folder without one. Twin of 'folder-trailing-slash' in
// ts/test/filehandler.test.ts.
func TestFolderTrailingSlash(t *testing.T) {
	cwd := memCwd()
	merge := true
	for _, c := range [][2]string{
		{"out/", cwd + "/out"},
		{"./out/", cwd + "/out"},
		{"out//", cwd + "/out"},
		{"/abs/out/", "/abs/out"},
	} {
		folder, base := c[0], c[1]
		mem := NewMemFS()
		root := func(body string) func(*J) {
			return func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File("a.txt", func(j *J) { j.Content(body) })
					j.Folder("sub", func(j *J) {
						j.File("b.txt", func(j *J) { j.Content("B\n") })
					})
				})
			}
		}
		if _, err := New(WithFS(mem), WithFolder(folder), WithNow(func() int64 { return fhNow })).
			Generate(Options{}, root("L1\nL2\nL3\n")); err != nil {
			t.Fatal(err)
		}
		for _, p := range []string{"/.jostraca/generated/a.txt", "/.jostraca/generated/sub/b.txt"} {
			if !mem.Exists(base + p) {
				t.Errorf("%s: %s missing", folder, p)
			}
		}
		files, _ := fhMeta(t, mem, base+"/.jostraca/jostraca.meta.log")["files"].(map[string]any)
		if _, ok := files["a.txt"]; !ok || len(files) != 2 {
			t.Errorf("%s: meta keys %v, want a.txt and sub/b.txt", folder, files)
		}
		if _, ok := files["sub/b.txt"]; !ok {
			t.Errorf("%s: meta keys %v, want sub/b.txt", folder, files)
		}

		_ = mem.WriteFile(base+"/a.txt", []byte("L1\nU\nL3\n"))
		res, err := New(WithFS(mem), WithFolder(folder), WithNow(func() int64 { return fhNow + 1 })).
			Generate(Options{Existing: Existing{Txt: ExistingTxt{Merge: &merge}}}, root("L1\nG\nL3\n"))
		if err != nil {
			t.Fatal(err)
		}
		if len(res.Files.Merged) != 1 || len(res.Files.Conflicted) != 1 ||
			!strings.HasSuffix(res.Files.Merged[0], "/a.txt") {
			t.Errorf("%s: merged=%v conflicted=%v", folder, res.Files.Merged, res.Files.Conflicted)
		}
		got, _ := mem.ReadFile(base + "/a.txt")
		if !strings.Contains(string(got), "U\n") || !strings.Contains(string(got), "G\n") {
			t.Errorf("%s: a.txt = %q, want both edits kept", folder, got)
		}
	}
}

// A previous meta log's `last` is used only when it is a finite number a
// JS Date can carry; anything else is treated as absent (-1). Twin of
// 'meta-last-type' in ts/test/filehandler.test.ts.
func TestMetaLastType(t *testing.T) {
	merge := true
	for _, last := range []string{`"1735689600000"`, `true`, `"2025-01-01"`, `{}`, `1e20`, `[]`, `null`} {
		mem := NewMemFS()
		_ = mem.WriteFile("/out/.jostraca/jostraca.meta.log",
			[]byte(`{"last":`+last+`,"hlast":"x","files":[1]}`))
		_ = mem.WriteFile("/out/.jostraca/generated/a.txt", []byte("L1\nL2\n"))
		_ = mem.WriteFile("/out/a.txt", []byte("L1\nU\n"))
		res, err := New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return fhNow })).
			Generate(Options{Existing: Existing{Txt: ExistingTxt{Merge: &merge}}}, func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File("a.txt", func(j *J) { j.Content("L1\nG\n") })
				})
			})
		if err != nil {
			t.Fatalf("last=%s: %v", last, err)
		}
		if strings.Join(res.Files.Merged, ",") != "/out/a.txt" ||
			strings.Join(res.Files.Conflicted, ",") != "/out/a.txt" {
			t.Errorf("last=%s: merged=%v conflicted=%v", last, res.Files.Merged, res.Files.Conflicted)
		}
		got, _ := mem.ReadFile("/out/a.txt")
		if !strings.Contains(string(got), ">>>>>>> EXISTING: 1969-12-31T23:59:59.999Z/merge") {
			t.Errorf("last=%s: a.txt = %q", last, got)
		}
	}
}

// Every meta entry carries when/hwhen, skip entries included. Twin of
// 'skip-entry-when' in ts/test/filehandler.test.ts.
func TestSkipEntryWhen(t *testing.T) {
	no, yes := false, true
	nodup := Control{NoDuplicate: true}
	file := func(folder, body string) func(*J) {
		return func(j *J) {
			j.Project(ProjectProps{Folder: folder}, func(j *J) {
				j.File("a.txt", func(j *J) { j.Content(body) })
			})
		}
	}
	rows := []struct {
		name string
		seed map[string]string
		opts Options
		root func(*J)
		key  string
	}{
		{"write-off", map[string]string{"/out/a.txt": "OLD"},
			Options{Existing: Existing{Txt: ExistingTxt{Write: &no}}, Control: nodup},
			file("", "NEW"), "a.txt"},
		{"protected", map[string]string{"/out/a.txt": "JOSTRACA_PROTECT"},
			Options{Control: nodup}, file("", "NEW"), "a.txt"},
		{"unchanged-merge", map[string]string{"/out/a.txt": "SAME"},
			Options{Existing: Existing{Txt: ExistingTxt{Merge: &yes}}, Control: nodup},
			file("", "SAME"), "a.txt"},
		{"unchanged-diff", map[string]string{"/out/a.txt": "SAME"},
			Options{Existing: Existing{Txt: ExistingTxt{Diff: &yes}}, Control: nodup},
			file("", "SAME"), "a.txt"},
		{"outside-folder", map[string]string{"/elsewhere/a.txt": "OLD"},
			Options{Existing: Existing{Txt: ExistingTxt{Write: &no}}},
			file("/elsewhere", "NEW"), "/elsewhere/a.txt"},
	}
	for _, r := range rows {
		mem := NewMemFS()
		for k, v := range r.seed {
			_ = mem.WriteFile(k, []byte(v))
		}
		if _, err := New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return fhNow })).
			Generate(r.opts, r.root); err != nil {
			t.Fatalf("%s: %v", r.name, err)
		}
		e := fhMetaEntry(t, mem, "/out/.jostraca/jostraca.meta.log", r.key)
		if e["action"] != "skip" || e["when"] != float64(fhNow) || e["hwhen"] != float64(2025010100000000) {
			t.Errorf("%s: meta = %v, want skip stamped %d", r.name, e, fhNow)
		}
	}
}
