package jostraca

import (
	"encoding/json"
	"slices"
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

// Hunks is EXPORTED, so what it returns is the caller's to keep and to
// modify. It used to hand back the caller's own backing array: the loop
// builds each hunk by appending onto a nil slice, so those own their
// storage, but the trailing `flush(generated[gi:], existing[ei:])` passed
// sub-slices straight through.
//
// Whether that was observable depended entirely on the input shape, which
// is why one probe missed it: inputs sharing a first and last line leave
// the trailing flush empty and nothing aliases. Every shape that reaches
// it is covered here. Canonical TS copies (`generated.slice(gi)`), so this
// pins Go to the behaviour TS always had. See PARITY_PLAN.md 2.3.
func TestHunksDoesNotAliasCallerSlices(t *testing.T) {
	cases := []struct {
		name      string
		generated []string
		existing  []string
	}{
		{"no common line", []string{"a"}, []string{"b"}},
		{"divergent tails", []string{"a", "b", "c"}, []string{"a", "X", "Y"}},
		{"generated longer", []string{"a", "b", "c", "d"}, []string{"a"}},
		{"existing longer", []string{"a"}, []string{"a", "b", "c", "d"}},
		{"shared ends", []string{"a", "b", "c"}, []string{"a", "X", "c"}},
		{"identical", []string{"a", "b"}, []string{"a", "b"}},
		{"both empty", nil, nil},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gen := slices.Clone(c.generated)
			exi := slices.Clone(c.existing)
			wantGen := callerStateJSON(t, gen)
			wantExi := callerStateJSON(t, exi)

			for _, h := range Hunks(gen, exi) {
				for i := range h.Generated {
					h.Generated[i] = "MUTATED"
				}
				for i := range h.Existing {
					h.Existing[i] = "MUTATED"
				}
			}

			if got := callerStateJSON(t, gen); got != wantGen {
				t.Errorf("generated was mutated: got %s, want %s", got, wantGen)
			}
			if got := callerStateJSON(t, exi); got != wantExi {
				t.Errorf("existing was mutated: got %s, want %s", got, wantExi)
			}
		})
	}
}

// The third instance of the same class, pinned on this side too. TS's
// `generate` used to hand the caller's own options object to the validator,
// which injects its defaults in place, so the caller got `build`, `cmp`,
// `control`, `exclude` and `name` written into their object -- and `bin`
// into an `existing` they supplied. Go passes Options by VALUE, so the
// struct itself cannot be touched; what could still leak is the maps it
// carries, which are reference types. Nothing in Generate should write to
// the caller's Meta, Model or Vol. See PARITY_PLAN.md 2.3.
func TestGenerateDoesNotMutateCallerOptions(t *testing.T) {
	mem := NewMemFS()

	meta := map[string]any{"k": 1.0}
	model := map[string]any{"v": "V"}
	vol := map[string][]byte{"/seed.txt": []byte("S")}
	preserve := true
	existing := Existing{}
	existing.Txt.Preserve = &preserve

	opts := Options{
		Folder:   "/out",
		Meta:     meta,
		Model:    model,
		Vol:      vol,
		Existing: existing,
	}

	before := callerStateJSON(t, map[string]any{
		"meta": meta, "model": model, "vol": vol, "preserve": preserve,
	})

	j := New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return 1735689600000 }))
	if _, err := j.Generate(opts, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("A") })
		})
	}); err != nil {
		t.Fatal(err)
	}

	after := callerStateJSON(t, map[string]any{
		"meta": meta, "model": model, "vol": vol, "preserve": preserve,
	})
	if after != before {
		t.Errorf("Generate mutated the caller's options:\n before=%s\n after =%s", before, after)
	}
}
