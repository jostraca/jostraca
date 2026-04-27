package jostraca

import (
	"fmt"
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
// Phase 5 wires this in but ops are stubs that don't write to disk.
func runBuild(st *jstate) (*buildCtx, error) {
	if st.root == nil {
		return nil, nil
	}
	b := newBuildCtx(st)
	if err := step(st.root, st, b); err != nil {
		return b, err
	}
	return b, nil
}

// --- Op implementations (Phase 5 stubs unless noted). ---

func projectBefore(n *Node, st *jstate, b *buildCtx) error {
	b.current.project = n
	b.current.folder = folderRef{
		node:   n,
		path:   []string{},
		parent: st.folder,
	}
	return nil
}

func folderBefore(n *Node, _ *jstate, b *buildCtx) error {
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
	b.current.file = n
	dir := strings.Join(b.current.folder.path, "/")
	if dir != "" {
		n.FullPath = b.current.folder.parent + "/" + dir + "/" + n.Name
	} else {
		n.FullPath = b.current.folder.parent + "/" + n.Name
	}
	n.FullPath = strings.TrimPrefix(n.FullPath, "/")
	if st.folder != "" && st.folder != "." {
		// Path stays canonical; the FS wrapper handles OS conversion.
	}
	return nil
}

func fileAfter(n *Node, st *jstate, b *buildCtx) error {
	// Phase 5 stub: FileHandler.save lands in Phase 6. For now, just
	// concatenate any accumulated Content node bodies into a single
	// stash on the node so tests can introspect.
	var sb strings.Builder
	for _, c := range n.Children {
		if c.Kind == KindContent {
			for _, s := range c.Content {
				sb.WriteString(s)
			}
		}
	}
	n.Content = []string{sb.String()}
	_ = st
	_ = b
	return nil
}

func contentBefore(n *Node, _ *jstate, b *buildCtx) error {
	// Append the rendered content to the current file's accumulator.
	if b.current.file != nil && b.current.file != n {
		// Nothing to do here - File.after concatenates from children.
	}
	return nil
}

func copyBefore(_ *Node, _ *jstate, _ *buildCtx) error   { return nil }
func copyAfter(_ *Node, _ *jstate, _ *buildCtx) error    { return nil }
func injectBefore(_ *Node, _ *jstate, _ *buildCtx) error { return nil }
func injectAfter(_ *Node, _ *jstate, _ *buildCtx) error  { return nil }
func fragmentBefore(_ *Node, _ *jstate, _ *buildCtx) error {
	return nil
}
func fragmentAfter(_ *Node, _ *jstate, _ *buildCtx) error { return nil }
func slotBefore(_ *Node, _ *jstate, _ *buildCtx) error    { return nil }
func slotAfter(_ *Node, _ *jstate, _ *buildCtx) error     { return nil }
