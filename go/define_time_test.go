package jostraca

import (
	"os"
	"path/filepath"
	"testing"
)

// A Fragment or CopyFiles `from` that does not exist is refused in the
// DEFINE phase, against the filesystem the run will use, whether that
// filesystem was supplied or defaulted. Nothing is written: no earlier
// sibling file, no folder, no .jostraca baseline.
//
// Every other define-time test supplies WithFS(NewMemFS()), which is why
// the defaulted filesystem was never covered: with no FS option the check
// was skipped, the build wrote ok.txt and the .jostraca folder, and only
// then failed on the read. A REAL FILESYSTEM, because the default is the
// point.

func defineTimeGen(t *testing.T, body func(j *J)) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "out")
	_, err := New(WithNow(func() int64 { return 1735689600000 })).
		Generate(Options{Folder: fwd(out)}, func(j *J) {
			j.Project(ProjectProps{}, func(j *J) {
				j.File("ok.txt", func(j *J) { j.Content("OK") })
				body(j)
			})
		})
	if err == nil {
		t.Fatal("a missing from must be refused")
	}
	return out
}

func assertNothingWritten(t *testing.T, out string) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(out, "ok.txt")); !os.IsNotExist(err) {
		t.Errorf("ok.txt was written before the refusal: %v", err)
	}
	if _, err := os.Stat(filepath.Join(out, ".jostraca")); !os.IsNotExist(err) {
		t.Errorf(".jostraca was written before the refusal: %v", err)
	}
	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Errorf("the output folder was created: %v", err)
	}
}

func TestFragmentMissingFromDefaultFSWritesNothing(t *testing.T) {
	out := defineTimeGen(t, func(j *J) {
		j.File("b.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "nope.txt"}, nil)
		})
	})
	assertNothingWritten(t, out)
}

func TestCopyMissingFromDefaultFSWritesNothing(t *testing.T) {
	out := defineTimeGen(t, func(j *J) {
		j.CopyFiles(CopyFilesProps{From: "/nonexistent-jostraca-define-time/x.txt"})
	})
	assertNothingWritten(t, out)
}
