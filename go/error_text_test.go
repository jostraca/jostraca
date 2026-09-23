package jostraca

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// Every error jostraca raises itself has the same message BODY in both
// ports: the text after Go's NodeError wrapper, `jostraca <step> @<path>: `,
// and after TS's `<ERROR:>?<Op>:<phase>: ` prefix. The wrappers differ by
// runtime, and so does an embedded filesystem error, which is the host's
// own text; those cases pin the step and the partial tree. Mirrors the
// `errors` block in ts/test/generate.test.ts.

func errorRefusal(t *testing.T, root func(*J)) error {
	t.Helper()
	_, err := New(WithMem(), WithFolder("/out"), WithNow(func() int64 { return 1735689600000 })).
		Generate(Options{}, root)
	if err == nil {
		t.Fatal("expected a refusal")
	}
	return err
}

// errorBody is the message inside the NodeError wrapper, and the step.
func errorBody(t *testing.T, err error) (string, string) {
	t.Helper()
	var ne *NodeError
	if !errors.As(err, &ne) {
		return err.Error(), ""
	}
	return ne.Err.Error(), ne.Step
}

func TestErrorBodyDuplicateFilePath(t *testing.T) {
	err := errorRefusal(t, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("1") })
			j.File("./a.txt", func(j *J) { j.Content("2") })
		})
	})
	if !errors.Is(err, ErrDuplicateFilePath) {
		t.Fatalf("not ErrDuplicateFilePath: %v", err)
	}
	body, step := errorBody(t, err)
	want := "two File components resolve to the same output path, " +
		"path=/out/a.txt, first=a.txt, second=./a.txt"
	if body != want || step != "file" {
		t.Fatalf("step %q body %q\nwant %q", step, body, want)
	}

	// Under Project{Folder: "."} the refusal and the step agree as well.
	// TS names the paths as above there too; Go's node path counts the
	// Project's folder, so only the start of the body is held here.
	err = errorRefusal(t, func(j *J) {
		j.Project(ProjectProps{Folder: "."}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("1") })
			j.File("./a.txt", func(j *J) { j.Content("2") })
		})
	})
	body, step = errorBody(t, err)
	if !errors.Is(err, ErrDuplicateFilePath) || step != "file" ||
		!strings.HasPrefix(body, "two File components resolve to the same output path, path=/out/a.txt, first=") {
		t.Fatalf("step %q body %q", step, body)
	}
}

func TestErrorBodyNameTraversal(t *testing.T) {
	err := errorRefusal(t, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("ok.txt", func(j *J) { j.Content("ok") })
			j.File("../x.txt", func(j *J) { j.Content("x") })
		})
	})
	if !errors.Is(err, ErrNameTraversal) {
		t.Fatalf("not ErrNameTraversal: %v", err)
	}
	body, step := errorBody(t, err)
	if want := `File name must not contain a ".." path segment, name=../x.txt`; body != want || step != "file" {
		t.Fatalf("step %q body %q\nwant %q", step, body, want)
	}
}

func TestErrorBodyInjectTargetMissing(t *testing.T) {
	err := errorRefusal(t, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("ok.txt", func(j *J) { j.Content("ok") })
			j.Inject("nope.txt", func(j *J) { j.Content("X") })
		})
	})
	if !errors.Is(err, ErrInjectTargetMissing) {
		t.Fatalf("not ErrInjectTargetMissing: %v", err)
	}
	body, step := errorBody(t, err)
	want := "inject target does not exist, path=/out/nope.txt " +
		"(Inject rewrites an existing file; use File to create one)"
	if body != want || step != "inject" {
		t.Fatalf("step %q body %q\nwant %q", step, body, want)
	}
}

func TestErrorBodyInjectOneEmptyMarker(t *testing.T) {
	err := errorRefusal(t, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.InjectP(InjectProps{Name: "nope.txt", Markers: [2]string{"X", ""}},
				func(j *J) { j.Content("X") })
		})
	})
	if want := `Inject: both markers must be non-empty, got ["X",""]`; err.Error() != want {
		t.Fatalf("err %q\nwant %q", err, want)
	}
}

func TestErrorBodyNilRoot(t *testing.T) {
	_, err := New(WithMem()).Generate(Options{}, nil)
	if !errors.Is(err, ErrNilRoot) ||
		err.Error() != "jostraca: generate root callback is not a function" {
		t.Fatalf("err %v", err)
	}
}

func TestErrorBodyDefineTimeFrom(t *testing.T) {
	missing := errorRefusal(t, func(j *J) {
		j.File("a.txt", func(j *J) { j.Fragment(FragmentProps{}, nil) })
	})
	body, _ := errorBody(t, missing)
	if want := `Fragment: Validation failed for property "from" because the property is missing.`; body != want {
		t.Fatalf("body %q\nwant %q", body, want)
	}

	frag := errorRefusal(t, func(j *J) {
		j.File("a.txt", func(j *J) { j.Fragment(FragmentProps{From: "nope.txt"}, nil) })
	})
	body, _ = errorBody(t, frag)
	if !strings.HasPrefix(body, `Fragment: Validation failed for property "from" `+
		`with string "/out/nope.txt" because check "From" failed (threw: `) {
		t.Fatalf("body %q", body)
	}
	if !errors.Is(frag, fs.ErrNotExist) {
		t.Fatalf("the filesystem error is not wrapped: %v", frag)
	}

	cp := errorRefusal(t, func(j *J) {
		j.CopyFiles(CopyFilesProps{From: "/nope"})
	})
	body, _ = errorBody(t, cp)
	if !strings.HasPrefix(body, `CopyFiles: Validation failed for property "from" `+
		`with string "/nope" because check "From" failed (threw: `) {
		t.Fatalf("body %q", body)
	}
}

// shape clips a value inside a message to 111 characters, and so does
// the Go rendering of the same text.
func TestShapeValueTextClips(t *testing.T) {
	long := "/" + strings.Repeat("x", 200)
	got := shapeValueText(long)
	if len(got) != 111 || !strings.HasSuffix(got, "...") || got[:108] != long[:108] {
		t.Fatalf("%q", got)
	}
	if got := shapeValueText(`C:\x"y`); got != `C:\\x\y` {
		t.Fatalf("%q", got)
	}
}

// A filesystem failure embeds the host's error, so these hold the step and
// the partial tree the refusal leaves, not the text. A REAL FILESYSTEM,
// because the failures are the operating system's.
func TestFilesystemFailuresLeaveTheSameTree(t *testing.T) {
	walk := func(root string) []string {
		out := []string{}
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil || p == root {
				return nil
			}
			rel, _ := filepath.Rel(root, p)
			rel = filepath.ToSlash(rel)
			if d.IsDir() {
				rel += "/"
			}
			out = append(out, rel)
			return nil
		})
		sort.Strings(out)
		return out
	}
	one := func(body string) func(*J) {
		return func(j *J) {
			j.Project(ProjectProps{Folder: "."}, func(j *J) {
				j.File("a.txt", func(j *J) { j.Content(body) })
			})
		}
	}
	gen := func(out string, opts []Option, root func(*J)) error {
		_, err := New(append([]Option{WithFolder(fwd(out)),
			WithNow(func() int64 { return 1735689600000 })}, opts...)...).
			Generate(Options{}, root)
		return err
	}
	preserve := []Option{WithExisting(Existing{Txt: ExistingTxt{Preserve: existingFlag(true)}})}

	cases := []struct {
		name string
		prep func(t *testing.T, out string)
		opts []Option
		root func(*J)
		step string
		tree []string
	}{
		{"file-where-a-folder-goes",
			func(t *testing.T, out string) {
				_ = os.WriteFile(filepath.Join(out, "sub"), []byte("I am a file\n"), 0o644)
			}, nil,
			func(j *J) {
				j.Project(ProjectProps{Folder: "."}, func(j *J) {
					j.Folder("sub", func(j *J) { j.File("a.txt", func(j *J) { j.Content("A\n") }) })
				})
			},
			"folder", []string{"sub"}},
		{"folder-where-a-file-goes",
			func(t *testing.T, out string) { _ = os.Mkdir(filepath.Join(out, "a.txt"), 0o755) },
			nil, one("A\n"), "file", []string{"a.txt/"}},
		{"meta-log-is-a-folder",
			func(t *testing.T, out string) {
				_ = os.MkdirAll(filepath.Join(out, ".jostraca", "jostraca.meta.log"), 0o755)
			},
			nil, one("A\n"), "",
			[]string{".jostraca/", ".jostraca/generated/", ".jostraca/generated/a.txt",
				".jostraca/jostraca.meta.log/", "a.txt"}},
		{"meta-folder-is-a-file",
			func(t *testing.T, out string) {
				_ = os.WriteFile(filepath.Join(out, ".jostraca"), []byte("x"), 0o644)
			},
			nil, one("A\n"), "file", []string{".jostraca", "a.txt"}},
		{"preserve-backup-is-a-folder",
			func(t *testing.T, out string) {
				if err := gen(out, nil, one("A\n")); err != nil {
					t.Fatal(err)
				}
				_ = os.WriteFile(filepath.Join(out, "a.txt"), []byte("U\n"), 0o644)
				_ = os.Mkdir(filepath.Join(out, "a.old.txt"), 0o755)
			},
			preserve, one("A2\n"), "file",
			[]string{".jostraca/", ".jostraca/.gitignore", ".jostraca/generated/",
				".jostraca/generated/a.txt", ".jostraca/jostraca.meta.log",
				"a.old.txt/", "a.txt"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out := filepath.Join(t.TempDir(), "out")
			if err := os.Mkdir(out, 0o755); err != nil {
				t.Fatal(err)
			}
			tc.prep(t, out)
			err := gen(out, tc.opts, tc.root)
			if err == nil {
				t.Fatal("expected a refusal")
			}
			if _, step := errorBody(t, err); step != tc.step {
				t.Errorf("step %q, want %q (%v)", step, tc.step, err)
			}
			if got := walk(out); !reflect.DeepEqual(got, tc.tree) {
				t.Errorf("tree\n got %v\nwant %v", got, tc.tree)
			}
			if tc.name == "preserve-backup-is-a-folder" {
				if b, _ := os.ReadFile(filepath.Join(out, "a.txt")); string(b) != "U\n" {
					t.Errorf("a.txt = %q", b)
				}
			}
		})
	}
}
