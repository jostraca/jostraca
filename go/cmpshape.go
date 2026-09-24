package jostraca

import (
	"fmt"
	"math"
	"reflect"
	"regexp"

	shape "github.com/rjrodger/shape/go"
)

// THE PROP TYPES OF THE TWO CLOSED COMPONENTS. TypeScript's FragmentShape
// and CopyFilesShape refuse a wrongly typed prop when the component is
// called, before anything is written; this port used to take whatever it
// was given, so a CopyFiles with `exclude: 5` copied the whole tree and a
// Fragment with `indent: true` wrote "true" before every line. Each schema
// below states the TS types of one component, and the texts are shape's, so
// a refusal reads the same in both ports.
//
// Content and Line are NOT here: TS Content has no shape, and
// Content({indent: true}) writes "true" as a prefix in both ports.

const (
	faultIndent  = `Value "$VALUE" for property "$PATH" does not satisfy one of: String, Number`
	faultEject   = `Value "$VALUE" for property "$PATH" does not satisfy one of: String, RegExp`
	faultExclude = `Value "$VALUE" for property "$PATH" does not satisfy one of: ` +
		`Boolean, String, RegExp, ["One(String,)"]`
)

var fragmentPropShape = shape.MustShape(map[string]any{
	// Empty(String): a tree's `from` is refused for its type here, and
	// for being absent or missing on disk by FragmentP itself.
	"from":    shape.Skip(shape.Empty(shape.String)),
	"indent":  shape.Skip(shape.Fault(faultIndent, shape.Check(isIndentProp))),
	"replace": shape.Skip(map[string]any{}),
	"eject":   shape.Skip([]any{shape.Fault(faultEject, shape.Check(isMarkerProp))}),
})

var copyFilesPropShape = shape.MustShape(map[string]any{
	"from":    shape.Skip(shape.Empty(shape.String)),
	"to":      shape.Skip(shape.String),
	"replace": shape.Skip(map[string]any{}),
	"exclude": shape.Skip(shape.Fault(faultExclude, shape.Check(isCopyExcludeProp))),
})

// isIndentProp is TS's One(Empty(String), Number), which refuses null. The
// typed API passes an unset Indent as no key at all (fragmentPropError), as
// the tree does (an unset ListItems indent binds nothing).
func isIndentProp(v any, _ *shape.Update, _ *shape.State) bool {
	if _, ok := v.(string); ok {
		return true
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return true
	case reflect.Float32, reflect.Float64:
		return !math.IsNaN(rv.Float())
	}
	return false
}

// isMarkerProp is TS's One(String, RegExp): shape's String refuses "".
func isMarkerProp(v any, _ *shape.Update, _ *shape.State) bool {
	switch x := v.(type) {
	case string:
		return x != ""
	case *regexp.Regexp:
		return x != nil
	}
	return false
}

// isCopyExcludeProp is TS's One(Boolean, String, RegExp, [One(String, RegExp)]).
func isCopyExcludeProp(v any, u *shape.Update, s *shape.State) bool {
	if _, ok := v.(bool); ok {
		return true
	}
	if isMarkerProp(v, u, s) {
		return true
	}
	list, ok := propList(v)
	if !ok {
		return false
	}
	for _, x := range list {
		if !isMarkerProp(x, u, s) {
			return false
		}
	}
	return true
}

// propList reads the list forms a Go caller writes, so shape sees one.
func propList(v any) ([]any, bool) {
	switch x := v.(type) {
	case []any:
		return x, true
	case []string:
		out := make([]any, len(x))
		for i, s := range x {
			out[i] = s
		}
		return out, true
	case []*regexp.Regexp:
		out := make([]any, len(x))
		for i, re := range x {
			out[i] = re
		}
		return out, true
	case [2]string:
		return []any{x[0], x[1]}, true
	case [2]any:
		return []any{x[0], x[1]}, true
	}
	return nil, false
}

// fragmentPropError checks the typed Fragment props TS types and Go leaves
// open: Indent and Eject.
func fragmentPropError(p FragmentProps) error {
	props := map[string]any{}
	if p.Indent != nil {
		props["indent"] = p.Indent
	}
	if p.Eject != nil {
		props["eject"] = p.Eject
		if list, ok := propList(p.Eject); ok {
			props["eject"] = list
		}
	}
	return checkPropShape("Fragment", fragmentPropShape, props)
}

// copyFilesPropError checks the typed CopyFiles prop TS types and Go
// leaves open: Exclude.
func copyFilesPropError(p CopyFilesProps) error {
	props := map[string]any{}
	if p.Exclude != nil {
		props["exclude"] = p.Exclude
	}
	return checkPropShape("CopyFiles", copyFilesPropShape, props)
}

// treePropError checks a data node's props for a closed component before
// they are read into its struct, where a wrongly typed `from`, `to` or
// `replace` would otherwise become "" or nil and pass. A present nil is a
// JSON null, refused as TypeScript refuses it: an unset ListItems indent
// binds no key at all.
func treePropError(name string, p map[string]any) error {
	var sh *shape.Schema
	var keys []string
	switch name {
	case "Fragment":
		sh, keys = fragmentPropShape, []string{"from", "indent", "replace", "eject"}
	case "CopyFiles":
		sh, keys = copyFilesPropShape, []string{"from", "to", "replace", "exclude"}
	default:
		return nil
	}
	props := map[string]any{}
	for _, k := range keys {
		if v, present := p[k]; present {
			props[k] = v
		}
	}
	return checkPropShape(name, sh, props)
}

func checkPropShape(name string, sh *shape.Schema, props map[string]any) error {
	if len(props) == 0 {
		return nil
	}
	if _, err := sh.Validate(props); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}

// refuseProps records a data node's prop type error, if any, as the define
// phase's error, and reports whether it did.
func (j *J) refuseProps(name, step string, p map[string]any) bool {
	if j.st.err != nil {
		return true
	}
	if err := treePropError(name, p); err != nil {
		j.st.err = &NodeError{Step: step, Err: err}
		return true
	}
	return false
}
