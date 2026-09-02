package jostraca

import (
	"fmt"
	"io/fs"
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

	// Mode sets POSIX permission bits on the generated file, e.g. 0o755 to
	// make a script executable. Zero leaves the platform default (or, when
	// the file already exists, its current mode).
	Mode fs.FileMode
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
		Mode:    p.Mode,
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

	// Reject BEFORE rendering. `Template` runs user-supplied ReplaceFunc
	// callbacks, and a Fragment's scan pass rejects every child -- so
	// rendering first fired those callbacks on a pass TS never runs at all,
	// and fired them again on the replay that accepts the child. A callback
	// carrying state saw two calls where TS makes one.
	if j.filteredKind(KindContent, p.Name) {
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
	// The filter check that used to live here is in attachAndDescend now,
	// where it covers every component rather than this one.
	n := &Node{
		Kind: KindSlot,
		Name: p.Name,
		Path: childPath(j.cur, p.Name),
		Meta: map[string]any{},
	}
	j.attachAndDescend(n, body)
}

// Cmp runs fn as a user-authored component. It allocates a KindNone node
// and descends into it, which is what TS's cmp() factory does: it makes a
// `kind: 'none'` node, nests the component's children under it, and passes
// through the enclosing Fragment's filter on the way.
//
// The node is why this is not simply `fn(j)`. Without one, a user component
// used as a direct Fragment child was invisible to the filter, so its body
// ran once per replay pass where TS ran it zero times, and the tree Go
// assembled was flatter than TS's. KindNone carries no op and nodeText
// walks straight through it, so nesting changes no output on its own. See
// #29.
func (j *J) Cmp(name string, fn func(*J)) {
	if j.st.err != nil || fn == nil {
		return
	}

	n := &Node{
		Kind: KindNone,
		Meta: map[string]any{},
	}
	if j.cur != nil {
		n.Path = append([]string(nil), j.cur.Path...)
	}

	// TS records the callsite on the component's OWN node
	// (`node.meta.debug.callsite`), not on its parent, which is where this
	// used to write it for want of a node to write to.
	if j.st.opts.Debug != "" {
		n.Meta["callsite"] = name
	}

	j.attachAndDescend(n, fn)
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
	// Mirrors markersOf in ts/src/cmp/Inject.ts: a pair with exactly one
	// empty marker is rejected, a fully empty pair means "not supplied".
	// An empty marker is a zero-width match, not a marker — it used to hang
	// this stack's scan loop outright and produce regex fallout in TS.
	markers := p.Markers
	if markers == [2]string{} {
		markers = defaultInjectMarkers
	} else if markers[0] == "" || markers[1] == "" {
		j.st.err = fmt.Errorf(
			"Inject: both markers must be non-empty, got %q", markers)
		return
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
	// Eject rides on Meta, the way fragmentBody and slotNames already do.
	// It used to be declared on FragmentProps and read by nothing at all, so
	// a Fragment that trims to a region in TS emitted its whole source file
	// here. Mirrors ts/src/cmp/Fragment.ts, which passes props.eject straight
	// into template(). See PARITY_PLAN.md 3.
	if p.Eject != nil {
		n.Meta["fragmentEject"] = p.Eject
	}
	if j.filtered(n) {
		return
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
	sawNonSlot := false
	n.Filter = func(kind, name string) bool {
		if kind == "slot" {
			slotNames[name] = struct{}{}
		} else {
			sawNonSlot = true
		}
		return false
	}
	body(&J{st: j.st, cur: n})
	n.Filter = nil

	// Which children the scan REJECTED, recorded here because it can no
	// longer be inferred from n.Children: nothing attaches during the scan
	// now, so a Fragment's children are always empty at this point. TS
	// tracks the same thing in a `sawnonslot` local, for the same reason.
	if sawNonSlot {
		n.Meta["fragmentSawNonSlot"] = true
	}

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
	if j.filtered(n) {
		return
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
//
// There is no Replace field, matching TS, where List's own `replace` prop
// is accepted and never used - the one handed to the body is built fresh
// per item.
type ListProps struct {
	Item   any
	NoLine bool
	Indent any
}

// listItemMacro is the replace key List hands to its body. Byte-identical
// to the one TS builds in ts/src/cmp/List.ts, so a template written for
// one stack resolves on the other. `(?<path>...)` is the JS spelling of a
// named group; renameUserGroups in template.go accepts it alongside Go's
// own `(?P<path>...)`.
const listItemMacro = `/{item(\.(?<path>[^}]+))?}/`

// ListItemProps is what a List body receives for each item. It mirrors the
// `{item, indent, replace}` object TS hands to each child.
//
// Indent and Replace are meant to be passed straight through to the
// components inside the body - neither does anything on its own:
//
//	j.ListP(ListProps{Item: items, Indent: "  "}, func(j *J, it ListItemProps) {
//		j.ContentP(ContentProps{
//			Src:     "{item.name}: {item.role}\n",
//			Indent:  it.Indent,
//			Replace: it.Replace,
//		})
//	})
//
// Item is the raw item. TS's props.item is each-WRAPPED (a scalar arrives
// as {val$, index$}), because TS's List iterates with each()'s default
// annotation while this one passes Raw. The macro is unaffected: getx
// cannot address a `$`-suffixed key on either stack, so {item.val$} and
// {item.index$} yield the empty string in TS too - the item argument is
// the documented route to a scalar there as much as here.
//
// Three limits on the macro, identical on both stacks and all quiet:
// a bare {item} yields the empty string, so does a `$`-suffixed key, and
// so does an unresolved path - unlike $$path$$, which is left in place.
type ListItemProps struct {
	Item    any
	Indent  any
	Replace map[string]any
}

// listItemReplace builds the per-item `{item.path}` substitution spec.
func listItemReplace(item any) map[string]any {
	return map[string]any{
		listItemMacro: ReplaceFunc(func(groups map[string]string, _ string) string {
			// The path group is optional: a bare `{item}` leaves it empty,
			// and TS yields "" there rather than the item itself.
			path := groups["path"]
			if path == "" {
				return ""
			}
			v := GetX(item, path)
			if v == nil {
				return ""
			}
			// "" as the fallback, not the full match: an unresolved path
			// yields the empty string here, where an unresolved $$path$$
			// is left in place. TS draws the same distinction - its
			// replace FUNCTIONS have no leave-in-place branch.
			return formatValue(v, "")
		}),
	}
}

// List iterates a slice or map and calls body once per item. The body
// receives the same *J (children attach to the surrounding parent).
// After the iteration a trailing empty line is emitted (TS parity).
func (j *J) List(items any, body func(j *J, it ListItemProps)) {
	j.ListP(ListProps{Item: items}, body)
}

func (j *J) ListP(p ListProps, body func(j *J, it ListItemProps)) {
	if j.st.err != nil || body == nil {
		return
	}

	// List allocates a node for the same reason Cmp does: TS wraps it in
	// `cmp()`, so the enclosing Fragment's filter sees the LIST, not just
	// whatever it emits. Without one the per-item bodies ran during a
	// Fragment's scan pass, and an empty list with NoLine set emitted
	// nothing at all -- so a Fragment with no unnamed marker succeeded here
	// and raised the non-Slot-child error in TS. KindNone carries no op and
	// the content walk goes through it, so the nesting changes no output.
	n := &Node{
		Kind: KindNone,
		Meta: map[string]any{},
	}
	if j.cur != nil {
		n.Path = append([]string(nil), j.cur.Path...)
	}

	j.attachAndDescend(n, func(j *J) {
		for _, item := range Each(p.Item, EachSpec{Raw: true}, nil) {
			body(j, ListItemProps{
				Item:    item,
				Indent:  p.Indent,
				Replace: listItemReplace(item),
			})
		}
		if !p.NoLine {
			j.Line("")
		}
	})
}

// attachAndDescend is the shared 5-step body: append the node, set root
// on first call, recurse with a child *J. Used by every component
// method that allocates a node.
// filtered reports whether the enclosing Fragment rejects this node.
//
// TS consults its filter at `cmp()`, which EVERY component -- built-in and
// user-authored alike -- is wrapped in, so a rejected child never allocates
// and its body never runs. Go used to consult it in SlotP alone, so a
// Fragment's non-Slot children ran during the scan walk and attached, where
// TS's ran zero times. Every component that allocates a node calls this now:
// through attachAndDescend if it takes a body, directly if it does not. See
// #29.
func (j *J) filtered(n *Node) bool {
	return j.filteredKind(n.Kind, n.Name)
}

// filteredKind asks the same question before a node exists, which matters
// for any component that does work while building one. TS rejects at
// `cmp()`, BEFORE the component's function body runs, so anything the body
// would have done -- rendering a template, running a user ReplaceFunc --
// must not happen on a pass that rejects it.
func (j *J) filteredKind(k Kind, name string) bool {
	return j.cur != nil && j.cur.Filter != nil && !j.cur.Filter(kindName(k), name)
}

func (j *J) attachAndDescend(n *Node, body func(*J)) {
	if j.filtered(n) {
		return
	}

	if j.cur != nil {
		j.cur.Children = append(j.cur.Children, n)
	}
	// st.root tracks the first attached node during the define phase.
	// Generate replaces it with the synthetic root once the define phase
	// is done, so top-level siblings are all walked.
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
