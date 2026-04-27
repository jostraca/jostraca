// Package jostraca is a code- and project-generator framework. It mirrors
// the TypeScript package at https://github.com/jostraca/jostraca and is
// being grown to full feature parity (see go/PORT_PLAN.md).
//
// Phase 1 ships only the foundational types and a no-op build phase.
package jostraca

import (
	"time"
)

// J is the receiver-shadowing builder. Each component method on *J
// allocates a child *J bound to the current node frame and passes it to
// the user callback. See PORT_PLAN §2 for the rationale.
type J struct {
	st  *jstate
	cur *Node
}

// jstate is the per-Generate-call shared state. Concurrency: within one
// Generate call the define phase is single-goroutine; multiple Generate
// calls each own their own *jstate, so no locking is needed.
type jstate struct {
	opts   Options
	fs     FS
	now    func() int64
	folder string
	model  map[string]any
	log    Log
	meta   map[string]any
	debug  string

	root *Node
	err  error
}

// New constructs a builder seeded with global options. Component methods
// must only be called on the *J passed into a Generate callback, not on
// this top-level value.
func New(opts ...Option) *J {
	o := applyOptions(opts)
	return &J{st: newJstateFromOptions(o), cur: nil}
}

func newJstateFromOptions(o Options) *jstate {
	st := &jstate{opts: o}
	if o.Now != nil {
		st.now = o.Now
	} else {
		st.now = func() int64 { return time.Now().UnixMilli() }
	}
	if o.Log != nil {
		st.log = o.Log
	} else {
		st.log = nopLog{}
	}
	st.folder = o.Folder
	if st.folder == "" {
		st.folder = "."
	}
	st.model = o.Model
	st.meta = o.Meta
	st.debug = o.Debug
	st.fs = o.FS
	return st
}

// Result is what Generate returns after both define and build phases.
type Result struct {
	When  int64
	Files Files
	Audit func() Audit
	Vol   func() map[string][]byte
	FS    func() FS
}

// Files groups output paths by category so callers can diff or report.
type Files struct {
	Preserved  []string
	Written    []string
	Presented  []string
	Diffed     []string
	Merged     []string
	Conflicted []string
	Unchanged  []string
}

// Audit is an ordered list of build-phase actions.
type Audit []AuditEntry

type AuditEntry struct {
	Tag  string
	Data map[string]any
}

// Generate runs the user-supplied root callback in the define phase to
// build a node tree, then walks the tree in the build phase. The build
// phase is a no-op until Phase 5/6 lands the ops.
func (j *J) Generate(opts Options, root func(*J)) (Result, error) {
	if root == nil {
		return Result{}, ErrNilRoot
	}
	merged := mergeOptions(j.st.opts, opts)
	st := newJstateFromOptions(merged)

	// Synthetic top-level node so the user's first component has a parent
	// to append to. Path is empty; Kind=KindNone makes the root op a noop.
	rootNode := &Node{Kind: KindNone, Meta: map[string]any{}}
	cj := &J{st: st, cur: rootNode}

	// Define phase: synchronous walk of user callbacks.
	root(cj)
	if st.err != nil {
		return Result{}, st.err
	}

	// Build phase: walks the tree depth-first via the op dispatch table.
	// Phase 5 ships ops that build the in-memory tree but don't yet
	// touch the filesystem (FileHandler arrives in Phase 6).
	doBuild := merged.Build == nil || *merged.Build
	res := Result{
		When:  st.now(),
		Audit: func() Audit { return nil },
	}
	if !doBuild {
		return res, nil
	}
	b, err := runBuild(st)
	if err != nil {
		return res, err
	}
	if b != nil {
		res.When = b.when
		audit := b.audit
		res.Audit = func() Audit { return audit }
	}
	return res, nil
}
