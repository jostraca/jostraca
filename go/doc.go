// Package jostraca is a code- and project-generator framework. Compose
// file trees with components — Project, Folder, File, Content, Fragment,
// Slot, Inject, Copy, List — and the build phase walks the tree to
// produce output on a configurable filesystem.
//
// # Quick start
//
//	j := jostraca.New(jostraca.WithFolder("./out"))
//	_, err := j.Generate(jostraca.Options{}, func(j *jostraca.J) {
//	    j.Project(jostraca.ProjectProps{Folder: "my-app"}, func(j *jostraca.J) {
//	        j.File("hello.txt", func(j *jostraca.J) {
//	            j.Content("Hello, world!\n")
//	        })
//	    })
//	})
//
// # Receiver-shadowing closures
//
// User code never sees an explicit context value. Each callback
// receives a fresh *J that shadows the outer one and is bound to the
// current node frame. This replaces the TypeScript original's
// AsyncLocalStorage pattern with idiomatic Go closures, isolates
// concurrent Generate calls by construction, and keeps the call sites
// nearly as terse as the JS form. See PORT_PLAN.md §2 for the rationale.
//
// # Existing-file modes
//
// Five modes control how generation interacts with files that already
// exist: Write (overwrite), Preserve (back up to .old.<ext>), Present
// (side-write .new.<ext>), Diff (2-way conflict-marker render), and
// Merge (3-way merge using the duplicate baseline at .jostraca/generated/).
// Files containing the literal string "JOSTRACA_PROTECT" are never
// overwritten.
//
// # Concurrency
//
// Each Generate call constructs its own *J/*jstate. The package
// exports zero mutable globals. Two goroutines calling Generate
// simultaneously cannot collide; this is verified by the
// concurrency_test.go regression that runs 10 goroutines under -race.
package jostraca
