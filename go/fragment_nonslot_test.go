package jostraca

import (
	"strings"
	"testing"
)

// Non-Slot children of a Fragment fill the unnamed <[SLOT]> marker. With
// no unnamed marker in the source there is nowhere for them to go; that
// used to drop them silently in both stacks, so it is now an error.
// Mirrors ts/test/jostraca.test.ts:fragment-nonslot-child-without-default-slot.
func TestFragmentNonSlotChildWithoutDefaultSlot(t *testing.T) {
	gen := func(src string) error {
		mem := NewMemFS()
		_ = mem.WriteFile("/f01.txt", []byte(src))
		j := New(WithFS(mem), WithFolder("/top"), WithNow(func() int64 { return 1735689600000 }))
		_, err := j.Generate(Options{}, func(g *J) {
			g.Project(ProjectProps{}, func(g *J) {
				g.File("foo.txt", func(g *J) {
					g.FragmentP(FragmentProps{From: "/f01.txt"}, func(g *J) {
						g.Content("A")
						g.Slot("alice", func(g *J) { g.Content("ALICE") })
					})
				})
			})
		})
		return err
	}

	// Named marker only -- no unnamed <[SLOT]>.
	err := gen("Q+// <[SLOT:alice]>\n")
	if err == nil {
		t.Fatal("expected an error for a non-Slot child with no unnamed <[SLOT]> marker")
	}
	if !strings.Contains(err.Error(), "no unnamed <[SLOT]> marker") {
		t.Errorf("unexpected error text: %v", err)
	}
	if !strings.Contains(err.Error(), "/f01.txt") {
		t.Errorf("error should name the fragment source: %v", err)
	}

	// No markers at all.
	if err := gen("Q\n"); err == nil {
		t.Fatal("expected an error for a markerless fragment source")
	}

	// An unnamed marker makes the same body legal again.
	if err := gen("Q+<[SLOT]>+// <[SLOT:alice]>\n"); err != nil {
		t.Fatalf("unnamed marker present, should be legal: %v", err)
	}
}
