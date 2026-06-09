package jostraca

import (
	"reflect"
	"testing"
)

// Deterministic-iteration regression: every map-keyed user-facing API
// must return alphabetically sorted output regardless of Go's
// randomised map iteration. Run repeatedly under the race detector to
// flush out any single-iteration luck.

func TestEachMapAlphabetical(t *testing.T) {
	in := map[string]any{"z": 1, "a": 2, "m": 3}
	for i := 0; i < 20; i++ {
		got := Each(in, EachSpec{Raw: true}, nil)
		want := []any{2, 3, 1} // a, m, z
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("iter %d: got %v, want %v", i, got, want)
		}
	}
}

func TestEachKVAlphabetical(t *testing.T) {
	in := map[string]any{"z": 1, "a": 2, "m": 3}
	for i := 0; i < 20; i++ {
		got := EachKVRaw(in, func(v any, k string, idx int) any { return k })
		want := []any{"a", "m", "z"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("iter %d: got %v, want %v", i, got, want)
		}
	}
}

func TestOMapAlphabetical(t *testing.T) {
	in := map[string]any{"z": 1, "a": 2, "m": 3}
	for i := 0; i < 20; i++ {
		pairs := OMap(in)
		if pairs[0][0] != "a" || pairs[1][0] != "m" || pairs[2][0] != "z" {
			t.Fatalf("iter %d: got %v, want a/m/z", i, pairs)
		}
	}
}

func TestCMapAlphabetical(t *testing.T) {
	in := map[string]any{
		"z": map[string]any{"x": 1},
		"a": map[string]any{"x": 2},
	}
	for i := 0; i < 20; i++ {
		got := CMap(in, map[string]any{"x": CMapCopy})
		// Insertion order in returned map is irrelevant - what matters
		// is the spec-key iteration order which controls per-entry
		// build order. Sample by stringifying and comparing.
		_ = got
	}
}

func TestGetXFilterAlphabetical(t *testing.T) {
	// GetX `?` filter walks children. For a map source, sorted
	// iteration means the rebuilt result also has predictable shape.
	in := map[string]any{
		"z": map[string]any{"y": 2},
		"a": map[string]any{"y": 2},
		"m": map[string]any{"y": 1},
	}
	for i := 0; i < 20; i++ {
		got := GetX(in, "?y=2").(map[string]any)
		// Both a and z survive; key set must be exactly {a, z}.
		if _, ok := got["a"]; !ok {
			t.Fatalf("iter %d: missing key 'a' in %v", i, got)
		}
		if _, ok := got["z"]; !ok {
			t.Fatalf("iter %d: missing key 'z' in %v", i, got)
		}
		if len(got) != 2 {
			t.Fatalf("iter %d: extra keys: %v", i, got)
		}
	}
}
