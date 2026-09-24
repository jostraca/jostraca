package jostraca

import (
	"strings"
	"testing"
)

// The parity corpus records these bodies as errorBody, taken from TS. This
// holds the same text as a literal, on the corpus's own trees
// (scenarioRunners), so a regenerated corpus cannot move the bodies without
// a failure here. An embedded filesystem error is the host's, so
// everything from `(threw: ` is normalised. TS twin: parity-error-scenarios
// in ts/test/generate.test.ts.
func TestParityErrorScenarioBodies(t *testing.T) {
	want := map[string]string{
		"fragment_missing_from_errors": `Fragment: Validation failed for property "from" ` +
			`with string "/templates/does-not-exist.html" because check "From" failed (threw: <os>)`,
		"copy_missing_source_errors": `CopyFiles: Validation failed for property "from" ` +
			`with string "/src/does-not-exist.txt" because check "From" failed (threw: <os>)`,
		"inject_missing_target_errors": "inject target does not exist, " +
			"path=/out/app/does-not-exist.txt (Inject rewrites an existing file; use File to create one)",
		"frag_nonslot_no_default_error": "jostraca: Fragment has non-Slot children, but " +
			"/tm/noslot.txt contains no unnamed <[SLOT]> marker to receive them; their " +
			"output would be silently discarded. Add an unnamed <[SLOT]> marker to the " +
			"fragment source, or wrap the children in a named Slot.",
		"frag_template_error": "Regular expression matches empty string: " +
			`/(?<J_O>\$\$)(?<J_R>[^$]+)(?<J_C>\$\$)` +
			`|(?<J_K1__t_t_SLOT_t_t_>[ \t]*[-<!/#*]*[ \t]*<\[SLOT]>[ \t]*[->/#*]*[ \t]*)` +
			`|(?<J_K2__x_>x*)/`,
	}
	for name, w := range want {
		mem := NewMemFS()
		_ = mem.WriteFile("/tm/noslot.txt", []byte("no markers\n"))
		_ = mem.WriteFile("/tm/model.txt", []byte("M=$$name$$\n"))
		_, err := New(WithFS(mem), WithFolder("/out"),
			WithNow(func() int64 { return frozenNow })).
			Generate(Options{}, scenarioRunners[name])
		if err == nil {
			t.Fatalf("%s: expected a refusal", name)
		}
		body, _ := errorBody(t, err)
		if i := strings.Index(body, "(threw: "); i >= 0 {
			body = body[:i] + "(threw: <os>)"
		}
		if body != w {
			t.Errorf("%s:\n got %q\nwant %q", name, body, w)
		}
	}
}
