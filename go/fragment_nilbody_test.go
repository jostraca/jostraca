package jostraca

import "testing"

// A Fragment may have no body. FragmentP returns before stashing one when
// body == nil (builder.go), so fragmentAfter's replay closure held a nil func
// -- and a source containing an unnamed <[SLOT]> marker calls that closure to
// fill the slot. The result was a nil pointer dereference: a two-line program
// panicked and killed the caller's goroutine, where TS renders the marker as
// empty and completes.
//
// The panic is why this class matters beyond the single bug. A panic cannot be
// recorded by any corpus in the repo -- the scenario runner asserts errors
// bidirectionally, but a panic unwinds the test binary rather than returning
// one. See PARITY_PLAN.md 2.1 and 3.

func fragNilBodyGen(t *testing.T, src string, body func(*J)) (string, error) {
	t.Helper()
	m := NewMemFS()
	if err := m.WriteFile("/tm/frag.txt", []byte(src)); err != nil {
		t.Fatal(err)
	}
	j := New(WithFS(m), WithFolder("/out"),
		WithNow(func() int64 { return 1735689600000 }))

	_, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("a.txt", func(j *J) {
				j.Fragment(FragmentProps{From: "/tm/frag.txt"}, body)
			})
		})
	})
	if err != nil {
		return "", err
	}
	return string(m.Vol()["/out/a.txt"]), nil
}

// The regression. Must not panic, and must match what TS emits: the unnamed
// slot renders empty, leaving the surrounding source intact.
func TestFragmentNilBodyWithDefaultSlot(t *testing.T) {
	got, err := fragNilBodyGen(t, "A<[SLOT]>B\n", nil)
	if err != nil {
		t.Fatalf("bodyless Fragment errored: %v", err)
	}
	if want := "AB\n"; got != want {
		t.Errorf("got %q, want %q (TS renders the unnamed slot as empty)", got, want)
	}
}

// A NAMED slot behaves differently from the unnamed one, and both stacks agree.
// Named handlers are registered only for the slot names collected from the
// body, so with no body there are none and the marker survives verbatim.
// Verified against TS, which emits the same string. The asymmetry is the point:
// the unnamed marker is always registered, which is exactly why it was the one
// that reached the nil call.
func TestFragmentNilBodyWithNamedSlot(t *testing.T) {
	got, err := fragNilBodyGen(t, "A<[SLOT:one]>B\n", nil)
	if err != nil {
		t.Fatalf("bodyless Fragment errored: %v", err)
	}
	if want := "A<[SLOT:one]>B\n"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// No slot marker at all: the body was never going to be called, so this passed
// before the fix too. Kept so a future change cannot quietly narrow the fix to
// only the marker case.
func TestFragmentNilBodyWithoutSlot(t *testing.T) {
	got, err := fragNilBodyGen(t, "PLAIN\n", nil)
	if err != nil {
		t.Fatalf("bodyless Fragment errored: %v", err)
	}
	if want := "PLAIN\n"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// The ordinary path stays intact: a real body still fills the slot.
func TestFragmentBodyStillFillsSlot(t *testing.T) {
	got, err := fragNilBodyGen(t, "A<[SLOT]>B\n", func(j *J) { j.Content("X") })
	if err != nil {
		t.Fatalf("Fragment with a body errored: %v", err)
	}
	if want := "AXB\n"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
