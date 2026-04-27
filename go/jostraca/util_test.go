package jostraca

import (
	"reflect"
	"testing"
)

// Phase 4 — Utilities. Cases ported from test/utility.test.ts where the
// Go signatures permit. GetX, CMap/VMap, Humanify, DLog, and OMap are
// deferred per BUILD_LOG; their tests will land alongside their
// implementations.

func TestEachSlice(t *testing.T) {
	got := Each([]any{11, 22}, EachSpec{}, nil)
	if !reflect.DeepEqual(got, []any{
		map[string]any{"val$": 11, "index$": 0},
		map[string]any{"val$": 22, "index$": 1},
	}) {
		t.Errorf("default oval=true: got %v", got)
	}

	got = Each([]any{11, 22}, EachSpec{Raw: true}, nil)
	if !reflect.DeepEqual(got, []any{11, 22}) {
		t.Errorf("Raw=true: got %v", got)
	}
}

func TestEachSliceSort(t *testing.T) {
	got := Each([]any{"b", "a"}, EachSpec{Raw: true, Sort: true}, nil)
	if !reflect.DeepEqual(got, []any{"a", "b"}) {
		t.Errorf("sort: got %v", got)
	}
}

func TestEachSliceTransform(t *testing.T) {
	got := Each([]any{1, 2}, EachSpec{Raw: true}, func(v any) any {
		n := v.(int)
		return n * 2
	})
	if !reflect.DeepEqual(got, []any{2, 4}) {
		t.Errorf("got %v, want [2 4]", got)
	}
}

func TestEachMap(t *testing.T) {
	got := Each(map[string]any{"a": 1}, EachSpec{}, nil)
	if !reflect.DeepEqual(got, []any{
		map[string]any{"key$": "a", "val$": 1},
	}) {
		t.Errorf("map: got %v", got)
	}
}

func TestEachMapSorted(t *testing.T) {
	got := Each(map[string]any{"b": 22, "c": 11, "a": 33}, EachSpec{Sort: true}, nil)
	want := []any{
		map[string]any{"key$": "a", "val$": 33},
		map[string]any{"key$": "b", "val$": 22},
		map[string]any{"key$": "c", "val$": 11},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestEachNil(t *testing.T) {
	if got := Each(nil, EachSpec{}, nil); len(got) != 0 {
		t.Errorf("Each(nil) = %v, want empty", got)
	}
}

func TestNameConverters(t *testing.T) {
	cases := []struct {
		in           string
		camel, snake, kebab string
	}{
		{"foo-bar", "FooBar", "foo_bar", "foo-bar"},
		{"foo_bar", "FooBar", "foo_bar", "foo-bar"},
		{"FooBar", "FooBar", "foo_bar", "foo-bar"},
		{"foo bar", "FooBar", "foo_bar", "foo-bar"},
		{"foo", "Foo", "foo", "foo"},
		{"", "", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			if got := Camelify(tc.in); got != tc.camel {
				t.Errorf("Camelify(%q) = %q, want %q", tc.in, got, tc.camel)
			}
			if got := Snakify(tc.in); got != tc.snake {
				t.Errorf("Snakify(%q) = %q, want %q", tc.in, got, tc.snake)
			}
			if got := Kebabify(tc.in); got != tc.kebab {
				t.Errorf("Kebabify(%q) = %q, want %q", tc.in, got, tc.kebab)
			}
		})
	}
}

func TestPartify(t *testing.T) {
	cases := []struct {
		in   any
		want []string
	}{
		{"foo-bar", []string{"foo", "bar"}},
		{"foo_bar", []string{"foo", "bar"}},
		{"FooBar", []string{"Foo", "Bar"}},
		{"fooBar", []string{"foo", "Bar"}},
		{"foo bar", []string{"foo", "bar"}},
		{[]string{"foo", "bar"}, []string{"foo", "bar"}},
	}
	for _, tc := range cases {
		got := Partify(tc.in)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("Partify(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestLCFUCF(t *testing.T) {
	if got := UCF("foo"); got != "Foo" {
		t.Errorf("UCF(foo) = %q, want Foo", got)
	}
	if got := LCF("Foo"); got != "foo" {
		t.Errorf("LCF(Foo) = %q, want foo", got)
	}
	if got := UCF(""); got != "" {
		t.Errorf("UCF(empty) = %q, want empty", got)
	}
}

func TestEscRE(t *testing.T) {
	if got := EscRE("a.b+c"); got != `a\.b\+c` {
		t.Errorf("EscRE(a.b+c) = %q", got)
	}
}

func TestIsBinExt(t *testing.T) {
	if !IsBinExt("file.png") {
		t.Error("IsBinExt(file.png) = false")
	}
	if !IsBinExt("file.PDF") {
		t.Error("IsBinExt(file.PDF) = false")
	}
	if IsBinExt("file.txt") {
		t.Error("IsBinExt(file.txt) = true")
	}
	if IsBinExt("noext") {
		t.Error("IsBinExt(noext) = true")
	}
}

func TestNames(t *testing.T) {
	base := map[string]any{"name": "fooBar"}
	out := Names(base, "fooBar", "name")
	if out["name"] != "fooBar" {
		t.Errorf("name preserved: got %q", out["name"])
	}
	// At minimum the variants Camel/Snake/Kebab should appear under
	// some predictable key. Keep the assertion loose since the TS API
	// uses a name__ prefix convention; we'll mirror TS exactly.
	for _, k := range []string{"name__camel", "name__snake", "name__kebab"} {
		if _, ok := out[k]; !ok {
			t.Errorf("missing variant %s", k)
		}
	}
}

func TestGet(t *testing.T) {
	m := map[string]any{"a": map[string]any{"b": 1}}
	if got := Get(m, "a.b"); got != 1 {
		t.Errorf("Get(a.b) = %v, want 1", got)
	}
	if got := Get(m, "x.y"); got != nil {
		t.Errorf("Get(x.y) = %v, want nil", got)
	}
}

func TestIndent(t *testing.T) {
	cases := []struct {
		src, want string
		ind       any
	}{
		{"a\nb", "a\n  b", 2},
		{"a\nb", "a\nXb", "X"},
		{"abc", "abc", 4},
		{"a\nb\nc", "a\n>>b\n>>c", ">>"},
		{"", "", 4},
	}
	for _, tc := range cases {
		got := Indent(tc.src, tc.ind)
		if got != tc.want {
			t.Errorf("Indent(%q, %v) = %q, want %q", tc.src, tc.ind, got, tc.want)
		}
	}
}

func TestDeep(t *testing.T) {
	a := map[string]any{"x": 1, "y": map[string]any{"a": 1, "b": 2}}
	b := map[string]any{"y": map[string]any{"b": 99, "c": 3}, "z": 5}
	got := Deep(a, b).(map[string]any)
	want := map[string]any{
		"x": 1,
		"y": map[string]any{"a": 1, "b": 99, "c": 3},
		"z": 5,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Deep got %v, want %v", got, want)
	}
}
