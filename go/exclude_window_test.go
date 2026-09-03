package jostraca

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Options.Exclude skips output files the USER has modified since the last
// successful build. It compares each file's mtime against meta `last`.
//
// Go used to stamp `last` when buildMeta was CONSTRUCTED, before a single file
// was written, so every file this build generated ended up with an mtime later
// than `last` -- and the next run skipped them as though the user had edited
// them. `exclude: true` therefore meant "stop regenerating anything after the
// first build", the exact inverse of its purpose. TS stamps at the end of the
// build (ts/src/build/BuildMeta.ts done()) and was correct. See
// docs/design/PARITY_PLAN.md 1.2.
//
// This has to run against a real filesystem with a real clock: MemFS stamps
// mtimes from wall-clock time (fs.go) while `last` comes from Options.Now, so
// on an in-memory volume the two are not comparable. That mismatch is why no
// existing snapshot could catch this -- every one of them freezes the clock.

// excludeFileCount is deliberately large. The defect is an ORDERING one, and a
// single-file build finishes inside one millisecond, so the construction stamp
// and the file's mtime land on the same value and `mtime > last` is false
// either way. Enough files to span a few milliseconds makes the ordering
// observable -- which is also why the audit that found this used 400.
const excludeFileCount = 300

func excludeGen(t *testing.T, dir, content string, exclude bool) {
	t.Helper()
	j := New(
		WithFolder(fwd(dir)),
		WithNow(func() int64 { return time.Now().UnixMilli() }),
	)
	if _, err := j.Generate(Options{Exclude: exclude}, func(j *J) {
		j.Project(ProjectProps{Folder: "p"}, func(j *J) {
			for i := 0; i < excludeFileCount; i++ {
				j.File(fmt.Sprintf("f%03d.txt", i), func(j *J) { j.Content(content) })
			}
			j.File("a.txt", func(j *J) { j.Content(content) })
		})
	}); err != nil {
		t.Fatal(err)
	}
}

// metaLast reads the persisted `last` stamp out of the meta log.
func metaLast(t *testing.T, dir string) int64 {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, ".jostraca", "jostraca.meta.log"))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	v, ok := m["last"].(float64)
	if !ok {
		t.Fatalf("meta log has no numeric last: %v", m["last"])
	}
	return int64(v)
}

// The invariant, asserted directly rather than through a second build: every
// file this run generated must be NO NEWER than the `last` it records. Break
// that and the Exclude window mistakes the generator's own output for user
// edits. This does not depend on how long the build happens to take.
func TestMetaLastIsStampedAfterGeneratedFiles(t *testing.T) {
	dir := t.TempDir()
	excludeGen(t, dir, "V1\n", false)

	last := metaLast(t, dir)

	newest := int64(-1)
	newestName := ""
	entries, err := os.ReadDir(filepath.Join(dir, "p"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		fi, err := e.Info()
		if err != nil {
			t.Fatal(err)
		}
		if ms := fi.ModTime().UnixMilli(); ms > newest {
			newest = ms
			newestName = e.Name()
		}
	}

	if newest > last {
		t.Errorf("meta last (%d) is older than generated file %s (%d) by %dms: "+
			"the stamp is being taken before the build writes, so Exclude will "+
			"skip this run's own output", last, newestName, newest, newest-last)
	}
}

func excludeRead(t *testing.T, dir string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, "p", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// The regression: a file this generator wrote itself must NOT be treated as a
// user edit on the next run.
func TestExcludeDoesNotSkipOwnOutput(t *testing.T) {
	dir := t.TempDir()

	excludeGen(t, dir, "V1\n", false)
	if got := excludeRead(t, dir); got != "V1\n" {
		t.Fatalf("first build: got %q, want %q", got, "V1\n")
	}

	// Enough separation that mtime and `last` cannot collide in the same
	// millisecond and mask the ordering.
	time.Sleep(20 * time.Millisecond)

	excludeGen(t, dir, "V2\n", true)

	if got := excludeRead(t, dir); got != "V2\n" {
		t.Errorf("exclude:true skipped a file the generator wrote itself: "+
			"got %q, want %q -- meta `last` is being stamped before the "+
			"generated files rather than after", got, "V2\n")
	}
}

// The other half: a genuine user edit after the build MUST still be respected,
// or the fix above would have simply disabled the feature.
func TestExcludeSkipsUserEdit(t *testing.T) {
	dir := t.TempDir()

	excludeGen(t, dir, "V1\n", false)

	time.Sleep(20 * time.Millisecond)

	// Stand in for the user editing the generated file.
	target := filepath.Join(dir, "p", "a.txt")
	if err := os.WriteFile(target, []byte("USER EDIT\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	time.Sleep(20 * time.Millisecond)

	excludeGen(t, dir, "V2\n", true)

	if got := excludeRead(t, dir); got != "USER EDIT\n" {
		t.Errorf("exclude:true overwrote a user edit: got %q, want %q",
			got, "USER EDIT\n")
	}
}

// Without exclude, a user edit is overwritten as usual -- proving the two tests
// above are measuring the exclude window and not some unrelated skip.
func TestWithoutExcludeUserEditIsOverwritten(t *testing.T) {
	dir := t.TempDir()

	excludeGen(t, dir, "V1\n", false)

	time.Sleep(20 * time.Millisecond)

	target := filepath.Join(dir, "p", "a.txt")
	if err := os.WriteFile(target, []byte("USER EDIT\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	time.Sleep(20 * time.Millisecond)

	excludeGen(t, dir, "V2\n", false)

	if got := excludeRead(t, dir); got != "V2\n" {
		t.Errorf("without exclude the edit should be overwritten: got %q, want %q",
			got, "V2\n")
	}
}
