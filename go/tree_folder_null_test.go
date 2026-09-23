package jostraca

import (
	"reflect"
	"testing"
)

// A JSON null `folder` prop is absent, as it is in TypeScript: the tree
// generates byte for byte as though the key were missing. Go refused it
// as "folder is not a string", while accepting a null `props` or
// `children`. The acceptance itself is a row per component in
// test/spec/tree.tsv.
func TestCmpTreeFolderNullIsAbsent(t *testing.T) {
	gen := func(project map[string]any) map[string][]byte {
		t.Helper()
		root, err := CmpTree(map[string]any{
			"cmp": "Project", "props": project,
			"children": []any{map[string]any{
				"cmp": "File", "props": map[string]any{"name": "a.txt", "folder": nil},
				"children": []any{map[string]any{"cmp": "Content", "props": map[string]any{"arg": "A"}}},
			}},
		})
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

	withNull := gen(map[string]any{"folder": nil})
	absent := gen(map[string]any{})
	if !reflect.DeepEqual(withNull, absent) {
		t.Fatalf("null folder differs from absent:\n%v\n%v", withNull, absent)
	}
	if string(withNull["/top/a.txt"]) != "A" {
		t.Fatalf("a.txt = %q", withNull["/top/a.txt"])
	}
}
