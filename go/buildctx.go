package jostraca

// buildCtx is the per-Generate-call build state, the Go peer of TS
// BuildContext. Phase 5 stub - FileHandler and BuildMeta arrive in
// Phase 6.
type buildCtx struct {
	st      *jstate
	when    int64
	audit   Audit
	current currentRefs
	logx    buildLog
	fh      *fileHandler

	// filepaths is the output paths already claimed by a File this run,
	// each mapped to the node path of the File that claimed it. See
	// claimFile in build.go.
	filepaths map[string]string

	// replayErr carries the first error raised while rendering a replayed
	// subtree. Replay happens inside a ReplaceFunc, which returns a string
	// and so cannot propagate one directly.
	replayErr error
}

type currentRefs struct {
	project *Node
	folder  folderRef
	file    *Node
}

type folderRef struct {
	node   *Node
	path   []string
	parent string
}

type buildLog struct {
	exclude []string
	last    int64
}

func newBuildCtx(st *jstate) *buildCtx {
	folder := st.folder
	if folder == "" {
		folder = "."
	}
	return &buildCtx{
		st:        st,
		when:      st.now(),
		audit:     Audit{},
		filepaths: map[string]string{},
		current: currentRefs{
			folder: folderRef{path: []string{}, parent: folder},
		},
	}
}
