package jostraca

import (
	"strings"
	"testing"
)

// Phase 8 — Inject, Fragment, List.

func TestInjectReplacesBetweenMarkers(t *testing.T) {
	mem := NewMemFS()
	// Pre-populate the target file with markers and old content.
	_ = mem.WriteFile("/out/foo.txt",
		[]byte("HEADER\n#--START--#\nold content\n#--END--#\nFOOTER\n"))

	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Inject("foo.txt", func(j *J) {
			j.Content("new content\n")
		})
	})
	if err != nil {
		t.Fatal(err)
	}

	got, _ := mem.ReadFile("/out/foo.txt")
	want := "HEADER\n#--START--#\nnew content\n\n#--END--#\nFOOTER\n"
	if string(got) != want {
		t.Errorf("got %q\nwant %q", got, want)
	}
}

func TestInjectCustomMarkers(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/out/x.txt", []byte("a<<begin>>old<<end>>z"))
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.InjectP(InjectProps{
			Name:    "x.txt",
			Markers: [2]string{"<<begin>>", "<<end>>"},
		}, func(j *J) {
			j.Content("NEW")
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := mem.ReadFile("/out/x.txt")
	if string(got) != "a<<begin>>NEW<<end>>z" {
		t.Errorf("got %q", got)
	}
}

func TestFragmentNamedSlot(t *testing.T) {
	mem := NewMemFS()
	// Provide a fragment template under an absolute path.
	_ = mem.WriteFile("/templates/page.html",
		[]byte("<html>\n<!-- <[SLOT:head]> -->\n<body>\n<!-- <[SLOT:body]> -->\n</body>\n</html>\n"))

	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.File("index.html", func(j *J) {
			j.Fragment(FragmentProps{From: "/templates/page.html"}, func(j *J) {
				j.Slot("head", func(j *J) {
					j.Content("<title>X</title>")
				})
				j.Slot("body", func(j *J) {
					j.Content("<h1>Hello</h1>")
				})
			})
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := mem.ReadFile("/out/index.html")
	s := string(got)
	if !strings.Contains(s, "<title>X</title>") {
		t.Errorf("missing head slot in %q", s)
	}
	if !strings.Contains(s, "<h1>Hello</h1>") {
		t.Errorf("missing body slot in %q", s)
	}
	if strings.Contains(s, "<[SLOT") {
		t.Errorf("slot marker not replaced: %q", s)
	}
}

func TestListIteratesItems(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.File("out.txt", func(j *J) {
			j.List([]any{"a", "b", "c"}, func(j *J, it ListItemProps) {
				j.Line(it.Item.(string))
			})
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := mem.ReadFile("/out/out.txt")
	// TS parity: List adds a trailing Line('') after the body iteration
	// unless NoLine is set, so the output ends with an extra "\n".
	if string(got) != "a\nb\nc\n\n" {
		t.Errorf("got %q, want a\\nb\\nc\\n\\n", got)
	}
}
