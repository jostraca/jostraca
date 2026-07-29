package jostraca

import (
	"strings"
	"testing"
)

// TestAuditWhyBreadcrumbs mirrors test/parity-fidelity.test.ts:'audit-why-write'.
// Each save() call records a `why` array of breadcrumbs explaining
// which mode-dispatch branches fired. Mirrors TS at FileHandler.ts:162+.

func TestAuditWhyBreadcrumbs(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return 1735689600000 }))
	res, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("hi") })
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	audit := res.Audit()
	var saveEntry *AuditEntry
	for i := range audit {
		if strings.HasPrefix(audit[i].Tag, "save:") {
			saveEntry = &audit[i]
			break
		}
	}
	if saveEntry == nil {
		t.Fatalf("no save: audit entry found; have %d entries", len(audit))
	}
	why, ok := saveEntry.Data["why"].([]string)
	if !ok {
		t.Fatalf("why is %T, want []string", saveEntry.Data["why"])
	}
	if len(why) == 0 {
		t.Errorf("empty why")
	}
	// Specific breadcrumbs that should appear for a fresh write.
	hasWriteCrumb := false
	hasDuplicateCrumb := false
	for _, c := range why {
		if c == "write-1" {
			hasWriteCrumb = true
		}
		if c == "duplicate-1" {
			hasDuplicateCrumb = true
		}
	}
	if !hasWriteCrumb {
		t.Errorf("why missing write-1: %v", why)
	}
	if !hasDuplicateCrumb {
		t.Errorf("why missing duplicate-1: %v", why)
	}
}

func TestAuditWhyOnUnchanged(t *testing.T) {
	mem := NewMemFS()
	_ = mem.WriteFile("/out/p/a.txt", []byte("hi"))
	j := New(WithFS(mem), WithFolder("/out"))
	res, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("hi") })
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	audit := res.Audit()
	// A byte-identical rewrite still records the *write* intent (TS sets
	// meta.action = 'write' and tags the entry save:write); the fact that
	// nothing was touched shows up as the `unchanged-0` breadcrumb.
	var unchangedEntry *AuditEntry
	for i := range audit {
		if audit[i].Tag == "save:write" {
			unchangedEntry = &audit[i]
			break
		}
	}
	if unchangedEntry == nil {
		t.Fatalf("no save:write audit entry; have %d entries", len(audit))
	}
	why, ok := unchangedEntry.Data["why"].([]string)
	if !ok {
		t.Fatalf("why type: %T", unchangedEntry.Data["why"])
	}
	hasUnchanged := false
	for _, c := range why {
		if c == "unchanged-0" {
			hasUnchanged = true
		}
	}
	if !hasUnchanged {
		t.Errorf("why missing unchanged-0: %v", why)
	}
}
