package jostraca

// Corpus adapters for the merge and diff engine (test/spec/diff.tsv), kept
// beside the tests they serve rather than in spec_test.go's table. A result
// is the object TS returns, so one expectation serves both stacks.
func init() {
	specFns["merge"] = func(a []any) (any, error) {
		r := Merge(specStr(a[0]), specStr(a[1]), specStr(a[2]), specDiffSpec(a, 3))
		return map[string]any{"content": r.Content, "conflict": r.Conflict,
			"outcome": string(r.Outcome)}, nil
	}
	specFns["diff"] = func(a []any) (any, error) {
		r := Diff(specStr(a[0]), specStr(a[1]), specDiffSpec(a, 2))
		return map[string]any{"content": r.Content, "conflict": r.Conflict,
			"outcome": string(r.Outcome)}, nil
	}
	specFns["hasConflicts"] = func(a []any) (any, error) {
		label := ""
		if 1 < len(a) {
			label = specStr(a[1])
		}
		return HasConflictsLabel(specStr(a[0]), label), nil
	}
}

// specDiffSpec decodes the optional spec argument at index i. JSON numbers
// arrive as float64, and labels present in the JSON give non-nil Labels.
func specDiffSpec(a []any, i int) DiffSpec {
	var spec DiffSpec
	if len(a) <= i {
		return spec
	}
	m, _ := a[i].(map[string]any)
	if w, ok := m["when"].(float64); ok {
		spec.When = int64(w)
	}
	if l, ok := m["last"].(float64); ok {
		spec.Last = int64(l)
	}
	spec.Kind = specStr(m["kind"])
	if lb, ok := m["labels"].(map[string]any); ok {
		spec.Labels = &DiffLabels{
			Generated: specStr(lb["generated"]),
			Existing:  specStr(lb["existing"]),
		}
	}
	return spec
}
