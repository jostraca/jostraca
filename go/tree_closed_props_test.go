package jostraca

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// treeClosedCmp holds the props a data node may state on the built-in
// Fragment and CopyFiles. TypeScript derives the same two sets from the
// spec its closed shapes are built from (FragmentSpec, CopyFilesSpec,
// less the define phase's own `ctx$`), and both ports check them when the
// tree is read. This holds the two declarations to each other, as
// TestCmpPropsMatchTypeScript does for the props types.
func TestCmpTreeClosedSetsMatchTypeScript(t *testing.T) {
	key := regexp.MustCompile(`^  ([A-Za-z_$][A-Za-z0-9_$]*):`)

	for name, spec := range map[string]string{
		"Fragment":  "FragmentSpec",
		"CopyFiles": "CopyFilesSpec",
	} {
		src, err := os.ReadFile(filepath.Join("..", "ts", "src", "cmp", name+".ts"))
		if err != nil {
			t.Fatal(err)
		}
		head := "const " + spec + " = {\n"
		at := strings.Index(string(src), head)
		if at < 0 {
			t.Fatalf("ts/src/cmp/%s.ts declares no %s", name, spec)
		}

		ts := []string{}
		closed := false
		for _, line := range strings.Split(string(src)[at+len(head):], "\n") {
			if strings.HasPrefix(line, "}") {
				closed = true
				break
			}
			if m := key.FindStringSubmatch(line); m != nil && m[1] != "ctx$" {
				ts = append(ts, m[1])
			}
		}
		if !closed {
			t.Fatalf("%s does not close", spec)
		}
		sort.Strings(ts)

		goSet := []string{}
		for k := range treeClosedCmp[name] {
			goSet = append(goSet, k)
		}
		sort.Strings(goSet)

		if strings.Join(ts, ",") != strings.Join(goSet, ",") {
			t.Fatalf("%s: the ports disagree about the closed prop set\n"+
				"  ts/src/cmp/%s.ts %s: %v\n  go treeClosedCmp: %v",
				name, name, spec, ts, goSet)
		}
	}

	if len(treeClosedCmp) != 2 {
		t.Fatalf("treeClosedCmp names %d components; TypeScript closes two", len(treeClosedCmp))
	}
}
