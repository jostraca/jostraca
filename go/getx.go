package jostraca

import (
	"reflect"
	"regexp"
	"strings"
	"sync"
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
			var arg any = jsUndefined
			if i+2 < len(tokens) {
				arg = getxArg(tokens[i+2])
			}
			if getxCompare(val, t1, arg) {
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

			node = getxFilter(node, ftokens)
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
	if toks, ok := getxTokenizePlain(p); ok {
		return toks
	}
	getxTokenCacheMu.Lock()
	toks, ok := getxTokenCache[p]
	getxTokenCacheMu.Unlock()
	if ok {
		return toks
	}
	toks = getxTokenizeRE(p)
	getxTokenCacheMu.Lock()
	if len(getxTokenCache) >= getxTokenCacheMax {
		getxTokenCache = make(map[string][]string, getxTokenCacheMax)
	}
	getxTokenCache[p] = toks
	getxTokenCacheMu.Unlock()
	return toks
}

// Tokens are never mutated by the walk, so a cached slice can be shared.
const getxTokenCacheMax = 1000

var (
	getxTokenCacheMu sync.Mutex
	getxTokenCache   = make(map[string][]string, getxTokenCacheMax)
)

// getxTokenizePlain is the regex's answer for the common path made only of
// ASCII word characters, '.' and ' ': every run of word characters is a
// token, and every run of the other two is a dropped separator.
func getxTokenizePlain(p string) ([]string, bool) {
	out := []string{}
	start := -1
	for i := 0; i < len(p); i++ {
		c := p[i]
		switch {
		case (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_':
			if start < 0 {
				start = i
			}
		case c == '.' || c == ' ':
			if start >= 0 {
				out = append(out, p[start:i])
				start = -1
			}
		default:
			return nil, false
		}
	}
	if start >= 0 {
		out = append(out, p[start:])
	}
	return out, true
}

func getxTokenizeRE(p string) []string {
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

// getxIsIdent is TS's filter-end test, /[\w\d_]+/ unanchored: the token
// CONTAINS an ASCII word character, so 't-w' counts.
func getxIsIdent(t string) bool {
	for i := 0; i < len(t); i++ {
		c := t[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '_' {
			return true
		}
	}
	return false
}

// getxArg coerces a comparison argument as TS does: only 'true' and
// 'false' become booleans, and quotes come off ^"[^"]+"$. Nothing is
// parsed as a number -- 'NaN', 'inf' and '1e1' stay strings.
func getxArg(tok string) any {
	switch tok {
	case "true":
		return true
	case "false":
		return false
	}
	return jsUnquote(tok)
}

// getxCompare applies op with JavaScript's semantics: '=' is ==, '==' is
// ===, '!=' is !=, the orderings are JS relational comparison (strings by
// UTF-16 code unit, anything else by ToNumber), and '~' is
// String(val).match(RegExp(arg)). val and arg may be jsUndefined.
//
// '~' compiles with RE2, so a pattern RE2 rejects is a non-match where JS
// would throw, and the two regex dialects differ at their edges.
func getxCompare(val any, op string, arg any) bool {
	switch op {
	case "<":
		lt, undef := jsLessThan(val, arg)
		return !undef && lt
	case ">":
		lt, undef := jsLessThan(arg, val)
		return !undef && lt
	case "<=":
		lt, undef := jsLessThan(arg, val)
		return !undef && !lt
	case ">=":
		lt, undef := jsLessThan(val, arg)
		return !undef && !lt
	case "=":
		return jsLooseEqual(val, arg)
	case "==":
		return jsStrictEqual(val, arg)
	case "!=":
		return !jsLooseEqual(val, arg)
	case "~":
		pattern := "(?:)"
		if !isUndefined(arg) {
			pattern = jsString(arg)
		}
		re, err := regexp.Compile(pattern)
		if err != nil {
			return false
		}
		return re.MatchString(jsString(val))
	}
	return false
}

// getxFilter keeps the RAW children of a map or slice for which the
// filter path resolves to something other than nil, as TS getx '?' does:
// a slice gives a []any in order, a map a map[string]any. Filtering
// anything else is a miss.
func getxFilter(node any, ftokens []string) any {
	switch v := node.(type) {
	case map[string]any:
		out := map[string]any{}
		for k, c := range v {
			if GetX(c, ftokens) != nil {
				out[k] = c
			}
		}
		return out
	case []any:
		out := make([]any, 0, len(v))
		for _, c := range v {
			if GetX(c, ftokens) != nil {
				out = append(out, c)
			}
		}
		return out
	}
	rv := reflect.ValueOf(node)
	switch rv.Kind() {
	case reflect.Map:
		out := map[string]any{}
		iter := rv.MapRange()
		for iter.Next() {
			c := iter.Value().Interface()
			if GetX(c, ftokens) != nil {
				out[jsJSONMapKey(iter.Key())] = c
			}
		}
		return out
	case reflect.Slice, reflect.Array:
		out := make([]any, 0, rv.Len())
		for i := 0; i < rv.Len(); i++ {
			c := rv.Index(i).Interface()
			if GetX(c, ftokens) != nil {
				out = append(out, c)
			}
		}
		return out
	}
	return jsUndefined
}
