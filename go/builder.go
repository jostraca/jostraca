package jostraca

import (
	"fmt"
	"io/fs"
)

// fmtErrorf wraps fmt.Errorf so other files can use it without importing fmt.
func fmtErrorf(format string, args ...any) error {
	return fmt.Errorf(format, args...)
}

// mustBeInGenerate panics when a component is called on the *J that New
// returned, which belongs to no Generate: it has no node to attach to, so a
// File or a Content dereferenced nil and a Project built a tree that was
// then thrown away. TS's cmp() throws the same text for a component called
// outside generate(). A panic, because a component method has no error
// return and this is a mistake in the calling code, not in its data.
func (j *J) mustBeInGenerate(name string) {
	if j.cur == nil {
		panic(fmt.Sprintf("jostraca: component %s called outside Generate(); "+
			"components can only be used inside the callback passed to Generate()", name))
	}
}

// Builder methods on *J. Each follows the 5-step template from
// PORT_PLAN §5: short-circuit on j.st.err, allocate node, append to
// parent, set root if first call, recurse with a child *J bound to the
// new node.

// ProjectProps is the full options struct for Project. Convenience
// callers should use the positional Project method when they only need
// Folder.
type ProjectProps struct {
	// Names the project, and joins the node path. No output of its own.
	Name string

	// Output folder, joined to Options.Folder. A tree is refused an
	// absolute path or a ".." segment.
	Folder string
}

// Project marks the root of an output tree. Folder is the destination
// directory under Options.Folder.
func (j *J) Project(p ProjectProps, body func(*J)) {
	j.mustBeInGenerate("Project")
	if j.st.err != nil {
		return
	}
	// The node path takes the Project NAME, never its folder, as TS's cmp()
	// pushes props.name. A File exclude names this path.
	n := &Node{
		Kind:   KindProject,
		Name:   p.Name,
		Folder: p.Folder,
		Path:   childPath(j.cur, p.Name),
		Meta:   map[string]any{},
	}
	j.attachAndDescend(n, body)
}

// Folder represents a sub-directory under the current project/folder.
func (j *J) Folder(name string, body func(*J)) {
	j.mustBeInGenerate("Folder")
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
	// Path below the enclosing folder. It may hold "/", so a File can
	// reach into subfolders without a Folder around it. A ".." segment is
	// refused, and so are two Files that resolve to one output path.
	Name string

	// Leave the file alone when it already exists. true always skips it;
	// a string, or a list of strings, names the file's component path:
	// the Project name if any, then the Folder names, then the File name,
	// joined with "/" (never the Project folder). Any other value does not
	// exclude.
	Exclude any

	// Mode sets POSIX permission bits on the generated file, e.g. 0o755 to
	// make a script executable. Zero leaves the platform default, 0666 less
	// the umask (or, when the file already exists, its current mode).
	Mode fs.FileMode
}

// File represents an output file. Children populate its content during
// the define phase.
func (j *J) File(name string, body func(*J)) {
	j.FileP(FileProps{Name: name}, body)
}

func (j *J) FileP(p FileProps, body func(*J)) {
	j.mustBeInGenerate("File")
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
//
// Raw hands the bytes through untouched: no Template, so no model
// substitution and no Replace. Templating is the default, because a
// generator that writes its content at the call site wants the model in
// scope -- that is what Content is for. Raw is for the caller holding
// final bytes from somewhere else, where a `$$...$$` sequence in a
// shell script, a makefile, a doc comment or a regex would otherwise be
// substituted with no diagnostic. An empty model is NOT the same guard:
// `$$"quoted"$$` renders its own literal and `$$__JOSTRACA_REPLACE__$$`
// renders the matcher, neither of them from the model. Indent is
// placement rather than substitution and applies either way.
// NO Arg. TypeScript reads a positional Content('text') into props.arg;
// the positional form here is the Content(src) method, so the field has
// nothing to carry. Held by TestCmpPropsMatchTypeScript, which pins this
// and the ListItems NoLine inversion as the only two field-set
// differences between the ports.
type ContentProps struct {
	// Source text.
	Src string

	// Names the span, and joins the node path. No effect on output.
	Name string

	// A number is that many spaces, a string is a literal prefix.
	Indent any

	// Extra substitutions, keyed by a literal, a /regexp/ or a #Tag.
	Replace map[string]any

	// Merged over the generate model, for this span only.
	Extra map[string]any

	// Hand the bytes through untouched: no model substitution, and so
	// neither Extra nor Replace. See the note above for why templating
	// is the default.
	Raw bool
}

// Content emits a string of text into the surrounding File. Templates
// are applied with the model in scope.
func (j *J) Content(src string) {
	j.ContentP(ContentProps{Src: src})
}

func (j *J) ContentP(p ContentProps) {
	j.mustBeInGenerate("Content")
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

	rendered := p.Src
	if !p.Raw && rendered != "" {
		model := mergeModel(j.st.model, p.Extra)
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

// Line is Content with a trailing newline. DELEGATES to LineP rather
// than carrying its own copy of the rule: the two spellings had drifted
// apart once already, and one of them is enough.
func (j *J) Line(src string) {
	j.LineP(ContentProps{Src: src})
}

// LineP is Content with a newline appended. UNCONDITIONALLY: this used
// to append only when Src did not already end in one, so `Line("a\n")`
// emitted "a\n" here and "a\n\n" in TypeScript, which is what the
// component reference documents ("Line('a\n')" writes "a\n\n"). An
// undocumented divergence rather than a deviation, and TypeScript is
// canonical, so this is the side that moves.
//
// `Line("")` and `Line()` still write one newline, since there was
// nothing to append to.
func (j *J) LineP(p ContentProps) {
	j.mustBeInGenerate("Line")
	p.Src = p.Src + "\n"
	j.ContentP(p)
}

// SlotProps is the options struct for Slot.
type SlotProps struct {
	// Matches the <[SLOT:name]> marker in the enclosing Fragment. Empty
	// means the unnamed <[SLOT]> marker.
	Name string
}

// Slot is a placeholder consumed by a surrounding Fragment. When the
// Fragment is in scan mode (Filter set), Slot collects its name for
// later replay.
func (j *J) Slot(name string, body func(*J)) {
	j.SlotP(SlotProps{Name: name}, body)
}

func (j *J) SlotP(p SlotProps, body func(*J)) {
	j.mustBeInGenerate("Slot")
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
// assembled was flatter than TS's. KindNone carries no op and the content
// collectors walk straight through it, so nesting changes no output on its
// own. See #29.
func (j *J) Cmp(name string, fn func(*J)) {
	if name == "" {
		j.mustBeInGenerate("<anon>")
	} else {
		j.mustBeInGenerate(name)
	}
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
	// Path of the file to edit, below the enclosing folder. It must
	// already exist: Inject rewrites the region between the markers, it
	// does not create a file.
	Name string

	// The start and end marker pair. Both must be non-empty; an empty
	// pair means the default.
	Markers [2]string

	// Leave the target alone. Any truthy value excludes, by JavaScript's
	// rules: nil, false, "", zero and NaN do not; any other value does,
	// an empty list or map included, whatever it names.
	Exclude any
}

var defaultInjectMarkers = [2]string{"#--START--#\n", "\n#--END--#"}

// Inject replaces content between markers in an existing file.
func (j *J) Inject(name string, body func(*J)) {
	j.InjectP(InjectProps{Name: name}, body)
}

func (j *J) InjectP(p InjectProps, body func(*J)) {
	j.mustBeInGenerate("Inject")
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
		pair, _ := marshalJSLike(markers[:])
		j.st.err = fmt.Errorf("Inject: both markers must be non-empty, got %s", pair)
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
//
// NO Exclude. The field was here, was assigned to the node, and was read
// by nothing on either side -- the component reference said so in as
// many words ("Validated and then never read. It has no effect."). Now
// that each component declares its props as a type the package
// publishes, a declaration has to be a promise the code keeps, so it
// goes rather than becoming the one field that means nothing. A tree
// carrying `{"cmp":"Fragment","props":{"exclude":true}}` is refused by
// name from here on, which is the diagnostic it should have had all
// along. TypeScript is canonical and moved first.
type FragmentProps struct {
	// Path of the template file. A relative path resolves against the
	// output folder. The file must exist at define time.
	From string

	// A number is that many spaces, a string is a literal prefix,
	// applied to the whole fragment.
	Indent any

	// Extra substitutions, applied to the template as it is read. The
	// <[SLOT]> markers are added to this, so keep a key of your own
	// distinct from them.
	Replace map[string]any

	// A start and end marker pair: only the region between them is read.
	Eject any
}

// Fragment reads an external template, replays Slot children into
// <[SLOT:name]> markers, and emits the result via Content under the
// surrounding File.
func (j *J) Fragment(p FragmentProps, body func(*J)) {
	j.FragmentP(p, body)
}

func (j *J) FragmentP(p FragmentProps, body func(*J)) {
	j.mustBeInGenerate("Fragment")
	if j.st.err != nil {
		return
	}
	// Define-time validation: From must be a non-empty path that
	// resolves on the FS. Mirrors TS FragmentShape's Check(From)
	// at src/cmp/Fragment.ts:11-20.
	if p.From == "" {
		j.st.err = &NodeError{Step: "fragment", Err: fromMissingErr("Fragment")}
		return
	}
	// Resolve a relative From against the output folder before checking it
	// exists, so validation and the later read agree. Mirrors
	// ts/src/cmp/Fragment.ts, which resolves before its shape check for the
	// same reason.
	p.From = resolveFragmentFrom(j.st, p.From)
	if _, err := j.st.fs.Stat(p.From); err != nil {
		j.st.err = &NodeError{Step: "fragment", Err: fromCheckErr("Fragment", p.From, err)}
		return
	}
	if p.Replace == nil {
		p.Replace = map[string]any{}
	}
	n := &Node{
		Kind:    KindFragment,
		From:    p.From,
		Indent:  p.Indent,
		Replace: p.Replace,
		Path:    childPath(j.cur, ""),
		Meta:    map[string]any{},
	}
	if j.filtered(n) {
		return
	}
	if err := fragmentPropError(p); err != nil {
		j.st.err = &NodeError{Step: "fragment", Err: err}
		return
	}
	if j.cur != nil {
		j.cur.Children = append(j.cur.Children, n)
	}
	if j.st.root == nil {
		j.st.root = n
	}

	// Rendered NOW, as TS renders it inside the component call. See
	// fragment.go.
	renderFragment(j.st, n, body, p.Eject)
}

// CopyFilesProps configures CopyFiles.
//
// NO Indent. The field was here, was assigned to the node, and was
// never read by the copy build step -- so the only thing it did was
// accept a prop the TypeScript side REFUSES outright (CopyFilesShape
// validates a closed set, and `indent` is not in it). A data tree
// carrying `{"cmp":"CopyFiles","props":{"indent":"  "}}` therefore
// generated in Go and threw in TypeScript, which is a parity break in
// the surface rather than in the output. TypeScript is canonical and is
// also right here -- nothing on either side indents a copy -- so the
// field goes. Indenting a spliced copy is a feature, and would arrive
// with an implementation on both sides.
type CopyFilesProps struct {
	// File or directory to copy. Independent of the output folder: a
	// relative path resolves against the process working directory, not
	// against the project. It must exist at define time.
	From string

	// Destination name below the enclosing folder, when it differs from
	// the source name. A directory copy lands under it.
	To string

	// Substitutions applied to copied text. A binary file is copied
	// through unchanged.
	Replace map[string]any

	// Paths to skip, relative to the copied source root. A scalar is as
	// legal as a list; a boolean is accepted and does nothing.
	Exclude any
}

// CopyFiles is a leaf component: at define time it just records
// source/dest; the heavy lifting (read, template, walk, write) happens
// in CopyOp. `From` may name a single file or a whole directory tree.
func (j *J) CopyFiles(p CopyFilesProps) {
	j.mustBeInGenerate("CopyFiles")
	if j.st.err != nil {
		return
	}
	// Define-time validation matches TS CopyShape's Check(From)
	// at src/cmp/Copy.ts:9-21.
	if p.From == "" {
		j.st.err = &NodeError{Step: "copy", Err: fromMissingErr("CopyFiles")}
		return
	}
	if _, err := j.st.fs.Stat(p.From); err != nil {
		j.st.err = &NodeError{Step: "copy", Err: fromCheckErr("CopyFiles", p.From, err)}
		return
	}
	n := &Node{
		Kind:    KindCopy,
		From:    p.From,
		Name:    p.To,
		Replace: p.Replace,
		Exclude: p.Exclude,
		Path:    childPath(j.cur, p.To),
		Meta:    map[string]any{},
	}
	if j.filtered(n) {
		return
	}
	if err := copyFilesPropError(p); err != nil {
		j.st.err = &NodeError{Step: "copy", Err: err}
		return
	}
	if j.cur != nil {
		j.cur.Children = append(j.cur.Children, n)
	}
	if j.st.root == nil {
		j.st.root = n
	}
}

// ListItemsProps configures List. Mirrors TS List behaviour:
// after iterating all items a trailing empty Line is emitted unless
// NoLine is true. NoLine inverts TS's `props.line === false` opt-out
// so Go's zero value matches TS's default.
//
// There is no Replace field, matching TS, where List's own `replace` prop
// is accepted and never used - the one handed to the body is built fresh
// per item.
type ListItemsProps struct {
	// Walked once per element, with each element bound as Item for the
	// body. A slice is walked in order; a map is walked by value.
	Item any

	// Suppress the blank line written after the last item. Inverts
	// TypeScript's `line` so Go's zero value matches its default.
	NoLine bool

	// Set on the node and handed to the body, so the body can apply it
	// itself.
	Indent any
}

// listItemMacro is the replace key List hands to its body. Byte-identical
// to the one TS builds in ts/src/cmp/ListItems.ts, so a template written for
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
//	j.ListP(ListItemsProps{Item: items, Indent: "  "}, func(j *J, it ListItemProps) {
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
	// The element this invocation is for.
	Item any

	// As given to the ListItems. Neither does anything on its own: both
	// are meant to be passed straight into the components in the body.
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

// ListItems iterates a slice or map and calls body once per item. The
// body receives the same *J (children attach to the surrounding
// parent). After the iteration a trailing empty line is emitted (TS
// parity).
//
// NOTE the two struct names, one letter apart and deliberately so:
// ListItemsProps is this component's OPTIONS, ListItemProps is what one
// ITEM hands the body.
func (j *J) ListItems(items any, body func(j *J, it ListItemProps)) {
	j.ListItemsP(ListItemsProps{Item: items}, body)
}

func (j *J) ListItemsP(p ListItemsProps, body func(j *J, it ListItemProps)) {
	j.mustBeInGenerate("ListItems")
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

// THE NAMES TWO COMPONENTS SHIPPED UNDER, kept as DEPRECATED ALIASES so
// no consumer breaks. `CopyFiles` and `ListItems` are the canonical
// spellings: they match jostraca's other verb+noun components and the
// aontu functions that drive them, where plain `copy` and `list` were
// already builtins with unrelated meanings.

// Deprecated: use CopyFilesProps.
type CopyProps = CopyFilesProps

// Deprecated: use ListItemsProps.
type ListProps = ListItemsProps

// Deprecated: use J.CopyFiles.
func (j *J) Copy(p CopyFilesProps) { j.CopyFiles(p) }

// Deprecated: use J.ListItems.
func (j *J) List(items any, body func(j *J, it ListItemProps)) {
	j.ListItems(items, body)
}

// Deprecated: use J.ListItemsP.
func (j *J) ListP(p ListItemsProps, body func(j *J, it ListItemProps)) {
	j.ListItemsP(p, body)
}
