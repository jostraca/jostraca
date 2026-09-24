package jostraca

import (
	"strings"
	"testing"
)

// TestAuditWhyBreadcrumbs mirrors test/parity-fidelity.test.ts:'audit-why-write'.
// Each save() call records a `why` array of breadcrumbs explaining
// which mode-dispatch branches fired, in TS's order.

func auditRecord(audit Audit, tag string) *AuditEntry {
	for i := range audit {
		if audit[i].Tag == tag {
			return &audit[i]
		}
	}
	return nil
}

func TestAuditWhyBreadcrumbs(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return 1735689600000 }))
	gen := func() Audit {
		res, err := j.Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{Folder: "p"}, func(j *J) {
				j.File("a.txt", func(j *J) { j.Content("hi") })
			})
		})
		if err != nil {
			t.Fatal(err)
		}
		return res.Audit()
	}

	rec := auditRecord(gen(), "FileHandler:save:write")
	if rec == nil {
		t.Fatal("no FileHandler:save:write record")
	}
	if got := strings.Join(rec.Data["why"].([]string), " "); got !=
		"start<wX> write-1 duplicate-1 within-0" {
		t.Errorf("why = %s", got)
	}

	// A re-run over the file writes nothing new, and says why.
	rec = auditRecord(gen(), "FileHandler:save:write")
	if rec == nil {
		t.Fatal("no FileHandler:save:write record on the re-run")
	}
	if got := strings.Join(rec.Data["why"].([]string), " "); got !=
		"start<Wx> exists-0 write-0 not-protect-1 unchanged-0 duplicate-1 within-0" {
		t.Errorf("re-run why = %s", got)
	}
}
