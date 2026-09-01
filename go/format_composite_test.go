package jostraca

import (
	"testing"
	"time"
)

// formatValue's JSON branch matched four EXACT types -- map[string]any,
// map[string]string, []any, []string -- so any other composite fell through
// to fmt.Sprintf and rendered in Go's debug syntax. Ordinary typed Go data
// therefore came out wrong wherever a template macro resolved to it:
//
//	map[string]int{"a": 1}   ->  map[a:1]     want {"a":1}
//	[]int{1, 2}              ->  [1 2]        want [1,2]
//	a struct                 ->  {1 x}        want {"a":1,"b":"x"}
//
// TS has one object type and JSONifies all of it, so every one of these was
// a cross-stack divergence. Only the TOP level was affected: encoding/json
// already handled a typed value nested inside a recognised one.
//
// Reported by the Codex review bot against the `{item}` macro added for #40.
// The macro was one caller; $$path$$ had the identical defect and predates
// it, so the fix is in formatValue.

type fcStruct struct {
	A int    `json:"a"`
	B string `json:"b"`
}

// Declaration order deliberately unsorted, to catch the key-order half.
type fcOrder struct {
	Zeta  int   `json:"zeta"`
	Alpha int   `json:"alpha"`
	Big   int64 `json:"big"`
}

func fcTemplate(t *testing.T, v any) string {
	t.Helper()
	out, err := Template("v=$$x$$", map[string]any{"x": v}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestFormatValueTypedComposites(t *testing.T) {
	cases := []struct {
		name string
		v    any
		want string
	}{
		// The regression: typed composites, none of them in the old type
		// switch.
		{"map[string]int", map[string]int{"a": 1}, `v={"a":1}`},
		{"map[string]float64", map[string]float64{"a": 1.5}, `v={"a":1.5}`},
		{"[]int", []int{1, 2}, "v=[1,2]"},
		{"[]float64", []float64{1.5}, "v=[1.5]"},
		{"array", [2]int{1, 2}, "v=[1,2]"},
		{"struct", fcStruct{A: 1, B: "x"}, `v={"a":1,"b":"x"}`},
		{"slice of struct", []fcStruct{{A: 1, B: "x"}},
			`v=[{"a":1,"b":"x"}]`},

		// The four already-recognised shapes must not move.
		{"map[string]any", map[string]any{"a": 1.0}, `v={"a":1}`},
		{"map[string]string", map[string]string{"a": "x"}, `v={"a":"x"}`},
		{"[]any", []any{1.0, 2.0}, "v=[1,2]"},
		{"[]string", []string{"a", "b"}, `v=["a","b"]`},

		// Scalars are untouched by the kind test, which runs only after the
		// type switch falls through.
		{"string", "S", "v=S"},
		{"int", 42, "v=42"},
		{"float64", 1.5, "v=1.5"},
		{"bool", true, "v=true"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := fcTemplate(t, c.v); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

// fmt.Stringer still wins, because the kind test runs AFTER the type switch.
// A time.Time is a struct, so a kind test placed first would have turned every
// timestamp into a JSON object.
func TestFormatValueStringerBeatsStructKind(t *testing.T) {
	got := fcTemplate(t, time.Unix(0, 0).UTC())
	if want := "v=1970-01-01 00:00:00 +0000 UTC"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// Struct fields are emitted in SORTED key order, not declaration order.
// encoding/json sorts map keys but not struct fields, so without the round
// trip a struct would be the one shape whose key order depended on how the
// Go side happened to declare it -- where TS's jsonify sorts every object.
func TestFormatValueStructKeysSort(t *testing.T) {
	got := fcTemplate(t, fcOrder{Zeta: 1, Alpha: 2, Big: 3})
	if want := `v={"alpha":2,"big":3,"zeta":1}`; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// And at every depth: a struct nested inside a map[string]any takes the fast
// path, which would otherwise have kept its declaration order and left the
// two spellings of one value disagreeing.
func TestFormatValueNestedStructKeysSort(t *testing.T) {
	got := fcTemplate(t, map[string]any{"outer": fcOrder{Zeta: 1, Alpha: 2, Big: 3}})
	if want := `v={"outer":{"alpha":2,"big":3,"zeta":1}}`; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// The sort takes the value through a generic decode, so integer precision has
// to survive it. UseNumber is what keeps this exact; plain `any` would route
// the value through float64 and round it to ...992.
func TestFormatValueStructKeepsLargeIntExact(t *testing.T) {
	got := fcTemplate(t, fcOrder{Big: 9007199254740993})
	if want := `v={"alpha":0,"big":9007199254740993,"zeta":0}`; got != want {
		t.Errorf("got %q, want %q -- the sort round trip lost integer "+
			"precision; UseNumber is what prevents that", got, want)
	}
}

// KNOWN, and deliberately left alone by the fix above.
//
// A []byte is a slice, so the kind test would sweep it in, but encoding/json
// renders one as base64 while TS renders a Buffer through its toJSON as
// {"type":"Buffer","data":[...]}. Neither matches the other, so neither is
// the obvious answer and this fix does not pretend to settle it. Pinned so
// the current rendering cannot change without someone deciding to.
func TestFormatValueByteSliceUnchanged(t *testing.T) {
	got := fcTemplate(t, []byte("hi"))
	if want := "v=[104 105]"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// Pointers likewise. Dereferencing raises its own questions -- what a nil
// pointer renders as, and whether a pointer is a value or a reference to the
// caller -- so a pointer keeps Go's debug syntax for now.
func TestFormatValuePointerUnchanged(t *testing.T) {
	got := fcTemplate(t, &fcStruct{A: 1, B: "x"})
	if want := "v=&{1 x}"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// The same values through the List `{item}` macro, which is where the finding
// was raised: it shares formatValue, so one fix covers both callers.
func TestListItemMacroTypedComposites(t *testing.T) {
	cases := []struct {
		name string
		v    any
		want string
	}{
		{"map[string]int", map[string]int{"a": 1}, "w={\"a\":1}\n\n"},
		{"[]int", []int{1, 2}, "w=[1,2]\n\n"},
		{"struct", fcStruct{A: 1, B: "x"}, "w={\"a\":1,\"b\":\"x\"}\n\n"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := listGen(t, []any{map[string]any{"v": c.v}}, "w={item.v}\n", nil)
			if got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}
