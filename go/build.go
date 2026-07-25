package jostraca

import (
	"fmt"
	"path"
	"regexp"
	"strings"
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
	return b.fh.save(n.FullPath, []byte(body), "FileOp:after")
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
	if !IsBinExt(from) {
		out, err := Template(string(body), st.model, &TemplateSpec{Replace: n.Replace})
		if err != nil {
			return err
		}
		body = []byte(out)
	}
	n.After = &AfterRef{Kind: "file"}
	n.FullPath = dest
	n.Content = []string{string(body)}
	return nil
}

func copyAfter(n *Node, st *jstate, b *buildCtx) error {
	if b.fh == nil || n.After == nil {
		return nil
	}
	switch n.After.Kind {
	case "file":
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

func walkCopy(b *buildCtx, st *jstate, from, to string, n *Node) error {
	entries, err := b.fh.fs.ReadDir(from)
	if err != nil {
		return err
	}
	for _, e := range entries {
		src := from + "/" + e.Name
		dst := to + "/" + e.Name
		if shouldIgnoreCopyPath(e.Name, n.Exclude, st.opts.Cmp.Copy.Ignore) {
			continue
		}
		if e.IsDir {
			if err := walkCopy(b, st, src, dst, n); err != nil {
				return err
			}
			continue
		}
		body, err := b.fh.fs.ReadFile(src)
		if err != nil {
			return err
		}
		if !IsBinExt(src) {
			rendered, err := Template(string(body), st.model, &TemplateSpec{Replace: n.Replace})
			if err != nil {
				return err
			}
			body = []byte(rendered)
		}
		if err := b.fh.save(dst, body, "CopyOp:walk"); err != nil {
			return err
		}
	}
	return nil
}

// defaultCopyIgnoreRE matches the TS default ignore pattern (~$).
var defaultCopyIgnoreRE = regexp.MustCompile(`~$`)

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

func shouldIgnoreCopyPath(name string, exclude any, ignores []*regexp.Regexp) bool {
	if defaultCopyIgnoreRE.MatchString(name) {
		return true
	}
	for _, re := range ignores {
		if re != nil && re.MatchString(name) {
			return true
		}
	}
	switch v := exclude.(type) {
	case nil, bool:
	case string:
		if v == name {
			return true
		}
	case []any:
		for _, x := range v {
			if s, ok := x.(string); ok && s == name {
				return true
			}
			if r, ok := x.(*regexp.Regexp); ok && r.MatchString(name) {
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

	if !b.fh.fs.Exists(n.FullPath) {
		// No target — silently skip; matches TS read-error tolerance for
		// missing inject targets in tests.
		return nil
	}
	src, err := b.fh.fs.ReadFile(n.FullPath)
	if err != nil {
		return err
	}

	startM, endM := n.Markers[0], n.Markers[1]
	startIdx := strings.Index(string(src), startM)
	if startIdx < 0 {
		return nil
	}
	endIdx := strings.Index(string(src), endM)
	if endIdx < 0 || endIdx < startIdx {
		return nil
	}
	// Replace [startIdx+len(startM), endIdx) with body.
	replaceFrom := startIdx + len(startM)
	out := make([]byte, 0, len(src)+len(body))
	out = append(out, src[:replaceFrom]...)
	out = append(out, []byte(body)...)
	out = append(out, src[endIdx:]...)
	return b.fh.save(n.FullPath, out, "InjectOp:after")
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
	collectSlot := func(parent *Node) string {
		var sb strings.Builder
		for _, c := range parent.Children {
			if c.Kind == KindSlot {
				for _, gc := range c.Children {
					if gc.Kind == KindContent {
						for _, s := range gc.Content {
							sb.WriteString(s)
						}
					}
				}
			}
		}
		return sb.String()
	}
	collectContent := func(parent *Node) string {
		var sb strings.Builder
		for _, c := range parent.Children {
			if c.Kind == KindContent {
				for _, s := range c.Content {
					sb.WriteString(s)
				}
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
