package jostraca

import "runtime"

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
