package jostraca

import (
	"errors"
	"regexp"
	"strings"
	"testing"
)

// Existing Phase 0 tests, kept verbatim where the public API is
// unchanged. Eject widens to `any` in Phase 3; the tests are updated
// where they observe the type.

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
	if out != "Z1\n" {
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
	// Use parsed spec with Template - the assertion is on output.
	out, err := Template("A\nSTART\nQ$$x$$\nEND\nB", map[string]any{"x": 1}, spec)
	if err != nil {
		t.Fatal(err)
	}
	if out != "Z1\n" {
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
}

// Phase 3 — feature parity. Cases ported from test/template.test.ts
// where Go semantics permit (RE2 differences flagged inline).

func TestTemplateBasicValues(t *testing.T) {
	cases := []struct {
		name  string
		src   string
		model any
		want  string
	}{
		{"path", "a$$b.c$$d", map[string]any{"b": map[string]any{"c": "X"}}, "aXd"},
		{"index", "a$$1$$d", []any{22, 222}, "a222d"},
		{"bool true", "a$$b$$c$$b$$", map[string]any{"b": true}, "atruectrue"},
		{"bool false", "$$b$$a$$b$$c", map[string]any{"b": false}, "falseafalsec"},
		{"missing left in place", "$$a$$$$b$$$$c$$", map[string]any{}, "$$a$$$$b$$$$c$$"},
		{"object json", "$$a$$", map[string]any{"a": map[string]any{"b": 1}}, `{"b":1}`},
		{"slice json", "$$a$$", map[string]any{"a": []any{"b", "c"}}, `["b","c"]`},
		{"function", "$$a$$", map[string]any{"a": func() any { return "A" }}, "A"},
		{"function string", "$$a$$", map[string]any{"a": func() string { return "A" }}, "A"},
		{"resolved value not re-parsed", "$$a$$", map[string]any{"a": "$$b$$"}, "$$b$$"},
		{"quoted ref", "$$\"hi\"$$", nil, "hi"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Template(tc.src, tc.model, nil)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestTemplateReplaceVariants(t *testing.T) {
	cases := []struct {
		name string
		src  string
		spec *TemplateSpec
		want string
	}{
		{
			"literal string key",
			"aQb",
			&TemplateSpec{Replace: map[string]any{"Q": "Z"}},
			"aZb",
		},
		{
			"regex key",
			"aQQQb",
			&TemplateSpec{Replace: map[string]any{"/Q+/": "Z"}},
			"aZb",
		},
		{
			"function value for literal key",
			"aQb",
			&TemplateSpec{Replace: map[string]any{"Q": ReplaceFunc(func(g map[string]string, m string) string { return "X" })}},
			"aXb",
		},
		{
			"named group regex with function",
			"a[q]b[w]c",
			&TemplateSpec{Replace: map[string]any{
				`/\[(?P<cap>\w)\]/`: ReplaceFunc(func(g map[string]string, m string) string {
					return strings.ToUpper(g["cap"])
				}),
			}},
			"aQbWc",
		},
		{
			"unmatched key leaves source",
			"abc",
			&TemplateSpec{Replace: map[string]any{"X": "Y"}},
			"abc",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Template(tc.src, nil, tc.spec)
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestTemplateEmptyMatchRegexRejected(t *testing.T) {
	_, err := Template("aQQQb", nil, &TemplateSpec{
		Replace: map[string]any{"/Q*/": "Z"},
	})
	if !errors.Is(err, ErrEmptyMatchRegex) {
		t.Errorf("err = %v, want ErrEmptyMatchRegex", err)
	}
}

func TestTemplateLookbehindRejected(t *testing.T) {
	_, err := Template("ab", nil, &TemplateSpec{
		Replace: map[string]any{`/(?<=a)b/`: "Z"},
	})
	if !errors.Is(err, ErrLookbehind) {
		t.Errorf("err = %v, want ErrLookbehind", err)
	}
}

func TestTemplateLookaheadRejected(t *testing.T) {
	_, err := Template("ab", nil, &TemplateSpec{
		Replace: map[string]any{`/a(?=b)/`: "Z"},
	})
	if !errors.Is(err, ErrLookbehind) {
		t.Errorf("err = %v, want ErrLookbehind (lookahead also rejected)", err)
	}
}

func TestTemplateCustomDelimiters(t *testing.T) {
	out, err := Template("a{{x}}b", map[string]any{"x": "Z"}, &TemplateSpec{
		Open: `\{\{`, Close: `\}\}`, Ref: `[a-z]+`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out != "aZb" {
		t.Errorf("got %q, want %q", out, "aZb")
	}
}

func TestTemplateHandleStreams(t *testing.T) {
	var got []string
	out, err := Template("a$$x$$b$$x$$c", map[string]any{"x": "Z"}, &TemplateSpec{
		Handle: func(s string) { got = append(got, s) },
	})
	if err != nil {
		t.Fatal(err)
	}
	if out != "" {
		t.Errorf("Template returned %q with Handle, want empty", out)
	}
	joined := strings.Join(got, "")
	if joined != "aZbZc" {
		t.Errorf("Handle parts joined = %q, want %q", joined, "aZbZc")
	}
}

func TestTemplateEjectStrings(t *testing.T) {
	src := "A\nSTART\nQ$$a$$\nEND\nB"
	out, err := Template(src, map[string]any{"a": 1}, &TemplateSpec{Eject: []any{"START", "END"}})
	if err != nil {
		t.Fatal(err)
	}
	if out != "Q1\n" {
		t.Errorf("got %q, want %q", out, "Q1\n")
	}
}

func TestTemplateEjectRegex(t *testing.T) {
	// Bare regexes preserve surrounding whitespace/newlines per TS; only
	// string-form markers get the [ \t]* + \n? wrapping.
	src := "\nA\n  START  \nQ$$a$$\n  END  \nB\n"
	startRE := regexp.MustCompile("START")
	endRE := regexp.MustCompile("END")
	out, err := Template(src, map[string]any{"a": 1}, &TemplateSpec{
		Eject: []any{startRE, endRE},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "  \nQ1\n  "
	if out != want {
		t.Errorf("got %q, want %q", out, want)
	}
}

func TestTemplateJostracaReplaceSentinel(t *testing.T) {
	out, err := Template("$$__JOSTRACA_REPLACE__$$", map[string]any{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	// The exact regex source format may differ between Go and JS, but
	// it must contain the canonical group names so users can recognise
	// the assembled regex.
	for _, sub := range []string{"J_O", "J_R", "J_C"} {
		if !strings.Contains(out, sub) {
			t.Errorf("out %q missing %q", out, sub)
		}
	}
}

func TestTemplateTagMatchSimple(t *testing.T) {
	src := "{\n//#Wax\n}"
	got, err := Template(src, nil, &TemplateSpec{
		Replace: map[string]any{
			"#Wax": ReplaceFunc(func(g map[string]string, m string) string {
				return g["indent"] + "-Wax:" + strings.ToUpper(g["TAG"]) + "\n"
			}),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n-Wax:WAX\n}"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestTemplateTagMatchWithIndent(t *testing.T) {
	src := "{\n  //  #SeeSaw\n}"
	got, err := Template(src, nil, &TemplateSpec{
		Replace: map[string]any{
			"#SeeSaw": ReplaceFunc(func(g map[string]string, m string) string {
				return g["indent"] + "X-" + g["TAG"] + "\n"
			}),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n  X-SeeSaw\n}"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestTemplateTagDashName(t *testing.T) {
	src := "{\n  // #Foo-Bar\n}"
	got, err := Template(src, nil, &TemplateSpec{
		Replace: map[string]any{
			"#Foo-Bar": ReplaceFunc(func(g map[string]string, m string) string {
				return g["indent"] + g["Bar"] + "/" + g["TAG"] + "\n"
			}),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	// Bar capture is the dynamic identifier ("Foo"); TAG is the literal "Bar"
	// after the dash. Match the TS contract: g.Bar is the inner identifier,
	// g.TAG is the literal tag name.
	if !strings.Contains(got, "Foo") {
		t.Errorf("got %q, expected to contain 'Foo' as inner identifier", got)
	}
}

// The eject schema is a repeated-element array, not a fixed two-element
// tuple. shape v0.5.0 stopped suppressing element validation for an absent
// Optional array, which made the tuple form reject a spec that simply had
// no eject. These pin the four boundaries the repeated form has to hold,
// all of them matching TS (cmp/Fragment.ts declares the same repeated
// shape, and util/basic.ts requires BOTH markers before it ejects).
func TestParseTemplateSpecEjectArity(t *testing.T) {
	cases := []struct {
		name    string
		raw     map[string]any
		wantErr bool
		wantEj  bool // Eject populated
	}{
		{"absent", map[string]any{}, false, false},
		{"pair", map[string]any{"eject": []any{"A", "B"}}, false, true},
		// More than two markers applies the FIRST pair, as TS does.
		{"triple", map[string]any{"eject": []any{"A", "B", "C"}}, false, true},
		{"quad", map[string]any{"eject": []any{"A", "B", "C", "D"}}, false, true},
		// Accepted by the schema, then not applied -- TS does the same.
		{"single", map[string]any{"eject": []any{"A"}}, false, false},
		{"empty", map[string]any{"eject": []any{}}, false, false},
		// Element validation must survive the change to the repeated form.
		{"non-string element", map[string]any{"eject": []any{"A", 1}}, true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			spec, err := ParseTemplateSpec(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got spec %+v", spec)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got := spec.Eject != nil; got != tc.wantEj {
				t.Fatalf("Eject populated = %v, want %v (Eject=%v)", got, tc.wantEj, spec.Eject)
			}
		})
	}
}

// The rendered result of a longer eject array, through BOTH routes into
// applyEject: a spec parsed from a raw map, and a TemplateSpec.Eject set
// directly. Measured against canonical TS on the same input, which yields
// "X\n" for two, three and four markers alike -- util/basic.ts indexes
// eject[0] and eject[1] and never looks past them.
func TestTemplateEjectIgnoresExtraMarkers(t *testing.T) {
	const src = "A\nSTART\nX\nEND\nB"

	lengths := map[string][]any{
		"two":   {"START", "END"},
		"three": {"START", "END", "EXTRA"},
		"four":  {"START", "END", "E1", "E2"},
	}
	for name, eject := range lengths {
		t.Run("parsed/"+name, func(t *testing.T) {
			spec, err := ParseTemplateSpec(map[string]any{"eject": eject})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			out, err := Template(src, map[string]any{}, spec)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if out != "X\n" {
				t.Fatalf("got %q, want %q", out, "X\n")
			}
		})
		t.Run("direct/"+name, func(t *testing.T) {
			out, err := Template(src, map[string]any{}, &TemplateSpec{Eject: eject})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if out != "X\n" {
				t.Fatalf("got %q, want %q", out, "X\n")
			}
		})
	}

	// Fewer than two markers cannot eject: TS requires BOTH non-nil.
	for name, eject := range map[string][]any{"one": {"START"}, "none": {}} {
		t.Run("noop/"+name, func(t *testing.T) {
			out, err := Template(src, map[string]any{}, &TemplateSpec{Eject: eject})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if out != src {
				t.Fatalf("got %q, want the source unchanged", out)
			}
		})
	}
}
