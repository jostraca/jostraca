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

// GetX is the rich-path lookup ported from src/util/basic.ts:128-268.
// Supports dot/space-separated navigation, ancestry (`:`), comparison
// filters (`=`, `!=`, `<`, `<=`, `>`, `>=`, `==`, `~`), array filters
// (`?`), array indexing, and quoted segments.
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
			tokens[i] = fmt.Sprint(x)
		}
	default:
		return nil
	}

	var node any = root
	var out any
	ancestry := false

	for i := 0; i < len(tokens) && node != nil; i++ {
		t0 := tokens[i]
		var t1 string
		if i+1 < len(tokens) {
			t1 = tokens[i+1]
		}

		if t1 != "" && getxIsCompareOp(t1) {
			val := getxIndex(node, t0)
			argRaw := ""
			if i+2 < len(tokens) {
				argRaw = tokens[i+2]
			}
			pass := getxCompare(val, t1, argRaw)
			if pass {
				i += 2
			} else {
				node = nil
			}
			if !(ancestry && node != nil) {
				out = node
			}
			continue
		}

		if t1 == ":" {
			// Look ahead: a colon followed by `=` is not an ancestry op.
			next := ""
			if i+2 < len(tokens) {
				next = tokens[i+2]
			}
			if next != "=" {
				if !ancestry {
					out = node
				}
				node = getxIndex(node, t0)
				if node == nil {
					out = nil
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

		if t1 != "" {
			node = getxIndex(node, t0)
			if ancestry {
				ancestry = false
				if node == nil {
					out = nil
				} else {
					node = out
				}
			}
			continue
		}

		// Last token.
		node = getxIndex(node, t0)
		if !(ancestry && node != nil) {
			out = node
		}
	}

	return out
}

// getxTokenize implements the regex-driven splitter from
// src/util/basic.ts:120, dropping pure-whitespace and dot tokens and
// stripping surrounding quotes from quoted segments.
var getxTokenRE = regexp.MustCompile(`\s*("(\\.|[^"\\])*"|[\w\d_]+|\s+|[^\w\d_]+)\s*`)

func getxTokenize(p string) []string {
	out := []string{}
	for _, m := range getxTokenRE.FindAllStringSubmatch(p, -1) {
		tok := m[1]
		if tok == "" {
			continue
		}
		// Skip whitespace-only or dot-only tokens.
		if strings.TrimSpace(tok) == "" || strings.Trim(tok, ".") == "" {
			continue
		}
		// Strip surrounding quotes.
		if len(tok) >= 2 && tok[0] == '"' && tok[len(tok)-1] == '"' {
			tok = tok[1 : len(tok)-1]
		}
		out = append(out, tok)
	}
	return out
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

// getxIndex looks up key on node, treating maps as keyed and slices as
// integer-indexed. Returns nil on miss.
func getxIndex(node any, key string) any {
	switch v := node.(type) {
	case map[string]any:
		if x, ok := v[key]; ok {
			return x
		}
		return nil
	case []any:
		i, err := strconv.Atoi(key)
		if err != nil || i < 0 || i >= len(v) {
			return nil
		}
		return v[i]
	}
	rv := reflect.ValueOf(node)
	switch rv.Kind() {
	case reflect.Map:
		x := rv.MapIndex(reflect.ValueOf(key))
		if !x.IsValid() {
			return nil
		}
		return x.Interface()
	case reflect.Slice, reflect.Array:
		i, err := strconv.Atoi(key)
		if err != nil || i < 0 || i >= rv.Len() {
			return nil
		}
		return rv.Index(i).Interface()
	}
	return nil
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
	switch op {
	case "<":
		return bothNum && vn < an
	case "<=":
		return bothNum && vn <= an
	case ">":
		return bothNum && vn > an
	case ">=":
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
