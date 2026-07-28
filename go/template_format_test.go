package jostraca

import (
	"math"
	"strings"
	"testing"
)

// Formatting properties the cross-stack corpus cannot express.
//
// template_corpus.json travels as JSON, so every number in it reaches Go
// as a float64 — which is exactly what a user gets from JSON or YAML
// config, and the path the corpus therefore exercises. A Go caller
// building a model in code can hand the engine a native int, uint or
// float32 instead, and those take a different branch of formatValue.
// Nothing on the TS side can pin that branch down, so it is pinned here.

func TestFormatValueNativeIntMatchesFloat64(t *testing.T) {
	// Every value both an int and a float64 can hold exactly must format
	// identically, whichever type the caller happens to have used.
	cases := []int64{
		0, 1, -1, 42, -17, 1000,
		999999, 1000000, 10000000,
		1 << 40,
		9007199254740992, // 2^53, the last integer float64 counts by ones
		-9007199254740992,
	}

	for _, n := range cases {
		asInt := formatValue(int(n), "FALLBACK")
		asInt64 := formatValue(n, "FALLBACK")
		asFloat := formatValue(float64(n), "FALLBACK")

		if asInt != asFloat {
			t.Errorf("int(%d)=%q but float64=%q", n, asInt, asFloat)
		}
		if asInt64 != asFloat {
			t.Errorf("int64(%d)=%q but float64=%q", n, asInt64, asFloat)
		}
	}
}

func TestFormatValueUnsignedMatchesFloat64(t *testing.T) {
	for _, n := range []uint64{0, 1, 42, 1000000, 1 << 40} {
		if got, want := formatValue(uint(n), ""), formatValue(float64(n), ""); got != want {
			t.Errorf("uint(%d)=%q but float64=%q", n, got, want)
		}
		if got, want := formatValue(n, ""), formatValue(float64(n), ""); got != want {
			t.Errorf("uint64(%d)=%q but float64=%q", n, got, want)
		}
	}
}

// Variables, not constants: Go evaluates an untyped constant `0.1 + 0.2`
// at arbitrary precision and lands on exactly 0.3. JS adds them as
// float64 and gets 0.30000000000000004, and so must this.
var (
	pointOne = 0.1
	pointTwo = 0.2
)

func TestFormatJSNumber(t *testing.T) {
	// Expectations are what `String(n)` produces in JavaScript. TS is
	// canonical and all its numbers are float64, so this is the contract.
	cases := []struct {
		in   float64
		want string
	}{
		{0, "0"},
		{math.Copysign(0, -1), "0"}, // JS String(-0) is "0", not "-0"
		{1, "1"},
		{-1, "-1"},
		{42, "42"},
		{0.1, "0.1"},
		{-0.25, "-0.25"},
		{1.0 / 3.0, "0.3333333333333333"},
		{pointOne + pointTwo, "0.30000000000000004"},
		{9007199254740992, "9007199254740992"},

		// Positional up to but not including 1e21, exponential from there.
		{1e20, "100000000000000000000"},
		{1e21, "1e+21"},
		{1.5e300, "1.5e+300"},

		// Positional down to 1e-6, exponential below it. Go's %v would
		// zero-pad these exponents ("1e-07"); JS does not.
		{1e-6, "0.000001"},
		{1e-7, "1e-7"},
		{1.5e-7, "1.5e-7"},
		{1e-100, "1e-100"},

		{math.NaN(), "NaN"},
		{math.Inf(1), "Infinity"},
		{math.Inf(-1), "-Infinity"},
	}

	for _, c := range cases {
		if got := formatJSNumber(c.in); got != c.want {
			t.Errorf("formatJSNumber(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestTrimExponentZeros(t *testing.T) {
	cases := [][2]string{
		{"1e-07", "1e-7"},
		{"1e+21", "1e+21"},
		{"1.5e+300", "1.5e+300"},
		{"1e-100", "1e-100"},
		{"2E-05", "2e-5"},
		{"5e00", "5e0"},   // an all-zero exponent keeps one digit
		{"5e-00", "5e-0"}, // ...sign and all
		{"123", "123"},    // no exponent, unchanged
		{"", ""},
	}

	for _, c := range cases {
		if got := trimExponentZeros(c[0]); got != c[1] {
			t.Errorf("trimExponentZeros(%q) = %q, want %q", c[0], got, c[1])
		}
	}
}

func TestMarshalJSLikeDoesNotEscapeHTML(t *testing.T) {
	// Go's encoding/json escapes <, > and & by default; JSON.stringify
	// does not. Generated code is full of angle brackets, so a model value
	// carrying markup would otherwise come out mangled on one stack only.
	got, err := marshalJSLike(map[string]any{"tag": "<a href=\"x\">a&b</a>"})
	if err != nil {
		t.Fatal(err)
	}
	if want := `{"tag":"<a href=\"x\">a&b</a>"}`; got != want {
		t.Errorf("marshalJSLike = %s, want %s", got, want)
	}
	// Belt and braces: these are what the default encoder emits instead.
	for _, escaped := range []string{"\\u003c", "\\u003e", "\\u0026"} {
		if strings.Contains(got, escaped) {
			t.Errorf("HTML escaping is still on (%s): %s", escaped, got)
		}
	}
}

func TestMarshalJSLikeNestedNumbersUseJSForm(t *testing.T) {
	// encoding/json already renders floats the ECMAScript way, so nested
	// numbers need no help — but that is load-bearing, not incidental.
	got, err := marshalJSLike(map[string]any{"tiny": 1e-7, "huge": 1e21})
	if err != nil {
		t.Fatal(err)
	}
	if want := `{"huge":1e+21,"tiny":1e-7}`; got != want {
		t.Errorf("marshalJSLike = %s, want %s", got, want)
	}
}

func TestFormatValueSortsObjectKeys(t *testing.T) {
	// Go maps have no insertion order, so TS sorts to match. Assert the
	// sorted form directly rather than relying on the corpus alone.
	got := formatValue(map[string]any{"z": 1, "a": 2, "m": 3}, "")
	if want := `{"a":2,"m":3,"z":1}`; got != want {
		t.Errorf("formatValue = %s, want %s", got, want)
	}
}
