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

// THE CLAIM IS ON THE CANONICAL PATH, so two lexically different names
// for one file are one file. Go has always cleaned the path before
// recording it (`fileBefore` does `path.Clean(fwd(raw))`); this pins
// that, because it is the behaviour TypeScript had to be corrected to
// match after its guard let `a.txt` and `./a.txt` through as two.
func TestDuplicatePathIsCanonical(t *testing.T) {
	refused := func(root func(*J)) error {
		_, err := New(WithMem(), WithFolder("/top"),
			WithNow(func() int64 { return 1 })).Generate(Options{}, root)
		return err
	}

	err := refused(func(j *J) {
		j.File("a.txt", func(j *J) { j.Content("FIRST") })
		j.File("./a.txt", func(j *J) { j.Content("SECOND") })
	})
	if !errors.Is(err, ErrDuplicateFilePath) ||
		!strings.Contains(err.Error(), "path=/top/a.txt") {
		t.Fatalf("dot-slash duplicate: %v", err)
	}

	err = refused(func(j *J) {
		j.Folder("x", func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("FIRST") })
		})
		j.File("x/./a.txt", func(j *J) { j.Content("SECOND") })
	})
	if !errors.Is(err, ErrDuplicateFilePath) ||
		!strings.Contains(err.Error(), "path=/top/x/a.txt") {
		t.Fatalf("composed dot-slash duplicate: %v", err)
	}

	// Two files that only LOOK similar are still two files.
	res, err := New(WithMem(), WithFolder("/top"),
		WithNow(func() int64 { return 1 })).Generate(Options{}, func(j *J) {
		j.File("a.txt", func(j *J) { j.Content("A") })
		j.File("./b.txt", func(j *J) { j.Content("B") })
	})
	if err != nil {
		t.Fatal(err)
	}
	vol := res.Vol()
	if string(vol["/top/a.txt"]) != "A" || string(vol["/top/b.txt"]) != "B" {
		t.Fatalf("two files: %q %q", vol["/top/a.txt"], vol["/top/b.txt"])
	}
}

// A LINE APPENDS ITS NEWLINE UNCONDITIONALLY, which is what TypeScript
// does and what the component reference documents (`Line('a\n')` writes
// `a\n\n`). This port appended only when Src did not already end in
// one, so the same call produced different bytes on the two sides -- an
// undocumented divergence rather than a deviation, and TypeScript is
// canonical.
//
// Both spellings, because they had drifted apart from each other too:
// `Line` carried its own copy of the rule and now delegates to `LineP`.
func TestLineAppendsItsNewlineUnconditionally(t *testing.T) {
	res, err := New(WithMem(), WithFolder("/top"),
		WithNow(func() int64 { return 1 })).Generate(Options{}, func(j *J) {
		j.File("a.txt", func(j *J) { j.Line("a\n") })
		j.File("b.txt", func(j *J) { j.Line("b") })
		j.File("c.txt", func(j *J) { j.Line("") })
		j.File("d.txt", func(j *J) { j.LineP(ContentProps{Src: "d\n"}) })
		j.File("e.txt", func(j *J) { j.LineP(ContentProps{Src: "e\n", Raw: true}) })
	})
	if err != nil {
		t.Fatal(err)
	}
	vol := res.Vol()

	for _, c := range []struct{ path, want string }{
		{"/top/a.txt", "a\n\n"},
		{"/top/b.txt", "b\n"},
		{"/top/c.txt", "\n"},
		{"/top/d.txt", "d\n\n"},
		{"/top/e.txt", "e\n\n"},
	} {
		if got := string(vol[c.path]); got != c.want {
			t.Fatalf("%s: %q, want %q", c.path, got, c.want)
		}
	}
}
