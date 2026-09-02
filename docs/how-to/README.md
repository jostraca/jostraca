# How-to guides

One task per guide. Each assumes you know the basics (the
[tutorial](../tutorial.md) teaches those), solves one job, and links the
reference for depth. Every example is executed by
`ts/test/docs.test.ts` in a temp directory, and the listing under it is
the tree the generator actually wrote.

<!-- Generated from the guides' own frontmatter. Order follows each
     guide's `order` field, and the groups are the six that
     ts/test/docs.test.ts enforces on that frontmatter. -->

## Compose the output tree

Declaring folders, files, and the content that goes inside them.

- [Write a file tree](write-a-file-tree.md). Declare folders and files with nested components, and know which props move the output path.
- [Insert values from your model](insert-model-values.md). Substitute values from the data model into file content with the double-dollar syntax.
- [Repeat content inside one file](repeat-content-in-one-file.md). Emit one block of content per array item inside a single file, with List.

## Templates and fragments

Filling files from a data model, and from template files on disk.

- [Fill a template file's slots](fill-a-template-slot.md). Read a template file with Fragment and fill its marked regions with Slot.
- [Extract part of a template](extract-part-of-a-template.md). Use eject to take one marked region out of a larger template file.
- [Replace markers in a template](replace-markers-in-a-template.md). Swap named placeholders in a template for strings, computed values or generated components.
- [Indent generated content](indent-generated-content.md). Indent a block of generated content to match the code around it.

## Reusable components

Factoring a generator into pieces you call more than once.

- [Make a reusable component](make-a-reusable-component.md). Wrap a function with cmp so it can be called anywhere in a component tree.
- [Pass data to child components](pass-data-to-children.md). Give a custom component a body, and call that body once per item with data.
- [Branch and loop in a generator](branch-and-loop.md). Use ordinary JavaScript control flow to decide what a generator emits.

## Regenerating over existing files

Running the generator again over code a person has edited.

- [Keep a backup when overwriting](keep-a-backup-when-overwriting.md). Turn on preserve so the bytes you are about to overwrite are kept in a sibling file.
- [Offer a new version instead of overwriting](offer-a-new-version.md). Leave the existing file untouched and write the new version beside it with present.
- [Merge your changes with the user's](merge-generator-and-user-edits.md). Three-way merge the new generate with hand edits, using the previous run as the base.
- [Show a diff instead of writing](show-a-diff-instead-of-writing.md). Rewrite the target as an annotated two-way diff so a reviewer can see both versions.
- [Let a user take a file over](let-a-user-take-a-file-over.md). Mark a generated file with JOSTRACA_PROTECT so no later run overwrites it.
- [Preview a run without writing](preview-a-run.md). Run the whole generator with control.dryrun so it reports what it would do and writes nothing.

## Files, copying and permissions

Getting existing assets into the output, and setting how they land.

- [Copy a directory into the output](copy-a-directory.md). Bring an existing file or directory tree into the output, templating text on the way.
- [Skip files when copying](skip-files-when-copying.md). Keep editor backups, caches and named paths out of a copied tree.
- [Make a generated script executable](set-file-permissions.md). Give a generated script its execute bit with the File mode prop.
- [Edit a file you did not generate](edit-a-file-you-did-not-generate.md). Use Inject to replace the region between two markers in a file that already exists.

## Embedding Jostraca

Driving the generator from your own tool, in memory, or on disk.

- [Generate in memory](generate-in-memory.md). Run a generator on a virtual filesystem with mem, and read the result back from the volume.
- [Report what a run did](report-what-a-run-did.md). Read the result arrays and the audit trail to tell a user what a generate changed.
- [Test a generator](test-a-generator.md). Assert on a generator's output without a temp directory, using in-memory generation.
- [Call Jostraca from Go](call-jostraca-from-go.md). Drive the Go port from your own program, and know where its surface differs.

If none of these is your task, the
[component reference](../reference-components.md) and the
[options reference](../reference-options.md) list every surface, and
the [explanation](../explanation.md) argues why the design is what it
is.
