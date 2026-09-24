package jostraca

import (
	"reflect"
	"sort"
	"strings"
	"testing"
)

// A Copy or an Inject nested INSIDE a File. TS used to destroy the enclosing
// file in both cases: CopyOp.before and InjectOp.before each made themselves
// buildctx.current.file and never put the previous one back, so every later
// sibling accumulated into the wrong buffer and FileOp.after wrote that buffer
// to the wrong path. The enclosing file was never written at all, and the
// Inject case overwrote its own pre-existing TARGET.
//
// Go was correct throughout - copyBefore leaves b.current.file alone, and
// fileAfter concatenates from n.Children rather than from a mutable cursor.
// These tests pin the Go side so a future change cannot drift onto the
// behaviour TS just left. Mirrors the `nested-emitters` block in
// ts/test/jostraca.test.ts; the copy_in_file and inject_in_file parity
// snapshots pin the same shapes across both stacks. See #39.

func nestedVol(m *MemFS) map[string]string {
	out := map[string]string{}
	for k, v := range m.Vol() {
		if len(k) > 14 && k[:14] == "/out/.jostraca" {
			continue
		}
		out[k] = string(v)
	}
	return out
}

func nestedGen(t *testing.T, seed map[string]string, body func(*J)) map[string]string {
	t.Helper()
	m := NewMemFS()
	// Sorted, so the seed order cannot vary run to run.
	keys := make([]string, 0, len(seed))
	for k := range seed {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if err := m.WriteFile(k, []byte(seed[k])); err != nil {
			t.Fatal(err)
		}
	}

	j := New(WithFS(m), WithFolder("/out"),
		WithNow(func() int64 { return 1735689600000 }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{}, body)
	}); err != nil {
		t.Fatal(err)
	}
	return nestedVol(m)
}

// The copied text is spliced into the enclosing file at the position the Copy
// sits in source order, AND still written to its own destination.
func TestCopyInsideFile(t *testing.T) {
	got := nestedGen(t, map[string]string{"/tm/h.txt": "HELLO\n"}, func(j *J) {
		j.File("a.txt", func(j *J) {
			j.Content("BEFORE\n")
			j.Copy(CopyProps{From: "/tm/h.txt"})
			j.Content("AFTER\n")
		})
	})

	want := map[string]string{
		"/tm/h.txt":  "HELLO\n",
		"/out/h.txt": "HELLO\n",
		"/out/a.txt": "BEFORE\nHELLO\nAFTER\n",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("copy inside file:\n got: %v\nwant: %v", got, want)
	}
}

// An Inject contributes NO text to the file around it, unlike Fragment and
// Slot: it writes to its own target, which keeps everything outside the
// markers.
func TestInjectInsideFile(t *testing.T) {
	got := nestedGen(t, map[string]string{
		"/out/t.txt": "HEADER\n#--START--#\nold\n#--END--#\nFOOTER\n",
	}, func(j *J) {
		j.File("a.txt", func(j *J) {
			j.Content("BEFORE\n")
			j.Inject("t.txt", func(j *J) { j.Content("new content") })
			j.Content("AFTER\n")
		})
	})

	if want := "BEFORE\nAFTER\n"; got["/out/a.txt"] != want {
		t.Errorf("/out/a.txt: got %q, want %q", got["/out/a.txt"], want)
	}
	want := "HEADER\n#--START--#\nnew content\n#--END--#\nFOOTER\n"
	if got["/out/t.txt"] != want {
		t.Errorf("/out/t.txt: got %q, want %q", got["/out/t.txt"], want)
	}
}

// Two Copies in one File keep their source-order positions.
func TestTwoCopiesInsideFile(t *testing.T) {
	got := nestedGen(t, map[string]string{
		"/tm/h.txt": "H\n",
		"/tm/i.txt": "I\n",
	}, func(j *J) {
		j.File("a.txt", func(j *J) {
			j.Copy(CopyProps{From: "/tm/h.txt"})
			j.Content("MID\n")
			j.Copy(CopyProps{From: "/tm/i.txt"})
		})
	})

	if want := "H\nMID\nI\n"; got["/out/a.txt"] != want {
		t.Errorf("/out/a.txt: got %q, want %q", got["/out/a.txt"], want)
	}
	if got["/out/h.txt"] != "H\n" || got["/out/i.txt"] != "I\n" {
		t.Errorf("copied files: h=%q i=%q", got["/out/h.txt"], got["/out/i.txt"])
	}
}

// A DIRECTORY Copy contributes nothing to the file around it in either stack:
// copyBefore returns before setting n.Content, so fileAfter's KindCopy splice
// finds none. Pinned so the single-file splice cannot quietly grow to cover
// the tree walk.
func TestDirectoryCopyInsideFileSplicesNothing(t *testing.T) {
	got := nestedGen(t, map[string]string{
		"/tm/d/x.txt": "X\n",
		"/tm/d/y.txt": "Y\n",
	}, func(j *J) {
		j.File("a.txt", func(j *J) {
			j.Content("BEFORE\n")
			j.Copy(CopyProps{From: "/tm/d", To: "sub"})
			j.Content("AFTER\n")
		})
	})

	if want := "BEFORE\nAFTER\n"; got["/out/a.txt"] != want {
		t.Errorf("/out/a.txt: got %q, want %q", got["/out/a.txt"], want)
	}
	if got["/out/sub/x.txt"] != "X\n" || got["/out/sub/y.txt"] != "Y\n" {
		t.Errorf("copied tree: %v", got)
	}
}

// KNOWN DEVIATION, pinned deliberately rather than fixed.
//
// A BINARY single-file Copy inside a File splices its raw bytes into the
// enclosing file here. TS cannot: its copy content is a Buffer, and a Buffer
// joined into a JS string is UTF-8 decoded, so every byte that is not valid
// UTF-8 would become U+FFFD and the splice would silently corrupt the copy.
// A Go string is a byte string and has no such loss.
//
// TS therefore contributes nothing to the enclosing file for a binary Copy
// and logs it, rather than writing a corrupted approximation. Closing the gap
// would mean a byte-oriented content pipeline through FileHandler in TS, for a
// shape - embedding a binary inside a text file - that is a user error either
// way. Recorded in the deviations list.
func TestBinaryCopyInsideFileSplicesBytes(t *testing.T) {
	m := NewMemFS()
	raw := []byte{0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe}
	if err := m.WriteFile("/tm/i.png", raw); err != nil {
		t.Fatal(err)
	}
	j := New(WithFS(m), WithFolder("/out"),
		WithNow(func() int64 { return 1735689600000 }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("a.txt", func(j *J) {
				j.Content("BEFORE\n")
				j.Copy(CopyProps{From: "/tm/i.png"})
				j.Content("AFTER\n")
			})
		})
	}); err != nil {
		t.Fatal(err)
	}

	want := append(append([]byte("BEFORE\n"), raw...), []byte("AFTER\n")...)
	if !reflect.DeepEqual(m.Vol()["/out/a.txt"], want) {
		t.Errorf("/out/a.txt: got %v, want %v", m.Vol()["/out/a.txt"], want)
	}
	if !reflect.DeepEqual(m.Vol()["/out/i.png"], raw) {
		t.Errorf("/out/i.png: got %v, want %v", m.Vol()["/out/i.png"], raw)
	}
}

// nestedGenModel is nestedGen with a model.
func nestedGenModel(t *testing.T, seed map[string]string, model map[string]any,
	body func(*J)) map[string]string {
	t.Helper()
	m := NewMemFS()
	keys := make([]string, 0, len(seed))
	for k := range seed {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if err := m.WriteFile(k, []byte(seed[k])); err != nil {
			t.Fatal(err)
		}
	}
	j := New(WithFS(m), WithFolder("/out"), WithModel(model),
		WithNow(func() int64 { return 1735689600000 }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{}, body)
	}); err != nil {
		t.Fatal(err)
	}
	return nestedVol(m)
}

// A File nested in a File, directly or through a Folder, is written to its
// own path, and the outer File keeps all of its own content, before and
// after it. Go collected from the tree and was right throughout; TS left
// the inner File current and lost the outer file's trailing content, and
// moved to save and restore it. Mirrors 'file-inside-file' in the
// `components` block of ts/test/jostraca.test.ts.
func TestFileInsideFile(t *testing.T) {
	out := nestedGen(t, nil, func(j *J) {
		j.File("outer.txt", func(j *J) {
			j.Content("1")
			j.File("inner.txt", func(j *J) { j.Content("2") })
			j.Content("3")
		})
		j.File("outer2.txt", func(j *J) {
			j.Content("1")
			j.Folder("sub", func(j *J) {
				j.File("inner.txt", func(j *J) { j.Content("2") })
			})
			j.Content("3")
		})
	})
	want := map[string]string{
		"/out/outer.txt":     "13",
		"/out/inner.txt":     "2",
		"/out/outer2.txt":    "13",
		"/out/sub/inner.txt": "2",
	}
	if !reflect.DeepEqual(out, want) {
		t.Errorf("got %q\nwant %q", out, want)
	}

	files, written := projectScopeGen(t, "/out", func(j *J) {
		j.Project(ProjectProps{}, func(j *J) {
			j.File("outer.txt", func(j *J) {
				j.Content("1")
				j.File("inner.txt", func(j *J) { j.Content("2") })
				j.Content("3")
			})
		})
	})
	expectFiles(t, files, []string{"/out/inner.txt", "/out/outer.txt"})
	expectFiles(t, written, []string{"/out/inner.txt", "/out/outer.txt"})
}

// A Folder or a Project inside a File never becomes the current file in
// TS, so what its children emit lands in the File, in source order, and the
// directories are still made. A File or an Inject in there writes its own
// target. Go's collector walked only KindNone and KindSlot, so the text
// inside a Folder or a Project was dropped. Mirrors
// 'folder-and-project-inside-file' in ts/test/jostraca.test.ts.
func TestFolderAndProjectInsideFile(t *testing.T) {
	m := NewMemFS()
	for _, kv := range [][2]string{
		{"/src/c.txt", "C$$name$$\n"},
		{"/tm/f.txt", "[F<[SLOT]>]\n"},
		{"/out/inj.txt", "h\n#--START--#\nold\n#--END--#\nt\n"},
	} {
		if err := m.WriteFile(kv[0], []byte(kv[1])); err != nil {
			t.Fatal(err)
		}
	}
	_, err := New(WithFS(m), WithFolder("/out"), WithModel(map[string]any{"name": "N"}),
		WithNow(func() int64 { return 1735689600000 })).
		Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("f.txt", func(j *J) {
					j.Content("1")
					j.Folder("d", func(j *J) { j.Content("x") })
					j.Content("2")
				})
				j.File("g.txt", func(j *J) {
					j.Content("1")
					j.Project(ProjectProps{Folder: "p"}, func(j *J) { j.Content("y") })
					j.Content("2")
				})
				j.File("h.txt", func(j *J) {
					j.Content("1")
					j.Folder("e", func(j *J) { j.Copy(CopyProps{From: "/src/c.txt", To: "c2.txt"}) })
					j.Content("2")
				})
				j.File("i.txt", func(j *J) {
					j.Content("1")
					j.Folder("k", func(j *J) {
						j.Folder("l", func(j *J) {
							j.Fragment(FragmentProps{From: "/tm/f.txt"}, func(j *J) { j.Content("S") })
						})
					})
					j.Content("2")
				})
				j.File("j.txt", func(j *J) {
					j.Content("1")
					j.Folder("m", func(j *J) {
						j.File("inner.txt", func(j *J) { j.Content("I") })
						j.Content("z")
					})
					j.Content("2")
				})
				j.File("n.txt", func(j *J) {
					j.Content("1")
					j.Folder(".", func(j *J) {
						j.Inject("inj.txt", func(j *J) { j.Content("NEW") })
					})
					j.Content("2")
				})
			})
		})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]any{}
	for k, v := range m.Vol() {
		if strings.HasPrefix(k, "/out/.jostraca") {
			continue
		}
		if v == nil {
			got[k] = nil
		} else {
			got[k] = string(v)
		}
	}
	want := map[string]any{
		"/src/c.txt":       "C$$name$$\n",
		"/tm/f.txt":        "[F<[SLOT]>]\n",
		"/out/d":           nil,
		"/out/p":           nil,
		"/out/k/l":         nil,
		"/out/f.txt":       "1x2",
		"/out/g.txt":       "1y2",
		"/out/e/c2.txt":    "CN\n",
		"/out/h.txt":       "1CN\n2",
		"/out/i.txt":       "1[FS]\n2",
		"/out/m/inner.txt": "I",
		"/out/j.txt":       "1z2",
		"/out/inj.txt":     "h\n#--START--#\nNEW\n#--END--#\nt\n",
		"/out/n.txt":       "12",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %q\nwant %q", got, want)
	}
}

// A single-file text CopyFiles inside a File splices exactly the text it
// writes to its own target, `replace` included. Go templated once with the
// copy's Replace and used that text for both; TS left `replace` off the
// splice and moved to match. Mirrors 'copy-inside-file-replace' in
// ts/test/jostraca.test.ts. (The Inject variant there is fh-inject-children's
// in Go: injectAfter does not collect a CopyFiles child yet.)
func TestCopyInsideFileReplace(t *testing.T) {
	out := nestedGenModel(t, map[string]string{
		"/tm/single.txt": "single $$name$$ FOO\n",
	}, map[string]any{"name": "World"}, func(j *J) {
		j.File("host.txt", func(j *J) {
			j.Content("pre\n")
			j.CopyFiles(CopyFilesProps{From: "/tm/single.txt", To: "spliced.txt",
				Replace: map[string]any{"FOO": "bar"}})
			j.Content("post\n")
		})
	})
	if got := out["/out/spliced.txt"]; got != "single World bar\n" {
		t.Errorf("spliced.txt: %q", got)
	}
	if got := out["/out/host.txt"]; got != "pre\nsingle World bar\npost\n" {
		t.Errorf("host.txt: %q", got)
	}
}
