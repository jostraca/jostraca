package jostraca

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// Regressions from the PR #20 review. Every one of these was invisible to a
// green suite, which is the point of writing them down here.

const revWhen = 1735689600000

func revJ(t *testing.T, folder string, opts ...Option) *J {
	t.Helper()
	return New(append([]Option{
		WithFolder(folder),
		WithNow(func() int64 { return revWhen }),
	}, opts...)...)
}

// C1. `visited` must be the ACTIVE ANCESTOR CHAIN, not every path the walk
// has ever seen. A real directory plus a sibling symlink to it are two
// legitimate copy targets, not a cycle. Whichever the sorted ReadDir
// yielded second used to be dropped silently — and since sort order
// decides, the dropped one could be the REAL directory.
func TestCopyDuplicateRealpathSiblingsBothCopied(t *testing.T) {
	for _, linkname := range []string{"alink", "zlink"} {
		dir := t.TempDir()
		src := filepath.Join(dir, "src")
		if err := os.MkdirAll(filepath.Join(src, "real"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(src, "real", "one.txt"), []byte("ONE\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		// Creating a symlink on Windows needs SeCreateSymbolicLinkPrivilege,
		// which GitHub's windows-latest runners do not have. Skip rather than
		// fail — this test is entirely about a symlinked sibling, so there is
		// nothing left to assert without one. Same idiom as
		// robustness_test.go. The cost is that Windows CI never regression-
		// tests the R1 visited-unwind fix; that gap is deliberate.
		if err := os.Symlink(filepath.Join(src, "real"), filepath.Join(src, linkname)); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}

		j := revJ(t, fwd(dir))
		if _, err := j.Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{Folder: "app"}, func(j *J) {
				j.Copy(CopyProps{From: fwd(src), To: "lib"})
			})
		}); err != nil {
			t.Fatal(err)
		}

		for _, want := range []string{"real", linkname} {
			p := filepath.Join(dir, "app", "lib", want, "one.txt")
			body, err := os.ReadFile(p)
			if err != nil {
				t.Fatalf("link=%s: %s missing: %v", linkname, p, err)
			}
			if string(body) != "ONE\n" {
				t.Errorf("link=%s: %s content = %q", linkname, p, body)
			}
		}
	}
}

// A genuine cycle must STILL be caught after the unwind fix — that is what
// `visited` is for. Guards against "fixing" the above by deleting it.
func TestCopyStillDetectsAncestorCycle(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "a.txt"), []byte("A\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// See the note on the sibling test above: no symlink privilege on
	// Windows runners, and a cycle test without a cycle asserts nothing.
	if err := os.Symlink(src, filepath.Join(src, "sub", "loop")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		j := revJ(t, fwd(dir))
		_, err := j.Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{Folder: "app"}, func(j *J) {
				j.Copy(CopyProps{From: fwd(src), To: "lib"})
			})
		})
		done <- err
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("copy did not terminate: cycle detection is gone")
	}

	if _, err := os.Stat(filepath.Join(dir, "app", "lib", "sub", "a.txt")); err != nil {
		t.Errorf("real content missing: %v", err)
	}
	deep := filepath.Join(dir, "app", "lib", "sub", "loop", "sub", "loop", "sub")
	if _, err := os.Stat(deep); err == nil {
		t.Errorf("descended into the cycle: %s exists", deep)
	}
}

// C6. A file that happens to sit at the atomic writer's temp path must not
// be destroyed. The temp name used to be a fixed <target>.jostraca-tmp, so
// generating <target> overwrote the sibling and then renamed it away.
func TestAtomicWriteDoesNotClobberTempNamedSibling(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "p", "a.txt")
	decoy := target + tmpSuffix
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(decoy, []byte("PRECIOUS USER DATA\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	j := revJ(t, fwd(dir))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.File("a.txt", func(j *J) { j.Content("GENERATED\n") })
		})
	}); err != nil {
		t.Fatal(err)
	}

	if body, _ := os.ReadFile(target); string(body) != "GENERATED\n" {
		t.Errorf("target content = %q", body)
	}
	body, err := os.ReadFile(decoy)
	if err != nil {
		t.Fatalf("the sibling was destroyed: %v", err)
	}
	if string(body) != "PRECIOUS USER DATA\n" {
		t.Errorf("sibling content = %q, want unchanged", body)
	}
}

// C2. Identical bytes are not a complete no-op when an explicit Mode was
// asked for: the content matches from the second run onward, so skipping
// meant Mode could never be applied to an existing correct file.
func TestFileModeAppliedWhenContentUnchanged(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "p", "run.sh")
	body := "#!/bin/sh\necho hi\n"
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	j := revJ(t, fwd(dir))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.FileP(FileProps{Name: "run.sh", Mode: 0o755}, func(j *J) {
				j.Content(body)
			})
		})
	}); err != nil {
		t.Fatal(err)
	}

	if got, _ := os.ReadFile(target); string(got) != body {
		t.Errorf("content = %q", got)
	}
	fi, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if posixModes && fi.Mode().Perm() != 0o755 {
		t.Errorf("mode = %v, want 0755 on an unchanged file", fi.Mode().Perm())
	}
}

// C3. Merge and diff used writeAtomic, not writeAtomicMode, so an explicit
// FileProps.Mode was silently dropped whenever either handled the file.
// TS forwards modeopts() on both branches, so this was a parity break too.
func TestFileModeAppliedOnMergeAndDiff(t *testing.T) {
	tr := true

	for _, tc := range []struct {
		name     string
		existing Existing
		seedDup  bool
	}{
		{"merge", Existing{Txt: ExistingTxt{Merge: &tr}}, true},
		{"diff", Existing{Txt: ExistingTxt{Diff: &tr}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			target := filepath.Join(dir, "p", "run.sh")
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				t.Fatal(err)
			}
			// A user edit, so the existing-file path actually engages.
			if err := os.WriteFile(target, []byte("#!/bin/sh\nUSER\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			if tc.seedDup {
				dup := filepath.Join(dir, "p", ".jostraca", "generated", "run.sh")
				if err := os.MkdirAll(filepath.Dir(dup), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(dup, []byte("#!/bin/sh\nORIG\n"), 0o644); err != nil {
					t.Fatal(err)
				}
			}

			j := revJ(t, fwd(dir))
			if _, err := j.Generate(Options{Existing: tc.existing}, func(j *J) {
				j.Project(ProjectProps{Folder: "p"}, func(j *J) {
					j.FileP(FileProps{Name: "run.sh", Mode: 0o755}, func(j *J) {
						j.Content("#!/bin/sh\nGENERATED\n")
					})
				})
			}); err != nil {
				t.Fatal(err)
			}

			fi, err := os.Stat(target)
			if err != nil {
				t.Fatal(err)
			}
			if posixModes && fi.Mode().Perm() != 0o755 {
				t.Errorf("%s: mode = %v, want 0755", tc.name, fi.Mode().Perm())
			}
		})
	}
}

// C7. An empty inject start marker used to spin the scan loop forever,
// hanging the generator. Nothing validates the markers, so a plain
// InjectP call could do it. TS advances past a zero-length match.
func TestInjectEmptyStartMarkerTerminates(t *testing.T) {
	mem := NewMemFS()
	if err := mem.WriteFile("/out/a.txt", []byte("a<<end>>b\n")); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		j := New(WithFS(mem), WithFolder("/out"), WithNow(func() int64 { return revWhen }))
		_, err := j.Generate(Options{}, func(j *J) {
			j.InjectP(InjectProps{Name: "a.txt", Markers: [2]string{"", "<<end>>"}},
				func(j *J) { j.Content("NEW") })
		})
		done <- err
	}()

	select {
	case <-done:
		// Terminating at all is the assertion.
	case <-time.After(20 * time.Second):
		t.Fatal("inject with an empty start marker did not terminate")
	}
}

// Degenerate Inject markers must behave identically in both stacks.
//
// This is the follow-up to C7. The first fix stopped the Go hang but did
// NOT make the two stacks agree — a self-check found them differing on 4
// of 5 degenerate inputs, because TS's behaviour there was regex fallout
// (an empty pair interleaved the body between every character) that no
// scan loop would ever reproduce. Both stacks now reject a half-specified
// pair and treat a fully empty one as "not supplied".
//
// The expectations here are transcribed from TS. Kept in step by
// ts/test/robustness.test.ts:inject-degenerate-markers, which asserts the
// same table.
func TestInjectDegenerateMarkers(t *testing.T) {
	const src = "A\n#--START--#\nold\n#--END--#\nB\n"

	cases := []struct {
		name    string
		markers [2]string
		set     bool
		wantErr bool
		want    string
	}{
		{name: "default", want: "A\n#--START--#\nNEW\n\n#--END--#\nB\n"},
		// A fully empty pair is indistinguishable from "not supplied", so
		// both stacks fall back to the defaults rather than to a
		// zero-width match.
		{name: "both-empty", markers: [2]string{"", ""}, set: true,
			want: "A\n#--START--#\nNEW\n\n#--END--#\nB\n"},
		{name: "empty-start", markers: [2]string{"", "#--END--#"}, set: true, wantErr: true},
		{name: "empty-end", markers: [2]string{"#--START--#", ""}, set: true, wantErr: true},
		{name: "normal", markers: [2]string{"#--START--#", "#--END--#"}, set: true,
			want: "A\n#--START--#NEW\n#--END--#\nB\n"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			mem := NewMemFS()
			if err := mem.WriteFile("/out/a.txt", []byte(src)); err != nil {
				t.Fatal(err)
			}
			props := InjectProps{Name: "a.txt"}
			if c.set {
				props.Markers = c.markers
			}

			done := make(chan error, 1)
			go func() {
				j := New(WithFS(mem), WithFolder("/out"),
					WithNow(func() int64 { return revWhen }))
				_, err := j.Generate(Options{}, func(j *J) {
					j.InjectP(props, func(j *J) { j.Content("NEW\n") })
				})
				done <- err
			}()

			var err error
			select {
			case err = <-done:
			case <-time.After(20 * time.Second):
				t.Fatal("inject did not terminate")
			}

			if c.wantErr {
				if err == nil {
					t.Fatalf("%s: want an error, got none", c.name)
				}
				if !strings.Contains(err.Error(), "both markers must be non-empty") {
					t.Errorf("%s: unexpected error %v", c.name, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			got, _ := mem.ReadFile("/out/a.txt")
			if string(got) != c.want {
				t.Errorf("%s:\n got %q\nwant %q", c.name, got, c.want)
			}
		})
	}
}

// C8. resolveFragmentFrom is NOT idempotent for a relative output folder
// other than ".": re-resolving turned "generated/frag.txt" into
// "generated/generated/frag.txt", so define-time validation passed and
// then the read failed.
func TestFragmentRelativeFromWithRelativeFolder(t *testing.T) {
	for _, folder := range []string{".", "generated", "a/b"} {
		mem := NewMemFS()
		fragpath := "frag.txt"
		if folder != "." {
			fragpath = folder + "/frag.txt"
		}
		if err := mem.WriteFile(fragpath, []byte("HELLO\n")); err != nil {
			t.Fatal(err)
		}

		j := New(WithFS(mem), WithFolder(folder), WithNow(func() int64 { return revWhen }))
		_, err := j.Generate(Options{}, func(j *J) {
			j.File("out.txt", func(j *J) {
				j.Content("BEGIN\n")
				j.FragmentP(FragmentProps{From: "frag.txt"}, nil)
				j.Content("END\n")
			})
		})
		if err != nil {
			t.Fatalf("folder=%q: %v", folder, err)
		}

		outpath := "out.txt"
		if folder != "." {
			outpath = folder + "/out.txt"
		}
		body, err := mem.ReadFile(outpath)
		if err != nil {
			t.Fatalf("folder=%q: %v", folder, err)
		}
		if !strings.Contains(string(body), "HELLO") {
			t.Errorf("folder=%q: fragment not included: %q", folder, body)
		}
	}
}

// R10. The folder prefix must match on a PATH BOUNDARY.
//
// TrimPrefix(p, ".") ate the leading dot of `.env`, producing the same
// relative key as a sibling `env` — the collision the previous fix existed
// to prevent, reintroduced one case narrower. Mirrors
// ts/test/robustness.test.ts:default-dot-folder-keeps-leading-dots.
func TestDefaultDotFolderKeepsLeadingDots(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("."), WithNow(func() int64 { return revWhen }))

	if _, err := j.Generate(Options{}, func(j *J) {
		j.Folder("", func(j *J) {
			j.File(".env", func(j *J) { j.Content("SECRET=1\n") })
			j.File("env", func(j *J) { j.Content("PLAIN\n") })
			j.File(".gitignore", func(j *J) { j.Content("node_modules\n") })
		})
	}); err != nil {
		t.Fatal(err)
	}

	vol := mem.Vol()
	for _, tc := range [][2]string{
		{".env", "SECRET=1\n"},
		{"env", "PLAIN\n"},
		{".gitignore", "node_modules\n"},
	} {
		if got := string(vol[tc[0]]); got != tc[1] {
			t.Errorf("%s = %q, want %q", tc[0], got, tc[1])
		}
		// The merge baseline is the part that actually collided.
		dup := ".jostraca/generated/" + tc[0]
		if got := string(vol[dup]); got != tc[1] {
			t.Errorf("%s = %q, want %q", dup, got, tc[1])
		}
	}
}

// R11. Exhausting the temp-path retries must be an ERROR, never a write.
//
// The loop used to exit with `tmp` last known to EXIST and fall straight
// through to a truncating WriteFile — so the one path meant to protect an
// occupied file was the path that destroyed it.

// occupiedExcl provides exclusiveFS and always reports a collision, which
// is the path both real providers take.
type occupiedExcl struct {
	*MemFS
}

func (f *occupiedExcl) WriteFileExcl(p string, data []byte) error {
	return &os.PathError{Op: "open", Path: p, Err: fs.ErrExist}
}

// occupiedPlain deliberately does NOT embed *MemFS, so it does not inherit
// WriteFileExcl and exercises the check-then-write fallback for providers
// without the capability. Every method forwards explicitly.
type occupiedPlain struct {
	m *MemFS
}

func (f *occupiedPlain) ReadFile(p string) ([]byte, error) { return f.m.ReadFile(p) }
func (f *occupiedPlain) WriteFile(p string, d []byte) error {
	return f.m.WriteFile(p, d)
}
func (f *occupiedPlain) Exists(p string) bool {
	if strings.Contains(p, tmpSuffix) {
		return true
	}
	return f.m.Exists(p)
}
func (f *occupiedPlain) Stat(p string) (FileInfo, error)      { return f.m.Stat(p) }
func (f *occupiedPlain) MkdirAll(p string) error              { return f.m.MkdirAll(p) }
func (f *occupiedPlain) ReadDir(p string) ([]DirEntry, error) { return f.m.ReadDir(p) }
func (f *occupiedPlain) Remove(p string) error                { return f.m.Remove(p) }
func (f *occupiedPlain) Rename(a, b string) error             { return f.m.Rename(a, b) }

func TestTempPathExhaustionErrorsInsteadOfOverwriting(t *testing.T) {
	victim := "/out/p/a.txt" + tmpSuffix + "-squatter"

	for _, tc := range []struct {
		name string
		wrap func(*MemFS) FS
	}{
		{"exclusive", func(m *MemFS) FS { return &occupiedExcl{MemFS: m} }},
		{"fallback", func(m *MemFS) FS { return &occupiedPlain{m: m} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mem := NewMemFS()
			if err := mem.WriteFile(victim, []byte("NOT MINE\n")); err != nil {
				t.Fatal(err)
			}

			fh := &fileHandler{fs: tc.wrap(mem), folder: "/out"}
			err := fh.writeAtomicMode("/out/p/a.txt", []byte("GENERATED\n"), 0)
			if err == nil {
				t.Fatal("exhausting the retries must return an error, not write")
			}
			if !strings.Contains(err.Error(), "no free temp path") {
				t.Errorf("unexpected error: %v", err)
			}
			if got := string(mem.Vol()[victim]); got != "NOT MINE\n" {
				t.Errorf("bystander was damaged: %q", got)
			}
		})
	}
}

// OsFS and MemFS must both provide exclusive creation, since the atomic
// write depends on it to close the check-then-act race.
func TestProvidersImplementExclusiveCreate(t *testing.T) {
	var o FS = OsFS{}
	if _, ok := o.(exclusiveFS); !ok {
		t.Error("OsFS should implement exclusiveFS")
	}

	mem := NewMemFS()
	var m FS = mem
	if _, ok := m.(exclusiveFS); !ok {
		t.Error("MemFS should implement exclusiveFS")
	}

	if err := mem.WriteFile("/x", []byte("first")); err != nil {
		t.Fatal(err)
	}
	if err := mem.WriteFileExcl("/x", []byte("second")); err == nil {
		t.Error("WriteFileExcl must fail on an existing path")
	}
	if got := string(mem.Vol()["/x"]); got != "first" {
		t.Errorf("WriteFileExcl clobbered an existing file: %q", got)
	}
}

// R14. An explicit Mode must be applied on the unchanged path in EVERY
// existing-file configuration, not just plain write.
//
// The first fix put the chmod inside `if write { if exists && contentEqual
// }`, but the diff and merge branches clear `write` before reaching it —
// so in exactly the configurations most likely to carry a mode, an
// existing 0644 script asked for 0755 stayed non-executable forever.
// Mirrors ts/test/robustness.test.ts.
func TestFileModeAppliedWhenUnchangedInEveryMode(t *testing.T) {
	const body = "#!/bin/sh\necho hi\n"
	tr := true

	for _, tc := range []struct {
		name     string
		existing Existing
	}{
		{"write", Existing{}},
		{"diff", Existing{Txt: ExistingTxt{Diff: &tr}}},
		{"merge", Existing{Txt: ExistingTxt{Merge: &tr}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			target := filepath.Join(dir, "p", "run.sh")
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(target, []byte(body), 0o644); err != nil {
				t.Fatal(err)
			}
			// merge needs a baseline to take its equal-content path.
			dup := filepath.Join(dir, ".jostraca", "generated", "p", "run.sh")
			if err := os.MkdirAll(filepath.Dir(dup), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(dup, []byte(body), 0o644); err != nil {
				t.Fatal(err)
			}

			j := revJ(t, fwd(dir))
			if _, err := j.Generate(Options{Existing: tc.existing}, func(j *J) {
				j.Project(ProjectProps{Folder: "p"}, func(j *J) {
					j.FileP(FileProps{Name: "run.sh", Mode: 0o755}, func(j *J) {
						j.Content(body)
					})
				})
			}); err != nil {
				t.Fatal(err)
			}

			if got, _ := os.ReadFile(target); string(got) != body {
				t.Errorf("%s: content = %q", tc.name, got)
			}
			fi, err := os.Stat(target)
			if err != nil {
				t.Fatal(err)
			}
			if posixModes && fi.Mode().Perm() != 0o755 {
				t.Errorf("%s: mode = %v, want 0755", tc.name, fi.Mode().Perm())
			}
		})
	}
}

// S1. A temp file created by an atomic write must not survive a write
// failure. O_EXCL/WriteFile creates before writing, so a mid-write error
// (ENOSPC) leaves a partial file that only this call knows the path of —
// writeAtomicMode returns before `tmp` is assigned, so its own cleanup
// cannot reach it.
type midWriteFailFS struct {
	*MemFS
	err error
}

func (f *midWriteFailFS) WriteFileExcl(p string, data []byte) error {
	// Mimic O_EXCL succeeding and the write then failing: create, then fail.
	if err := f.MemFS.WriteFileExcl(p, data); err != nil {
		return err
	}
	return f.err
}

func TestAtomicWriteLeavesNoTempAfterWriteFailure(t *testing.T) {
	mem := NewMemFS()
	fh := &fileHandler{
		fs:              &midWriteFailFS{MemFS: mem, err: errDiskFull},
		folder:          "/out",
		duplicateFolder: "/out/.jostraca/generated",
		createdDirs:     map[string]struct{}{},
	}

	err := fh.writeAtomicMode("/out/p/a.txt", []byte("GENERATED\n"), 0)
	if err == nil {
		t.Fatal("expected the write failure to surface")
	}
	for k := range mem.Vol() {
		if strings.Contains(k, tmpSuffix) {
			t.Errorf("temp file survived a failed write: %s", k)
		}
	}
}

// S2. `relative` is not the same as `inside`. With the default folder, a
// `..` segment walks OUT, and withinFolder returning true for it let the
// merge baseline normalize to a path outside .jostraca/generated and
// overwrite whatever was there.
func TestParentRelativePathIsNotWithinFolder(t *testing.T) {
	fh := &fileHandler{folder: ".", duplicateFolder: "./.jostraca/generated"}

	// This table is asserted identically in
	// ts/test/robustness.test.ts:within-folder-boundary-table. Found by a
	// differential probe: a backslash form used to differ, because Go's
	// path.Clean is slash-only while TS folds backslashes unconditionally
	// — and on Windows that is a real parent reference, so Go was the one
	// with a live escape.
	outside := []string{
		"..", "../x.txt", "../../victim/app.txt", "a/../../b.txt",
		"./..", `..\x`, `..\..\x`,
	}
	for _, in := range outside {
		if fh.withinFolder(in) {
			t.Errorf("withinFolder(%q) = true, want false", in)
		}
	}

	inside := []string{
		"a.txt", ".env", "sub/a.txt", "./a.txt", "a/../b.txt",
		"...", "..foo", "foo..", ".", "", `a\..\b`,
	}
	for _, in := range inside {
		if !fh.withinFolder(in) {
			t.Errorf("withinFolder(%q) = false, want true", in)
		}
	}
}

// And the baseline write itself refuses to escape, independently of the
// containment check above.
func TestWriteDuplicateRefusesToEscapeItsRoot(t *testing.T) {
	mem := NewMemFS()
	fh := &fileHandler{
		fs:              mem,
		folder:          ".",
		duplicateFolder: "./.jostraca/generated",
		control:         Control{},
		createdDirs:     map[string]struct{}{},
	}

	if err := fh.writeDuplicate("../../victim.txt", []byte("CLOBBERED\n")); err != nil {
		t.Fatal(err)
	}
	for k := range mem.Vol() {
		if !strings.HasPrefix(k, ".jostraca/generated/") {
			t.Errorf("baseline escaped its root: %s", k)
		}
	}

	// A normal path still lands where it should.
	if err := fh.writeDuplicate("a.txt", []byte("OK\n")); err != nil {
		t.Fatal(err)
	}
	if got := string(mem.Vol()[".jostraca/generated/a.txt"]); got != "OK\n" {
		t.Errorf("normal baseline = %q, want %q", got, "OK\n")
	}
}

// S3. The temp-path retry budget must be identical in both stacks, or an
// identical collision schedule succeeds in one and fails in the other.
func TestTempPathAttemptsMatchesTS(t *testing.T) {
	// Mirrors TMP_PATH_ATTEMPTS in ts/src/build/FileHandler.ts. If you
	// change one, change both — the constant is the contract.
	if tmpPathAttempts != 9 {
		t.Errorf("tmpPathAttempts = %d, want 9 to match TS", tmpPathAttempts)
	}
}

// S4. Exclusive create must treat a directory as an occupied name, the way
// O_EXCL and OsFS do. Checking only m.files let a file be stored under a
// key m.dirs also held, which Stat then reported as a regular file.
func TestMemFSExclusiveCreateRefusesDirectory(t *testing.T) {
	mem := NewMemFS()
	if err := mem.MkdirAll("/out/adir"); err != nil {
		t.Fatal(err)
	}
	if err := mem.WriteFileExcl("/out/adir", []byte("X")); err == nil {
		t.Error("WriteFileExcl must fail on a path occupied by a directory")
	}
	fi, err := mem.Stat("/out/adir")
	if err != nil {
		t.Fatal(err)
	}
	if !fi.IsDir {
		t.Error("the directory was replaced by a synthetic file")
	}
}

// U5. Copy `exclude` entries must match the SOURCE-RELATIVE PATH, as TS
// does, not the bare basename. `sub/a.txt` was silently ineffective in Go,
// and `a.txt` excluded every same-named file at any depth here while
// excluding only the root one in TS.
func TestCopyExcludeMatchesRelativePath(t *testing.T) {
	for _, tc := range []struct {
		exclude any
		want    []string
	}{
		{[]any{"sub/a.txt"}, []string{"/out/p/lib/a.txt"}},
		{[]any{"a.txt"}, []string{"/out/p/lib/sub/a.txt"}},
	} {
		mem := NewMemFS()
		if err := mem.WriteFile("/src/a.txt", []byte("ROOT\n")); err != nil {
			t.Fatal(err)
		}
		if err := mem.WriteFile("/src/sub/a.txt", []byte("NESTED\n")); err != nil {
			t.Fatal(err)
		}

		j := New(WithFS(mem), WithFolder("/out"),
			WithNow(func() int64 { return revWhen }))
		if _, err := j.Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{Folder: "p"}, func(j *J) {
				j.Copy(CopyProps{From: "/src", To: "lib", Exclude: tc.exclude})
			})
		}); err != nil {
			t.Fatal(err)
		}

		var got []string
		for k := range mem.Vol() {
			if strings.HasPrefix(k, "/out/p/lib") {
				got = append(got, k)
			}
		}
		sort.Strings(got)
		if strings.Join(got, ",") != strings.Join(tc.want, ",") {
			t.Errorf("exclude=%v: got %v, want %v", tc.exclude, got, tc.want)
		}
	}
}

// U3. A content-sniffed binary must be governed by existing.bin, not
// existing.txt. save re-derived the classification from the extension and
// lost the sniff, so with txt.diff on, a diff render wrote textual conflict
// markers into binary data.
func TestSniffedBinaryUsesBinaryModes(t *testing.T) {
	binary := []byte{0x00, 0xff, 0x02, 0x00}
	tr := true

	mem := NewMemFS()
	if err := mem.WriteFile("/src/data.txt", binary); err != nil {
		t.Fatal(err)
	}
	if err := mem.WriteFile("/out/p/data.txt", []byte{0x00, 0xfe, 0x03}); err != nil {
		t.Fatal(err)
	}

	j := New(WithFS(mem), WithFolder("/out"),
		WithNow(func() int64 { return revWhen }))
	if _, err := j.Generate(Options{
		// txt.diff would write conflict markers; bin.write must win.
		Existing: Existing{
			Txt: ExistingTxt{Diff: &tr},
			Bin: ExistingBin{Write: &tr},
		},
	}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.Copy(CopyProps{From: "/src/data.txt", To: "data.txt"})
		})
	}); err != nil {
		t.Fatal(err)
	}

	got := mem.Vol()["/out/p/data.txt"]
	if strings.Contains(string(got), ">>>>>>>") ||
		strings.Contains(string(got), "<<<<<<<") {
		t.Errorf("conflict markers written into binary data: %q", got)
	}
	if string(got) != string(binary) {
		t.Errorf("binary content = % x, want % x", got, binary)
	}
}

// Nesting must not change what a Copy `exclude` means. TS used to prefix
// the exclude base with the enclosing Folder chain — an artifact of which
// prop each component happens to use — so the same option needed a
// different spelling depending on where the Copy sat. Both stacks are now
// source-relative. Mirrors
// ts/test/robustness.test.ts:copy-exclude-is-source-relative-at-any-nesting.
func TestCopyExcludeIsSourceRelativeWhenNested(t *testing.T) {
	for _, tc := range []struct {
		exclude any
		want    []string
	}{
		{[]any{"sub/a.txt"}, []string{"a.txt"}},
		{[]any{"a.txt"}, []string{"sub/a.txt"}},
	} {
		mem := NewMemFS()
		if err := mem.WriteFile("/src/a.txt", []byte("ROOT\n")); err != nil {
			t.Fatal(err)
		}
		if err := mem.WriteFile("/src/sub/a.txt", []byte("NESTED\n")); err != nil {
			t.Fatal(err)
		}

		j := New(WithFS(mem), WithFolder("/out"),
			WithNow(func() int64 { return revWhen }))
		if _, err := j.Generate(Options{}, func(j *J) {
			j.Project(ProjectProps{Folder: "p"}, func(j *J) {
				j.Folder("outer", func(j *J) {
					j.Copy(CopyProps{From: "/src", To: "lib", Exclude: tc.exclude})
				})
			})
		}); err != nil {
			t.Fatal(err)
		}

		const base = "/out/p/outer/lib/"
		var got []string
		for k := range mem.Vol() {
			if strings.HasPrefix(k, base) {
				got = append(got, strings.TrimPrefix(k, base))
			}
		}
		sort.Strings(got)
		if strings.Join(got, ",") != strings.Join(tc.want, ",") {
			t.Errorf("nested exclude=%v: got %v, want %v", tc.exclude, got, tc.want)
		}
	}
}

// A conflict written under a CUSTOM label must be recognised on the next
// run — but the check must match the COMPLETE marker, or the label is
// treated as a prefix and an ordinary line like ">>>>>>> Example"
// suppresses a legitimate regeneration.
func TestUnresolvedDetectionWithCustomLabels(t *testing.T) {
	spec := DiffSpec{Labels: &DiffLabels{Generated: "G", Existing: "E"}}

	first := Merge("NEW\n", "OLD\n", "USER\n", spec)
	if !first.Conflict {
		t.Fatal("expected a conflict to set up the test")
	}
	again := Merge("NEWER\n", "OLD\n", first.Content, spec)
	if again.Outcome != MergeUnresolved {
		t.Errorf("re-merge outcome = %q, want unresolved", again.Outcome)
	}

	innocent := Merge("NEW\n", "OLD\n", "a\n>>>>>>> Example\nb\n", spec)
	if innocent.Outcome == MergeUnresolved {
		t.Errorf("a label PREFIX match suppressed regeneration: %q", innocent.Content)
	}

	// The default sentinel still matches whatever timestamp follows.
	dflt := Merge("NEW\n", "OLD\n", "a\n>>>>>>> EXISTING: T/merge\n", DiffSpec{})
	if dflt.Outcome != MergeUnresolved {
		t.Errorf("default sentinel outcome = %q, want unresolved", dflt.Outcome)
	}
}

// Issue #21. Bare top-level components with no Project or Folder wrapper:
// st.root used to be seeded with the FIRST node attached, so every sibling
// after it was orphaned and silently dropped — Generate returned no error
// and the later files simply were not there.
func TestTopLevelSiblingsAllBuilt(t *testing.T) {
	mfs := NewMemFS()
	j := revJ(t, "/top", WithFS(mfs))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.File("a.txt", func(j *J) { j.Content("AAA") })
		j.File("b.txt", func(j *J) { j.Content("BBB") })
		j.Folder("sub", func(j *J) {
			j.File("c.txt", func(j *J) { j.Content("CCC") })
		})
	}); err != nil {
		t.Fatal(err)
	}

	vol := mfs.Vol()
	for path, want := range map[string]string{
		"/top/a.txt":     "AAA",
		"/top/b.txt":     "BBB",
		"/top/sub/c.txt": "CCC",
	} {
		got, ok := vol[path]
		if !ok {
			t.Fatalf("%s missing", path)
		}
		if string(got) != want {
			t.Errorf("%s = %q, want %q", path, got, want)
		}
	}
}
