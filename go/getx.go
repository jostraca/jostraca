package jostraca

import (
	"fmt"
	"reflect"
	"regexp"
	"strconv"
	"strings"
)

// GetXPath is the narrower variant of GetX taking an explicit
// []string token sequence. Equivalent to GetX(root, []string{...}).
// Use when the path is already split.
func GetXPath(root any, tokens []string) any {
	return GetX(root, tokens)
}

// GetXS is the narrower variant of GetX taking a string path.
// Equivalent to GetX(root, "..."). Use when you want the typed
// signature surfaced to call sites.
func GetXS(root any, path string) any {
	return GetX(root, path)
}

// GetX is the rich-path lookup ported from getx in ts/src/util/basic.ts.
// Supports dot/space-separated navigation, ancestry (`:`), comparison
// filters (`=`, `!=`, `<`, `<=`, `>`, `>=`, `==`, `~`), array filters
// (`?`), array indexing, and quoted segments.
//
// Every step is jsProp: an own property of a map, a slice or a string.
// As in TS, a key that is present with a nil value is not the same as an
// absent one: the walk continues through a present nil, and only an
// absent key is a miss.
//
// Returns nil for any miss or invalid path; otherwise the matched value.
func GetX(root any, path any) any {
	if root == nil {
		return nil
	}
	rv := reflect.ValueOf(root)
	if rv.Kind() != reflect.Map && rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
		return nil
	}

	var tokens []string
	switch p := path.(type) {
	case nil:
		return nil
	case string:
		tokens = getxTokenize(p)
	case []string:
		tokens = p
	case []any:
		tokens = make([]string, len(p))
		for i, x := range p {
			tokens[i] = jsString(x)
		}
	default:
		return nil
	}

	out := getxWalk(root, tokens)
	if isUndefined(out) {
		return nil
	}
	return out
}

// getxWalk is the token loop of TS getx. jsUndefined stands for TS's
// undefined wherever the loop tells it apart from null.
func getxWalk(root any, tokens []string) any {
	var node any = root
	var out any = jsUndefined
	ancestry := false

	for i := 0; i < len(tokens) && !isUndefined(node); i++ {
		t0 := tokens[i]
		hasT1 := i+1 < len(tokens)
		var t1 string
		if hasT1 {
			t1 = tokens[i+1]
		}

		if t1 != "" && getxIsCompareOp(t1) {
			val := getxStep(node, t0)
			if isUndefined(val) {
				val = nil
			}
			argRaw := ""
			if i+2 < len(tokens) {
				argRaw = tokens[i+2]
			}
			if getxCompare(val, t1, argRaw) {
				i += 2
			} else {
				node = jsUndefined
			}
			if !(ancestry && !isUndefined(node)) {
				out = node
			}
			continue
		}

		if hasT1 && t1 == ":" {
			// A colon followed by `=` is not an ancestry op.
			if !(i+2 < len(tokens) && tokens[i+2] == "=") {
				if !ancestry {
					out = node
				}
				node = getxStep(node, t0)
				if isUndefined(node) {
					out = jsUndefined
				}
			}
			ancestry = true
			i++
			continue
		}

		if t0 == "?" {
			ftokens := tokens[i+1:]
			// Find filter end: two adjacent identifier tokens mark the end.
			j := 0
			for ; j < len(ftokens); j++ {
				if j+1 < len(ftokens) &&
					getxIsIdent(ftokens[j]) && getxIsIdent(ftokens[j+1]) {
					j++
					break
				}
			}
			ftokens = ftokens[:j]

			children := getxIterChildren(node)
			var filtered []getxItem
			for _, c := range children {
				if GetX(c.v, ftokens) != nil {
					filtered = append(filtered, c)
				}
			}
			node = getxRebuild(node, filtered)
			out = node
			i += len(ftokens)
			continue
		}

		if hasT1 {
			node = getxStep(node, t0)
			if ancestry {
				ancestry = false
				if isUndefined(node) {
					out = jsUndefined
				}
				node = out
			}
			continue
		}

		// Last token.
		node = getxStep(node, t0)
		if !(ancestry && !isUndefined(node)) {
			out = node
		}
	}

	return out
}

// getxStep is one step of the walk: jsUndefined for an absent key.
func getxStep(node any, key string) any {
	if v, ok := jsProp(node, key); ok {
		return v
	}
	return jsUndefined
}

// jsSpaceClass is JavaScript's \s, which RE2's ASCII \s is not: it adds
// \v, U+00A0, U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F,
// U+3000 and U+FEFF.
const jsSpaceClass = `[\t\n\x0B\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]`

// getxTokenRE is GETX_TOKEN_RE from ts/src/util/basic.ts with JavaScript's
// \s spelled out, and JavaScript's '.' (which excludes \r, U+2028 and
// U+2029 as well as \n) in the quoted-string escape.
var getxTokenRE = regexp.MustCompile(jsSpaceClass + `*("(\\[^\n\r\x{2028}\x{2029}]|[^"\\])*"|[\w\d_]+|` +
	jsSpaceClass + `+|[^\w\d_]+)` + jsSpaceClass + `*`)

var jsSpaceRE = regexp.MustCompile(jsSpaceClass)

// getxTokenize splits a string path as TS getx does: a token that
// CONTAINS whitespace or a '.' is dropped, so 'a. b', 'a.?b' and 'a.$'
// all read as 'a b' or 'a', and quotes are stripped only from a token
// matching ^"[^"]+"$.
func getxTokenize(p string) []string {
	out := []string{}
	for _, m := range getxTokenRE.FindAllStringSubmatch(p, -1) {
		tok := m[1]
		if strings.Contains(tok, ".") || jsSpaceRE.MatchString(tok) {
			continue
		}
		out = append(out, jsUnquote(tok))
	}
	return out
}

// jsUnquote strips the quotes from a token matching ^"[^"]+"$, and returns
// anything else unchanged.
func jsUnquote(tok string) string {
	if len(tok) >= 3 && tok[0] == '"' && tok[len(tok)-1] == '"' &&
		!strings.Contains(tok[1:len(tok)-1], `"`) {
		return tok[1 : len(tok)-1]
	}
	return tok
}

func getxIsCompareOp(t string) bool {
	switch t {
	case "=", "!=", "<", "<=", ">", ">=", "==", "~":
		return true
	}
	return false
}

func getxIsIdent(t string) bool {
	if t == "" {
		return false
	}
	for _, r := range t {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '_') {
			return false
		}
	}
	return true
}

// getxCompare runs op on (val, argRaw). argRaw may be a literal string,
// 'true'/'false', a numeric literal, or a quoted string.
func getxCompare(val any, op, argRaw string) bool {
	var arg any = argRaw
	switch argRaw {
	case "true":
		arg = true
	case "false":
		arg = false
	default:
		if len(argRaw) >= 2 && argRaw[0] == '"' && argRaw[len(argRaw)-1] == '"' {
			arg = argRaw[1 : len(argRaw)-1]
		}
	}
	// Numeric coercion when both sides parse as numbers.
	valS := fmt.Sprint(val)
	argS := fmt.Sprint(arg)
	vn, vErr := strconv.ParseFloat(valS, 64)
	an, aErr := strconv.ParseFloat(argS, 64)
	bothNum := vErr == nil && aErr == nil

	// Ordering ops mirror JS `<`/`>`: when both operands are strings the
	// comparison is lexicographic (type-based, so a string `"10"` is less than
	// `"9"`); otherwise both sides are coerced to numbers and non-numeric
	// operands never match. Keeps parity with src/util/basic.ts getx().
	valStr, valIsStr := val.(string)
	argStr, argIsStr := arg.(string)
	bothStr := valIsStr && argIsStr

	switch op {
	case "<":
		if bothStr {
			return valStr < argStr
		}
		return bothNum && vn < an
	case "<=":
		if bothStr {
			return valStr <= argStr
		}
		return bothNum && vn <= an
	case ">":
		if bothStr {
			return valStr > argStr
		}
		return bothNum && vn > an
	case ">=":
		if bothStr {
			return valStr >= argStr
		}
		return bothNum && vn >= an
	case "=":
		if bothNum {
			return vn == an
		}
		return valS == argS
	case "==":
		return reflect.DeepEqual(val, arg)
	case "!=":
		if bothNum {
			return vn != an
		}
		return valS != argS
	case "~":
		re, err := regexp.Compile(argS)
		if err != nil {
			return false
		}
		return re.MatchString(valS)
	}
	return false
}

// getxItem records a single child entry plus its origin key/index
// for rebuilding maps and slices after filtering.
type getxItem struct {
	key string
	idx int
	v   any
}

func getxIterChildren(node any) []getxItem {
	switch v := node.(type) {
	case map[string]any:
		keys := sortedKeys(v)
		out := make([]getxItem, 0, len(keys))
		for _, k := range keys {
			out = append(out, getxItem{key: k, v: v[k]})
		}
		return out
	case []any:
		out := make([]getxItem, len(v))
		for i, x := range v {
			out[i] = getxItem{idx: i, v: x}
		}
		return out
	}
	rv := reflect.ValueOf(node)
	switch rv.Kind() {
	case reflect.Map:
		ks := sortedStringKeys(rv)
		out := make([]getxItem, 0, len(ks))
		for _, k := range ks {
			v := rv.MapIndex(reflect.ValueOf(k)).Interface()
			out = append(out, getxItem{key: k, v: v})
		}
		return out
	case reflect.Slice, reflect.Array:
		out := make([]getxItem, rv.Len())
		for i := 0; i < rv.Len(); i++ {
			out[i] = getxItem{idx: i, v: rv.Index(i).Interface()}
		}
		return out
	}
	return nil
}

// getxRebuild reconstructs a container of the same kind as node from
// the filtered items.
func getxRebuild(node any, items []getxItem) any {
	switch node.(type) {
	case map[string]any:
		out := map[string]any{}
		for _, it := range items {
			out[it.key] = it.v
		}
		return out
	case []any:
		out := make([]any, 0, len(items))
		for _, it := range items {
			out = append(out, it.v)
		}
		return out
	}
	rv := reflect.ValueOf(node)
	switch rv.Kind() {
	case reflect.Map:
		out := map[string]any{}
		for _, it := range items {
			out[it.key] = it.v
		}
		return out
	case reflect.Slice, reflect.Array:
		out := make([]any, 0, len(items))
		for _, it := range items {
			out = append(out, it.v)
		}
		return out
	}
	return nil
}
