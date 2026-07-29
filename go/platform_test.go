package jostraca

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"testing"
)

// posixModes reports whether POSIX permission bits mean anything on this
// platform.
//
// They do not on Windows: os.Chmod there only toggles the read-only
// attribute, and FileInfo.Mode().Perm() always reports 0o666 (or 0o444
// when read-only). A file created with Mode 0o755 comes back as 0o666,
// and nothing is wrong — there is no execute bit to set.
//
// So the mode ASSERTIONS are skipped on Windows, not the tests. Everything
// around them — the content written, the atomic rename completing, no temp
// file left behind — is platform-independent and still checked. Guard the
// narrowest thing that is actually untestable.
//
// The Go CI job runs on Linux only, so none of this is currently exercised
// by a red build; it is here because `GOOS=windows go vet` is, and a test
// that cannot pass on a platform the project targets should say so rather
// than wait to be discovered. Its TypeScript counterpart is POSIX_MODES in
// ts/test/expect.ts, which Windows CI found the hard way.
var posixModes = runtime.GOOS != "windows"

// absBoundaryCases is the isAbsFromPath boundary, for BOTH platforms.
//
// isAbsFromPath mirrors node's Path.isAbsolute, which is platform
// dispatched. Every expectation here was taken from node itself rather
// than reasoned about:
//
//	node -e "const P=require('path');
//	         console.log(P.posix.isAbsolute(s), P.win32.isAbsolute(s))"
//
// ts/test/platform.test.ts pins the identical table against node's own
// posix and win32 implementations, so the two sides cannot drift: if node
// disagrees with the table the TS test fails, and if the Go mirror
// disagrees this one does.
var absBoundaryCases = []struct {
	path  string
	posix bool
	win   bool
}{
	{"", false, false},
	{"/x", true, true},
	{"\\x", false, true},
	{"C:/x", false, true},
	{"c:\\x", false, true},
	{"C:x", false, false}, // drive-RELATIVE, not absolute
	{"C:", false, false},  // too short to be drive-absolute
	{"C:/", false, true},  // bare drive root IS absolute
	{"x", false, false},
	{"./x", false, false},
	{"../x", false, false},
	{"//server/s", true, true},
	{"\\\\server\\s", false, true}, // UNC
	{"1:/x", false, false},         // digit is not a drive letter
	{":/x", false, false},          // empty drive letter
}

// TestIsAbsFromPathBoundary asserts the helper on both platforms from
// whichever host happens to be running.
//
// This exists because the helper's Windows branch is unreachable on the
// Linux CI that runs the Go suite — and that is not a hypothetical concern.
// isAbsFromPath was added to fix the Fragment case (U2) and then left off
// its two sibling call sites, projectBefore and withinFolder, for a full
// review round, because no test could fail. Adding windows-latest to the
// matrix does not close that hole either: no test or corpus case uses a
// drive-letter folder, so only a table like this one can.
func TestIsAbsFromPathBoundary(t *testing.T) {
	for _, c := range absBoundaryCases {
		if got := isAbsFromPathOn(c.path, false); got != c.posix {
			t.Errorf("isAbsFromPathOn(%q, posix) = %v, want %v", c.path, got, c.posix)
		}
		if got := isAbsFromPathOn(c.path, true); got != c.win {
			t.Errorf("isAbsFromPathOn(%q, windows) = %v, want %v", c.path, got, c.win)
		}
	}
}

// TestIsAbsFromPathDispatch checks the runtime.GOOS wrapper agrees with the
// seam for the platform actually running, so the seam cannot be correct
// while the real entry point is wired to the wrong leg.
func TestIsAbsFromPathDispatch(t *testing.T) {
	windows := runtime.GOOS == "windows"
	for _, c := range absBoundaryCases {
		want := c.posix
		if windows {
			want = c.win
		}
		if got := isAbsFromPath(c.path); got != want {
			t.Errorf("isAbsFromPath(%q) on %s = %v, want %v",
				c.path, runtime.GOOS, got, want)
		}
	}
}

// TestSlashOnlyAbsPathStaysContained guards the one legitimate use of the
// slash-only isAbsPath against the recurring mistake of reaching for it
// where node's platform-dispatched Path.isAbsolute is what TS uses.
//
// Every other absolute-path decision must go through isAbsFromPath. That
// invariant cannot be checked by behaviour on Linux, because the two
// helpers are identical there — which is exactly why isAbsFromPath was
// added for the Fragment case and then left off projectBefore and
// withinFolder for a full review round with a green suite. So it is
// checked structurally instead.
//
// The single permitted call is withinFolder's `case "/"` branch, because
// TS's matching branch (ts/src/build/FileHandler.ts) is a literal
// startsWith('/'), not Path.isAbsolute. If you are adding a use, the
// question to answer first is which of the two TS spellings the code you
// are mirroring actually uses.
func TestSlashOnlyAbsPathStaysContained(t *testing.T) {
	const permitted = "filehandler.go"

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}

	var calls []string
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		for i, line := range strings.Split(string(src), "\n") {
			trimmed := strings.TrimSpace(line)
			// Skip the declaration itself and comment prose about it.
			if strings.HasPrefix(trimmed, "func isAbsPath(") ||
				strings.HasPrefix(trimmed, "//") {
				continue
			}
			if strings.Contains(line, "isAbsPath(") &&
				!strings.Contains(line, "isAbsFromPath(") {
				calls = append(calls, fmt.Sprintf("%s:%d: %s", name, i+1, trimmed))
			}
		}
	}

	if len(calls) != 1 {
		t.Fatalf("expected exactly 1 isAbsPath call site, found %d:\n%s",
			len(calls), strings.Join(calls, "\n"))
	}
	if !strings.HasPrefix(calls[0], permitted+":") {
		t.Errorf("isAbsPath called outside %s: %s", permitted, calls[0])
	}
}
