package jostraca

import (
	"encoding/json"
	"testing"
)

// Caller-side state is recorded by no corpus: all four record OUTPUT only,
// never the model, the options object, or returned slices. A helper that
// quietly mutates its input is therefore invisible cross-stack.
//
// TS had exactly that bug in getx's `?` filter -- it stamped key$/index$ onto
// the caller's children in place and only cleaned the ones that survived the
// filter, so a rejected child kept the stamp and the pollution could reach
// generated files. Go rebuilds instead of stamping, so it was already correct.
// These pin that, so Go cannot drift into the mutating shape while the corpus
// stays silent. See PARITY_PLAN.md 2.3.

func callerStateJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestGetXFilterDoesNotMutateModel(t *testing.T) {
	model := map[string]any{"a": map[string]any{
		"x": map[string]any{"v": 1.0},
		"y": map[string]any{"v": 2.0},
	}}
	before := callerStateJSON(t, model)

	got := GetX(model, "a?v=1")

	if want := `{"x":{"v":1}}`; callerStateJSON(t, got) != want {
		t.Errorf("result: got %s, want %s", callerStateJSON(t, got), want)
	}
	if after := callerStateJSON(t, model); after != before {
		t.Errorf("GetX mutated the caller's model:\nbefore %s\nafter  %s", before, after)
	}
}

func TestGetXFilterDoesNotMutateArrayModel(t *testing.T) {
	model := map[string]any{"a": []any{
		map[string]any{"v": 1.0},
		map[string]any{"v": 2.0},
	}}
	before := callerStateJSON(t, model)

	GetX(model, "a?v=1")

	if after := callerStateJSON(t, model); after != before {
		t.Errorf("GetX mutated the caller's array model:\nbefore %s\nafter  %s", before, after)
	}
}

// The specific leak TS had: the child the filter REJECTED keeping its stamp.
func TestGetXLeavesNoStampOnRejectedChildren(t *testing.T) {
	rejected := map[string]any{"v": 2.0}
	model := map[string]any{"a": map[string]any{
		"x": map[string]any{"v": 1.0},
		"y": rejected,
	}}

	GetX(model, "a?v=1")

	for _, k := range []string{"key$", "index$"} {
		if _, found := rejected[k]; found {
			t.Errorf("rejected child kept bookkeeping key %q: %v", k, rejected)
		}
	}
}
