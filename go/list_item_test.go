package jostraca

import "testing"

// ListP now hands its body a ListItemProps carrying the `{item}` replace
// macro and the list's Indent, matching the {item, indent, replace} object
// TS gives each child. Before this the body signature was
// func(*J, item any): there was nowhere for either to arrive, so a body
// interpolating {item.n} emitted the macro verbatim and ListProps.Indent
// was declared and never read. See #40.
//
// Every expectation below was measured against TS first. The three quiet
// limits - a bare {item}, a `$`-suffixed key, and an unresolved path all
// yielding the empty string - are the documented contract on both stacks
// (docs/reference-components.md, List), not an accident of this port.
// The list_item_macro parity snapshot pins the same shapes cross-stack.

func listGen(t *testing.T, items any, src string, indent any) string {
	t.Helper()
	m := NewMemFS()
	j := New(WithFS(m), WithFolder("/out"), WithNow(func() int64 { return 1 }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("a.txt", func(j *J) {
				j.ListP(ListProps{Item: items, Indent: indent},
					func(j *J, it ListItemProps) {
						j.ContentP(ContentProps{
							Src: src, Replace: it.Replace, Indent: it.Indent,
						})
					})
			})
		})
	}); err != nil {
		t.Fatal(err)
	}
	return string(m.Vol()["/out/a.txt"])
}

func obj(kv ...any) map[string]any {
	m := map[string]any{}
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i].(string)] = kv[i+1]
	}
	return m
}

func TestListItemMacro(t *testing.T) {
	cases := []struct {
		name  string
		items any
		src   string
		want  string
	}{
		// The regression: the macro resolves instead of reaching the file.
		{"path", []any{obj("n", "p"), obj("n", "q")}, "n={item.n}\n",
			"n=p\nn=q\n\n"},
		{"deep-path", []any{obj("a", obj("b", "X"))}, "v={item.a.b}\n",
			"v=X\n\n"},
		{"twice-in-one-line", []any{obj("n", "p")}, "{item.n}-{item.n}\n",
			"p-p\n\n"},
		{"map-items-sorted", obj("x", obj("n", "P"), "y", obj("n", "Q")),
			"v={item.n}\n", "v=P\nv=Q\n\n"},

		// The three quiet limits, all measured against TS.
		{"bare-item", []any{"a", "b"}, "v={item}\n", "v=\nv=\n\n"},
		{"bare-item-object", []any{obj("n", "p")}, "v={item}\n", "v=\n\n"},
		{"dollar-key", []any{obj("n", "p")}, "v={item.index$}\n", "v=\n\n"},
		{"unresolved-path", []any{obj("n", "p")}, "v={item.zz}\n", "v=\n\n"},

		// A near-miss is NOT the macro, so it is left alone.
		{"near-miss-left-in-place", []any{obj("n", "p")}, "v={itemx}\n",
			"v={itemx}\n\n"},

		// Value formatting. Numbers, bools and nil match TS exactly.
		// Objects and arrays JSONify on both sides: TS used to coerce a
		// function replacement's return with String(), giving
		// "[object Object]" and "1,2", while the SAME value reached through
		// $$path$$ or a plain replacement was JSONified. TS was corrected to
		// format one value one way however it is supplied.
		{"number", []any{obj("v", 42.0)}, "v={item.v}\n", "v=42\n\n"},
		{"float", []any{obj("v", 1.5)}, "v={item.v}\n", "v=1.5\n\n"},
		{"bool", []any{obj("v", true)}, "v={item.v}\n", "v=true\n\n"},
		{"nil", []any{obj("v", nil)}, "v={item.v}\n", "v=\n\n"},
		{"object", []any{obj("v", obj("a", 1.0))}, "v={item.v}\n",
			"v={\"a\":1}\n\n"},
		{"array", []any{obj("v", []any{1.0, 2.0})}, "v={item.v}\n",
			"v=[1,2]\n\n"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := listGen(t, c.items, c.src, nil); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

// ListProps.Indent reaches the body, which has to apply it - the same
// contract as TS, where indent on its own indents nothing.
func TestListIndentReachesBody(t *testing.T) {
	got := listGen(t, []any{obj("n", "p"), obj("n", "q")}, "n={item.n}\n", ">>")
	if want := ">>n=p\n>>n=q\n\n"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// Item is the raw item, not TS's each-wrapped one. This is the ergonomic
// half of the signature and the reason a body can still type-assert.
func TestListItemIsRaw(t *testing.T) {
	m := NewMemFS()
	j := New(WithFS(m), WithFolder("/out"), WithNow(func() int64 { return 1 }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("a.txt", func(j *J) {
				j.List([]any{"a", "b"}, func(j *J, it ListItemProps) {
					j.Line(it.Item.(string))
				})
			})
		})
	}); err != nil {
		t.Fatal(err)
	}
	if got := string(m.Vol()["/out/a.txt"]); got != "a\nb\n\n" {
		t.Errorf("got %q, want %q", got, "a\nb\n\n")
	}
}

// Each item gets its OWN replace spec: the closure must capture the item,
// not the loop variable's final value.
func TestListReplaceIsPerItem(t *testing.T) {
	got := listGen(t, []any{obj("n", "1"), obj("n", "2"), obj("n", "3")},
		"{item.n}\n", nil)
	if want := "1\n2\n3\n\n"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// A nil body is a no-op, not a panic - the trailing Line is skipped too,
// because ListP returns before reaching it. Unchanged by the signature
// change, and worth keeping pinned across one.
func TestListNilBody(t *testing.T) {
	m := NewMemFS()
	j := New(WithFS(m), WithFolder("/out"), WithNow(func() int64 { return 1 }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("a.txt", func(j *J) {
				j.Content("X\n")
				j.List([]any{"a"}, nil)
			})
		})
	}); err != nil {
		t.Fatal(err)
	}
	if got := string(m.Vol()["/out/a.txt"]); got != "X\n" {
		t.Errorf("got %q, want %q", got, "X\n")
	}
}
