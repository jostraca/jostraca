package jostraca

// THE DATA-DRIVEN DEFINE PHASE (twin of ts/src/tree.ts).
//
// `Generate` takes a define-phase FUNCTION, which is the right surface
// for a generator written in Go and the wrong one for a generator
// written anywhere else. aontu evaluates a model to a component tree as
// DATA, and there was no way to hand jostraca one.
//
//	var tree any
//	json.Unmarshal(b, &tree)
//	root, err := jostraca.CmpTree(tree)
//	if err != nil { return err }
//	res, err := jostraca.New().Generate(opts, root)
//
// It is not an interpreter: it calls the same exported components a
// hand-written generator calls, in the same define phase, so every rule
// they already carry holds unchanged and there is no second
// implementation to keep in parity.
//
// The node vocabulary is jostraca's own component surface -- `cmp`
// names a component, `props` is its options and `children` its body --
// so it needs no entry per component and no version of its own.
//
// TWO DIFFERENCES FROM THE TYPESCRIPT SIDE, both forced by the
// language rather than chosen:
//
//   - A CHILD THUNK TAKES THE INHERITED PROPS EXPLICITLY. TypeScript's
//     children are called with the parent's arguments and merged there;
//     Go's component bodies are `func(*J)`, which carries nothing, so
//     the inherited map is a parameter of the internal thunk type. The
//     merge rule is the same: context first, the node's own props last.
//   - NO INHERITED-NAME HAZARD. `cmps[name]` on a Go map answers only
//     for keys the map holds, so the `toString`/`constructor` refusal
//     the TypeScript side needs has nothing to guard against here.

import (
	"fmt"
	"io/fs"
	"path/filepath"
	"strings"
)

// CmpTreeCmp is a component a tree may name beyond the built-in set.
// It receives the node's props and its children as thunks, already
// validated.
type CmpTreeCmp func(j *J, props map[string]any, children []func(*J))

// CmpTreeOptions carries extra components, by the name a node's `cmp`
// uses. Merged over the built-in set, so a caller may add their own or
// override one.
type CmpTreeOptions struct {
	Cmp map[string]CmpTreeCmp
}

// treeThunk is a child of some component. `inherit` carries the props a
// parent binds per invocation -- ListItems' item, indent and replace --
// and is merged UNDER the node's own props.
type treeThunk func(j *J, inherit map[string]any)

// treeCmpNames is the built-in set, and the canonical spelling of each.
var treeCmpNames = []string{
	"Project", "Folder", "File", "Content", "Fragment",
	"Inject", "Line", "Slot", "CopyFiles", "ListItems",
}

// treeCmpDeprecated maps the names two components shipped under to
// their canonical spelling, so a tree written against them still works.
var treeCmpDeprecated = map[string]string{
	"Copy": "CopyFiles",
	"List": "ListItems",
}

func treeErr(msg, path string) error {
	if path == "" {
		path = "<root>"
	}
	return fmt.Errorf("cmpTree: %s (at %s)", msg, path)
}

// --- props readers -------------------------------------------------

func propsMerge(props, inherit map[string]any) map[string]any {
	if len(inherit) == 0 {
		return props
	}
	out := make(map[string]any, len(inherit)+len(props))
	for k, v := range inherit {
		out[k] = v
	}
	for k, v := range props {
		out[k] = v
	}
	return out
}

func propString(p map[string]any, key string) string {
	if s, ok := p[key].(string); ok {
		return s
	}
	return ""
}

func propMap(p map[string]any, key string) map[string]any {
	if m, ok := p[key].(map[string]any); ok {
		return m
	}
	return nil
}

// propMode reads a POSIX mode. JSON numbers decode as float64.
func propMode(p map[string]any) fs.FileMode {
	switch v := p["mode"].(type) {
	case float64:
		return fs.FileMode(uint32(v))
	case int:
		return fs.FileMode(uint32(v))
	}
	return 0
}

// propMarkers reads Inject's marker pair. An absent or malformed pair
// leaves the zero value, which InjectP reads as "not supplied".
func propMarkers(p map[string]any) [2]string {
	out := [2]string{}
	list, ok := p["markers"].([]any)
	if !ok || len(list) != 2 {
		return out
	}
	out[0], _ = list[0].(string)
	out[1], _ = list[1].(string)
	return out
}

// validFolder: THE TREE MAY NOT CHOOSE THE OUTPUT ROOT. ProjectOp takes
// a `folder` as given -- an absolute path unchanged, a relative one
// joined to the base -- which is right when a developer wrote the call
// and wrong when the tree arrived as JSON. File and Folder names are
// already refused a ".." segment; `folder` had no such check because
// nothing could reach it from data.
func validFolder(props map[string]any, path string) error {
	raw, present := props["folder"]
	if !present {
		return nil
	}
	folder, ok := raw.(string)
	if !ok {
		return treeErr("folder is not a string", path)
	}
	if filepath.IsAbs(folder) || strings.HasPrefix(folder, "/") {
		return treeErr("folder must not be absolute: "+folder, path)
	}
	for _, seg := range strings.FieldsFunc(folder, func(r rune) bool {
		return r == '/' || r == '\\'
	}) {
		if seg == ".." {
			return treeErr(`folder must not contain a ".." segment: `+folder, path)
		}
	}
	return nil
}

// --- the walk ------------------------------------------------------

func runChildren(children []treeThunk, inherit map[string]any) func(*J) {
	return func(j *J) {
		for _, ch := range children {
			ch(j, inherit)
		}
	}
}

func nodeThunk(node any, cmps map[string]CmpTreeCmp, path string) (treeThunk, error) {
	obj, ok := node.(map[string]any)
	if !ok {
		return nil, treeErr("node is not an object", path)
	}

	name, ok := obj["cmp"].(string)
	if !ok || name == "" {
		return nil, treeErr("node has no cmp name", path)
	}
	if canon, dep := treeCmpDeprecated[name]; dep {
		name = canon
	}

	props := map[string]any{}
	if raw, present := obj["props"]; present && raw != nil {
		props, ok = raw.(map[string]any)
		if !ok {
			return nil, treeErr("props is not an object", path)
		}
	}
	if err := validFolder(props, path); err != nil {
		return nil, err
	}

	var kids []any
	if raw, present := obj["children"]; present && raw != nil {
		kids, ok = raw.([]any)
		if !ok {
			return nil, treeErr("children is not an array", path)
		}
	}

	children := make([]treeThunk, 0, len(kids))
	for i, kid := range kids {
		th, err := nodeThunk(kid, cmps,
			fmt.Sprintf("%s/%s[%d]", path, name, i))
		if err != nil {
			return nil, err
		}
		children = append(children, th)
	}

	if custom, has := cmps[name]; has {
		return func(j *J, inherit map[string]any) {
			p := propsMerge(props, inherit)
			plain := make([]func(*J), 0, len(children))
			for _, ch := range children {
				ch := ch
				plain = append(plain, func(j *J) { ch(j, nil) })
			}
			custom(j, p, plain)
		}, nil
	}

	build := treeBuild[name]
	if build == nil {
		return nil, treeErr("unknown component: "+name, path)
	}
	return func(j *J, inherit map[string]any) {
		build(j, propsMerge(props, inherit), children)
	}, nil
}

// treeBuild is the dispatch: one entry per component, each reading the
// props it knows and handing the rest of the tree to its body.
var treeBuild map[string]func(*J, map[string]any, []treeThunk)

func init() {
	treeBuild = map[string]func(*J, map[string]any, []treeThunk){
		"Project": func(j *J, p map[string]any, c []treeThunk) {
			j.Project(ProjectProps{
				Name:   propString(p, "name"),
				Folder: propString(p, "folder"),
			}, runChildren(c, nil))
		},
		"Folder": func(j *J, p map[string]any, c []treeThunk) {
			j.Folder(propString(p, "name"), runChildren(c, nil))
		},
		"File": func(j *J, p map[string]any, c []treeThunk) {
			j.FileP(FileProps{
				Name:    propString(p, "name"),
				Exclude: p["exclude"],
				Mode:    propMode(p),
			}, runChildren(c, nil))
		},
		"Content": func(j *J, p map[string]any, _ []treeThunk) {
			j.ContentP(contentProps(p))
		},
		"Line": func(j *J, p map[string]any, _ []treeThunk) {
			j.LineP(contentProps(p))
		},
		"Fragment": func(j *J, p map[string]any, c []treeThunk) {
			j.FragmentP(FragmentProps{
				From:    propString(p, "from"),
				Indent:  p["indent"],
				Replace: propMap(p, "replace"),
				Exclude: p["exclude"],
				Eject:   p["eject"],
			}, runChildren(c, nil))
		},
		"Slot": func(j *J, p map[string]any, c []treeThunk) {
			j.SlotP(SlotProps{Name: propString(p, "name")}, runChildren(c, nil))
		},
		"Inject": func(j *J, p map[string]any, c []treeThunk) {
			j.InjectP(InjectProps{
				Name:    propString(p, "name"),
				Markers: propMarkers(p),
				Exclude: p["exclude"],
			}, runChildren(c, nil))
		},
		"CopyFiles": func(j *J, p map[string]any, _ []treeThunk) {
			j.CopyFiles(CopyFilesProps{
				From:    propString(p, "from"),
				To:      propString(p, "to"),
				Replace: propMap(p, "replace"),
				Exclude: p["exclude"],
				Indent:  p["indent"],
			})
		},
		"ListItems": func(j *J, p map[string]any, c []treeThunk) {
			noline := false
			if b, ok := p["line"].(bool); ok {
				noline = !b
			}
			j.ListItemsP(ListItemsProps{
				Item:   p["item"],
				NoLine: noline,
				Indent: p["indent"],
			}, func(j *J, it ListItemProps) {
				// THE PER-ITEM BINDINGS REACH THE CHILDREN. A
				// hand-written body takes them as its parameter; a data
				// child has none, so they are merged UNDER its own
				// props -- context first, the author's statement last.
				inherit := map[string]any{
					"item":    it.Item,
					"indent":  it.Indent,
					"replace": it.Replace,
				}
				for _, ch := range c {
					ch(j, inherit)
				}
			})
		},
	}
}

func contentProps(p map[string]any) ContentProps {
	return ContentProps{
		Src:     propString(p, "src"),
		Name:    propString(p, "name"),
		Indent:  p["indent"],
		Replace: propMap(p, "replace"),
		Extra:   propMap(p, "extra"),
	}
}

// CmpTree turns a component tree given as data into a define-phase
// callback. The root may be one node or a list of them; a list becomes
// siblings.
//
// The whole tree is walked EAGERLY, so a malformed one is refused by
// this call rather than half way through a define phase that has
// already made folders.
func CmpTree(root any, opts ...CmpTreeOptions) (func(*J), error) {
	cmps := map[string]CmpTreeCmp{}
	for _, o := range opts {
		for k, v := range o.Cmp {
			cmps[k] = v
		}
	}

	nodes, isList := root.([]any)
	if !isList {
		nodes = []any{root}
	}

	thunks := make([]treeThunk, 0, len(nodes))
	for i, n := range nodes {
		th, err := nodeThunk(n, cmps, fmt.Sprintf("[%d]", i))
		if err != nil {
			return nil, err
		}
		thunks = append(thunks, th)
	}

	return runChildren(thunks, nil), nil
}
