package jostraca

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// THE PROP SURFACE, HELD ACROSS BOTH PORTS.
//
// Each component declares what it reads: a props type in TypeScript
// (ts/src/cmp/*.ts) and a props struct here. TypeScript is canonical,
// and the two have to carry the SAME FIELDS, because a generator in
// another language writes one schema and drives either port with it.
//
// Two checks:
//
//  1. THE FIELD SETS MATCH, compared against the TypeScript source
//     rather than against a copy of it -- a copy is the thing that goes
//     stale. Where the ports deliberately differ, the difference is
//     named in propDeviation below and nowhere else, so a third one
//     cannot appear quietly.
//  2. AN UNKNOWN PROP DOES THE SAME THING. Two of the ten components
//     refuse one and eight drop it. Go's props are a struct, so an
//     unknown key in a decoded tree was simply never looked at until
//     treeClosedCmp restored the refusal, and a tree that one port
//     refuses and the other generates does not mean one thing.

// The Go struct that carries each component's props.
//
// Folder has none: its only prop is the name, and the name is the
// method's argument. It is checked against TypeScript separately, in
// the same test.
var propStruct = map[string]any{
	"Project":   ProjectProps{},
	"File":      FileProps{},
	"Content":   ContentProps{},
	"Line":      ContentProps{},
	"Slot":      SlotProps{},
	"Inject":    InjectProps{},
	"Fragment":  FragmentProps{},
	"CopyFiles": CopyFilesProps{},
	"ListItems": ListItemsProps{},
}

// Where the ports deliberately differ, lowercased. Both entries are
// deviations go/README.md records; anything not here has to match.
var propDeviation = map[string]struct{ tsOnly, goOnly []string }{
	// TypeScript reads a positional Content('text') into props.arg. The
	// positional form here is the Content(src) method, so there is
	// nothing for a field to carry.
	"Content": {tsOnly: []string{"arg"}},
	"Line":    {tsOnly: []string{"arg"}},

	// NoLine inverts TypeScript's `line` so that Go's zero value matches
	// its default.
	"ListItems": {tsOnly: []string{"line"}, goOnly: []string{"noline"}},
}

// The two that refuse an unknown prop; the other eight drop it.
var propClosed = []string{"CopyFiles", "Fragment"}

var tsPropField = regexp.MustCompile(`^  ([A-Za-z_$][\w$]*)\??:`)
var tsPropAlias = regexp.MustCompile(`^([A-Za-z_$][\w$]*)\s*$`)

// tsProps reads one props type out of the TypeScript source, following
// an alias by name: LineProps is declared `type LineProps = ContentProps`
// and the answer wanted is Content's fields rather than a bare name.
func tsProps(t *testing.T, name string, seen ...string) []string {
	t.Helper()
	for _, s := range seen {
		if s == name {
			t.Fatalf("circular type alias: %s -> %s",
				strings.Join(seen, " -> "), name)
		}
	}

	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(filepath.Dir(wd), "ts", "src", "cmp")

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("cannot read %s: %v", dir, err)
	}

	head := "type " + name + " = "
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".ts") {
			continue
		}
		src, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		at := strings.Index(string(src), head)
		if at < 0 {
			continue
		}

		lines := strings.Split(string(src)[at+len(head):], "\n")
		if !strings.HasPrefix(lines[0], "{") {
			alias := tsPropAlias.FindStringSubmatch(strings.TrimSuffix(lines[0], ";"))
			if alias == nil {
				t.Fatalf("%s is neither an object type nor an alias: %q",
					name, lines[0])
			}
			return tsProps(t, alias[1], append(seen, name)...)
		}

		out := []string{}
		for _, line := range lines[1:] {
			if strings.HasPrefix(line, "}") {
				sort.Strings(out)
				return out
			}
			if m := tsPropField.FindStringSubmatch(line); m != nil {
				out = append(out, strings.ToLower(m[1]))
			}
		}
		t.Fatalf("the declaration of %s does not close", name)
	}

	t.Fatalf("ts/src/cmp/ declares no type %s", name)
	return nil
}

// goProps is one struct's exported fields, lowercased to compare.
func goProps(v any) []string {
	rt := reflect.TypeOf(v)
	out := []string{}
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		if f.IsExported() {
			out = append(out, strings.ToLower(f.Name))
		}
	}
	sort.Strings(out)
	return out
}

func holds(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func without(from, drop []string) []string {
	out := []string{}
	for _, v := range from {
		keep := true
		for _, d := range drop {
			if v == d {
				keep = false
			}
		}
		if keep {
			out = append(out, v)
		}
	}
	return out
}

// TestCmpPropsMatchTypeScript holds each port's declaration of a
// component's props to the other's.
func TestCmpPropsMatchTypeScript(t *testing.T) {
	names := []string{}
	for name := range treeBuild {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		ts := tsProps(t, name+"Props")

		if name == "Folder" {
			// No struct: the one prop is the Folder(name, body) argument.
			if fmt.Sprint(ts) != "[name]" {
				t.Fatalf("FolderProps is %v; Go carries it as the Folder "+
					"method's name argument, which admits one prop", ts)
			}
			continue
		}

		props, declared := propStruct[name]
		if !declared {
			t.Fatalf("%s has no entry in propStruct; every component with "+
				"a TypeScript props type needs one here", name)
		}

		dev := propDeviation[name]
		wantTS := without(ts, dev.tsOnly)
		wantGo := without(goProps(props), dev.goOnly)

		if strings.Join(wantTS, ",") != strings.Join(wantGo, ",") {
			t.Fatalf("%s: the ports disagree about props\n"+
				"  ts/src/cmp/%s.ts: %v\n"+
				"  go %T: %v\n"+
				"a deliberate difference goes in propDeviation, with its "+
				"reason, and in go/README.md", name, name, wantTS, props, wantGo)
		}

		// A deviation that has been resolved is a deviation that should
		// go, not one that should sit here being true of nothing.
		for _, only := range dev.tsOnly {
			if !holds(ts, only) {
				t.Fatalf("propDeviation says %s.%s is TypeScript-only, and "+
					"TypeScript does not declare it", name, only)
			}
		}
		for _, only := range dev.goOnly {
			if !holds(goProps(props), only) {
				t.Fatalf("propDeviation says %s.%s is Go-only, and Go does "+
					"not declare it", name, only)
			}
		}
	}
}

// One node per component, in a place its op accepts, so a case can
// generate it with an extra prop and see what happens. Mirrors sample()
// in ts/test/cmp-props.test.ts.
func propSample(t *testing.T, cmp, extra string) string {
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
	t.Fatalf("cmp-props: no sample node for %s", cmp)
	return ""
}

func propGenerates(t *testing.T, src string) error {
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

// TestCmpPropsUnknownPropRefusedByTwo is the Go half of
// `an-unknown-prop-is-refused-by-two-and-dropped-by-eight`.
func TestCmpPropsUnknownPropRefusedByTwo(t *testing.T) {
	names := []string{}
	for name := range treeBuild {
		names = append(names, name)
	}
	sort.Strings(names)

	closed := append([]string{}, propClosed...)
	sort.Strings(closed)
	got := []string{}
	for name := range treeClosedCmp {
		got = append(got, name)
	}
	sort.Strings(got)
	if strings.Join(closed, ",") != strings.Join(got, ",") {
		t.Fatalf("treeClosedCmp holds %v; the ports agree on %v", got, closed)
	}

	for _, name := range names {
		// The control: the same node with no extra prop must generate,
		// otherwise the case below proves nothing.
		if err := propGenerates(t, propSample(t, name, "")); err != nil {
			t.Fatalf("the sample node for %s does not generate: %v", name, err)
		}

		err := propGenerates(t, propSample(t, name, `,"nosuchprop":1`))

		if holds(closed, name) {
			if err == nil {
				t.Fatalf("%s validates a closed prop set and accepted an "+
					"unknown prop", name)
			}
			if !strings.Contains(err.Error(), "nosuchprop") {
				t.Fatalf("%s refused an unknown prop without naming it: %v",
					name, err)
			}
		} else if err != nil {
			t.Fatalf("%s refused an unknown prop; only %v validate a closed "+
				"set: %v", name, closed, err)
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

// A FRAGMENT IS REFUSED AN `exclude`. It was declared on both sides,
// validated, and read by neither; now that each component's props are a
// published type, the field is gone rather than left as the one
// declaration that means nothing.
func TestCmpTreeFragmentRefusesExclude(t *testing.T) {
	err := propGenerates(t, propSample(t, "Fragment", `,"exclude":true`))
	if err == nil {
		t.Fatal("Fragment accepted `exclude`, which nothing reads")
	}
	if !strings.Contains(err.Error(), "exclude") {
		t.Fatalf("Fragment refused `exclude` without naming it: %v", err)
	}
}
