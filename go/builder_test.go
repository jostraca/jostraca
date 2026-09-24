package jostraca

import (
	"strings"
	"testing"
)

// Phase 5 — Builder methods build a node tree of the right shape. The
// build phase still does not write to disk (FileHandler arrives in
// Phase 6). These tests inspect the in-memory tree via internal access.

func TestBuilderProjectShape(t *testing.T) {
	j := New()
	var capturedRoot *Node
	build := false
	_, err := j.Generate(Options{Build: &build}, func(j *J) {
		j.Project(ProjectProps{Folder: "sdk"}, func(j *J) {
			j.Folder("src", func(j *J) {
				j.File("main.go", func(j *J) {
					j.Content("// hi\n")
				})
			})
		})
		// Reach into internals to capture the root for assertion.
		capturedRoot = j.st.root
	})
	if err != nil {
		t.Fatal(err)
	}
	if capturedRoot == nil {
		t.Fatal("root is nil")
	}
	if capturedRoot.Kind != KindProject {
		t.Errorf("root.Kind = %v, want KindProject", capturedRoot.Kind)
	}
	if capturedRoot.Folder != "sdk" {
		t.Errorf("root.Folder = %q, want sdk", capturedRoot.Folder)
	}
	if len(capturedRoot.Children) != 1 {
		t.Fatalf("root.Children len = %d, want 1", len(capturedRoot.Children))
	}
	folder := capturedRoot.Children[0]
	if folder.Kind != KindFolder || folder.Name != "src" {
		t.Errorf("folder = %v/%q, want KindFolder/src", folder.Kind, folder.Name)
	}
	file := folder.Children[0]
	if file.Kind != KindFile || file.Name != "main.go" {
		t.Errorf("file = %v/%q, want KindFile/main.go", file.Kind, file.Name)
	}
	if len(file.Children) != 1 || file.Children[0].Kind != KindContent {
		t.Errorf("file.Children: want one Content, got %v", file.Children)
	}
	if file.Children[0].Content[0] != "// hi\n" {
		t.Errorf("Content = %q, want '// hi\\n'", file.Children[0].Content[0])
	}
}

func TestBuilderPathAccumulates(t *testing.T) {
	j := New()
	var captured *Node
	build := false
	_, _ = j.Generate(Options{Build: &build}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.Folder("a", func(j *J) {
				j.Folder("b", func(j *J) {
					j.File("c.txt", func(j *J) {})
				})
			})
		})
		captured = j.st.root
	})
	// Walk to the file. A Project contributes its NAME to the path, never
	// its folder, as TS's cmp() pushes props.name.
	file := captured.Children[0].Children[0].Children[0]
	wantPath := []string{"a", "b", "c.txt"}
	if len(file.Path) != len(wantPath) {
		t.Fatalf("Path = %v, want %v", file.Path, wantPath)
	}
	for i, p := range wantPath {
		if file.Path[i] != p {
			t.Errorf("Path[%d] = %q, want %q", i, file.Path[i], p)
		}
	}
}

func TestBuilderLineAddsNewline(t *testing.T) {
	j := New()
	var captured *Node
	build := false
	_, _ = j.Generate(Options{Build: &build}, func(j *J) {
		j.File("x.txt", func(j *J) {
			j.Line("hello")
		})
		captured = j.st.root
	})
	content := captured.Children[0].Content[0]
	if content != "hello\n" {
		t.Errorf("Line content = %q, want hello\\n", content)
	}
}

func TestBuilderContentTemplating(t *testing.T) {
	j := New(WithModel(map[string]any{"name": "Acme"}))
	var captured *Node
	build := false
	_, _ = j.Generate(Options{Build: &build}, func(j *J) {
		j.File("x.txt", func(j *J) {
			j.Content("hello $$name$$")
		})
		captured = j.st.root
	})
	content := captured.Children[0].Content[0]
	if content != "hello Acme" {
		t.Errorf("Content = %q, want 'hello Acme'", content)
	}
}

func TestBuilderErrorShortCircuit(t *testing.T) {
	j := New()
	called := false
	build := false
	_, err := j.Generate(Options{Build: &build}, func(j *J) {
		j.File("x.txt", func(j *J) {
			j.st.err = ErrInvalidPath // simulate error
			j.Content("after error")
		})
		j.File("y.txt", func(j *J) {
			called = true
		})
	})
	if err == nil {
		t.Error("Generate err = nil, want ErrInvalidPath")
	}
	if called {
		t.Error("subsequent component called after error")
	}
}

func TestBuilderCmpAddsATransparentNode(t *testing.T) {
	j := New()
	var captured *Node
	build := false
	_, _ = j.Generate(Options{Build: &build}, func(j *J) {
		j.File("x.txt", func(j *J) {
			j.Cmp("greet", func(j *J) {
				j.Content("hi")
			})
		})
		// st.root is set to the first attached node (File here) by
		// attachAndDescend; that lets us inspect File.Children directly.
		captured = j.st.root
	})

	// This test used to assert the opposite -- that Cmp added NO node --
	// which pinned the deviation #29 was about. TS's cmp() allocates a
	// `kind: 'none'` node and nests the component's children under it, and
	// that node is what the enclosing Fragment's filter sees. Go now does
	// the same, so the shapes match.
	if captured.Kind != KindFile {
		t.Fatalf("captured.Kind = %v, want KindFile", captured.Kind)
	}
	if len(captured.Children) != 1 {
		t.Fatalf("file.Children len = %d, want 1", len(captured.Children))
	}

	cmpNode := captured.Children[0]
	if cmpNode.Kind != KindNone {
		t.Fatalf("Cmp node kind = %v, want KindNone", cmpNode.Kind)
	}
	if len(cmpNode.Children) != 1 {
		t.Fatalf("cmp.Children len = %d, want 1", len(cmpNode.Children))
	}
	if cmpNode.Children[0].Kind != KindContent {
		t.Errorf("Cmp child kind = %v, want KindContent", cmpNode.Children[0].Kind)
	}
}

// KindNone carries no op and nodeText walks through it, so wrapping a
// component's children in one must not change a byte of output. Same tree
// built with and without the Cmp wrapper.
func TestBuilderCmpNodeIsOutputTransparent(t *testing.T) {
	run := func(wrap bool) string {
		m := NewMemFS()
		j := New(WithFS(m), WithFolder("/out"), WithNow(func() int64 { return 1 }))
		if _, err := j.Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{Folder: "p"}, func(j *J) {
				j.File("a.txt", func(j *J) {
					body := func(j *J) {
						j.Content("ONE\n")
						j.Content("TWO\n")
					}
					if wrap {
						j.Cmp("greet", body)
					} else {
						body(j)
					}
				})
			})
		}); err != nil {
			t.Fatal(err)
		}
		return string(m.Vol()["/out/p/a.txt"])
	}

	if got, want := run(true), run(false); got != want {
		t.Errorf("Cmp wrapper changed output: got %q, want %q", got, want)
	}
}

func TestBuildPhaseRunsWithNoOps(t *testing.T) {
	// Phase 5 ships a synchronous step walker but the file-touching ops
	// are stubs until Phase 6. The build phase should run without error
	// for a happy-path tree.
	j := New(WithMem())
	build := false
	_, err := j.Generate(Options{Build: &build}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) {
				j.Content("hello")
			})
		})
	})
	if err != nil {
		t.Errorf("Generate err = %v, want nil", err)
	}
}

// A component called on the *J that New returned, outside any Generate,
// fails at once with a message naming it. It used to dereference nil, and
// Project built and discarded a tree with no error at all. TS's cmp()
// throws the same text for a component called outside generate(). Mirrors
// 'component-outside-generate' in ts/test/jostraca.test.ts; the audit case
// was err-outside-generate.
func TestComponentOutsideGenerate(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/f.txt", []byte("F\n"))
	j := New(WithFS(mem), WithFolder("/out"),
		WithNow(func() int64 { return 1735689600000 }))

	ran := false
	body := func(*J) { ran = true }

	refused := func(t *testing.T, j *J) {
		t.Helper()
		for _, c := range []struct {
			name string
			call func()
		}{
			{"Project", func() { j.Project(ProjectProps{Folder: "p"}, body) }},
			{"Folder", func() { j.Folder("d", body) }},
			{"File", func() { j.File("x.txt", body) }},
			{"File", func() { j.FileP(FileProps{Name: "x.txt"}, body) }},
			{"Content", func() { j.Content("x") }},
			{"Content", func() { j.ContentP(ContentProps{Src: "x"}) }},
			{"Line", func() { j.Line("x") }},
			{"Line", func() { j.LineP(ContentProps{Src: "x"}) }},
			{"Slot", func() { j.Slot("s", body) }},
			{"Slot", func() { j.SlotP(SlotProps{Name: "s"}, body) }},
			{"Inject", func() { j.Inject("t.txt", body) }},
			{"Inject", func() { j.InjectP(InjectProps{Name: "t.txt"}, body) }},
			{"Fragment", func() { j.Fragment(FragmentProps{From: "/f.txt"}, body) }},
			{"Fragment", func() { j.FragmentP(FragmentProps{From: "/f.txt"}, body) }},
			{"CopyFiles", func() { j.CopyFiles(CopyFilesProps{From: "/f.txt"}) }},
			{"CopyFiles", func() { j.Copy(CopyProps{From: "/f.txt"}) }},
			{"ListItems", func() { j.ListItems([]any{1}, func(*J, ListItemProps) { ran = true }) }},
			{"ListItems", func() { j.List([]any{1}, func(*J, ListItemProps) { ran = true }) }},
			{"Wrap", func() { j.Cmp("Wrap", body) }},
			{"<anon>", func() { j.Cmp("", body) }},
		} {
			msg := func() (msg string) {
				defer func() {
					if r := recover(); r != nil {
						msg, _ = r.(string)
					}
				}()
				c.call()
				return ""
			}()
			want := "jostraca: component " + c.name + " called outside Generate(); " +
				"components can only be used inside the callback passed to Generate()"
			if msg != want {
				t.Errorf("%s: panic = %q\nwant %q", c.name, msg, want)
			}
		}
		if ran {
			t.Error("a component body ran outside Generate")
		}
	}
	refused(t, j)

	// The builder is not poisoned: a Generate on it still works, and
	// nothing the refused calls built leaks into it.
	if _, err := j.Generate(Options{}, func(j *J) {
		j.File("ok.txt", func(j *J) { j.Content("OK") })
	}); err != nil {
		t.Fatal(err)
	}
	for k := range mem.Vol() {
		if k != "/f.txt" && k != "/out/ok.txt" && !strings.HasPrefix(k, "/out/.jostraca") {
			t.Errorf("unexpected output: %s", k)
		}
	}
	if b, _ := mem.ReadFile("/out/ok.txt"); string(b) != "OK" {
		t.Errorf("ok.txt = %q", b)
	}

	// After a Generate has finished, the top-level *J still refuses, and
	// so does every *J kept from inside its callback: TS throws for any
	// component call once generate() has returned.
	refused(t, j)
	var kept []*J
	if _, err := j.Generate(Options{}, func(j *J) {
		kept = append(kept, j)
		j.File("kept.txt", func(j *J) {
			kept = append(kept, j)
			j.Content("K")
		})
	}); err != nil {
		t.Fatal(err)
	}
	for _, k := range kept {
		refused(t, k)
	}
	if b, _ := mem.ReadFile("/out/kept.txt"); string(b) != "K" {
		t.Errorf("kept.txt = %q", b)
	}
}
