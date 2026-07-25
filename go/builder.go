package jostraca

import (
	"fmt"
	"sort"
)

// fmtErrorf wraps fmt.Errorf so other files can use it without importing fmt.
func fmtErrorf(format string, args ...any) error {
	return fmt.Errorf(format, args...)
}

// Builder methods on *J. Each follows the 5-step template from
// PORT_PLAN §5: short-circuit on j.st.err, allocate node, append to
// parent, set root if first call, recurse with a child *J bound to the
// new node.

// ProjectProps is the full options struct for Project. Convenience
// callers should use the positional Project method when they only need
// Folder.
type ProjectProps struct {
	Name   string
	Folder string
}

// Project marks the root of an output tree. Folder is the destination
// directory under Options.Folder.
func (j *J) Project(p ProjectProps, body func(*J)) {
	if j.st.err != nil {
		return
	}
	n := &Node{
		Kind:   KindProject,
		Name:   p.Name,
		Folder: p.Folder,
		Path:   []string{},
		Meta:   map[string]any{},
	}
	if p.Folder != "" {
		n.Path = append(n.Path, p.Folder)
	}
	j.attachAndDescend(n, body)
}

// Folder represents a sub-directory under the current project/folder.
func (j *J) Folder(name string, body func(*J)) {
	if j.st.err != nil {
		return
	}
	n := &Node{
		Kind: KindFolder,
		Name: name,
		Path: childPath(j.cur, name),
		Meta: map[string]any{},
	}
	j.attachAndDescend(n, body)
}

// FileProps is the full options struct for File.
type FileProps struct {
	Name    string
	Exclude any
}

// File represents an output file. Children populate its content during
// the define phase.
func (j *J) File(name string, body func(*J)) {
	j.FileP(FileProps{Name: name}, body)
}

func (j *J) FileP(p FileProps, body func(*J)) {
	if j.st.err != nil {
		return
	}
	n := &Node{
		Kind:    KindFile,
		Name:    p.Name,
		Exclude: p.Exclude,
		Path:    childPath(j.cur, p.Name),
		Meta:    map[string]any{},
	}
	j.attachAndDescend(n, body)
}

// ContentProps configures Content.
type ContentProps struct {
	Src     string
	Name    string
	Indent  any
	Replace map[string]any
	Extra   map[string]any
}

// Content emits a string of text into the surrounding File. Templates
// are applied with the model in scope.
func (j *J) Content(src string) {
	j.ContentP(ContentProps{Src: src})
}

func (j *J) ContentP(p ContentProps) {
	if j.st.err != nil {
		return
	}
	model := mergeModel(j.st.model, p.Extra)
	rendered := p.Src
	if rendered != "" {
		out, err := Template(rendered, model, &TemplateSpec{Replace: p.Replace})
		if err != nil {
			j.st.err = err
			return
		}
		rendered = out
	}
	if p.Indent != nil {
		rendered = Indent(rendered, p.Indent)
	}
	n := &Node{
		Kind:    KindContent,
		Name:    p.Name,
		Indent:  p.Indent,
		Path:    childPath(j.cur, p.Name),
		Meta:    map[string]any{},
		Content: []string{rendered},
	}
	if j.cur != nil {
		j.cur.Children = append(j.cur.Children, n)
	}
	if j.st.root == nil {
		j.st.root = n
	}
}

// Line is Content with a trailing newline.
func (j *J) Line(src string) {
	if !strEndsWithNewline(src) {
		src = src + "\n"
	}
	j.ContentP(ContentProps{Src: src})
}

func (j *J) LineP(p ContentProps) {
	if !strEndsWithNewline(p.Src) {
		p.Src = p.Src + "\n"
	}
	j.ContentP(p)
}

// SlotProps is the options struct for Slot.
type SlotProps struct {
	Name string
}

// Slot is a placeholder consumed by a surrounding Fragment. When the
// Fragment is in scan mode (Filter set), Slot collects its name for
// later replay.
func (j *J) Slot(name string, body func(*J)) {
	j.SlotP(SlotProps{Name: name}, body)
}

func (j *J) SlotP(p SlotProps, body func(*J)) {
	if j.st.err != nil {
		return
	}
	if j.cur != nil && j.cur.Filter != nil && !j.cur.Filter("slot", p.Name) {
		return
	}
	n := &Node{
		Kind: KindSlot,
		Name: p.Name,
		Path: childPath(j.cur, p.Name),
		Meta: map[string]any{},
	}
	j.attachAndDescend(n, body)
}

// Cmp runs fn under the current frame without allocating a new node.
// It's the Go analogue of the TS cmp() factory for user-authored
// reusable components.
func (j *J) Cmp(name string, fn func(*J)) {
	if j.st.err != nil || fn == nil {
		return
	}
	if j.st.opts.Debug != "" && j.cur != nil {
		j.cur.Meta["callsite"] = name
	}
	fn(j)
}

// InjectProps configures Inject. Markers default to TS's
// "#--START--#\n" / "\n#--END--#" pair when both are empty.
type InjectProps struct {
	Name    string
	Markers [2]string
	Exclude any
}

var defaultInjectMarkers = [2]string{"#--START--#\n", "\n#--END--#"}

// Inject replaces content between markers in an existing file.
func (j *J) Inject(name string, body func(*J)) {
	j.InjectP(InjectProps{Name: name}, body)
}

func (j *J) InjectP(p InjectProps, body func(*J)) {
	if j.st.err != nil {
		return
	}
	markers := p.Markers
	if markers == [2]string{} {
		markers = defaultInjectMarkers
	}
	n := &Node{
		Kind:    KindInject,
		Name:    p.Name,
		Markers: markers,
		Exclude: p.Exclude,
		Path:    childPath(j.cur, p.Name),
		Meta:    map[string]any{},
	}
	j.attachAndDescend(n, body)
}

// FragmentProps configures Fragment.
type FragmentProps struct {
	From    string
	Indent  any
	Replace map[string]any
	Exclude any
	Eject   any
}

// Fragment reads an external template, replays Slot children into
// <[SLOT:name]> markers, and emits the result via Content under the
// surrounding File.
func (j *J) Fragment(p FragmentProps, body func(*J)) {
	j.FragmentP(p, body)
}

func (j *J) FragmentP(p FragmentProps, body func(*J)) {
	if j.st.err != nil {
		return
	}
	// Define-time validation: From must be a non-empty path that
	// resolves on the FS. Mirrors TS FragmentShape's Check(From)
	// at src/cmp/Fragment.ts:11-20.
	if p.From == "" {
		j.st.err = &NodeError{Step: "fragment", Err: fmtErrorf("Fragment: From is required")}
		return
	}
	// Resolve a relative From against the output folder before checking it
	// exists, so validation and the later read agree. Mirrors
	// ts/src/cmp/Fragment.ts, which resolves before its shape check for the
	// same reason.
	p.From = resolveFragmentFrom(j.st, p.From)
	if j.st.fs != nil && !j.st.fs.Exists(p.From) {
		j.st.err = &NodeError{Step: "fragment", Err: fmtErrorf("Fragment: From file does not exist: %s", p.From)}
		return
	}
	if p.Replace == nil {
		p.Replace = map[string]any{}
	}
	n := &Node{
		Kind:    KindFragment,
		From:    p.From,
		Indent:  p.Indent,
		Exclude: p.Exclude,
		Replace: p.Replace,
		Path:    childPath(j.cur, ""),
		Meta:    map[string]any{},
	}
	if j.cur != nil {
		j.cur.Children = append(j.cur.Children, n)
	}
	if j.st.root == nil {
		j.st.root = n
	}
	if body == nil {
		return
	}

	// Stash the body callback on the node so the Fragment op can replay
	// it during build phase. Capture by closure since body is a Go func.
	n.Meta["fragmentBody"] = body
	// Eagerly walk once with a slot-name-collecting filter so
	// Fragment can inject <[SLOT:name]> replace handlers before
	// the build phase runs Template.
	slotNames := map[string]struct{}{}
	n.Filter = func(kind, name string) bool {
		if kind == "slot" {
			slotNames[name] = struct{}{}
		}
		return false
	}
	body(&J{st: j.st, cur: n})
	n.Filter = nil

	// Stash the slot names so the op can build the right replace keys.
	// Sorted for deterministic regex-build order across stacks.
	names := make([]string, 0, len(slotNames))
	for k := range slotNames {
		names = append(names, k)
	}
	sort.Strings(names)
	n.Meta["slotNames"] = names
}

// CopyProps configures Copy.
type CopyProps struct {
	From    string
	To      string
	Replace map[string]any
	Exclude any
	Indent  any
}

// Copy is a leaf component: at define time it just records source/dest;
// the heavy lifting (read, template, walk, write) happens in CopyOp.
func (j *J) Copy(p CopyProps) {
	if j.st.err != nil {
		return
	}
	// Define-time validation matches TS CopyShape's Check(From)
	// at src/cmp/Copy.ts:9-21.
	if p.From == "" {
		j.st.err = &NodeError{Step: "copy", Err: fmtErrorf("Copy: From is required")}
		return
	}
	if j.st.fs != nil && !j.st.fs.Exists(p.From) {
		j.st.err = &NodeError{Step: "copy", Err: fmtErrorf("Copy: From does not exist: %s", p.From)}
		return
	}
	n := &Node{
		Kind:    KindCopy,
		From:    p.From,
		Name:    p.To,
		Replace: p.Replace,
		Exclude: p.Exclude,
		Indent:  p.Indent,
		Path:    childPath(j.cur, p.To),
		Meta:    map[string]any{},
	}
	if j.cur != nil {
		j.cur.Children = append(j.cur.Children, n)
	}
	if j.st.root == nil {
		j.st.root = n
	}
}

// ListProps configures List. Mirrors TS List behaviour:
// after iterating all items a trailing empty Line is emitted unless
// NoLine is true. NoLine inverts TS's `props.line === false` opt-out
// so Go's zero value matches TS's default.
type ListProps struct {
	Item   any
	NoLine bool
	Indent any
}

// List iterates a slice or map and calls body once per item. The body
// receives the same *J (children attach to the surrounding parent).
// After the iteration a trailing empty line is emitted (TS parity).
func (j *J) List(items any, body func(j *J, item any)) {
	j.ListP(ListProps{Item: items}, body)
}

func (j *J) ListP(p ListProps, body func(j *J, item any)) {
	if j.st.err != nil || body == nil {
		return
	}
	for _, item := range Each(p.Item, EachSpec{Raw: true}, nil) {
		body(j, item)
	}
	if !p.NoLine {
		j.Line("")
	}
}

// attachAndDescend is the shared 5-step body: append the node, set root
// on first call, recurse with a child *J. Used by every component
// method that allocates a node.
func (j *J) attachAndDescend(n *Node, body func(*J)) {
	if j.cur != nil {
		j.cur.Children = append(j.cur.Children, n)
	}
	if j.st.root == nil {
		j.st.root = n
	}
	if body != nil {
		body(&J{st: j.st, cur: n})
	}
}

// mergeModel combines the per-call model with optional Content.Extra
// overrides. Mirrors src/cmp/Content.ts:16-19 (right-precedence merge).
func mergeModel(base, extra map[string]any) map[string]any {
	if base == nil && extra == nil {
		return nil
	}
	out := make(map[string]any, len(base)+len(extra))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func strEndsWithNewline(s string) bool {
	return len(s) > 0 && s[len(s)-1] == '\n'
}
