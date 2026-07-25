package jostraca

import (
	"errors"
	"fmt"
	"strings"
)

// Sentinel errors. Wrap with NodeError when surfacing during build.
var (
	ErrMissingOp       = errors.New("jostraca: missing op for node kind")
	ErrInvalidPath     = errors.New("jostraca: invalid path")
	ErrEmptyMatchRegex = errors.New("jostraca: regex matches empty string")
	ErrLookbehind      = errors.New("jostraca: lookbehind not supported (RE2)")
	ErrMergeConflict   = errors.New("jostraca: 3-way merge produced conflicts")
	ErrNilRoot         = errors.New("jostraca: Generate root callback is nil")
	ErrNameTraversal   = errors.New(`jostraca: name must not contain a ".." path segment`)

	// ErrInjectTargetMissing is returned when Inject names a file that does
	// not exist. Inject rewrites a marked region of an existing file; it
	// does not create one.
	ErrInjectTargetMissing = errors.New("jostraca: inject target does not exist")
)

// NodeError wraps any build-phase error with context about which step and
// path produced it. Callsite is populated when Options.Debug is set.
type NodeError struct {
	Step     string
	Path     []string
	Callsite string
	Err      error
}

func (e *NodeError) Error() string {
	if e == nil {
		return "<nil>"
	}
	parts := []string{"jostraca"}
	if e.Step != "" {
		parts = append(parts, e.Step)
	}
	if len(e.Path) > 0 {
		parts = append(parts, "@"+strings.Join(e.Path, "/"))
	}
	msg := strings.Join(parts, " ")
	if e.Err != nil {
		msg = fmt.Sprintf("%s: %v", msg, e.Err)
	}
	if e.Callsite != "" {
		msg = msg + "\n  at " + e.Callsite
	}
	return msg
}

func (e *NodeError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// wrap attaches node context to err, idempotently. Callers may wrap once
// per recursion level; nested wraps short-circuit.
func wrap(n *Node, err error) error {
	if err == nil {
		return nil
	}
	var ne *NodeError
	if errors.As(err, &ne) {
		return err
	}
	cs, _ := n.Meta["callsite"].(string)
	return &NodeError{
		Step:     kindName(n.Kind),
		Path:     append([]string(nil), n.Path...),
		Callsite: cs,
		Err:      err,
	}
}
