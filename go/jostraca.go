package jostraca

import (
	"time"
)

// Version is the released version of the Go module. It is kept in sync
// with the canonical TypeScript package version by `make publish-go`.
const Version = "0.38.0"

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

	// mem is the instance's in-memory volume, on the state New builds
	// when the global Mem is on. Generate calls share it.
	mem *MemFS

	// warnings raised by THIS Generate, replayed to its log on success.
	warnings []dLogEntry

	root *Node
	err  error

	// finished is set when the Generate that owns this state returns. A *J
	// kept from its callback belongs to a tree that will never be built.
	finished bool
}

// New constructs a builder seeded with global options. Component methods
// must only be called on the *J passed into a Generate callback, while that
// Generate runs: calling one on this top-level value, or on a *J kept from
// a callback after its Generate has returned, panics with a message naming
// the component.
func New(opts ...Option) *J {
	o := applyOptions(opts)
	st := newJstateFromOptions(o)

	// Mem switches an in-memory filesystem on and Vol seeds it, which is
	// what TS's `{mem: true}` and `vol` pair does. Built from Mem alone,
	// whatever FS says, as TS builds gMemFs from gOpts.mem; Generate
	// decides per call which provider wins.
	//
	// These two options used to be INERT here: nothing read them, so
	// `WithMem()` ran against the real filesystem and returned a Result
	// whose Vol and FS were nil, with no error at all. See #37.
	if o.Mem != nil && *o.Mem {
		st.mem = newSeededMemFS(o.Vol)
	}
	return &J{st: st, cur: nil}
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
		st.log = defaultLog
	}
	st.folder = o.Folder
	if st.folder == "" {
		st.folder = "."
	}
	st.model = o.Model
	st.meta = o.Meta
	st.debug = o.Debug
	st.fs = o.FS

	// Defaulted HERE, not in the file handler, so the define-time checks
	// on a Fragment or CopyFiles `from` run against the filesystem the
	// build will use whether or not the caller spelled it. A missing
	// source then refuses the run before anything is written.
	if st.fs == nil {
		st.fs = OsFS{}
	}

	return st
}

// warn records a non-fatal warning in the package buffer and against this
// Generate, so it is replayed to this call's log and no other's.
func (st *jstate) warn(d *DLog, args ...any) {
	e := d.record(args...)
	if st != nil {
		st.warnings = append(st.warnings, e)
	}
}

// replayWarnings sends each warning this Generate raised to its log, one
// Debug call apiece, with TS's payload.
func (st *jstate) replayWarnings() {
	for _, e := range st.warnings {
		st.log.Debug(map[string]any{
			"point":     "jostraca-warning",
			"dlogentry": e,
			"note":      e.String(),
		})
	}
}

// newSeededMemFS builds an in-memory filesystem pre-populated from a Vol
// map. Mirrors TS's `MemFs(vol)`: a nil value is an empty directory, the
// convention Vol() itself reports one with, and any other value a file.
func newSeededMemFS(vol map[string][]byte) *MemFS {
	mem := NewMemFS()
	for path, body := range vol {
		if body == nil {
			_ = mem.MkdirAll(path)
			continue
		}
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
// Every category is a list, empty rather than nil, and the JSON keys are
// TS's, so a serialised Files has the TS shape.
type Files struct {
	Preserved  []string `json:"preserved"`
	Written    []string `json:"written"`
	Presented  []string `json:"presented"`
	Diffed     []string `json:"diffed"`
	Merged     []string `json:"merged"`
	Conflicted []string `json:"conflicted"`
	Unchanged  []string `json:"unchanged"`
}

// listed returns f with every nil category replaced by an empty list.
func (f Files) listed() Files {
	for _, l := range []*[]string{
		&f.Preserved, &f.Written, &f.Presented, &f.Diffed,
		&f.Merged, &f.Conflicted, &f.Unchanged,
	} {
		if *l == nil {
			*l = []string{}
		}
	}
	return f
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
	return j.generate(opts, root, nil)
}

// generate is Generate with a hook applied to the MERGED options, for a
// caller that must force a field whatever the global options say. Check
// uses it: a zero-value per-call field cannot override a global one.
//
// Every Files category of the Result is a list, including on a run that
// fails or builds nothing.
func (j *J) generate(
	opts Options, root func(*J), force func(*Options),
) (res Result, err error) {
	defer func() { res.Files = res.Files.listed() }()

	if root == nil {
		return Result{}, ErrNilRoot
	}
	merged := mergeOptions(j.st.opts, opts)
	if force != nil {
		force(&merged)
	}

	// The in-memory volume, when mem is on for THIS call. A GLOBAL volume
	// is reused across Generate calls, so a second run sees what the first
	// wrote -- unless this call supplies its own Vol, which seeds a fresh
	// one from the global seed merged with the call's. TS makes the same
	// distinction: `null == opts.vol && null != gMemFs ? gMemFs :
	// MemFs(vol)`. See #37.
	var mem *MemFS
	if merged.Mem != nil && *merged.Mem {
		if opts.Vol == nil && j.st.mem != nil {
			mem = j.st.mem
		} else {
			mem = newSeededMemFS(merged.Vol)
		}
	}

	// The provider, in TS's order: the per-call FS, else the in-memory
	// volume, else the global FS, else OsFS (defaulted by the state).
	if opts.FS == nil && mem != nil {
		merged.FS = mem
	}

	st := newJstateFromOptions(merged)
	defer func() { st.finished = true }()

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
	res = Result{
		Audit: func() Audit { return Audit{} },
	}

	b, err := newBuild(st)
	if err != nil {
		return res, err
	}
	res.When = b.when
	res.Audit = func() Audit { return b.audit }

	// The in-memory handles are attached exactly when mem is on for this
	// call, whether or not the build phase runs, as they are in TS: Vol is
	// that volume and FS the provider actually used. A caller-supplied
	// provider, even a MemFS, gets neither; the caller already holds it.
	if mem != nil {
		fsRef := st.fs
		res.Vol = func() map[string][]byte { return mem.Vol() }
		res.FS = func() FS { return fsRef }
	}

	if doBuild {
		err := runBuild(st, b)
		res.Files = b.fh.files
		if err != nil {
			return res, err
		}
	}

	// Only after a run that succeeded, as in TS: a refused run returns its
	// error and replays nothing.
	st.replayWarnings()
	return res, nil
}
