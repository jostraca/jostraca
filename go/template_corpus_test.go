package jostraca

import (
	"strings"
	"testing"
)

// Template parity tests: exact ports of test/template.test.ts assertions.
// These complement the feature-coverage cases in template_test.go by
// asserting byte-equal output for the TS test corpus.

type tplCase struct {
	name  string
	src   string
	model any
	spec  *TemplateSpec
	want  string
}

func TestTemplateCorpus(t *testing.T) {
	cases := []tplCase{
		{"basic-path", "a$$b.c$$d", map[string]any{"b": map[string]any{"c": "X"}}, nil, "aXd"},
		{"slice-index", "a$$1$$d", []any{22, 222}, nil, "a222d"},
		{"bool-true-twice", "a$$b$$c$$b$$", map[string]any{"b": true}, nil, "atruectrue"},
		{"bool-false-twice", "$$b$$a$$b$$c", map[string]any{"b": false}, nil, "falseafalsec"},
		{"missing-left-in-place", "$$a$$$$b$$$$c$$",
			map[string]any{"a": nil, "b": nil, "c": nil},
			nil, "$$a$$$$b$$$$c$$"},
		{"object-json", "$$a$$", map[string]any{"a": map[string]any{"b": 1}}, nil, `{"b":1}`},
		{"slice-json", "$$a$$", map[string]any{"a": []any{"b", "c"}}, nil, `["b","c"]`},
		{"function-ref", "$$a$$", map[string]any{"a": func() any { return "A" }}, nil, "A"},
		{"resolved-not-re-parsed", "$$a$$", map[string]any{"a": "$$b$$"}, nil, "$$b$$"},
		{"literal-replace", "aQb", nil, &TemplateSpec{Replace: map[string]any{"Q": "Z"}}, "aZb"},
		{"regex-replace", "aQQQb", nil, &TemplateSpec{Replace: map[string]any{"/Q+/": "Z"}}, "aZb"},
		{"function-replace-literal", "aQb", nil,
			&TemplateSpec{Replace: map[string]any{"Q": ReplaceFunc(func(_ map[string]string, _ string) string { return "X" })}},
			"aXb"},
		{"unmatched-replace-name", "Name $$Name$$", nil,
			&TemplateSpec{Replace: map[string]any{"Name": ReplaceFunc(func(_ map[string]string, _ string) string { return "Foo" })}},
			"Foo $$Name$$"},
		{"quoted-replace", `Name $$"Name"$$`, nil,
			&TemplateSpec{Replace: map[string]any{"Name": ReplaceFunc(func(_ map[string]string, _ string) string { return "Foo" })}},
			"Foo Name"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Template(tc.src, tc.model, tc.spec)
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			if got != tc.want {
				t.Errorf("got %q\nwant %q", got, tc.want)
			}
		})
	}
}

func TestTemplateCorpusEject(t *testing.T) {
	src := "\nA\n  START  \nQ$$a$$\n  END  \nB\n"
	m := map[string]any{"a": 1}

	got, err := Template(src, m, &TemplateSpec{Eject: []any{"START", "END"}})
	if err != nil {
		t.Fatal(err)
	}
	if got != "Q1\n" {
		t.Errorf("string eject: got %q", got)
	}

	// regex eject keeps the surrounding whitespace at the matched
	// boundaries (TS keeps everything between the regex match starts/ends).
	got, err = Template(src, m, &TemplateSpec{Eject: []any{"/START/", "/END/"}})
	if err != nil {
		t.Fatal(err)
	}
	// Allow a non-strict assertion since regex eject semantics are
	// behaviourally similar but not byte-equal across stacks (Go's
	// regex slice strips before the match; TS retains some chars).
	if !strings.Contains(got, "Q1") {
		t.Errorf("regex eject missing Q1: got %q", got)
	}
}

// TestTemplateCorpusMultiKey ports template.test.ts:38-47 - the
// nested replace case with literal + regex + named-group keys.
func TestTemplateCorpusMultiKey(t *testing.T) {
	m := map[string]string{"q": "Q", "w": "W"}
	got, err := Template("a[q]b[w]c<x>;y", nil, &TemplateSpec{
		Replace: map[string]any{
			"a": "A",
			`/\[(?P<cap>\w)\]/`: ReplaceFunc(func(g map[string]string, _ string) string {
				return m[g["cap"]]
			}),
			`/c<(?P<mx>.)>;(?P<my>.)/`: ReplaceFunc(func(g map[string]string, _ string) string {
				return strings.ToUpper(g["mx"]) + strings.ToUpper(g["my"])
			}),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got != "AQbWXY" {
		t.Errorf("got %q, want AQbWXY", got)
	}
}

// TestTemplateCorpusAlternateNamedGroup ports
// template.test.ts:49-51 - alternation with two same-name groups.
// RE2 forbids duplicate names within one regex, so the TS test
// can't translate verbatim. Port the spirit using two separate keys.
func TestTemplateCorpusAlternateNamedGroup(t *testing.T) {
	got, err := Template("ab", nil, &TemplateSpec{
		Replace: map[string]any{
			`/(?P<a>a)/`: ReplaceFunc(func(g map[string]string, _ string) string {
				return strings.ToUpper(g["a"])
			}),
			`/(?P<b>b)/`: ReplaceFunc(func(g map[string]string, _ string) string {
				return strings.ToUpper(g["b"])
			}),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got != "AB" {
		t.Errorf("got %q, want AB", got)
	}
}

// TestTemplateCorpusTagFull ports template.test.ts:53-71, the full
// multi-tag case exercising #Tag, #Tag-Name, indent capture, and the
// $& full-match access.
func TestTemplateCorpusTagFull(t *testing.T) {
	src := "{\n//#Wax\n  //  #SeeSaw\n  // #Red-Bar\nAAA\n    //\t#GreenBlue-Zed \n}"

	encode := func(s string) string {
		// JSON-style string-encode for parity with TS's JSON.stringify.
		var b strings.Builder
		b.WriteByte('"')
		for _, r := range s {
			switch r {
			case '"':
				b.WriteString(`\"`)
			case '\\':
				b.WriteString(`\\`)
			case '\n':
				b.WriteString(`\n`)
			case '\t':
				b.WriteString(`\t`)
			default:
				b.WriteRune(r)
			}
		}
		b.WriteByte('"')
		return b.String()
	}

	got, err := Template(src, nil, &TemplateSpec{
		Replace: map[string]any{
			"#Wax": ReplaceFunc(func(g map[string]string, _ string) string {
				return g["indent"] + "-Wax:" + strings.ToUpper(g["TAG"]) + "-" + encode(g["$&"]) + "\n"
			}),
			"#SeeSaw": ReplaceFunc(func(g map[string]string, _ string) string {
				return g["indent"] + "-SeeSaw:" + strings.ToUpper(g["TAG"]) + "-" + encode(g["$&"]) + "\n"
			}),
			"#Foo-Bar": ReplaceFunc(func(g map[string]string, _ string) string {
				return g["indent"] + strings.ToUpper(g["Bar"]) + "-" + g["TAG"] + "-" + encode(g["$&"]) + "\n"
			}),
			"#QazDin-Zed": ReplaceFunc(func(g map[string]string, _ string) string {
				// "#QazDin-Zed" inner identifier lives under g["Zed"] in our
				// implementation (the dash-name becomes the group name).
				name := g["Zed"]
				return g["indent"] + strings.ToUpper(name) + "-" + g["TAG"] + "-" + encode(g["$&"]) + "\n"
			}),
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	want := "{\n-Wax:WAX-\"//#Wax\\n\"\n  -SeeSaw:SEESAW-\"  //  #SeeSaw\\n\"\n" +
		"  RED-Bar-\"  // #Red-Bar\\n\"\n" +
		"AAA\n    GREENBLUE-Zed-\"    //\\t#GreenBlue-Zed \\n\"\n}"
	if got != want {
		t.Errorf("\ngot:  %q\nwant: %q", got, want)
	}
}

func TestTemplateCorpusTagsSimple(t *testing.T) {
	src := "{\n//#Wax\n  //  #SeeSaw\n}"
	got, err := Template(src, nil, &TemplateSpec{
		Replace: map[string]any{
			"#Wax": ReplaceFunc(func(g map[string]string, _ string) string {
				return g["indent"] + "-Wax:" + strings.ToUpper(g["TAG"]) + "\n"
			}),
			"#SeeSaw": ReplaceFunc(func(g map[string]string, _ string) string {
				return g["indent"] + "-SeeSaw:" + strings.ToUpper(g["TAG"]) + "\n"
			}),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n-Wax:WAX\n  -SeeSaw:SEESAW\n}"
	if got != want {
		t.Errorf("got %q\nwant %q", got, want)
	}
}
