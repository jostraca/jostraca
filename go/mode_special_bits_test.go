package jostraca

import (
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// chmodUnchanged decides whether a byte-identical rewrite still needs a chmod.
// It compared fi.Mode.Perm() against mode.Perm() -- 9 bits -- while os.Chmod
// also honours setuid, setgid and sticky. A file whose content did not change
// and whose mode went from 0755 to 0755|ModeSetuid therefore compared equal and
// never received the bit. See docs/design/PARITY_PLAN.md 3.
//
// Worth recording what this is NOT. The parity audit reported that Go "silently
// discards setuid" because FileProps{Mode: 0o4755} lands as 755 on disk. That
// is true but it is not a defect: Go's fs.FileMode keeps setuid at bit 23
// (fs.ModeSetuid), not at the POSIX octal 0o4000, so 0o4755 simply is not
// setuid in Go's encoding. Written the idiomatic way -- 0o755|fs.ModeSetuid --
// it works, and TestModeSetuidIsApplied below proves it. The API shape differs
// from the TS octal spelling; the behaviour does not.

// Windows has no Unix permission bits. Go's os.Chmod there toggles only the
// read-only attribute, and every file stats as 0666 whatever was requested --
// so these tests are meaningless rather than failing for a real reason. The
// behaviour under test (which bits take part in the "has the mode changed?"
// comparison) is POSIX-only. Same seam as platform_test.go's runtime.GOOS
// check.
func skipIfNoUnixModes(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("permission bits are not modelled on Windows; os.Chmod sets only read-only")
	}
}

func modeGen(t *testing.T, dir string, mode fs.FileMode, content string) {
	t.Helper()
	j := New(WithFolder(fwd(dir)), WithNow(func() int64 { return 1735689600000 }))
	if _, err := j.Generate(Options{}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			j.FileP(FileProps{Name: "s.sh", Mode: mode}, func(j *J) { j.Content(content) })
		})
	}); err != nil {
		t.Fatal(err)
	}
}

func modeOf(t *testing.T, dir string) fs.FileMode {
	t.Helper()
	fi, err := os.Stat(filepath.Join(dir, "p", "s.sh"))
	if err != nil {
		t.Fatal(err)
	}
	return fi.Mode()
}

// The regression: content identical, only the special bit added.
func TestModeSpecialBitAppliedOnUnchangedContent(t *testing.T) {
	skipIfNoUnixModes(t)
	dir := t.TempDir()

	modeGen(t, dir, fs.FileMode(0o755), "SAME\n")
	if got := modeOf(t, dir); got&os.ModeSetuid != 0 {
		t.Fatalf("setup: did not expect setuid yet, got %v", got)
	}

	// Same bytes, so the write short-circuits; only the mode differs.
	modeGen(t, dir, fs.FileMode(0o755)|fs.ModeSetuid, "SAME\n")

	got := modeOf(t, dir)
	if got&os.ModeSetuid == 0 {
		t.Errorf("setuid was not applied to a byte-identical rewrite: got %v; "+
			"the mode comparison is narrower than the bits chmod can set", got)
	}
	if got.Perm() != 0o755 {
		t.Errorf("permission bits changed unexpectedly: got %o, want 755", got.Perm())
	}
}

// setuid is expressible, on a fresh write, in Go's own encoding.
func TestModeSetuidIsApplied(t *testing.T) {
	skipIfNoUnixModes(t)
	dir := t.TempDir()
	modeGen(t, dir, fs.FileMode(0o755)|fs.ModeSetuid, "NEW\n")

	got := modeOf(t, dir)
	if got&os.ModeSetuid == 0 {
		t.Errorf("setuid not applied on a fresh write: got %v", got)
	}
}

// sticky and setgid travel the same path, so pin one of them too.
func TestModeStickyBitApplied(t *testing.T) {
	skipIfNoUnixModes(t)
	dir := t.TempDir()

	modeGen(t, dir, fs.FileMode(0o755), "SAME\n")
	modeGen(t, dir, fs.FileMode(0o755)|fs.ModeSticky, "SAME\n")

	if got := modeOf(t, dir); got&os.ModeSticky == 0 {
		t.Errorf("sticky was not applied to a byte-identical rewrite: got %v", got)
	}
}

// The ordinary case still short-circuits: nothing changed, so nothing happens.
func TestModeUnchangedStaysUnchanged(t *testing.T) {
	skipIfNoUnixModes(t)
	dir := t.TempDir()

	modeGen(t, dir, fs.FileMode(0o750), "SAME\n")
	modeGen(t, dir, fs.FileMode(0o750), "SAME\n")

	got := modeOf(t, dir)
	if got.Perm() != 0o750 {
		t.Errorf("got %o, want 750", got.Perm())
	}
	if got&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		t.Errorf("unexpected special bits: %v", got)
	}
}
