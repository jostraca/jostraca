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

func TestParseTemplateSpec(t *testing.T) {
	spec, err := ParseTemplateSpec(map[string]any{
		"replace": map[string]any{"Q": "Z"},
		"eject":   []any{"START", "END"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Replace["Q"] != "Z" {
		t.Fatalf("expected replace Q=Z, got %v", spec.Replace)
	}
	if spec.Eject[0] != "START" || spec.Eject[1] != "END" {
		t.Fatalf("expected eject [START END], got %v", spec.Eject)
	}

	// Use parsed spec with Template
	out, err := Template("A\nSTART\nQ$$x$$\nEND\nB", map[string]any{"x": 1}, spec)
	if err != nil {
		t.Fatal(err)
	}
	if out != "\nZ1\n" {
		t.Fatalf("unexpected output: %q", out)
	}
}

func TestParseTemplateSpecEmpty(t *testing.T) {
	spec, err := ParseTemplateSpec(map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(spec.Replace) != 0 {
		t.Fatalf("expected empty replace, got %v", spec.Replace)
	}
	if spec.Eject[0] != "" || spec.Eject[1] != "" {
		t.Fatalf("expected empty eject, got %v", spec.Eject)
	}
}
