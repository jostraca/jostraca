package jostraca

// Corpus adapter for cmpTree refusals (test/spec/tree.tsv), kept beside
// the tests it serves rather than in spec_test.go's table.
func init() {
	specFns["cmptree"] = func(a []any) (any, error) {
		if _, err := CmpTree(a[0]); err != nil {
			return nil, err
		}
		return "ok", nil
	}
}
