package jostraca

import (
	"fmt"
	"path"
	"regexp"
	"runtime"
	"strings"
	"unicode/utf8"
)

// op is one entry in the dispatch table indexed by Kind. before runs on
// node entry, after on node exit. Either may be nil for kinds that need
// only one hook.
type op struct {
	before func(n *Node, st *jstate, b *buildCtx) error
	after  func(n *Node, st *jstate, b *buildCtx) error
}

var ops = [kindCount]op{
	KindNone:     {},
	KindProject:  {before: projectBefore},
	KindFolder:   {before: folderBefore, after: folderAfter},
	KindFile:     {before: fileBefore, after: fileAfter},
	KindContent:  {before: contentBefore},
	KindCopy:     {before: copyBefore, after: copyAfter},
	KindInject:   {before: injectBefore, after: injectAfter},
	KindFragment: {before: fragmentBefore, after: fragmentAfter},
	KindSlot:     {before: slotBefore, after: slotAfter},
}

// step walks the tree depth-first, dispatching ops by Kind.
func step(n *Node, st *jstate, b *buildCtx) error {
	if n == nil {
		return nil
	}
	if int(n.Kind) >= int(kindCount) {
		return wrap(n, fmt.Errorf("%w: %d", ErrMissingOp, n.Kind))
	}
	o := ops[n.Kind]
	if o.before != nil {
		if err := o.before(n, st, b); err != nil {
			return wrap(n, err)
		}
	}
	for _, c := range n.Children {
		if err := step(c, st, b); err != nil {
			return wrap(c, err)
		}
	}
	if o.after != nil {
		if err := o.after(n, st, b); err != nil {
			return wrap(n, err)
		}
	}
	return nil
}

// runBuild is the entry point used by Generate after the define phase.
// Phase 6 onward: ops actually touch the filesystem via fileHandler.
func runBuild(st *jstate) (*buildCtx, error) {
	if st.root == nil {
		return nil, nil
	}
	b := newBuildCtx(st)
	b.fh = newFileHandler(b)
	if err := step(st.root, st, b); err != nil {
		return b, err
	}
	if b.fh != nil && b.fh.bmeta != nil {
		if err := b.fh.bmeta.done(); err != nil {
			return b, err
		}
	}
	return b, nil
}

// --- Op implementations (Phase 5 stubs unless noted). ---

func projectBefore(n *Node, st *jstate, b *buildCtx) error {
	b.current.project = n
	folder := st.folder
	if folder == "" {
		folder = "."
	}
	// Project.Folder is either absolute (used as-is) or relative (joined
	// to the global folder option). Mirrors src/op/ProjectOp.ts:9-13.
	parent := folder
	if n.Folder != "" {
		if isAbsPath(n.Folder) {
			parent = n.Folder
		} else {
			parent = folder + "/" + n.Folder
		}
	}
	parent = fwd(parent)
	parent = path.Clean(parent)
	b.current.folder = folderRef{
		node:   n,
		path:   []string{},
		parent: parent,
	}
	if b.fh != nil {
		_ = b.fh.ensureFolder(parent)
	}
	return nil
}

// resolveFragmentFrom resolves a relative Fragment From against the output
// folder. A bare relative path used to be passed through literally, so it
// resolved against the process working directory. Mirrors
// ts/src/cmp/Fragment.ts.
// isAbsFromPath mirrors node's Path.isAbsolute, which is PLATFORM
// DISPATCHED — ts/src/cmp/Fragment.ts guards the same join with it.
//
// isAbsPath is slash-only, so on Windows a drive-absolute source such as
// `C:/templates/page.html` was treated as relative and rewritten to
// `<output>/C:/templates/page.html`; FragmentP then stat'd that and
// rejected a file that exists. The Go CI job runs Linux only, and
// path.Clean is slash-only on every platform, so nothing in the suite
// could have caught it.
//
// filepath.IsAbs is NOT the right substitute: on Windows it reports false
// for "/foo", where node's win32.isAbsolute reports true.
func isAbsFromPath(p string) bool {
	if p == "" {
		return false
	}
	if p[0] == '/' {
		return true
	}
	if runtime.GOOS != "windows" {
		return false
	}
	if p[0] == '\\' {
		return true
	}
	// Drive-ABSOLUTE ("C:/x", "c:\\x") only; drive-relative ("C:x") is not.
	if len(p) >= 3 && isDriveLetter(p[0]) && p[1] == ':' &&
		(p[2] == '/' || p[2] == '\\') {
		return true
	}
	return false
}

func isDriveLetter(c byte) bool {
	return ('a' <= c && c <= 'z') || ('A' <= c && c <= 'Z')
}

func resolveFragmentFrom(st *jstate, from string) string {
	if from == "" || isAbsFromPath(from) {
		return from
	}
	folder := st.folder
	if folder == "" {
		folder = "."
	}
	return path.Clean(fwd(folder + "/" + from))
}

// isAbsPath reports whether p is an absolute canonical-/ path.
func isAbsPath(p string) bool {
	return len(p) > 0 && p[0] == '/'
}

// validName rejects path traversal in a component name. Names compose
// directly into output paths, and models are routinely third-party data,
// so a name containing a ".." segment is an arbitrary-file-write
// primitive: it escapes not just the project folder but the output
// folder entirely.
//
// A leading "/" is deliberately still allowed — an absolute Folder name
// composes with the Project folder (see the absolute_paths parity
// scenario). ProjectProps.Folder is likewise not checked: it is
// developer-authored top-level configuration rather than model-derived.
//
// Mirrors validName in ts/src/build/FileHandler.ts.
func validName(name, kind string) error {
	if name == "" {
		return nil
	}
	for _, seg := range strings.FieldsFunc(name, func(r rune) bool {
		return r == '/' || r == '\\'
	}) {
		if seg == ".." {
			return fmt.Errorf("%w: %s name=%s", ErrNameTraversal, kind, name)
		}
	}
	return nil
}

func folderBefore(n *Node, _ *jstate, b *buildCtx) error {
	if err := validName(n.Name, "Folder"); err != nil {
		return err
	}
	if b.current.folder.path == nil {
		b.current.folder.path = []string{}
	}
	b.current.folder.path = append(b.current.folder.path, n.Name)
	return nil
}

func folderAfter(_ *Node, _ *jstate, b *buildCtx) error {
	if len(b.current.folder.path) > 0 {
		b.current.folder.path = b.current.folder.path[:len(b.current.folder.path)-1]
	}
	return nil
}

func fileBefore(n *Node, st *jstate, b *buildCtx) error {
	if err := validName(n.Name, "File"); err != nil {
		return err
	}
	b.current.file = n
	parent := b.current.folder.parent
	dir := strings.Join(b.current.folder.path, "/")
	var raw string
	if dir != "" {
		raw = parent + "/" + dir + "/" + n.Name
	} else {
		raw = parent + "/" + n.Name
	}
	// path.Clean collapses // and resolves . / ..; matches TS's
	// Path.normalize at src/build/FileHandler.ts:151. This lets
	// Folder({name: '/code/js'}) compose with Project({folder: '/top/sdk'})
	// into a clean /top/sdk/code/js path.
	n.FullPath = path.Clean(fwd(raw))
	_ = st
	return nil
}

func fileAfter(n *Node, st *jstate, b *buildCtx) error {
	var sb strings.Builder
	for _, c := range n.Children {
		switch c.Kind {
		case KindContent:
			for _, s := range c.Content {
				sb.WriteString(s)
			}
		case KindFragment, KindInject, KindCopy, KindSlot:
			// In-place content emission. Fragment/Inject/Copy/Slot ops
			// stash their accumulated text in n.Content during their
			// after-hooks; we splice it into the parent file's stream
			// at the position where the child sat in source order.
			for _, s := range c.Content {
				sb.WriteString(s)
			}
		}
	}
	body := sb.String()
	n.Content = []string{body}

	if b.fh == nil {
		return nil
	}
	if n.FullPath == "" {
		return nil
	}
	// Honour Exclude=true (skip).
	if ex, ok := n.Exclude.(bool); ok && ex && b.fh.fs.Exists(n.FullPath) {
		return nil
	}
	// Honour global Options.Exclude time-window: skip files modified on
	// disk since the last successful build (mtime > meta.last).
	if st.opts.Exclude && b.fh.fs.Exists(n.FullPath) && b.fh.bmeta != nil {
		if fi, err := b.fh.fs.Stat(n.FullPath); err == nil {
			last := b.fh.bmeta.last()
			if last > 0 && fi.ModTime > last {
				return nil
			}
		}
	}
	return b.fh.saveMode(n.FullPath, []byte(body), "FileOp:after", n.Mode)
}

// nodeText renders a node from a *replayed* subtree to its text.
//
// A replay (Fragment's slot/default handlers, and user func(*J) replace
// callbacks) builds nodes outside the main tree walk, so their ops never
// fire. Content nodes already carry their text, but a nested Fragment has
// to be rendered here on demand. Inject and Copy are rendered by their own
// after-hooks during the real walk, so their Content is taken as-is.
//
// Any other container is descended into, so content nested arbitrarily
// deep is collected — matching TS, which accumulates into the current
// file's buffer as the walk descends and so never had a depth limit.
func nodeText(n *Node, st *jstate, b *buildCtx) string {
	if n == nil {
		return ""
	}

	var sb strings.Builder

	switch n.Kind {
	case KindContent, KindInject, KindCopy:
		for _, s := range n.Content {
			sb.WriteString(s)
		}
		return sb.String()

	case KindFragment:
		if len(n.Content) == 0 {
			if err := fragmentAfter(n, st, b); err != nil && b.replayErr == nil {
				b.replayErr = err
			}
		}
		for _, s := range n.Content {
			sb.WriteString(s)
		}
		return sb.String()
	}

	for _, c := range n.Children {
		sb.WriteString(nodeText(c, st, b))
	}
	return sb.String()
}

func contentBefore(n *Node, _ *jstate, b *buildCtx) error {
	// Append the rendered content to the current file's accumulator.
	if b.current.file != nil && b.current.file != n {
		// Nothing to do here - File.after concatenates from children.
	}
	return nil
}

// copyBefore resolves single-file vs directory copies. For a single
// file, it reads the source, applies template substitution to text
// files, and queues a write at the resolved destination. For a
// directory, it queues a recursive walk in copyAfter.
func copyBefore(n *Node, st *jstate, b *buildCtx) error {
	if b.fh == nil {
		return nil
	}
	// n.Name carries the Copy `To` prop.
	if err := validName(n.Name, "Copy(To)"); err != nil {
		return err
	}
	from := n.From
	fi, err := b.fh.fs.Stat(from)
	if err != nil {
		return fmt.Errorf("Copy: stat %s: %w", from, err)
	}
	if fi.IsDir {
		// Walk handled in copyAfter.
		n.After = &AfterRef{Kind: "copy"}
		return nil
	}
	// Single file: resolve dest path under current folder.
	name := n.Name
	if name == "" {
		name = pathBase(from)
	}
	parent := b.current.folder.parent
	dir := strings.Join(b.current.folder.path, "/")
	dest := parent
	if dir != "" {
		dest = dest + "/" + dir
	}
	dest = dest + "/" + name
	dest = fwd(dest)

	body, err := b.fh.fs.ReadFile(from)
	if err != nil {
		return err
	}
	// Extension alone is not enough to know a file is safe to decode and
	// re-encode as UTF-8; sniff the content too.
	isBin := IsBinExt(from) || IsBinContent(body)
	if !isBin {
		out, err := Template(string(body), st.model, &TemplateSpec{Replace: n.Replace})
		if err != nil {
			return err
		}
		body = []byte(out)
	}
	n.After = &AfterRef{Kind: "file"}
	n.FullPath = dest
	n.Content = []string{string(body)}
	// Record the sniff so copyAfter's save can honour it — save otherwise
	// re-derives the classification from the extension and loses it.
	if n.Meta == nil {
		n.Meta = map[string]any{}
	}
	n.Meta["copyBinary"] = isBin
	return nil
}

func copyAfter(n *Node, st *jstate, b *buildCtx) error {
	if b.fh == nil || n.After == nil {
		return nil
	}
	switch n.After.Kind {
	case "file":
		// Carry the sniff result recorded by copyBefore, so a
		// content-detected binary with an unlisted extension is governed by
		// existing.bin rather than existing.txt.
		if bin, _ := n.Meta["copyBinary"].(bool); bin {
			return b.fh.saveBinary(n.FullPath, []byte(n.Content[0]), "CopyOp:after")
		}
		return b.fh.save(n.FullPath, []byte(n.Content[0]), "CopyOp:after")
	case "copy":
		return copyWalk(n, st, b)
	}
	return nil
}

// copyWalk recursively copies a directory tree, applying template to
// text files and pass-through bytes to binaries.
func copyWalk(n *Node, st *jstate, b *buildCtx) error {
	from := n.From
	parent := b.current.folder.parent
	dir := strings.Join(b.current.folder.path, "/")
	to := parent
	if dir != "" {
		to = to + "/" + dir
	}
	if n.Name != "" {
		to = to + "/" + n.Name
	}
	return walkCopy(b, st, from, to, n)
}

// maxCopyDepth bounds recursion in the copy walk. Go's ReadDir reports a
// symlink-to-directory as a non-directory entry, so unlike TS (whose
// statSync follows the link) there is no cycle to fall into — but a
// backstop is cheap and keeps the two stacks' failure modes comparable.
// Mirrors MAX_COPY_DEPTH in ts/src/op/CopyOp.ts.
const maxCopyDepth = 64

func walkCopy(b *buildCtx, st *jstate, from, to string, n *Node) error {
	return walkCopyDepth(b, st, from, to, n, 0, map[string]struct{}{}, "")
}

// realpathOf resolves p to its canonical location when the provider can,
// so a symlink and its target compare equal for cycle detection.
func realpathOf(fsys FS, p string) string {
	if rp, ok := fsys.(realpathFS); ok {
		if r, err := rp.Realpath(p); err == nil {
			return r
		}
	}
	return p
}

func walkCopyDepth(b *buildCtx, st *jstate, from, to string, n *Node,
	depth int, visited map[string]struct{}, rel string) error {

	if depth > maxCopyDepth {
		return fmt.Errorf("Copy: tree too deep (>%d), possible symlink cycle, path=%s",
			maxCopyDepth, from)
	}
	// `visited` must be the ACTIVE ANCESTOR CHAIN, not every path the walk
	// has ever seen, so it is unwound on the way out. Without that, a source
	// tree holding a real directory AND a sibling symlink to it had its
	// second entry (whichever the sorted ReadDir yielded later — often the
	// real directory) reported as a cycle and its whole subtree silently
	// dropped. Mirrors ts/src/op/CopyOp.ts.
	real := realpathOf(b.fh.fs, from)
	if _, seen := visited[real]; seen {
		copyDlog.Log("copy", "symlink cycle, not descending: "+from+" -> "+real)
		return nil
	}
	visited[real] = struct{}{}
	defer delete(visited, real)

	entries, err := b.fh.fs.ReadDir(from)
	if err != nil {
		return err
	}
	for _, e := range entries {
		src := from + "/" + e.Name
		dst := to + "/" + e.Name
		entryRel := e.Name
		if rel != "" {
			entryRel = rel + "/" + e.Name
		}
		if shouldIgnoreCopyPath(e.Name, entryRel, n.Exclude, st.opts.Cmp.Copy.Ignore) {
			continue
		}
		// ReadDir reports a symlink by the link's own type, so a symlinked
		// directory arrives as a non-directory entry. TS's statSync follows
		// the link, so resolve it here too — otherwise the entry would be
		// read as a file and fail with "is a directory".
		isDir := e.IsDir
		if !isDir {
			if fi, serr := b.fh.fs.Stat(src); serr == nil && fi.IsDir {
				isDir = true
			}
		}

		if isDir {
			if err := walkCopyDepth(b, st, src, dst, n, depth+1, visited, entryRel); err != nil {
				return err
			}
			continue
		}
		body, err := b.fh.fs.ReadFile(src)
		if err != nil {
			return err
		}
		isBin := IsBinExt(src) || IsBinContent(body)
		if !isBin {
			rendered, err := Template(string(body), st.model, &TemplateSpec{Replace: n.Replace})
			if err != nil {
				return err
			}
			body = []byte(rendered)
		}
		if isBin {
			if err := b.fh.saveBinary(dst, body, "CopyOp:walk"); err != nil {
				return err
			}
		} else if err := b.fh.save(dst, body, "CopyOp:walk"); err != nil {
			return err
		}
	}
	return nil
}

// defaultCopyIgnoreRE matches the TS default ignore pattern, IGNORED_RE in
// src/op/CopyOp.ts: editor backups and explicitly disabled files.
var defaultCopyIgnoreRE = regexp.MustCompile(`(~|-jostraca-off)$`)

// injectDlog records non-fatal Inject weirdness, mirroring the dlog in
// ts/src/op/InjectOp.ts.
var injectDlog = NewDLog("jostraca", "build.go")

// copyDlog records non-fatal Copy weirdness, mirroring the dlog in
// ts/src/op/CopyOp.ts.
var copyDlog = NewDLog("jostraca", "build.go")

// injectExcluded reports whether name is excluded by the user's Inject
// Exclude setting. Accepts bool (true → always exclude), string,
// *regexp.Regexp, or a []any of those.
func injectExcluded(name string, exclude any) bool {
	switch v := exclude.(type) {
	case nil:
		return false
	case bool:
		return v
	case string:
		return v == name
	case *regexp.Regexp:
		return v != nil && v.MatchString(name)
	case []any:
		for _, x := range v {
			switch xv := x.(type) {
			case string:
				if xv == name {
					return true
				}
			case *regexp.Regexp:
				if xv != nil && xv.MatchString(name) {
					return true
				}
			}
		}
	case []string:
		for _, s := range v {
			if s == name {
				return true
			}
		}
	}
	return false
}

// shouldIgnoreCopyPath decides whether a copy entry is skipped.
//
// The two kinds of rule match DIFFERENT things, mirroring
// ts/src/op/CopyOp.ts:
//
//   - the built-in ignore rules (`~` backups, `-jostraca-off`) and the
//     configured Cmp.Copy.Ignore regexes match the bare NAME, as TS's
//     `ignored()` does;
//   - the caller's Copy `exclude` entries match the SOURCE-RELATIVE PATH,
//     as TS's `excludeFile()` does via `nodepath.concat(name).join('/')`.
//
// Matching excludes on the basename made `sub/a.txt` silently ineffective
// in Go while TS honoured it, and made `a.txt` exclude every same-named
// file at any depth in Go while TS excluded only the root one.
func shouldIgnoreCopyPath(name, rel string, exclude any, ignores []*regexp.Regexp) bool {
	if defaultCopyIgnoreRE.MatchString(name) {
		return true
	}
	for _, re := range ignores {
		if re != nil && re.MatchString(name) {
			return true
		}
	}
	if rel == "" {
		rel = name
	}
	switch v := exclude.(type) {
	case nil, bool:
	case string:
		if v == rel {
			return true
		}
	case []any:
		for _, x := range v {
			if s, ok := x.(string); ok && s == rel {
				return true
			}
			if r, ok := x.(*regexp.Regexp); ok && r.MatchString(rel) {
				return true
			}
		}
	}
	return false
}

// injectBefore mirrors fileBefore: set current.file and FullPath.
func injectBefore(n *Node, _ *jstate, b *buildCtx) error {
	if err := validName(n.Name, "Inject"); err != nil {
		return err
	}
	parent := b.current.folder.parent
	dir := strings.Join(b.current.folder.path, "/")
	if dir != "" {
		n.FullPath = parent + "/" + dir + "/" + n.Name
	} else {
		n.FullPath = parent + "/" + n.Name
	}
	n.FullPath = fwd(n.FullPath)
	b.current.file = n
	return nil
}

// injectAfter concatenates child Content, wraps in markers, replaces
// the existing marker block in the target file, and writes back.
func injectAfter(n *Node, _ *jstate, b *buildCtx) error {
	if b.fh == nil {
		return nil
	}
	if injectExcluded(n.Name, n.Exclude) {
		return nil
	}
	var sb strings.Builder
	for _, c := range n.Children {
		if c.Kind == KindContent {
			for _, s := range c.Content {
				sb.WriteString(s)
			}
		}
	}
	body := sb.String()

	// Inject rewrites a region of an existing file; a missing target is a
	// user error. TS throws here, so the port must too.
	if !b.fh.fs.Exists(n.FullPath) {
		return fmt.Errorf("%w: path=%s (Inject rewrites an existing file; use File to create one)",
			ErrInjectTargetMissing, n.FullPath)
	}
	src, err := b.fh.fs.ReadFile(n.FullPath)
	if err != nil {
		return err
	}

	startM, endM := n.Markers[0], n.Markers[1]
	s := string(src)

	// TS builds a /start(.*?)end/sg regex, so *every* marker pair in the
	// file is rewritten, and the end marker is always searched for after
	// the start marker. Scanning once from the front missed later blocks
	// and could be defeated by a stray end marker earlier in the file.
	var out strings.Builder
	out.Grow(len(s) + len(body))
	pos, matched := 0, false
	for {
		si := strings.Index(s[pos:], startM)
		if si < 0 {
			break
		}
		si += pos
		after := si + len(startM)
		ei := strings.Index(s[after:], endM)
		if ei < 0 {
			break
		}
		ei += after

		out.WriteString(s[pos:after])
		out.WriteString(body)
		prev := pos
		pos = ei
		matched = true

		// Guarantee forward progress.
		//
		// With a zero-width start marker, si and after both stay at pos,
		// the end marker can resolve at that same position, and pos = ei
		// is a no-op — the loop spins forever. InjectP now rejects an
		// empty marker (as TS does), so this is a backstop rather than the
		// primary defence, kept because a hang is the worst possible
		// failure mode for a code generator.
		//
		// It does NOT reproduce TS's zero-width behaviour, and is not
		// meant to: TS's own output for such markers was regex fallout
		// that both stacks now reject up front.
		if pos == prev {
			if pos >= len(s) {
				break
			}
			_, w := utf8.DecodeRuneInString(s[pos:])
			out.WriteString(s[pos : pos+w])
			pos += w
		}
	}
	if !matched {
		// Nothing to inject into. Not fatal — the target may not be marked
		// up yet — but it should not be invisible.
		injectDlog.Log("inject", "markers not found, nothing injected: path="+n.FullPath)
		return b.fh.save(n.FullPath, src, "InjectOp:after")
	}
	out.WriteString(s[pos:])

	return b.fh.save(n.FullPath, []byte(out.String()), "InjectOp:after")
}

// fragmentBefore stashes the parent file's current content slot so we
// can append rendered fragment output to it.
func fragmentBefore(n *Node, _ *jstate, b *buildCtx) error {
	n.Meta["parentFile"] = b.current.file
	return nil
}

// fragmentAfter reads the From file, runs Template with replay
// callbacks per Slot name, and appends output as a new Content node
// on the parent File.
func fragmentAfter(n *Node, st *jstate, b *buildCtx) error {
	if b.fh == nil {
		return nil
	}
	body, _ := n.Meta["fragmentBody"].(func(*J))
	slotNames, _ := n.Meta["slotNames"].([]string)

	// Already resolved at define time by FragmentP (see resolveFragmentFrom),
	// and resolution is NOT idempotent for a relative output folder other
	// than ".": re-resolving turned "generated/frag.txt" into
	// "generated/generated/frag.txt", so define-time validation passed and
	// then the read failed. Read the stored path, as ts/src/cmp/Fragment.ts
	// does.
	src, err := b.fh.fs.ReadFile(n.From)
	if err != nil {
		return err
	}

	// Build the replace map: one entry per named slot, plus a default
	// <[SLOT]> handler for non-Slot children. Source iteration is
	// alphabetical for cross-stack determinism.
	//
	// User-supplied func(*J) callbacks let replace handlers re-enter
	// the component system. Wrap them here so the J they receive is
	// bound to a fresh buffer node; the buffer's accumulated Content
	// children become the replacement text. Mirrors TS Fragment's
	// `handle: s => Content(s)` re-entrant pattern.
	replace := map[string]any{}
	for _, k := range sortedKeys(n.Replace) {
		v := n.Replace[k]
		if subFn, ok := v.(func(*J)); ok {
			subFn := subFn
			replace[k] = ReplaceFunc(func(_ map[string]string, _ string) string {
				buffer := &Node{Kind: KindFragment, Meta: map[string]any{}}
				subFn(&J{st: st, cur: buffer})
				var sb strings.Builder
				for _, c := range buffer.Children {
					if c.Kind == KindContent {
						for _, s := range c.Content {
							sb.WriteString(s)
						}
					}
				}
				return sb.String()
			})
		} else {
			replace[k] = v
		}
	}
	// replayWithFilter runs the user's Fragment body against a fresh
	// throwaway parent node carrying filter. Slot's check at SlotP looks
	// at j.cur.Filter, so the filter must live on the throwaway, not on n.
	replayWithFilter := func(filter FilterFunc, collect func(*Node) string) string {
		throwaway := &Node{Kind: KindFragment, Meta: map[string]any{}, Filter: filter}
		body(&J{st: st, cur: throwaway})
		return collect(throwaway)
	}
	// Collect the replayed subtree in source order, at any depth. These used
	// to look only one level down (Slot's direct Content grandchildren, or
	// the parent's direct Content children), so anything nested deeper — a
	// Fragment inside a Slot, most obviously — was silently dropped where TS
	// emits it.
	collectSlot := func(parent *Node) string {
		var sb strings.Builder
		for _, c := range parent.Children {
			if c.Kind == KindSlot {
				sb.WriteString(nodeText(c, st, b))
			}
		}
		return sb.String()
	}
	collectContent := func(parent *Node) string {
		var sb strings.Builder
		for _, c := range parent.Children {
			if c.Kind != KindSlot {
				sb.WriteString(nodeText(c, st, b))
			}
		}
		return sb.String()
	}
	for _, name := range slotNames {
		name := name
		key := "/[ \\t]*[-<!/#*]*[ \\t]*<\\[SLOT:" + EscRE(name) + "\\]>[ \\t]*[->/#*]*[ \\t]*/"
		replace[key] = ReplaceFunc(func(_ map[string]string, _ string) string {
			return replayWithFilter(
				func(kind, slotName string) bool { return kind == "slot" && slotName == name },
				collectSlot,
			)
		})
	}
	// Default <[SLOT]> matches non-Slot children.
	replace["/[ \\t]*[-<!/#*]*[ \\t]*<\\[SLOT\\]>[ \\t]*[->/#*]*[ \\t]*/"] =
		ReplaceFunc(func(_ map[string]string, _ string) string {
			return replayWithFilter(
				func(kind, _ string) bool { return kind != "slot" },
				collectContent,
			)
		})

	rendered, err := Template(string(src), st.model, &TemplateSpec{
		Replace: replace,
	})
	if err != nil {
		return err
	}
	if b.replayErr != nil {
		err, b.replayErr = b.replayErr, nil
		return err
	}
	if n.Indent != nil {
		rendered = Indent(rendered, n.Indent)
	}

	// Stash the rendered output on the Fragment node so the parent's
	// fileAfter walks Children in source order and splices Fragment's
	// content in place (not appended at the end).
	n.Content = []string{rendered}
	return nil
}

func slotBefore(_ *Node, _ *jstate, _ *buildCtx) error { return nil }
func slotAfter(_ *Node, _ *jstate, _ *buildCtx) error  { return nil }
