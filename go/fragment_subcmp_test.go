package jostraca

import (
	"fmt"
	"strings"
	"testing"
)

// Phase parity-push: Fragment replace callbacks may invoke other
// components. Mirrors test/jostraca.test.ts:fragment-subcmp.
//
// The TS test has:
//   replace: {
//     bar: 'BAR',                    // literal string
//     zed: () => 'ZED',              // function returning string
//     con: () => Content('CON'),    // side-effect emitting via handle
//     foo: () => Foo('B')           // calls a custom cmp
//   }
//
// Expected: 'TWO-A-BAR-ZED-CON-FOO[B]+S\n' inside the rendered fragment.
//
// Go's overload-coverage approach: ReplaceFunc accepts a func(*J) variant
// which the engine calls with a buffer-bound J. j.Content / custom-cmp
// calls accumulate output that becomes the replacement text.

func TestFragmentReplaceSubcmp(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/f01.txt", []byte("TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n"))

	// Custom Go component analogous to TS:
	//   const Foo = cmp(function Foo(props: any) {
	//     Content('FOO['); Content(props.arg); Content(']')
	//   })
	Foo := func(j *J, arg string) {
		j.Content("FOO[")
		j.Content(arg)
		j.Content("]")
	}

	j := New(WithFS(mem), WithFolder("/out"), WithModel(map[string]any{"a": "A"}))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("foo.txt", func(j *J) {
				j.Content("ONE\n")
				j.Fragment(FragmentProps{
					From: "/f01.txt",
					Replace: map[string]any{
						"bar": "BAR",
						"zed": func() string { return "ZED" },
						"con": func(j *J) { j.Content("CON") },
						"foo": func(j *J) { Foo(j, "B") },
					},
				}, func(j *J) {
					j.Content("S")
				})
				j.Content("THREE\n")
			})
		})
	})
	if err != nil {
		t.Fatal(err)
	}

	got, err := mem.ReadFile("/out/foo.txt")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	want := "ONE\nTWO-A-BAR-ZED-CON-FOO[B]+S\nTHREE\n"
	if string(got) != want {
		t.Errorf("got %q\nwant %q", got, want)
	}
	_ = strings.Contains // keep import
}

// A Fragment is templated once: a `$$x$$` inside a model value, a plain
// replace value or a replace function's return is inserted as text, as it
// is in a plain Content. TS templated every segment a second time through
// Content and moved to a raw Content to match. Mirrors
// ts/test/jostraca.test.ts 'fragment-templates-once'.
func TestFragmentTemplatesOnce(t *testing.T) {
	out := nestedGenModel(t, map[string]string{
		"/tm/double.txt":  "[$$a$$]\n",
		"/tm/replace.txt": "FOO and BAR $$name$$\n",
	}, map[string]any{"a": "$$b$$", "b": "X", "name": "N"}, func(j *J) {
		j.File("double.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/tm/double.txt"}, nil)
			j.Content("content:$$a$$\n")
		})
		j.File("r1.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/tm/replace.txt",
				Replace: map[string]any{"FOO": "$$b$$", "BAR": "bar"}}, nil)
		})
		j.File("r2.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/tm/replace.txt",
				Replace: map[string]any{
					"FOO": `$$"q"$$`,
					"BAR": func() string { return "$$name$$" },
				}}, nil)
		})
	})

	want := map[string]string{
		"/out/double.txt": "[$$b$$]\ncontent:$$b$$\n",
		"/out/r1.txt":     "$$b$$ and bar N\n",
		"/out/r2.txt":     "$$\"q\"$$ and $$name$$ N\n",
	}
	for k, w := range want {
		if out[k] != w {
			t.Errorf("%s: got %q, want %q", k, out[k], w)
		}
	}
}

// A user component called from a Fragment replace handler emits at the
// marker, children and all. Go port of ts/test/jostraca.test.ts
// 'custom-cmp': unlike TestFragmentReplaceSubcmp, the component here is a
// real j.Cmp, which attaches a KindNone node the old wrapper skipped.
func TestFragmentReplaceCmp(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/f01.txt", []byte("<foo>"))

	model := map[string]any{
		"a": "A",
		"foo": map[string]any{
			"a": map[string]any{"x": 11},
			"b": map[string]any{"x": 22},
		},
	}

	foo := func(j *J, b string, child func(j *J, key string, x any)) {
		j.Cmp("Foo", func(j *J) {
			j.Content("FOO[$$a$$:" + b)
			for _, key := range sortedKeys(model["foo"].(map[string]any)) {
				child(j, key, model["foo"].(map[string]any)[key].(map[string]any)["x"])
			}
			j.Content("]")
		})
	}

	j := New(WithFS(mem), WithModel(model),
		WithNow(func() int64 { return 1735689600000 }))
	if _, err := j.Generate(Options{Folder: "/"}, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("foo.txt", func(j *J) {
				j.Content("{")
				j.Fragment(FragmentProps{From: "/f01.txt", Replace: map[string]any{
					"foo": func(j *J) {
						foo(j, "B", func(j *J, key string, x any) {
							j.Content(":" + key + "=(")
							j.Content(fmt.Sprint(x))
							j.Content(")")
						})
					},
				}}, nil)
				j.Content("}")
			})
		})
	}); err != nil {
		t.Fatal(err)
	}

	got, err := mem.ReadFile("/foo.txt")
	if err != nil {
		t.Fatal(err)
	}
	if want := "{<FOO[A:B:a=(11):b=(22)]>}"; string(got) != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
