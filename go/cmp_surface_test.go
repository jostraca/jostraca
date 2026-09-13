package jostraca

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// THE PUBLISHED PROP SURFACE, HELD TO THE GO PORT (docs/cmp-surface.tsv).
//
// That file says what every component reads and what an unknown prop
// does. Its full drift guard is on the canonical side
// (ts/test/cmp-surface.test.ts), which scans the component sources; a
// Go component is a struct field and there is nothing to scan. What
// this holds is the half the two ports HAVE to agree about: the `*`
// rows.
//
// A tree that is refused in TypeScript and generated in Go does not
// mean one thing, and the data path is the contract a generator in
// another language writes against. Two of the ten components refuse an
// unknown prop; Go's props are a struct, so an unknown key in the map
// was simply never looked at until treeClosedCmp restored the refusal.

type surfaceStar struct {
	cmp  string
	verb string // "refused" or "ignored"
	line int
}

func surfacePath(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Join(filepath.Dir(wd), "docs", "cmp-surface.tsv")
}

func loadSurfaceStars(t *testing.T) []surfaceStar {
	t.Helper()
	path := surfacePath(t)
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("cannot read %s: %v", path, err)
	}
	defer f.Close()

	out := []surfaceStar{}
	header := false
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for i := 1; sc.Scan(); i++ {
		line := strings.TrimSuffix(sc.Text(), "\r")
		if strings.TrimSpace(line) == "" || strings.HasPrefix(line, "#") {
			continue
		}
		cols := strings.Split(line, "\t")
		if len(cols) != 5 {
			t.Fatalf("%s:%d wants 5 tab-separated columns, got %d",
				path, i, len(cols))
		}
		if !header {
			if cols[0] != "cmp" || cols[1] != "prop" {
				t.Fatalf("%s: unexpected header row: %v", path, cols)
			}
			header = true
			continue
		}
		if cols[1] != "*" {
			continue
		}
		verb, _, found := strings.Cut(cols[4], ":")
		if !found || (verb != "refused" && verb != "ignored") {
			t.Fatalf("%s:%d a `*` note starts `refused:` or `ignored:`: %q",
				path, i, cols[4])
		}
		out = append(out, surfaceStar{cmp: cols[0], verb: verb, line: i})
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	if !header {
		t.Fatalf("%s: no header row", path)
	}
	return out
}

// One node per component, in a place its op accepts, so a case can
// generate it with an extra prop and see what happens. Mirrors sample()
// in ts/test/cmp-surface.test.ts.
func surfaceSample(t *testing.T, cmp, extra string) string {
	t.Helper()
	props := func(p string) string {
		if p == "" {
			return "{" + strings.TrimPrefix(extra, ",") + "}"
		}
		return "{" + p + extra + "}"
	}
	inFile := func(node string) string {
		return `{"cmp":"File","props":{"name":"x.txt"},"children":[` + node + `]}`
	}

	switch cmp {
	case "Project":
		return `{"cmp":"Project","props":` + props(`"folder":"sdk"`) + `}`
	case "Folder":
		return `{"cmp":"Folder","props":` + props(`"name":"f"`) + `}`
	case "File":
		return `{"cmp":"File","props":` + props(`"name":"x.txt"`) + `}`
	case "Content", "Line":
		return inFile(`{"cmp":"` + cmp + `","props":` + props(`"src":"c"`) + `}`)
	case "Fragment":
		return inFile(`{"cmp":"Fragment","props":` + props(`"from":"/frag.txt"`) +
			`,"children":[{"cmp":"Slot","props":{"name":"s"}}]}`)
	case "Slot":
		return inFile(`{"cmp":"Fragment","props":{"from":"/frag.txt"},"children":[` +
			`{"cmp":"Slot","props":` + props(`"name":"s"`) + `}]}`)
	case "Inject":
		return `{"cmp":"Inject","props":` + props(`"name":"inject.txt"`) + `}`
	case "CopyFiles":
		return inFile(`{"cmp":"CopyFiles","props":` +
			props(`"from":"/src/copied.txt","to":"c.txt"`) + `}`)
	case "ListItems":
		return inFile(`{"cmp":"ListItems","props":` + props(`"item":[{"n":1}]`) +
			`,"children":[{"cmp":"Content","props":{"src":"i"}}]}`)
	}
	t.Fatalf("cmp-surface: no sample node for %s", cmp)
	return ""
}

func surfaceGenerates(t *testing.T, src string) error {
	t.Helper()
	var tree any
	if err := json.Unmarshal([]byte(src), &tree); err != nil {
		t.Fatalf("sample is not JSON: %v\n%s", err, src)
	}
	root, err := CmpTree(tree)
	if err != nil {
		return err
	}
	seed := map[string][]byte{
		"/frag.txt":       []byte("HEADER\n<[SLOT]>\nFOOTER\n"),
		"/src/copied.txt": []byte("COPIED\n"),
		"/top/inject.txt": []byte("A\n#--START--#\n\n#--END--#\nB\n"),
	}
	_, err = New(WithMem(), WithVol(seed), WithFolder("/top"),
		WithNow(func() int64 { return 1 })).Generate(Options{}, root)
	return err
}

func TestCmpSurfaceStarRowsHoldInGo(t *testing.T) {
	stars := loadSurfaceStars(t)

	names := []string{}
	for _, s := range stars {
		names = append(names, s.cmp)
	}
	sort.Strings(names)
	want := []string{}
	for name := range treeBuild {
		want = append(want, name)
	}
	sort.Strings(want)
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("docs/cmp-surface.tsv and the component registry disagree:\n"+
			" surface: %v\n registry: %v", names, want)
	}

	for _, s := range stars {
		// The control: the same node with no extra prop must generate,
		// otherwise the case below proves nothing.
		if err := surfaceGenerates(t, surfaceSample(t, s.cmp, "")); err != nil {
			t.Fatalf("the sample node for %s does not generate: %v", s.cmp, err)
		}

		err := surfaceGenerates(t, surfaceSample(t, s.cmp, `,"nosuchprop":1`))

		if s.verb == "refused" {
			if err == nil {
				t.Fatalf("docs/cmp-surface.tsv:%d says %s refuses an unknown "+
					"prop, and Go accepted one", s.line, s.cmp)
			}
			if !strings.Contains(err.Error(), "nosuchprop") {
				t.Fatalf("%s refused an unknown prop without naming it: %v",
					s.cmp, err)
			}
		} else if err != nil {
			t.Fatalf("docs/cmp-surface.tsv:%d says %s ignores an unknown "+
				"prop, and Go refused one: %v", s.line, s.cmp, err)
		}
	}
}

// A CLOSED PROP SET ADMITS THE ENGINE'S OWN BINDINGS. ListItems binds
// `item`, `indent` and `replace` for each invocation of its children,
// and a data child receives all three merged under its own props -- so
// a Fragment repeated once per entity has an `item` it never asked for.
// TypeScript refused that tree until FragmentShape admitted the key;
// Go never did, and this keeps it that way now that Go refuses unknown
// props for the same two components.
func TestCmpTreeClosedPropsAdmitBindings(t *testing.T) {
	src := `{"cmp":"File","props":{"name":"x.txt"},"children":[{
	  "cmp":"ListItems","props":{"item":[{"n":1},{"n":2}]},
	  "children":[{"cmp":"Fragment","props":{"from":"/frag.txt"}}]
	}]}`

	var tree any
	if err := json.Unmarshal([]byte(src), &tree); err != nil {
		t.Fatal(err)
	}
	root, err := CmpTree(tree)
	if err != nil {
		t.Fatal(err)
	}
	res, err := New(WithMem(),
		WithVol(map[string][]byte{"/frag.txt": []byte("F {item.n}\n")}),
		WithFolder("/top"), WithNow(func() int64 { return 1 })).
		Generate(Options{}, root)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(res.Vol()["/top/x.txt"]); got != "F 1\nF 2\n\n" {
		t.Fatalf("fragment per item: %q", got)
	}
}
