package jostraca

// Corpus adapters for option validation (test/spec/options.tsv), kept
// beside the tests they serve rather than in spec_test.go's table.
func init() {
	specFns["options"] = func(a []any) (any, error) {
		m, _ := a[0].(map[string]any)
		if _, err := OptionsFromMap(m); err != nil {
			return nil, err
		}
		return "ok", nil
	}
}
