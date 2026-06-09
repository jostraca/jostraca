package jostraca

import (
	"strings"
	"testing"
)

// Phase parity-push: Fragment replace callbacks may invoke other
// components. Mirrors test/jostraca.test.ts:fragment-subcmp.
//
// The TS test has:
//   replace: {
//     bar: 'BAR',                    // literal string
//     zed: () => 'ZED',              // function returning string
//     con: () => Content('CON'),    // side-effect emitting via handle
//     foo: () => Foo('B')           // calls a custom cmp
//   }
//
// Expected: 'TWO-A-BAR-ZED-CON-FOO[B]+S\n' inside the rendered fragment.
//
// Go's overload-coverage approach: ReplaceFunc accepts a func(*J) variant
// which the engine calls with a buffer-bound J. j.Content / custom-cmp
// calls accumulate output that becomes the replacement text.

func TestFragmentReplaceSubcmp(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/f01.txt", []byte("TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n"))

	// Custom Go component analogous to TS:
	//   const Foo = cmp(function Foo(props: any) {
	//     Content('FOO['); Content(props.arg); Content(']')
	//   })
	Foo := func(j *J, arg string) {
		j.Content("FOO[")
		j.Content(arg)
		j.Content("]")
	}

	j := New(WithFS(mem), WithFolder("/out"), WithModel(map[string]any{"a": "A"}))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("foo.txt", func(j *J) {
				j.Content("ONE\n")
				j.Fragment(FragmentProps{
					From: "/f01.txt",
					Replace: map[string]any{
						"bar": "BAR",
						"zed": func() string { return "ZED" },
						"con": func(j *J) { j.Content("CON") },
						"foo": func(j *J) { Foo(j, "B") },
					},
				}, func(j *J) {
					j.Content("S")
				})
				j.Content("THREE\n")
			})
		})
	})
	if err != nil {
		t.Fatal(err)
	}

	got, err := mem.ReadFile("/out/foo.txt")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	want := "ONE\nTWO-A-BAR-ZED-CON-FOO[B]+S\nTHREE\n"
	if string(got) != want {
		t.Errorf("got %q\nwant %q", got, want)
	}
	_ = strings.Contains // keep import
}
