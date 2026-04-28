package jostraca

import (
	"reflect"
	"testing"
)

// GetX tests ported from test/utility.test.ts:60-167.

func TestGetXNilGuards(t *testing.T) {
	cases := []struct {
		root any
		path any
	}{
		{nil, nil},
		{nil, "x"},
		{map[string]any{}, nil},
		{nil, nil},
		{map[string]any{}, ""},
		{map[string]any{}, "x"},
	}
	for _, tc := range cases {
		if got := GetX(tc.root, tc.path); got != nil {
			t.Errorf("GetX(%v, %v) = %v, want nil", tc.root, tc.path, got)
		}
	}
}

func TestGetXBasicNav(t *testing.T) {
	if v := GetX(map[string]any{"a": 1}, "a"); v != 1 {
		t.Errorf("a = %v", v)
	}
	if v := GetX(map[string]any{"a": 1}, "x"); v != nil {
		t.Errorf("x = %v, want nil", v)
	}

	m := map[string]any{"a": map[string]any{"b": 1}}
	if v := GetX(m, "a b"); v != 1 {
		t.Errorf("a b = %v", v)
	}
	if v := GetX(m, "a.b"); v != 1 {
		t.Errorf("a.b = %v", v)
	}
	if v := GetX(m, "a x"); v != nil {
		t.Errorf("a x = %v", v)
	}
}

func TestGetXAncestry(t *testing.T) {
	m := map[string]any{"a": map[string]any{"b": 1}}
	got := GetX(m, "a:b")
	if !reflect.DeepEqual(got, m) {
		t.Errorf("a:b = %v, want full ancestry", got)
	}
	if v := GetX(map[string]any{"a": map[string]any{"x": 1}}, "a:b"); v != nil {
		t.Errorf("missing nested b, got %v", v)
	}

	deep := map[string]any{"a": map[string]any{"b": map[string]any{"c": 1}}}
	if got := GetX(deep, "a:b:c"); !reflect.DeepEqual(got, deep) {
		t.Errorf("a:b:c = %v, want %v", got, deep)
	}
}

func TestGetXFilterEquality(t *testing.T) {
	m := map[string]any{"a": 1}
	if got := GetX(m, "a=1"); !reflect.DeepEqual(got, m) {
		t.Errorf("a=1 = %v", got)
	}

	mb := map[string]any{"a": map[string]any{"b": 1}}
	if got := GetX(mb, "a:b=1"); !reflect.DeepEqual(got, mb) {
		t.Errorf("a:b=1 = %v", got)
	}
	if got := GetX(mb, "a b=1"); !reflect.DeepEqual(got, map[string]any{"b": 1}) {
		t.Errorf("a b=1 = %v", got)
	}
}

func TestGetXArrayFilter(t *testing.T) {
	a := map[string]any{"a": []any{
		map[string]any{"c": 1},
		map[string]any{"c": 2},
	}}
	want := []any{map[string]any{"c": 1}}
	got := GetX(a, "a?c=1")
	if !reflect.DeepEqual(got, want) {
		t.Errorf("a?c=1 = %v, want %v", got, want)
	}

	xs := []any{
		map[string]any{"y": 1},
		map[string]any{"y": 2},
		map[string]any{"y": 2},
	}
	wantTwos := []any{
		map[string]any{"y": 2},
		map[string]any{"y": 2},
	}
	got = GetX(map[string]any{"x": xs}, "x?y=2")
	if !reflect.DeepEqual(got, wantTwos) {
		t.Errorf("x?y=2 = %v, want %v", got, wantTwos)
	}
	got = GetX(xs, "?y=2")
	if !reflect.DeepEqual(got, wantTwos) {
		t.Errorf("?y=2 = %v, want %v", got, wantTwos)
	}

	wantOnes := []any{map[string]any{"y": 1}}
	got = GetX(map[string]any{"x": xs}, "x?y!=2")
	if !reflect.DeepEqual(got, wantOnes) {
		t.Errorf("x?y!=2 = %v, want %v", got, wantOnes)
	}
}

func TestGetXArrayIndex(t *testing.T) {
	xs := []any{11, 22, 33}
	if v := GetX(xs, "0"); v != 11 {
		t.Errorf("0 = %v", v)
	}
	if v := GetX(xs, "2"); v != 33 {
		t.Errorf("2 = %v", v)
	}
	if v := GetX(map[string]any{"a": xs}, "a 0"); v != 11 {
		t.Errorf("a 0 = %v", v)
	}
	nested := []any{[]any{11, 22, 33}}
	if v := GetX(nested, "0 1"); v != 22 {
		t.Errorf("0 1 = %v", v)
	}
}

func TestGetXEmptyPath(t *testing.T) {
	if v := GetX(map[string]any{"x": 3}, ""); v != nil {
		t.Errorf("empty path = %v, want nil", v)
	}
}

func TestGetXQuotedSegment(t *testing.T) {
	m := map[string]any{"a": map[string]any{"b": 1}}
	if v := GetX(m, `a "b"`); v != 1 {
		t.Errorf("a \"b\" = %v", v)
	}
}

// TestGetXNestedAncestry covers utility.test.ts:91-101.
func TestGetXNestedAncestry(t *testing.T) {
	cases := []struct {
		root any
		path string
		want any
	}{
		// 'a:b a' returns the inner b after stepping back to a.
		{map[string]any{"a": map[string]any{"b": map[string]any{"c": 1}}}, "a:b a", map[string]any{"b": map[string]any{"c": 1}}},
		{map[string]any{"a": map[string]any{"b": map[string]any{"c": 1}}}, "a:b a b", map[string]any{"c": 1}},
		{map[string]any{"a": map[string]any{"b": map[string]any{"c": 1}}}, "a:b a b c", 1},
	}
	for _, tc := range cases {
		got := GetX(tc.root, tc.path)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("GetX(%v, %q) = %v, want %v", tc.root, tc.path, got, tc.want)
		}
	}
}

// TestGetXNestedFilter covers utility.test.ts:108-114.
func TestGetXNestedFilter(t *testing.T) {
	in := map[string]any{
		"a": map[string]any{
			"b": map[string]any{"c": map[string]any{"e": 1}},
			"d": map[string]any{"c": map[string]any{"e": 2}},
		},
	}
	got := GetX(in, "a?c:e=1")
	want := map[string]any{"b": map[string]any{"c": map[string]any{"e": 1}}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("GetX(a?c:e=1) = %v, want %v", got, want)
	}
}

// TestGetXChainedFilters covers utility.test.ts:127-130.
func TestGetXChainedFilters(t *testing.T) {
	if v := GetX(map[string]any{"x": map[string]any{"y": 1}}, "x:y x"); !reflect.DeepEqual(v, map[string]any{"y": 1}) {
		t.Errorf("x:y x = %v", v)
	}
	if v := GetX(map[string]any{"x": map[string]any{"y": 1}}, "x:y x y"); v != 1 {
		t.Errorf("x:y x y = %v", v)
	}
}

// TestGetXFilterPick covers utility.test.ts:153-159.
func TestGetXFilterPick(t *testing.T) {
	xs := []any{
		map[string]any{"y": 1},
		map[string]any{"y": 2},
		map[string]any{"y": 2},
	}
	if v := GetX(xs, "?y=2"); !reflect.DeepEqual(v, []any{
		map[string]any{"y": 2},
		map[string]any{"y": 2},
	}) {
		t.Errorf("?y=2 (slice) = %v", v)
	}
	// Index after filter: ?y=2 0 picks first matching item.
	if v := GetX(xs, "?y=2 0"); !reflect.DeepEqual(v, map[string]any{"y": 2}) {
		t.Errorf("?y=2 0 = %v", v)
	}
}

// TestGetXNestedArrayIndex covers utility.test.ts:147-150.
func TestGetXNestedArrayIndex(t *testing.T) {
	in := []any{[]any{
		map[string]any{"a": 11},
		map[string]any{"a": 22},
		map[string]any{"a": 33},
	}}
	if v := GetX(in, "0 1 a"); v != 22 {
		t.Errorf("0 1 a = %v", v)
	}
	if v := GetX(in, "0?a=11"); !reflect.DeepEqual(v, []any{map[string]any{"a": 11}}) {
		t.Errorf("0?a=11 = %v", v)
	}
}

func TestGetXFilterChain(t *testing.T) {
	m := map[string]any{"x": map[string]any{"y": 1}}
	if v := GetX(m, "x y=1 y"); v != 1 {
		t.Errorf("x y=1 y = %v", v)
	}
	if v := GetX(m, "x y!=1"); v != nil {
		t.Errorf("x y!=1 = %v, want nil", v)
	}

	// x=1 x returns x's value when x equals 1.
	if v := GetX(map[string]any{"x": 1}, "x=1 x"); v != 1 {
		t.Errorf("x=1 x = %v", v)
	}
}
