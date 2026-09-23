package jostraca

import (
	"regexp"
	"strings"
	"testing"
)

// Per-component shape validation at define time. Mirrors TS FragmentShape
// and CopyShape at src/cmp/Fragment.ts:13-20 and src/cmp/Copy.ts:10-21.

func TestFragmentRequiresFrom(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.File("foo.txt", func(j *J) {
			j.Fragment(FragmentProps{}, nil) // missing From
		})
	})
	if err == nil {
		t.Errorf("Fragment without From should error")
	}
	if err != nil && !strings.Contains(err.Error(), "From is required") {
		t.Errorf("err = %v, want 'From is required'", err)
	}
}

func TestFragmentMissingFromFile(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.File("foo.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/nonexistent.html"}, nil)
		})
	})
	if err == nil {
		t.Errorf("Fragment with missing From file should error")
	}
	if err != nil && !strings.Contains(err.Error(), "does not exist") {
		t.Errorf("err = %v, want 'does not exist'", err)
	}
}

func TestCopyRequiresFrom(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Copy(CopyProps{})
	})
	if err == nil {
		t.Errorf("Copy without From should error")
	}
	if err != nil && !strings.Contains(err.Error(), "From is required") {
		t.Errorf("err = %v, want 'From is required'", err)
	}
}

func TestCopyMissingFromFile(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Copy(CopyProps{From: "/nonexistent"})
	})
	if err == nil {
		t.Errorf("Copy with missing From should error")
	}
	if err != nil && !strings.Contains(err.Error(), "does not exist") {
		t.Errorf("err = %v, want 'does not exist'", err)
	}
}

// Errors fire at DEFINE time, not at build phase, matching TS behaviour.
// A valid file in the user callback after the bad component should
// not be processed.
func TestShapeValidationStopsAtDefine(t *testing.T) {
	mem := NewMemFS()
	called := false
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.File("first.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/missing"}, nil)
		})
		j.File("second.txt", func(j *J) {
			called = true
			j.Content("hi")
		})
	})
	if err == nil {
		t.Errorf("expected error from bad Fragment")
	}
	if called {
		t.Errorf("subsequent component called after define-time error")
	}
}

// Fragment and CopyFiles refuse a wrongly typed prop in the define phase,
// as TS's FragmentShape and CopyFilesShape do: the run stops before anything
// is written, not even .jostraca, and the message is shape's. Go used to
// copy a whole tree past `exclude: 5` and write "true" before every line of
// a Fragment with `indent: true`. Mirrors 'closed-shape-prop-types' in
// ts/test/jostraca.test.ts; the audit cases were copy_exclude_number and
// frag_indent_bool.
func TestClosedShapePropTypes(t *testing.T) {
	seed := func(t *testing.T) *MemFS {
		m := NewMemFS()
		for p, s := range map[string]string{
			"/tm/model.txt":  "M=$$name$$\n",
			"/tm/tree/a.txt": "A\n",
		} {
			if err := m.WriteFile(p, []byte(s)); err != nil {
				t.Fatal(err)
			}
		}
		return m
	}
	gen := func(t *testing.T, body func(*J)) (*MemFS, error) {
		m := seed(t)
		_, err := New(WithFS(m), WithFolder("/out"),
			WithModel(map[string]any{"name": "World"}),
			WithNow(func() int64 { return 1735689600000 })).
			Generate(Options{}, func(j *J) {
				j.Project(ProjectProps{}, func(j *J) {
					j.File("first.txt", func(j *J) { j.Content("first") })
					body(j)
				})
			})
		return m, err
	}

	for _, c := range []struct {
		name string
		body func(*J)
		want string
	}{
		{"copy exclude number", func(j *J) {
			j.CopyFiles(CopyFilesProps{From: "/tm/tree", To: "n", Exclude: 5})
		}, `CopyFiles: Value "5" for property "exclude" does not satisfy one of: ` +
			`Boolean, String, RegExp, ["One(String,)"]`},
		{"copy exclude object", func(j *J) {
			j.CopyFiles(CopyFilesProps{From: "/tm/tree", Exclude: map[string]any{"a": 1}})
		}, `Value "{a:1}" for property "exclude"`},
		{"copy exclude list of numbers", func(j *J) {
			j.CopyFiles(CopyFilesProps{From: "/tm/tree", Exclude: []any{1}})
		}, `Value "[1]" for property "exclude"`},
		{"copy exclude empty string", func(j *J) {
			j.CopyFiles(CopyFilesProps{From: "/tm/tree", Exclude: ""})
		}, `Value "" for property "exclude"`},
		{"fragment indent bool", func(j *J) {
			j.File("b.txt", func(j *J) {
				j.Fragment(FragmentProps{From: "/tm/model.txt", Indent: true}, nil)
			})
		}, `Fragment: Value "true" for property "indent" does not satisfy one of: String, Number`},
		{"fragment indent list", func(j *J) {
			j.File("b.txt", func(j *J) {
				j.Fragment(FragmentProps{From: "/tm/model.txt", Indent: []any{">"}}, nil)
			})
		}, `Value "[>]" for property "indent"`},
		{"fragment eject numbers", func(j *J) {
			j.File("b.txt", func(j *J) {
				j.Fragment(FragmentProps{From: "/tm/model.txt", Eject: []any{1, 2}}, nil)
			})
		}, `Value "1" for property "eject.0" does not satisfy one of: String, RegExp`},
		{"fragment eject string", func(j *J) {
			j.File("b.txt", func(j *J) {
				j.Fragment(FragmentProps{From: "/tm/model.txt", Eject: "x"}, nil)
			})
		}, `property "eject" with string "x" because the string is not of type array`},
	} {
		t.Run(c.name, func(t *testing.T) {
			m, err := gen(t, c.body)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v\nwant it to contain %s", err, c.want)
			}
			for k := range m.Vol() {
				if strings.HasPrefix(k, "/out") {
					t.Errorf("written before the refusal: %s", k)
				}
			}
		})
	}

	// Every type TS accepts still generates.
	for _, c := range []struct {
		name string
		body func(*J)
	}{
		{"exclude values", func(j *J) {
			j.CopyFiles(CopyFilesProps{From: "/tm/tree", To: "b", Exclude: true})
			j.CopyFiles(CopyFilesProps{From: "/tm/tree", To: "s", Exclude: "a.txt"})
			j.CopyFiles(CopyFilesProps{From: "/tm/tree", To: "r", Exclude: regexp.MustCompile(`a`)})
			j.CopyFiles(CopyFilesProps{From: "/tm/tree", To: "l", Exclude: []any{"a.txt", regexp.MustCompile(`b`)}})
			j.CopyFiles(CopyFilesProps{From: "/tm/tree", To: "e", Exclude: []any{}})
			j.CopyFiles(CopyFilesProps{From: "/tm/tree", To: "ls", Exclude: []string{"a.txt"}})
		}},
		{"indent and eject values", func(j *J) {
			j.File("b.txt", func(j *J) {
				j.Fragment(FragmentProps{From: "/tm/model.txt", Indent: 2}, nil)
				j.Fragment(FragmentProps{From: "/tm/model.txt", Indent: 1.5}, nil)
				j.Fragment(FragmentProps{From: "/tm/model.txt", Indent: ""}, nil)
				j.Fragment(FragmentProps{From: "/tm/model.txt", Indent: "> "}, nil)
				j.Fragment(FragmentProps{From: "/tm/model.txt", Eject: [2]string{"M", "\n"}}, nil)
				j.Fragment(FragmentProps{From: "/tm/model.txt", Eject: []any{regexp.MustCompile(`M`), "\n"}}, nil)
				j.Fragment(FragmentProps{From: "/tm/model.txt", Eject: []any{}}, nil)
			})
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			m, err := gen(t, c.body)
			if err != nil {
				t.Fatal(err)
			}
			if c.name != "exclude values" {
				return
			}
			// A list is honoured whichever slice type holds it.
			for dir, kept := range map[string]bool{
				"b": true, "s": false, "r": false, "l": false, "e": true, "ls": false,
			} {
				if m.Exists("/out/"+dir+"/a.txt") != kept {
					t.Errorf("/out/%s/a.txt kept=%v, want %v", dir, !kept, kept)
				}
			}
		})
	}
}

// Content has no shape in TS, so an indent of any type is stringified and
// used as the prefix, in both ports. The control for the test above.
func TestContentIndentIsNotTypeChecked(t *testing.T) {
	m := NewMemFS()
	if _, err := New(WithFS(m), WithFolder("/out"),
		WithNow(func() int64 { return 1735689600000 })).
		Generate(Options{}, func(j *J) {
			j.File("c.txt", func(j *J) {
				j.ContentP(ContentProps{Src: "x\ny\n", Indent: true})
			})
		}); err != nil {
		t.Fatal(err)
	}
	if got, _ := m.ReadFile("/out/c.txt"); string(got) != "truex\ntruey\n" {
		t.Errorf("got %q", got)
	}
}
