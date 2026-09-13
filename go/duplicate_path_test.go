package jostraca

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// TWO FILES AT ONE PATH IS REFUSED, on every road in rather than only
// the one that asked for it. `aontu render` refuses an absolute path, a
// ".." segment and a DUPLICATE over its unit list; the first two were
// already here (validName, and CmpTree's folder check) and the third
// was the gap. It is the build phase's business because that is where
// the path is final -- see claimFile in build.go.
//
// Twin of the TypeScript `two-files-at-one-path-are-refused`.
func TestDuplicateFilePathRefused(t *testing.T) {
	refused := func(root func(*J)) string {
		_, err := New(WithMem(), WithFolder("/top"),
			WithNow(func() int64 { return 1 })).Generate(Options{}, root)
		if err == nil {
			return ""
		}
		if !errors.Is(err, ErrDuplicateFilePath) {
			t.Fatalf("wrong error: %v", err)
		}
		return err.Error()
	}

	msg := refused(func(j *J) {
		j.File("a.txt", func(j *J) { j.Content("one") })
		j.File("a.txt", func(j *J) { j.Content("two") })
	})
	if !strings.Contains(msg, "same output path") {
		t.Fatalf("plain duplicate: %q", msg)
	}

	// Two different statements of nesting arriving at one file: neither
	// name is a duplicate of the other.
	msg = refused(func(j *J) {
		j.Folder("x", func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("one") })
		})
		j.File("x/a.txt", func(j *J) { j.Content("two") })
	})
	if !strings.Contains(msg, "path=/top/x/a.txt") {
		t.Fatalf("composed duplicate: %q", msg)
	}

	// A LIST OVER FILES IS THE NORMAL GENERATOR and must not break: the
	// name is computed in the host language, so each pass names a
	// different file.
	res, err := New(WithMem(), WithFolder("/top"),
		WithNow(func() int64 { return 1 })).Generate(Options{},
		func(j *J) {
			j.ListItemsP(ListItemsProps{
				Item:   []any{map[string]any{"n": "1"}, map[string]any{"n": "2"}},
				NoLine: true,
			}, func(j *J, it ListItemProps) {
				n, _ := it.Item.(map[string]any)["n"].(string)
				j.File("f"+n+".txt", func(j *J) { j.Content("n=" + n) })
			})
		})
	if err != nil {
		t.Fatal(err)
	}
	vol := res.Vol()
	if string(vol["/top/f1.txt"]) != "n=1" || string(vol["/top/f2.txt"]) != "n=2" {
		t.Fatalf("list over files: %q %q", vol["/top/f1.txt"], vol["/top/f2.txt"])
	}
}

// AN INJECT INTO A FILE THE SAME RUN CREATED IS NOT A DUPLICATE, and is
// why the guard counts File nodes rather than saves. Both reach the file
// handler with the same path, and the second is the intended edit of the
// first.
func TestInjectIntoGeneratedFileIsNotADuplicate(t *testing.T) {
	res, err := New(WithMem(), WithFolder("/top"),
		WithNow(func() int64 { return 1 })).Generate(Options{},
		func(j *J) {
			j.File("a.txt", func(j *J) {
				j.Content("A\n#--START--#\n\n#--END--#\nB\n")
			})
			j.Inject("a.txt", func(j *J) {
				j.Content("INJECTED\n")
			})
		})
	if err != nil {
		t.Fatal(err)
	}
	got := string(res.Vol()["/top/a.txt"])
	if got != "A\n#--START--#\nINJECTED\n\n#--END--#\nB\n" {
		t.Fatalf("inject: %q", got)
	}
}

// A DATA TREE CANNOT VARY A FILE NAME: File assigns props.name to the
// node and fileBefore composes it as given, so `f{item.n}.txt` is a
// filename containing braces, not two filenames. Under ListItems that
// makes every pass claim the same path, which the guard now says rather
// than writing one file and dropping the rest.
func TestCmpTreeListItemsCannotVaryAFileName(t *testing.T) {
	var tree any
	if err := json.Unmarshal([]byte(`{
	  "cmp":"ListItems","props":{"item":[{"n":1},{"n":2}],"line":false},
	  "children":[{"cmp":"File","props":{"name":"f{item.n}.txt"}}]
	}`), &tree); err != nil {
		t.Fatal(err)
	}
	root, err := CmpTree(tree)
	if err != nil {
		t.Fatal(err)
	}
	_, err = New(WithMem(), WithFolder("/top"),
		WithNow(func() int64 { return 1 })).Generate(Options{}, root)
	if !errors.Is(err, ErrDuplicateFilePath) {
		t.Fatalf("wanted a duplicate refusal, got %v", err)
	}
	if !strings.Contains(err.Error(), "f{item.n}.txt") {
		t.Fatalf("message: %v", err)
	}
}
