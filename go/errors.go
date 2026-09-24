package jostraca

import (
	"errors"
	"fmt"
	"strings"
)

// Sentinel errors. Wrap with NodeError when surfacing during build.
//
// A sentinel with a TypeScript twin carries TypeScript's text, and no
// "jostraca: " of its own where the NodeError wrapper already says it:
// the message BODY after the wrapper is the same in both ports.
var (
	ErrMissingOp       = errors.New("missing op")
	ErrInvalidPath     = errors.New("jostraca: invalid path")
	ErrEmptyMatchRegex = errors.New("Regular expression matches empty string")
	// ErrLookbehind refuses any look-around in a regex replace key,
	// lookahead included; RE2 has neither. The name predates that.
	ErrLookbehind    = errors.New("jostraca: look-around not supported (RE2)")
	ErrMergeConflict = errors.New("jostraca: 3-way merge produced conflicts")
	ErrNilRoot       = errors.New("jostraca: generate root callback is not a function")
	ErrNameTraversal = errors.New(`name must not contain a ".." path segment`)

	// ErrInjectTargetMissing is returned when Inject names a file that does
	// not exist. Inject rewrites a marked region of an existing file; it
	// does not create one.
	ErrInjectTargetMissing = errors.New("inject target does not exist")

	// ErrDuplicateFilePath is returned when two File components resolve
	// to the same output path. The second used to win in silence, so the
	// first was never written -- output missing, no error, and nothing
	// to say which component lost.
	ErrDuplicateFilePath = errors.New(
		"two File components resolve to the same output path")
)

// fromMissingErr and fromCheckErr are the texts TypeScript's shape gives a
// Fragment or CopyFiles `from` that is absent or fails its check. What
// follows "threw:" is the filesystem's own error, so it is the host's
// text: ENOENT in Node, the Go runtime's here.
func fromMissingErr(cmp string) error {
	return fmt.Errorf(
		`%s: Validation failed for property "from" because the property is missing.`, cmp)
}

func fromCheckErr(cmp, from string, cause error) error {
	return fmt.Errorf(`%s: Validation failed for property "from" with string "%s" `+
		`because check "From" failed (threw: %w)`, cmp, shapeValueText(from), cause)
}

// shapeValueText renders a string as shape does inside a message:
// JSON-escaped with the quotes stripped, and clipped to 111 characters.
func shapeValueText(s string) string {
	if js, err := marshalJSLike(s); err == nil {
		s = strings.ReplaceAll(js, `"`, "")
	}
	return clipUTF16(s, 111)
}

// clipUTF16 clips s as shape's truncate does, counting a character as
// JavaScript's length does, in UTF-16 code units: beyond limit units, the
// first limit-3 and "...". A character the cut would split is dropped
// whole; JavaScript keeps half a surrogate pair there, which a Go string
// cannot hold.
func clipUTF16(s string, limit int) string {
	units := func(r rune) int {
		if r > 0xFFFF {
			return 2
		}
		return 1
	}
	total := 0
	for _, r := range s {
		total += units(r)
	}
	if total <= limit {
		return s
	}
	kept := 0
	for i, r := range s {
		if kept+units(r) > limit-3 {
			return s[:i] + "..."
		}
		kept += units(r)
	}
	return s
}

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
