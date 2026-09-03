package jostraca

import (
	"time"
)

// Version is the released version of the Go module. It is kept in sync
// with the canonical TypeScript package version by `make publish-go`.
const Version = "0.36.3"

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

	// Mem switches an in-memory filesystem on and Vol seeds it, which is
	// what TS's `{mem: true}` and `vol` pair does. An explicit FS still
	// wins, exactly as in TS, where `opts.fs ||` comes first in the chain
	// that picks the filesystem.
	//
	// These two options used to be INERT here: nothing read them, so
	// `WithMem()` ran against the real filesystem and returned a Result
	// whose Vol and FS were nil, with no error at all. A test translated
	// from TS by keeping those two options passed while writing into the
	// working directory. See #37.
	if st.fs == nil && o.Mem != nil && *o.Mem {
		st.fs = newSeededMemFS(o.Vol)
	}

	return st
}

// newSeededMemFS builds an in-memory filesystem pre-populated from a Vol
// map. Mirrors TS's `MemFs(vol)`.
func newSeededMemFS(vol map[string][]byte) *MemFS {
	mem := NewMemFS()
	for path, body := range vol {
		_ = mem.WriteFile(path, body)
	}
	return mem
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

	// A GLOBAL in-memory filesystem is reused across Generate calls, so a
	// second run sees what the first wrote -- unless this call supplies its
	// own Vol, which seeds a fresh one. TS makes the same distinction:
	// `null == opts.vol && null != gMemFs ? gMemFs : MemFs(vol)`. Without
	// this, `Jostraca({mem: true})` would hand every call a blank volume and
	// no regenerate-over-existing-output scenario could be written against
	// it. See #37.
	//
	// Decided BEFORE the state is built: newJstateFromOptions would
	// otherwise allocate a MemFS and copy every byte of the global seed into
	// it, only for the next line to throw that away. On a builder holding a
	// large template volume that is a full copy of it per call.
	if merged.FS == nil && merged.Mem != nil && *merged.Mem && opts.Vol == nil {
		if gmem, ok := j.st.fs.(*MemFS); ok {
			merged.FS = gmem
		}
	}

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

	// The synthetic root is the build root whenever the define phase
	// produced anything. The builder methods seed st.root with the FIRST
	// node they attach, which orphaned every top-level sibling after it;
	// rootNode already holds them all. An empty define leaves st.root nil
	// and runBuild bails, as before.
	if len(rootNode.Children) > 0 {
		st.root = rootNode
	}

	// Build phase: walks the tree depth-first via the op dispatch table.
	// Phase 5 ships ops that build the in-memory tree but don't yet
	// touch the filesystem (FileHandler arrives in Phase 6).
	doBuild := merged.Build == nil || *merged.Build
	res := Result{
		When:  st.now(),
		Audit: func() Audit { return nil },
	}

	// The in-memory handles are attached whether or not the build phase
	// runs, as they are in TS. A define-only run still has a filesystem --
	// the seeded one -- and a caller inspecting it was handed nil.
	if mfs, ok := st.fs.(*MemFS); ok {
		fsRef := st.fs
		res.Vol = func() map[string][]byte { return mfs.Vol() }
		res.FS = func() FS { return fsRef }
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
		if b.fh != nil {
			res.Files = b.fh.files
		}
	}
	return res, nil
}
