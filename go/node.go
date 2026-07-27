package jostraca

import (
	"io/fs"
	"regexp"
)

// Kind identifies the role a Node plays during the build phase.
type Kind uint8

const (
	KindNone Kind = iota
	KindProject
	KindFolder
	KindFile
	KindContent
	KindCopy
	KindInject
	KindFragment
	KindSlot

	// kindCount is the size of the op dispatch table. Add new kinds above.
	kindCount
)

// Node is the value carried in the build tree assembled during the define
// phase. Every component method on *J appends a Node to its parent's
// Children. Ops in build.go consume nodes during the build phase.
type Node struct {
	Kind     Kind
	Name     string
	Path     []string
	FullPath string
	Folder   string
	From     string
	Indent   any
	Exclude  any

	// Mode sets POSIX permission bits on the generated file. Zero means
	// unset: keep the platform default, or the file's current mode.
	Mode fs.FileMode

	Replace  map[string]any
	Markers  [2]string
	Filter   FilterFunc
	Children []*Node
	Content  []string
	Meta     map[string]any
	After    *AfterRef
}

// FilterFunc is consumed by Fragment to decide which Slot children to
// replay during template streaming. The signature is narrowed from the
// loose TS form (PORT_PLAN §14 D11).
type FilterFunc func(componentKind, name string) bool

// AfterRef is a small queue marker used by CopyOp to schedule a
// post-walk action.
type AfterRef struct {
	Kind string
}

// childPath builds a copy of parent.Path optionally extended with name.
func childPath(parent *Node, name string) []string {
	p := append([]string(nil), parent.Path...)
	if name != "" {
		p = append(p, name)
	}
	return p
}

// kindName maps a Kind to a stable lowercase token used in error messages
// and audit entries. Matches the TS node.kind strings.
func kindName(k Kind) string {
	switch k {
	case KindProject:
		return "project"
	case KindFolder:
		return "folder"
	case KindFile:
		return "file"
	case KindContent:
		return "content"
	case KindCopy:
		return "copy"
	case KindInject:
		return "inject"
	case KindFragment:
		return "fragment"
	case KindSlot:
		return "slot"
	case KindNone:
		return "none"
	default:
		return "unknown"
	}
}

// nodeMatcher exists only so the Node struct above can refer to a typed
// regex for Exclude/Ignore values; users may pass *regexp.Regexp directly.
var _ = regexp.MustCompile
