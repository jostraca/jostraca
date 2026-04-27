package jostraca

import (
	"testing"
)

// Phase 5 — Builder methods build a node tree of the right shape. The
// build phase still does not write to disk (FileHandler arrives in
// Phase 6). These tests inspect the in-memory tree via internal access.

func TestBuilderProjectShape(t *testing.T) {
	j := New()
	var capturedRoot *Node
	_, err := j.Generate(Options{}, func(j *J) {
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
	_, _ = j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.Folder("a", func(j *J) {
				j.Folder("b", func(j *J) {
					j.File("c.txt", func(j *J) {})
				})
			})
		})
		captured = j.st.root
	})
	// Walk to the file.
	file := captured.Children[0].Children[0].Children[0]
	wantPath := []string{"p", "a", "b", "c.txt"}
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
	_, _ = j.Generate(Options{}, func(j *J) {
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
	_, _ = j.Generate(Options{}, func(j *J) {
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
	_, err := j.Generate(Options{}, func(j *J) {
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

func TestBuilderCmpDoesNotAddNode(t *testing.T) {
	j := New()
	var captured *Node
	_, _ = j.Generate(Options{}, func(j *J) {
		j.File("x.txt", func(j *J) {
			j.Cmp("greet", func(j *J) {
				j.Content("hi")
			})
		})
		// st.root is set to the first attached node (File here) by
		// attachAndDescend; that lets us inspect File.Children directly.
		captured = j.st.root
	})
	// captured IS the File; its single child must be the Content node
	// added by the Cmp body, with no wrapper interposed.
	if captured.Kind != KindFile {
		t.Fatalf("captured.Kind = %v, want KindFile", captured.Kind)
	}
	if len(captured.Children) != 1 {
		t.Fatalf("file.Children len = %d, want 1", len(captured.Children))
	}
	if captured.Children[0].Kind != KindContent {
		t.Errorf("Cmp wrapped Content as kind %v, want KindContent", captured.Children[0].Kind)
	}
}

func TestBuildPhaseRunsWithNoOps(t *testing.T) {
	// Phase 5 ships a synchronous step walker but the file-touching ops
	// are stubs until Phase 6. The build phase should run without error
	// for a happy-path tree.
	j := New(WithMem())
	_, err := j.Generate(Options{}, func(j *J) {
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
