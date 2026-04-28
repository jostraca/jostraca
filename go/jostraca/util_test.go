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
	out := Names(map[string]any{}, "Foo")
	want := map[string]any{
		"name__orig": "Foo",
		"Name":       "Foo",
		"name_":      "foo",
		"name-":      "foo",
		"name":       "foo",
		"NAME":       "FOO",
	}
	for k, v := range want {
		if out[k] != v {
			t.Errorf("Names(Foo)[%s] = %v, want %v", k, out[k], v)
		}
	}

	out = Names(map[string]any{}, "FooBar")
	wantBar := map[string]any{
		"name__orig": "FooBar",
		"Name":       "FooBar",
		"name_":      "foo_bar",
		"name-":      "foo-bar",
		"name":       "foobar",
		"NAME":       "FOOBAR",
	}
	for k, v := range wantBar {
		if out[k] != v {
			t.Errorf("Names(FooBar)[%s] = %v, want %v", k, out[k], v)
		}
	}
}

func TestUtilityCorpus(t *testing.T) {
	// Cases ported from test/utility.test.ts:216-291.
	if v := UCF("foo"); v != "Foo" {
		t.Errorf("UCF(foo)=%q", v)
	}
	if v := UCF(""); v != "" {
		t.Errorf("UCF('')=%q", v)
	}
	if v := UCF(nil); v != "Null" {
		t.Errorf("UCF(nil)=%q, want Null", v)
	}
	if v := LCF(nil); v != "null" {
		t.Errorf("LCF(nil)=%q, want null", v)
	}

	cases := []struct {
		name string
		in   any
		c, s, k string
	}{
		{"foo", "foo", "Foo", "foo", "foo"},
		{"FooBar", "FooBar", "FooBar", "foo_bar", "foo-bar"},
		{"foo_bar", "foo_bar", "FooBar", "foo_bar", "foo-bar"},
		{"foo-bar", "foo-bar", "FooBar", "foo_bar", "foo-bar"},
		{"fooBar", "fooBar", "FooBar", "foo_bar", "foo-bar"},
		{"empty", "", "", "", ""},
		{"slice", []string{"foo", "bar"}, "FooBar", "foo_bar", "foo-bar"},
		{"bool", true, "True", "true", "true"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if v := Camelify(tc.in); v != tc.c {
				t.Errorf("Camelify(%v)=%q, want %q", tc.in, v, tc.c)
			}
			if v := Snakify(tc.in); v != tc.s {
				t.Errorf("Snakify(%v)=%q, want %q", tc.in, v, tc.s)
			}
			if v := Kebabify(tc.in); v != tc.k {
				t.Errorf("Kebabify(%v)=%q, want %q", tc.in, v, tc.k)
			}
		})
	}

	// Partify edge cases.
	if v := Partify(nil); !sliceStrEq(v, []string{"null"}) {
		t.Errorf("Partify(nil)=%v", v)
	}
	if v := Partify(""); !sliceStrEq(v, []string{}) {
		t.Errorf("Partify('')=%v, want []", v)
	}
	if v := Partify(true); !sliceStrEq(v, []string{"true"}) {
		t.Errorf("Partify(true)=%v", v)
	}
	if v := Partify("foobar"); !sliceStrEq(v, []string{"foobar"}) {
		t.Errorf("Partify(foobar)=%v", v)
	}
}

func sliceStrEq(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
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

func TestHumanify(t *testing.T) {
	const epoch = int64(1735689600000) // 2025-01-01T00:00:00.000Z

	// Default: digits-only with last digit dropped.
	if got := Humanify(epoch, HumanifyFlags{}); got != int64(2025010100000000) {
		t.Errorf("default = %v, want 2025010100000000", got)
	}

	// Parts mode: full named fields.
	parts := Humanify(epoch, HumanifyFlags{Parts: true}).(map[string]any)
	if parts["year"] != 2025 || parts["month"] != 1 || parts["day"] != 1 {
		t.Errorf("parts = %v", parts)
	}

	// Terse mode: same data under ty/tm/td/... keys.
	terse := Humanify(epoch, HumanifyFlags{Parts: true, Terse: true}).(map[string]any)
	if terse["ty"] != 2025 || terse["tm"] != 1 || terse["td"] != 1 {
		t.Errorf("terse = %v", terse)
	}
}

func TestEachMark(t *testing.T) {
	got := Each([]any{"a", "b"}, EachSpec{Mark: true, Raw: true}, nil)
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	// With Mark+Raw, the items are returned raw; the wrapping is
	// suppressed but Mark adds index$ via a side channel? In TS Mark
	// affects the wrapped form. Our minimal interpretation: Mark only
	// has effect when not Raw.
	got = Each([]any{"a", "b"}, EachSpec{Mark: true}, nil)
	w0 := got[0].(map[string]any)
	if w0["val$"] != "a" || w0["index$"] != 0 {
		t.Errorf("wrapped item = %v", w0)
	}
}

func TestCMapAndVMap(t *testing.T) {
	in := map[string]any{
		"a": map[string]any{"x": 1, "y": "A"},
		"b": map[string]any{"x": 2, "y": "B"},
	}
	out := CMap(in, map[string]any{"x": CMapCopy})
	for k := range in {
		got := out[k].(map[string]any)["x"]
		want := in[k].(map[string]any)["x"]
		if got != want {
			t.Errorf("CMap[%s].x = %v, want %v", k, got, want)
		}
	}

	// Transform via callable.
	doubled := CMap(in, map[string]any{
		"x": CMapTransform(func(v any, _ CMapCtx) any { return v.(int) * 2 }),
	})
	for k, v := range in {
		got := doubled[k].(map[string]any)["x"]
		want := v.(map[string]any)["x"].(int) * 2
		if got != want {
			t.Errorf("doubled[%s].x = %v, want %v", k, got, want)
		}
	}

	// VMap returns a slice.
	v := VMap(in, map[string]any{"x": CMapCopy})
	if len(v) != 2 {
		t.Errorf("VMap len = %d, want 2", len(v))
	}
}

func TestOMap(t *testing.T) {
	pairs := OMap(map[string]any{"a": 1, "b": 2})
	if len(pairs) != 2 {
		t.Errorf("OMap len = %d, want 2", len(pairs))
	}
	seen := map[string]bool{}
	for _, p := range pairs {
		seen[p[0].(string)] = true
	}
	if !seen["a"] || !seen["b"] {
		t.Errorf("OMap missing keys: %v", seen)
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
