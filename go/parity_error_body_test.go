package jostraca

import (
	"strings"
	"testing"
)

// The parity corpus records only THAT these scenarios fail. This holds the
// message body too, on the corpus's own trees (scenarioRunners), so the
// bodies cannot drift while the corpus stays green. An embedded filesystem
// error is the host's, so everything from `(threw: ` is normalised. TS
// twin: parity-error-scenarios in ts/test/generate.test.ts.
func TestParityErrorScenarioBodies(t *testing.T) {
	want := map[string]string{
		"fragment_missing_from_errors": `Fragment: Validation failed for property "from" ` +
			`with string "/templates/does-not-exist.html" because check "From" failed (threw: <os>)`,
		"copy_missing_source_errors": `CopyFiles: Validation failed for property "from" ` +
			`with string "/src/does-not-exist.txt" because check "From" failed (threw: <os>)`,
		"inject_missing_target_errors": "inject target does not exist, " +
			"path=/out/app/does-not-exist.txt (Inject rewrites an existing file; use File to create one)",
	}
	for name, w := range want {
		_, err := New(WithFS(NewMemFS()), WithFolder("/out"),
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
