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

// #29: a user component used as a direct Fragment child.
//
// TS wraps every component in cmp(), which consults the enclosing
// Fragment's filter before allocating anything, so a non-Slot child's body
// runs ZERO times during the scan and once per replay that accepts it. Go
// ran `j.Cmp` inline with no node, so the filter never saw it: the body ran
// on the scan walk and again on every replay pass -- three times against
// TS's zero -- and with a silent body Go completed where TS aborted.
//
// Both counts are pinned here. The output side is pinned cross-stack by the
// fragment_cmp_child_default_slot parity snapshot.
func TestCmpChildOfFragmentGoesThroughTheFilter(t *testing.T) {
	run := func(src string) (int, error, string) {
		runs := 0
		mem := NewMemFS()
		_ = mem.WriteFile("/tpl/f.txt", []byte(src))
		j := New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return 1735689600000 }))
		_, err := j.Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{Folder: "app"}, func(j *J) {
				j.File("a.txt", func(j *J) {
					j.FragmentP(FragmentProps{From: "/tpl/f.txt"}, func(j *J) {
						j.Cmp("Counter", func(j *J) { runs++; j.Content("H") })
						j.SlotP(SlotProps{Name: "s0"}, func(j *J) { j.Content("S0") })
					})
				})
			})
		})
		body, _ := mem.ReadFile("/out/app/a.txt")
		return runs, err, string(body)
	}

	// An unnamed <[SLOT]> accepts the component: exactly one run, and its
	// content lands at the marker.
	runs, err, out := run("A<[SLOT]>B<[SLOT:s0]>C\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if runs != 1 {
		t.Errorf("component body ran %d times, want 1", runs)
	}
	if out != "AHBS0C\n" {
		t.Errorf("got %q, want %q", out, "AHBS0C\n")
	}

	// No unnamed marker: the filter rejects it on every pass, so the body
	// never runs at all, and the build fails because its output would be
	// silently discarded.
	runs, err, _ = run("A<[SLOT:s0]>B\n")
	if err == nil {
		t.Error("expected an error with no unnamed <[SLOT]> marker")
	}
	if runs != 0 {
		t.Errorf("component body ran %d times, want 0", runs)
	}
}

// A List as a direct Fragment child, and a Content whose replace callback
// has a side effect.
//
// Both used to escape the filter for different reasons: List allocated no
// node at all, so only the Content it emitted was ever filtered -- and an
// EMPTY list with NoLine set emitted nothing, so a Fragment with no unnamed
// marker succeeded here while TS raised the non-Slot-child error. Content
// rendered its template BEFORE consulting the filter, so a user ReplaceFunc
// ran on the scan pass TS never runs, and again on the replay that accepts
// it. See #29.
func TestListAndContentGoThroughTheFragmentFilter(t *testing.T) {
	// An empty List with NoLine is invisible in its output, so the error is
	// the only way to observe that the component itself was seen.
	mem := NewMemFS()
	_ = mem.WriteFile("/tpl/f.txt", []byte("A<[SLOT:s0]>B\n"))
	j := New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return 1 }))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.File("a.txt", func(j *J) {
				j.FragmentP(FragmentProps{From: "/tpl/f.txt"}, func(j *J) {
					j.ListP(ListProps{Item: []any{}, NoLine: true},
						func(j *J, it ListItemProps) {})
					j.SlotP(SlotProps{Name: "s0"}, func(j *J) { j.Content("S0") })
				})
			})
		})
	})
	if err == nil {
		t.Error("an empty List with NoLine is still a non-Slot child; expected an error")
	}

	// A Content replace callback must fire once, on the replay that accepts
	// it -- not on the scan pass as well.
	calls := 0
	mem2 := NewMemFS()
	_ = mem2.WriteFile("/tpl/g.txt", []byte("A<[SLOT]>B\n"))
	j2 := New(WithFS(mem2), WithFolder("/out"), WithNow(func() int64 { return 1 }))
	if _, err := j2.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "app"}, func(j *J) {
			j.File("a.txt", func(j *J) {
				j.FragmentP(FragmentProps{From: "/tpl/g.txt"}, func(j *J) {
					j.ContentP(ContentProps{
						Src: "{x}",
						Replace: map[string]any{
							"{x}": ReplaceFunc(func(_ map[string]string, _ string) string {
								calls++
								return "X"
							}),
						},
					})
				})
			})
		})
	}); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Errorf("replace callback ran %d times, want 1", calls)
	}
	if got := string(mem2.Vol()["/out/app/a.txt"]); got != "AXB\n" {
		t.Errorf("got %q, want %q", got, "AXB\n")
	}
}
