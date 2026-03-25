package jostraca

import "testing"

func TestTemplateMacros(t *testing.T) {
	out, err := Template("a$$b.c$$d", map[string]any{"b": map[string]any{"c": "X"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out != "aXd" {
		t.Fatalf("expected aXd, got %q", out)
	}
}

func TestTemplateReplaceAndEject(t *testing.T) {
	spec := &TemplateSpec{
		Replace: map[string]any{"Q": "Z"},
		Eject:   [2]string{"START", "END"},
	}
	out, err := Template("A\nSTART\nQ$$x$$\nEND\nB", map[string]any{"x": 1}, spec)
	if err != nil {
		t.Fatal(err)
	}
	if out != "\nZ1\n" {
		t.Fatalf("unexpected output: %q", out)
	}
}
