package jostraca

import (
	"encoding/json"
	"math"
	"regexp"
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
