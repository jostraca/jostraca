package jostraca

import (
	"strings"
	"testing"
)

// A node's component is resolved by the name AS WRITTEN: the caller's
// override, then the built-in, then the deprecated alias of a built-in.
// Go used to rewrite `Copy` and `List` to their canonical names first,
// so an override keyed by the deprecated spelling was never consulted.
// Mirrors `tree-resolution` in ts/test/tree.test.ts; the refusals are
// rows in test/spec/tree.tsv.

func treeResolutionGen(t *testing.T, tree any, opts CmpTreeOptions) map[string][]byte {
	t.Helper()
	root, err := CmpTree(tree, opts)
	if err != nil {
		t.Fatal(err)
	}
	res, err := New(WithMem(), WithFolder("/top"), WithNow(func() int64 { return 1 })).
		Generate(Options{}, root)
	if err != nil {
		t.Fatal(err)
	}
	return res.Vol()
}

func TestCmpTreeOverrideOfDeprecatedCopyRuns(t *testing.T) {
	vol := treeResolutionGen(t,
		map[string]any{"cmp": "Copy", "props": map[string]any{"tag": "T"}},
		CmpTreeOptions{Cmp: map[string]CmpTreeCmp{
			"Copy": func(j *J, p map[string]any, _ []func(*J)) {
				tag, _ := p["tag"].(string)
				j.File("custom.txt", func(j *J) { j.Content("CUSTOM " + tag) })
			},
		}})
	if got := string(vol["/top/custom.txt"]); got != "CUSTOM T" {
		t.Fatalf("custom.txt = %q", got)
	}
}

func TestCmpTreeOverrideOfDeprecatedListRuns(t *testing.T) {
	vol := treeResolutionGen(t,
		map[string]any{"cmp": "File", "props": map[string]any{"name": "x.txt"},
			"children": []any{map[string]any{"cmp": "List", "props": map[string]any{"n": "L"}}}},
		CmpTreeOptions{Cmp: map[string]CmpTreeCmp{
			"List": func(j *J, p map[string]any, _ []func(*J)) {
				n, _ := p["n"].(string)
				j.Content("LIST " + n)
			},
		}})
	if got := string(vol["/top/x.txt"]); got != "LIST L" {
		t.Fatalf("x.txt = %q", got)
	}
}

// An override keyed only by the canonical name does not capture the
// deprecated spelling: `Copy` still runs the built-in, closed prop set
// and all.
func TestCmpTreeCanonicalOverrideLeavesAliasBuiltin(t *testing.T) {
	_, err := CmpTree(
		map[string]any{"cmp": "Copy", "props": map[string]any{"tag": "T"}},
		CmpTreeOptions{Cmp: map[string]CmpTreeCmp{
			"CopyFiles": func(j *J, p map[string]any, _ []func(*J)) {},
		}})
	if err == nil || !strings.Contains(err.Error(), "prop not allowed: tag") {
		t.Fatalf("err = %v", err)
	}
}
