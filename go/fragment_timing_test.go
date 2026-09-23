package jostraca

import (
	"fmt"
	"strings"
	"testing"
)

// A Fragment RENDERS WHEN IT IS CALLED, in the define phase, as it does in
// TS: the source is read, the slots replayed and the template run inside
// the component call, and what a slot or replace handler emits becomes a
// child the build walk visits. Each test is an audit case where Go used to
// render in the build walk instead. Mirrors the 'fragment-*' tests in the
// `components` block of ts/test/jostraca.test.ts.

var fragTimingSrc = map[string]string{
	"/tm/noslot.txt":  "no markers $$name$$\n",
	"/tm/model.txt":   "M=$$name$$\n",
	"/tm/twice.txt":   "1 <[SLOT:a]>\n2 <[SLOT:a]>\n3 <[SLOT]>\n4 <[SLOT]>\n",
	"/tm/replace.txt": "FOO and BAR $$name$$\n",
	"/tm/slot.txt":    "HEAD<[SLOT:s]>TAIL\n",
	"/tm/c.txt":       "copied $$name$$\n",
}

func fragTimingFS(t *testing.T, extra map[string]string) *MemFS {
	t.Helper()
	m := NewMemFS()
	for _, src := range []map[string]string{fragTimingSrc, extra} {
		for _, k := range sortedKeys(anyMap(src)) {
			if err := m.WriteFile(k, []byte(src[k])); err != nil {
				t.Fatal(err)
			}
		}
	}
	return m
}

func anyMap(m map[string]string) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func fragTimingGen(t *testing.T, m *MemFS, model map[string]any, body func(*J)) error {
	t.Helper()
	j := New(WithFS(m), WithFolder("/out"), WithModel(model),
		WithNow(func() int64 { return 1735689600000 }))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{}, body)
	})
	return err
}

func outputKeys(m *MemFS) []string {
	keys := []string{}
	for k := range m.Vol() {
		if strings.HasPrefix(k, "/out") {
			keys = append(keys, k)
		}
	}
	return keys
}

func readOut(t *testing.T, m *MemFS, p string) string {
	t.Helper()
	b, err := m.ReadFile(p)
	if err != nil {
		t.Fatalf("read %s: %v", p, err)
	}
	return string(b)
}

// (a) A render error aborts before anything is written: no earlier sibling,
// no .jostraca, not even the output folder.
func TestFragmentRenderErrorWritesNothing(t *testing.T) {
	m := fragTimingFS(t, nil)
	err := fragTimingGen(t, m, map[string]any{"name": "World"}, func(j *J) {
		j.File("ok.txt", func(j *J) { j.Content("ok") })
		j.File("n.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/tm/noslot.txt"}, func(j *J) {
				j.Content("lost")
			})
		})
	})
	if err == nil || !strings.Contains(err.Error(), "Fragment has non-Slot children") {
		t.Fatalf("non-Slot error: %v", err)
	}
	if keys := outputKeys(m); len(keys) != 0 {
		t.Errorf("written before the refusal: %v", keys)
	}

	m = fragTimingFS(t, nil)
	err = fragTimingGen(t, m, map[string]any{"name": "World"}, func(j *J) {
		j.File("first.txt", func(j *J) { j.Content("first") })
		j.File("e.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/tm/model.txt",
				Replace: map[string]any{"/x*/": "y"}}, nil)
		})
	})
	if err == nil || !strings.Contains(err.Error(), "matches empty string") {
		t.Fatalf("empty-match error: %v", err)
	}
	if keys := outputKeys(m); len(keys) != 0 {
		t.Errorf("written before the refusal: %v", keys)
	}
}

// (b) The model is read at call time, as Content reads it.
func TestFragmentReadsTheModelWhenCalled(t *testing.T) {
	m := fragTimingFS(t, nil)
	model := map[string]any{"name": "World"}
	if err := fragTimingGen(t, m, model, func(j *J) {
		j.File("m.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/tm/model.txt"}, nil)
			j.Content("content=$$name$$\n")
			model["name"] = "CHANGED"
		})
	}); err != nil {
		t.Fatal(err)
	}
	if got := readOut(t, m, "/out/m.txt"); got != "M=World\ncontent=World\n" {
		t.Errorf("got %q", got)
	}
}

// (c) The body's side effects run in the define phase: one scan and four
// replays before the Content after the Fragment is evaluated.
func TestFragmentBodyRunsInTheDefinePhase(t *testing.T) {
	m := fragTimingFS(t, nil)
	n := 0
	if err := fragTimingGen(t, m, nil, func(j *J) {
		j.File("c.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/tm/twice.txt"}, func(j *J) {
				n++
				j.Slot("a", func(j *J) { j.Content(fmt.Sprintf("a%d", n)) })
				j.Content(fmt.Sprintf("d%d", n))
			})
			j.Content(fmt.Sprintf("after=%d\n", n))
		})
	}); err != nil {
		t.Fatal(err)
	}
	if got := readOut(t, m, "/out/c.txt"); got != "1a2\n2a3\n3d4\n4d5\nafter=5\n" {
		t.Errorf("got %q", got)
	}
}

// (d) A source the same run writes is read with its bytes from before the
// run.
func TestFragmentReadsItsSourceBeforeTheRunWritesIt(t *testing.T) {
	m := fragTimingFS(t, map[string]string{"/out/tpl.txt": "OLD $$name$$ <[SLOT]>\n"})
	if err := fragTimingGen(t, m, map[string]any{"name": "World"}, func(j *J) {
		j.File("tpl.txt", func(j *J) { j.Content("NEW $$name$$ <[SLOT]>\n") })
		j.File("use.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "tpl.txt"}, func(j *J) { j.Content("S") })
		})
	}); err != nil {
		t.Fatal(err)
	}
	if got := readOut(t, m, "/out/tpl.txt"); got != "NEW World <[SLOT]>\n" {
		t.Errorf("tpl.txt: got %q", got)
	}
	if got := readOut(t, m, "/out/use.txt"); got != "OLD WorldS\n" {
		t.Errorf("use.txt: got %q", got)
	}
}

// (e) A CopyFiles inside a Slot runs in the real build walk: it writes its
// own target, and its text is spliced at the marker. Go used to drop both.
func TestFragmentSlotCopyRunsInTheBuild(t *testing.T) {
	m := fragTimingFS(t, nil)
	if err := fragTimingGen(t, m, map[string]any{"name": "World"}, func(j *J) {
		j.File("f.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/tm/slot.txt"}, func(j *J) {
				j.Slot("s", func(j *J) {
					j.Content("pre;")
					j.CopyFiles(CopyFilesProps{From: "/tm/c.txt", To: "c.txt"})
					j.Content("post;")
				})
			})
		})
	}); err != nil {
		t.Fatal(err)
	}
	if got := readOut(t, m, "/out/c.txt"); got != "copied World\n" {
		t.Errorf("c.txt: got %q", got)
	}
	if got := readOut(t, m, "/out/f.txt"); got != "HEADpre;copied World\npost;TAIL\n" {
		t.Errorf("f.txt: got %q", got)
	}
}

// Everything a func(*J) replace handler emits lands at the marker in
// emission order. The wrapper used to keep only direct Content, so
// ListItems, j.Cmp and a nested Fragment emitted nothing.
func TestFragmentReplaceHandlerEmissions(t *testing.T) {
	m := fragTimingFS(t, nil)
	wrap := func(j *J, body func(*J)) {
		j.Cmp("Wrap", func(j *J) {
			j.Content("<")
			body(j)
			j.Content(">")
		})
	}
	if err := fragTimingGen(t, m, map[string]any{"name": "World"}, func(j *J) {
		j.File("f.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/tm/replace.txt", Replace: map[string]any{
				"FOO": func(j *J) {
					j.ListItemsP(ListItemsProps{
						Item:   []any{map[string]any{"n": 1}, map[string]any{"n": 2}},
						NoLine: true,
					}, func(j *J, it ListItemProps) {
						j.ContentP(ContentProps{Src: "[{item.n}]", Replace: it.Replace})
					})
				},
				"BAR": func(j *J) { j.Line("bar") },
			}}, nil)
			j.Fragment(FragmentProps{From: "/tm/replace.txt", Replace: map[string]any{
				"FOO": func(j *J) { j.Fragment(FragmentProps{From: "/tm/model.txt"}, nil) },
				"BAR": func(j *J) { wrap(j, func(j *J) { j.Content("w") }) },
			}}, nil)
		})
	}); err != nil {
		t.Fatal(err)
	}
	want := "[1][2] and bar\n World\nM=World\n and <w> World\n"
	if got := readOut(t, m, "/out/f.txt"); got != want {
		t.Errorf("got %q\nwant %q", got, want)
	}
}

// A check over a tree holding a Fragment renders it as a write run would,
// slot text included, and reports drift in it as content.
func TestFragmentUnderCheck(t *testing.T) {
	root := func(j *J) {
		j.File("f.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/src/slot.txt"}, func(j *J) {
				j.Slot("s", func(j *J) { j.Content("S") })
				j.Content("D")
			})
		})
	}
	src := []byte("<[SLOT:s]>|<[SLOT]>\n")

	res := checkMem(t, map[string][]byte{
		"/src/slot.txt": src,
		"/app/f.txt":    []byte("S|D\n"),
	}, root)
	if len(res.Drift) != 0 {
		t.Fatalf("drift: %+v", res.Drift)
	}

	res = checkMem(t, map[string][]byte{
		"/src/slot.txt": src,
		"/app/f.txt":    []byte("stale\n"),
	}, root)
	if len(res.Drift) != 1 || res.Drift[0].Kind != DriftContent ||
		string(res.Drift[0].Generated) != "S|D\n" {
		t.Fatalf("drift: %+v", res.Drift)
	}
}
