package jostraca

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// The shared TSV corpus in test/spec, driven by both implementations.
// ts/test/spec.test.ts reads the same files and asserts the same
// expectations; see test/spec/README.md for the format.
//
// Tests run with the package directory as the working directory, so the
// corpus is one level up.
const specDir = "../test/spec"

type specCase struct {
	file   string
	line   int
	id     string
	fn     string
	args   []any
	expect any
	errSub string
}

// One adapter per corpus `fn`. These translate corpus JSON into native
// calls, which is where JSON's float64-everything meets Go's typed
// signatures -- `indent` takes an int count, `isbincontent` takes bytes.
var specFns = map[string]func(a []any) (any, error){
	"camelify": func(a []any) (any, error) { return Camelify(a[0]), nil },
	"snakify":  func(a []any) (any, error) { return Snakify(a[0]), nil },
	"kebabify": func(a []any) (any, error) { return Kebabify(a[0]), nil },
	"partify":  func(a []any) (any, error) { return Partify(a[0]), nil },
	"lcf":      func(a []any) (any, error) { return LCF(a[0]), nil },
	"ucf":      func(a []any) (any, error) { return UCF(a[0]), nil },
	"escre":    func(a []any) (any, error) { return EscRE(specStr(a[0])), nil },

	// a[1] is passed through as-is: Indent handles a float64 count itself,
	// so converting here would hide whether it does.
	"indent": func(a []any) (any, error) {
		return Indent(specStr(a[0]), a[1]), nil
	},

	"isbinext": func(a []any) (any, error) { return IsBinExt(specStr(a[0])), nil },
	"isbincontent": func(a []any) (any, error) {
		return IsBinContent([]byte(specStr(a[0]))), nil
	},

	"get":  func(a []any) (any, error) { return Get(a[0], specStr(a[1])), nil },
	"getx": func(a []any) (any, error) { return GetX(a[0], a[1]), nil },

	"deep": func(a []any) (any, error) { return Deep(a[0], a[1:]...), nil },

	"omap": func(a []any) (any, error) {
		m, _ := a[0].(map[string]any)
		return OMap(m), nil
	},

	"template": func(a []any) (any, error) {
		var spec *TemplateSpec
		if 3 <= len(a) && a[2] != nil {
			raw, ok := a[2].(map[string]any)
			if !ok {
				return nil, fmt.Errorf("template spec is not an object: %v", a[2])
			}
			spec = &TemplateSpec{}
			if rep, ok := raw["replace"].(map[string]any); ok {
				spec.Replace = rep
			}
		}
		return Template(specStr(a[0]), a[1], spec)
	},

	"names": func(a []any) (any, error) {
		base, _ := a[0].(map[string]any)
		if base == nil {
			base = map[string]any{}
		}
		if 3 == len(a) {
			return Names(base, specStr(a[1]), specStr(a[2])), nil
		}
		return Names(base, specStr(a[1])), nil
	},

	"lines": func(a []any) (any, error) { return Lines(specStr(a[0])), nil },
	"lcs": func(a []any) (any, error) {
		return LCS(specStrs(a[0]), specStrs(a[1])), nil
	},
}

// specStr coerces a corpus cell to string. A JSON null reaches a string
// parameter only where the corpus means the empty string.
func specStr(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

func specStrs(v any) []string {
	items, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, specStr(it))
	}
	return out
}

// specCanon renders a value as canonical JSON: object keys sorted (which
// json.Marshal already does for maps), HTML escaping off so <, > and &
// survive as themselves the way JSON.stringify leaves them.
func specCanon(v any) (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(specNorm(v)); err != nil {
		return "", err
	}
	return strings.TrimRight(buf.String(), "\n"), nil
}

// specNorm flattens Go's typed containers to the plain shapes the corpus
// speaks, so a []string, a [][2]any and a []any all serialize alike.
//
// A nil slice or map becomes empty rather than null. Go draws a
// distinction there that the corpus does not: len 0 either way, and no
// caller can tell them apart without reflection. A genuinely absent
// value is an untyped nil and still serializes as null.
func specNorm(v any) any {
	if v == nil {
		return nil
	}

	rv := reflect.ValueOf(v)
	switch rv.Kind() {

	case reflect.Slice, reflect.Array:
		if reflect.Slice == rv.Kind() && rv.IsNil() {
			return []any{}
		}
		out := make([]any, rv.Len())
		for i := 0; i < rv.Len(); i++ {
			out[i] = specNorm(rv.Index(i).Interface())
		}
		return out

	case reflect.Map:
		if rv.IsNil() {
			return map[string]any{}
		}
		out := make(map[string]any, rv.Len())
		for _, k := range rv.MapKeys() {
			out[specStr(k.Interface())] = specNorm(rv.MapIndex(k).Interface())
		}
		return out

	case reflect.Ptr:
		if rv.IsNil() {
			return nil
		}
		return specNorm(rv.Elem().Interface())
	}

	return v
}

func loadSpecCases(t *testing.T) []specCase {
	t.Helper()

	entries, err := os.ReadDir(specDir)
	if err != nil {
		t.Fatalf("cannot read %s: %v", specDir, err)
	}

	names := []string{}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tsv") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	if 0 == len(names) {
		t.Fatalf("no .tsv files in %s", specDir)
	}

	out := []specCase{}
	wantHeader := []string{"id", "fn", "args", "expect", "error"}

	for _, name := range names {
		raw, err := os.ReadFile(filepath.Join(specDir, name))
		if err != nil {
			t.Fatalf("cannot read %s: %v", name, err)
		}

		// Corpus files are committed with LF; tolerate CRLF in case a
		// checkout or an editor rewrote them.
		text := strings.ReplaceAll(string(raw), "\r\n", "\n")
		header := false

		for i, row := range strings.Split(text, "\n") {
			if "" == strings.TrimSpace(row) || strings.HasPrefix(row, "#") {
				continue
			}

			cells := strings.Split(row, "\t")

			if !header {
				if !reflect.DeepEqual(cells, wantHeader) {
					t.Fatalf("%s: header is %v, want %v", name, cells, wantHeader)
				}
				header = true
				continue
			}

			// A trailing empty cell may be trimmed by an editor; pad
			// rather than index out of range.
			for len(cells) < 5 {
				cells = append(cells, "")
			}
			if 5 != len(cells) {
				t.Fatalf("%s:%d: %d cells, want 5", name, i+1, len(cells))
			}

			c := specCase{
				file:   name,
				line:   i + 1,
				id:     cells[0],
				fn:     cells[1],
				errSub: cells[4],
			}

			if err := json.Unmarshal([]byte(cells[2]), &c.args); err != nil {
				t.Fatalf("%s:%d %s: bad args JSON: %v", name, i+1, c.id, err)
			}
			if "" == c.errSub {
				if err := json.Unmarshal([]byte(cells[3]), &c.expect); err != nil {
					t.Fatalf("%s:%d %s: bad expect JSON: %v", name, i+1, c.id, err)
				}
			}

			out = append(out, c)
		}
	}

	return out
}

// A corpus that shrank to nothing would pass every assertion, so the
// count is checked too. The TS runner prints its own count; the two
// should agree.
func TestSpecCorpusLoaded(t *testing.T) {
	cases := loadSpecCases(t)
	if 100 >= len(cases) {
		t.Fatalf("only %d cases loaded from %s", len(cases), specDir)
	}
	t.Logf("spec corpus: %d cases", len(cases))
}

// An unknown fn fails rather than skipping. A corpus entry that one stack
// quietly ignores is precisely the divergence this suite exists to catch.
func TestSpecAllFnsDispatched(t *testing.T) {
	seen := map[string]bool{}
	for _, c := range loadSpecCases(t) {
		if _, ok := specFns[c.fn]; !ok {
			seen[c.fn] = true
		}
	}
	if 0 < len(seen) {
		missing := []string{}
		for fn := range seen {
			missing = append(missing, fn)
		}
		sort.Strings(missing)
		t.Fatalf("corpus uses undispatched fns: %s", strings.Join(missing, ", "))
	}
}

func TestSpecIDsUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, c := range loadSpecCases(t) {
		key := c.file + ":" + c.id
		if seen[key] {
			t.Errorf("duplicate id %s", key)
		}
		seen[key] = true
	}
}

func TestSpecCorpus(t *testing.T) {
	for _, c := range loadSpecCases(t) {
		c := c
		t.Run(c.file+"/"+c.id, func(t *testing.T) {
			where := fmt.Sprintf("%s:%d %s", c.file, c.line, c.id)

			fn, ok := specFns[c.fn]
			if !ok {
				t.Fatalf("%s: fn %q is not dispatched", where, c.fn)
			}

			got, err := fn(c.args)

			if "" != c.errSub {
				if err == nil {
					t.Fatalf("%s: expected an error containing %q, got %v",
						where, c.errSub, got)
				}
				if !strings.Contains(err.Error(), c.errSub) {
					t.Fatalf("%s: error %q does not contain %q",
						where, err.Error(), c.errSub)
				}
				return
			}

			if err != nil {
				t.Fatalf("%s: unexpected error: %v", where, err)
			}

			gotJSON, gerr := specCanon(got)
			if gerr != nil {
				t.Fatalf("%s: cannot serialize result: %v", where, gerr)
			}
			wantJSON, werr := specCanon(c.expect)
			if werr != nil {
				t.Fatalf("%s: cannot serialize expectation: %v", where, werr)
			}

			if gotJSON != wantJSON {
				t.Errorf("%s\n  got  %s\n  want %s", where, gotJSON, wantJSON)
			}
		})
	}
}
