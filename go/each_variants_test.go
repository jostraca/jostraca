package jostraca

import (
	"encoding/json"
	"reflect"
	"testing"
)

// Tests for the narrower TS-overloading variants:
// - EachI: slice with (val, idx) callback
// - EachKV: map with (val, key, idx) callback
// - EachF: pure transform, no annotation
// - GetXPath: explicit []string path
// - HumanifyParts / HumanifyTerse: typed return shapes
// - NamesP: variadic prop alias

func TestEachIWithIndex(t *testing.T) {
	got := EachI([]any{"a", "b", "c"}, func(v any, idx int) any {
		return v.(string) + ":" + intToStr(idx)
	})
	want := []any{"a:0", "b:1", "c:2"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestEachKVMatchesTSCorpus(t *testing.T) {
	// Mirrors test/utility.test.ts:55-58 exactly.
	in := map[string]any{"b": 22, "c": 11, "a": 33}
	got := EachKV(in, func(v any, n string, i int) any {
		b, _ := json.Marshal(v)
		return n + "-" + intToStr(i) + "-" + string(b)
	})
	// Iteration order: insertion matters in TS but Go map iteration is
	// random. EachKV sorts by key for determinism (deviation flagged
	// in BUILD_LOG). The TS "abc by insertion" output thus becomes
	// alphabetical here.
	want := []any{
		`a-0-{"key$":"a","val$":33}`,
		`b-1-{"key$":"b","val$":22}`,
		`c-2-{"key$":"c","val$":11}`,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v\nwant %v", got, want)
	}
}

func TestEachFPure(t *testing.T) {
	got := EachF([]any{1, 2, 3}, func(v any) any {
		return v.(int) * 10
	})
	want := []any{10, 20, 30}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestGetXPathSlice(t *testing.T) {
	m := map[string]any{"a": map[string]any{"b": map[string]any{"c": 42}}}
	if v := GetXPath(m, []string{"a", "b", "c"}); v != 42 {
		t.Errorf("GetXPath = %v, want 42", v)
	}
}

func TestHumanifyPartsTyped(t *testing.T) {
	hp := HumanifyParts(int64(1735689600000))
	if hp.Year != 2025 || hp.Month != 1 || hp.Day != 1 {
		t.Errorf("parts = %+v, want 2025-01-01", hp)
	}
}

func TestNamesVariadic(t *testing.T) {
	out := Names(map[string]any{}, "Foo")
	if out["Name"] != "Foo" {
		t.Errorf("default prop=name: %v", out)
	}
	out2 := Names(map[string]any{}, "Foo", "thing")
	if out2["Thing"] != "Foo" {
		t.Errorf("custom prop=thing: %v", out2)
	}
}

func TestTemplateFAndR(t *testing.T) {
	got, err := TemplateF("a$$x$$b", map[string]any{"x": "Z"})
	if err != nil || got != "aZb" {
		t.Errorf("TemplateF = %q (err %v)", got, err)
	}
	got, err = TemplateR("aQb", map[string]any{"Q": "Z"})
	if err != nil || got != "aZb" {
		t.Errorf("TemplateR = %q (err %v)", got, err)
	}
}

func TestNamesP(t *testing.T) {
	out := NamesP(map[string]any{}, "FooBar", "thing")
	if out["thing__orig"] != "FooBar" {
		t.Errorf("NamesP missing thing__orig: %v", out)
	}
	if out["Thing"] != "FooBar" {
		t.Errorf("NamesP missing Thing: %v", out)
	}
}

func TestGetXSAndPath(t *testing.T) {
	m := map[string]any{"a": map[string]any{"b": 7}}
	if v := GetXS(m, "a b"); v != 7 {
		t.Errorf("GetXS = %v", v)
	}
	if v := GetXPath(m, []string{"a", "b"}); v != 7 {
		t.Errorf("GetXPath = %v", v)
	}
}

func TestHumanifyDigitsAndTerse(t *testing.T) {
	if v := HumanifyDigits(int64(1735689600000)); v != int64(2025010100000000) {
		t.Errorf("HumanifyDigits = %v", v)
	}
	terse := HumanifyTerse(int64(1735689600000))
	if terse.TY != 2025 || terse.TM != 1 || terse.TD != 1 {
		t.Errorf("HumanifyTerse = %+v", terse)
	}
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	if neg {
		digits = append([]byte{'-'}, digits...)
	}
	return string(digits)
}
