package jostraca

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	shape "github.com/rjrodger/shape/go"
)

// ReplaceFunc generates replacement text for regex/literal replacements.
// groups holds named capture groups (when the key is a regex with named
// groups or when the key is a #Tag pattern); match is the full string
// matched. When the key is a literal string, groups is empty.
type ReplaceFunc func(groups map[string]string, match string) string

// TemplateSpec customizes template rendering. Phase 3 widens the type
// surface to match TS feature parity (PORT_PLAN §9).
type TemplateSpec struct {
	Replace map[string]any

	// Eject accepts:
	//   [2]string                    — literal markers (default).
	//   [2]any{string|*regexp.Regexp} — regex pair, or mixed.
	//   []any{...}                   — same as the [2]any form.
	Eject any

	// Custom delimiters. Empty values use the defaults `\$\$` / `[^$]+`;
	// pass `(?:)` for an empty pattern, which is what TS does with ''.
	Open  string
	Close string
	Ref   string

	// Insert overrides the assembled regex if non-nil. Advanced use.
	Insert *regexp.Regexp

	// Handle, if non-nil, receives every output segment instead of the
	// returned string. Used by Fragment streaming. When set, Template
	// returns "".
	Handle func(string)
}

var defaultMacroRE = regexp.MustCompile(`\$\$([^$]+)\$\$`)

// eject is declared as a REPEATED-element array (one element spec), not a
// fixed two-element tuple, matching TS's `Optional([One(String, RegExp)])`
// in cmp/Fragment.ts. The tuple form broke under shape v0.5.0, which no
// longer suppresses element validation when an Optional array is absent:
// a spec with no eject reported both tuple slots missing. The repeated
// form yields an empty slice when absent, still rejects a non-string
// element, and closes a divergence -- a one-element eject is now accepted
// by the schema and then not applied, which is what TS does (util/basic.ts
// requires BOTH markers non-nil before it ejects).
var templateSpecSchema = shape.MustShape(map[string]any{
	"replace": shape.Optional(map[string]any{}),
	"eject":   shape.Optional([]any{shape.String}),
})

// ParseTemplateSpec validates and builds a TemplateSpec from a raw map.
// Phase 1 surface; full schema lands in Phase 12.
func ParseTemplateSpec(raw map[string]any) (*TemplateSpec, error) {
	result, err := templateSpecSchema.Validate(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid template spec: %w", err)
	}

	validated, ok := result.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid template spec: expected map, got %T", result)
	}

	spec := &TemplateSpec{}

	if r, ok := validated["replace"].(map[string]any); ok {
		spec.Replace = r
	}

	// Two OR MORE elements: TS reads eject[0] and eject[1] and ignores the
	// rest (util/basic.ts), so a longer array applies its first pair
	// rather than being discarded. Fewer than two cannot eject at all,
	// since TS requires both markers non-nil.
	if e, ok := validated["eject"].([]any); ok && len(e) >= 2 {
		spec.Eject = e
	}

	return spec, nil
}

// TemplateF is the narrowest variant: just substitute model values
// against $$path$$ placeholders, no replace map, no eject. Equivalent
// to Template(src, model, nil). Use when the call site doesn't need
// any of TemplateSpec.
func TemplateF(src string, model any) (string, error) {
	return Template(src, model, nil)
}

// TemplateR is the model-less variant for replace-only substitutions.
// Equivalent to Template(src, nil, &TemplateSpec{Replace: replace}).
func TemplateR(src string, replace map[string]any) (string, error) {
	return Template(src, nil, &TemplateSpec{Replace: replace})
}

// Template renders src using $$path.to.value$$ placeholders and optional
// replacements. See PORT_PLAN §9 for the supported feature set.
func Template(src string, model any, spec *TemplateSpec) (string, error) {
	out := src

	// Apply eject first.
	if spec != nil && spec.Eject != nil {
		ejected, err := applyEject(out, spec.Eject)
		if err != nil {
			return "", err
		}
		out = ejected
	}

	open, closeStr, ref := delimiters(spec)
	specReplace := map[string]any{}
	if spec != nil && spec.Replace != nil {
		specReplace = spec.Replace
	}

	// The assembled regex (cached), and the replace key each J_K group
	// stands for. A caller's own Insert regex replaces both, as in TS.
	var insertRE *regexp.Regexp
	var groupKey map[string]string
	if spec != nil && spec.Insert != nil {
		insertRE = spec.Insert
	} else {
		cacheKey := open + "\x00" + closeStr + "\x00" + ref + "\x00" + sortedKeysJoin(specReplace)
		entry := getCachedTemplateRE(cacheKey, func() *templateCacheEntry {
			return buildTemplateRE(open, closeStr, ref, specReplace)
		})
		if entry.err != nil {
			return "", entry.err
		}
		insertRE, groupKey = entry.re, entry.groupKey
	}

	hasHandle := spec != nil && spec.Handle != nil
	var sb strings.Builder
	var emitErr error
	emit := func(s string) {
		if hasHandle {
			spec.Handle(s)
		} else {
			sb.WriteString(s)
		}
	}

	remain := out
	for {
		loc := insertRE.FindStringSubmatchIndex(remain)
		if loc == nil {
			emit(remain)
			break
		}
		mStart, mEnd := loc[0], loc[1]
		// Empty-match guard: matches infinite loop in user regex.
		if mStart == mEnd {
			return "", fmt.Errorf("%w: %s", ErrEmptyMatchRegex, insertRE)
		}
		emit(remain[:mStart])

		// Decompose the match into a single replacement and advance.
		groups := namedGroups(insertRE, remain, loc)
		match := remain[mStart:mEnd]

		insert, err := resolveMatch(insertRE, model, match, groups, specReplace, groupKey)
		if err != nil {
			return "", err
		}
		emit(insert)
		remain = remain[mEnd:]
	}

	if emitErr != nil {
		return "", emitErr
	}
	if hasHandle {
		return "", nil
	}
	return sb.String(), nil
}

// resolveMatch picks the replacement string for one matched location: a
// model ref through J_R, or else the replace key whose J_K group matched,
// whose OWN value is used (groupKey maps the group back to the key). A
// match that captured nothing is an error, as TS throws on it.
func resolveMatch(insertRE *regexp.Regexp, model any, match string, groups map[string]string,
	replace map[string]any, groupKey map[string]string) (string, error) {
	if ref, ok := groups["J_R"]; ok {
		if ref == "" {
			return "", fmt.Errorf("%w: %s", ErrEmptyMatchRegex, insertRE)
		}
		return resolveModelRef(insertRE, model, match, ref), nil
	}

	for _, k := range sortedKeys(groups) {
		if !strings.HasPrefix(k, "J_K") {
			continue
		}
		if groups[k] == "" {
			break
		}
		return invokeReplace(replace[groupKey[k]], userGroupView(groups, match), match), nil
	}
	return "", fmt.Errorf("%w: %s", ErrEmptyMatchRegex, insertRE)
}

var userGroupNameRE = regexp.MustCompile(`^J_[NT]\d+_(.+)$`)

// userGroupView is the groups object TS hands a replace function: the
// whole match under `$&`, then every J_N and J_T group that took part
// (even one that matched "") under its stripped name, visited in sorted
// order so a later one overwrites an earlier one. A J_T group, the
// identifier of a #Tag key, also sets `name`. The J_K wrappers and the
// internal names are not exposed.
func userGroupView(groups map[string]string, match string) map[string]string {
	out := make(map[string]string, len(groups)+1)
	out["$&"] = match
	for _, k := range sortedKeys(groups) {
		v := groups[k]
		if !strings.HasPrefix(k, "J_") {
			out[k] = v
			continue
		}
		if m := userGroupNameRE.FindStringSubmatch(k); m != nil {
			out[m[1]] = v
			if strings.HasPrefix(k, "J_T") {
				out["name"] = v
			}
		}
	}
	return out
}

// resolveModelRef resolves a $$ref$$ as TS template does: a quoted
// literal, then the regex itself for __JOSTRACA_REPLACE__, and otherwise
// getx against the model. An unresolved ref (nil or NaN) leaves the macro
// in place.
func resolveModelRef(insertRE *regexp.Regexp, model any, fullMatch, ref string) string {
	if lit, ok := quotedRef(ref); ok {
		return lit
	}
	if ref == "__JOSTRACA_REPLACE__" {
		return formatJSStyleRegex(insertRE)
	}
	val := GetX(model, ref)
	switch f := val.(type) {
	case float64:
		if math.IsNaN(f) {
			return fullMatch
		}
	case float32:
		if math.IsNaN(float64(f)) {
			return fullMatch
		}
	}
	return formatValue(val, fullMatch)
}

// quotedRef is TS's /^"(.+)"$/: at least one character between the
// quotes, and none of them a JavaScript line terminator, since '.' does
// not match \n, \r, U+2028 or U+2029.
func quotedRef(ref string) (string, bool) {
	if len(ref) < 3 || ref[0] != '"' || ref[len(ref)-1] != '"' {
		return "", false
	}
	inner := ref[1 : len(ref)-1]
	if strings.ContainsAny(inner, "\n\r\u2028\u2029") {
		return "", false
	}
	return inner, true
}

// invokeReplace runs the value (which may be a string, function, or
// scalar) for the matched context.
func invokeReplace(val any, groups map[string]string, match string) string {
	switch v := val.(type) {
	case nil:
		return ""
	case string:
		return v
	case ReplaceFunc:
		return v(groups, match)
	case func(map[string]string, string) string:
		return v(groups, match)
	case func() any:
		return formatValue(v(), match)
	case func() string:
		return v()
	default:
		return fmt.Sprintf("%v", v)
	}
}

// formatValue stringifies a value found by model lookup. Strings pass
// through; nil/NaN-equivalent leaves the macro untouched (caller passes
// the full match to keep behaviour); maps/slices/structs JSON-marshal;
// numbers/bools format with Go's %v which matches TS in the common case.
func formatValue(v any, fallback string) string {
	switch v := v.(type) {
	case nil:
		return fallback
	case string:
		return v
	case fmt.Stringer:
		return v.String()
	case bool:
		if v {
			return "true"
		}
		return "false"
	case func() any:
		return formatValue(v(), fallback)
	case func() string:
		return v()
	case map[string]any, []any, []string, map[string]string:
		b, err := marshalJSLikeSorted(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return b

	// Numbers must format the way JavaScript formats them, since TS is the
	// canonical implementation and its numbers are all float64. Go's %v
	// differs on exponent padding and on when it switches to exponential
	// notation.
	case float64:
		return formatJSNumber(v)
	case float32:
		return formatJSNumber(float64(v))
	}

	// The four cases above are the fast path for the shapes that arrive from
	// JSON or YAML. Any OTHER composite has to reach the same formatter, or
	// ordinary typed Go data renders in Go's debug syntax: a
	// map[string]int{"a": 1} came out as `map[a:1]`, a []int as `[1 2]` and
	// a struct as `{1 x}`, where TS - which has one object type and JSONifies
	// all of it - gives {"a":1}, [1,2] and {"a":1,"b":"x"}. Only the TOP
	// level was affected, since encoding/json handles a typed value nested
	// inside a recognised one.
	//
	// The kind test runs after the type switch, so fmt.Stringer still wins:
	// a time.Time keeps its String() form rather than becoming a JSON
	// timestamp.
	if rv := reflect.ValueOf(v); rv.IsValid() {
		switch rv.Kind() {
		case reflect.Map, reflect.Array, reflect.Struct:
			if b, err := marshalJSLikeSorted(v); err == nil {
				return b
			}
		case reflect.Slice:
			// []byte deliberately excluded, and left exactly as it was.
			// encoding/json renders a byte slice as base64, while TS renders
			// a Buffer through its toJSON as {"type":"Buffer","data":[...]}.
			// Neither matches the other, so this fix does not pretend to
			// settle it - that needs its own decision.
			if rv.Type().Elem().Kind() != reflect.Uint8 {
				if b, err := marshalJSLikeSorted(v); err == nil {
					return b
				}
			}
		}
	}

	// Pointers are also left alone. Dereferencing one raises questions this
	// fix should not answer on its own - what a nil pointer renders as, and
	// whether a pointer is a value or a reference to the caller.
	return fmt.Sprintf("%v", v)
}

// marshalJSLike is encoding/json with HTML escaping off. It is only the
// normalising first pass for structs and marshalers (see jsJSON): its key
// order and its escaping of U+2028/U+2029 are not JSON.stringify's.
func marshalJSLike(v any) (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return "", err
	}
	// Encode appends a newline.
	return strings.TrimSuffix(buf.String(), "\n"), nil
}

// marshalJSLikeSorted renders v as TS's jsonify does:
// JSON.stringify(sortKeys(v)). See jsJSON.
func marshalJSLikeSorted(v any) (string, error) {
	return jsJSON(v)
}

// formatJSNumber renders a float the way ECMAScript's Number::toString
// does, because TS is canonical and every number there is a float64.
//
// Go's %v disagrees in two ways that reach generated output:
//
//	1e-7   Go "1e-07"                  JS "1e-7"      (exponent zero-padding)
//	9007199254740992
//	       Go "9.007199254740992e+15"  JS "9007199254740992"
//
// JS uses positional notation while 1e-6 <= |v| < 1e21, and exponential
// outside that, with no zero-padding in the exponent.
func formatJSNumber(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		// JS String(-0) is "0".
		return "0"
	}

	abs := math.Abs(f)
	if abs >= 1e21 || abs < 1e-6 {
		return trimExponentZeros(strconv.FormatFloat(f, 'e', -1, 64))
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// trimExponentZeros rewrites Go's zero-padded exponent to JS's unpadded
// form: "1e-07" becomes "1e-7". "1.5e+300" is unchanged.
func trimExponentZeros(s string) string {
	at := strings.IndexAny(s, "eE")
	if at < 0 {
		return s
	}

	mantissa, exp := s[:at], s[at+1:]

	sign := ""
	if len(exp) > 0 && (exp[0] == '+' || exp[0] == '-') {
		sign, exp = string(exp[0]), exp[1:]
	}

	exp = strings.TrimLeft(exp, "0")
	if exp == "" {
		exp = "0"
	}

	return mantissa + "e" + sign + exp
}

func formatJSStyleRegex(re *regexp.Regexp) string {
	// Convert Go's (?P<name>...) to JS-style (?<name>...) for parity
	// with TS, then wrap in /.../.
	src := re.String()
	src = strings.ReplaceAll(src, "(?P<", "(?<")
	return "/" + src + "/"
}

func delimiters(spec *TemplateSpec) (open, closeStr, ref string) {
	open = `\$\$`
	closeStr = `\$\$`
	ref = `[^$]+`
	if spec != nil {
		if spec.Open != "" {
			open = spec.Open
		}
		if spec.Close != "" {
			closeStr = spec.Close
		}
		if spec.Ref != "" {
			ref = spec.Ref
		}
	}
	return
}

type templateCacheEntry struct {
	re *regexp.Regexp
	// groupKey maps each J_K group name to the replace key it stands for.
	groupKey map[string]string
	err      error
}

const templateCacheMax = 100

var (
	templateCacheMu sync.Mutex
	templateCache   = make(map[string]*templateCacheEntry, templateCacheMax)
)

func getCachedTemplateRE(key string, build func() *templateCacheEntry) *templateCacheEntry {
	templateCacheMu.Lock()
	defer templateCacheMu.Unlock()
	if e, ok := templateCache[key]; ok {
		return e
	}
	if len(templateCache) >= templateCacheMax {
		// Simple full-clear matches TS; LRU is over-engineered for v1.
		templateCache = make(map[string]*templateCacheEntry, templateCacheMax)
	}
	e := build()
	templateCache[key] = e
	return e
}

// unsupportedLookRE detects RE2-incompatible JS regex constructs.
var unsupportedLookRE = regexp.MustCompile(`\(\?<?[!=]`)

// buildTemplateRE assembles the regex exactly as TS template does, group
// names and numbering included: a J_K<n>_<key> wrapper per replace key,
// numbered before the groups inside it, then J_N<n>_<name> for a regex
// key's own named groups, and for a #Tag key J_N<n>_indent, J_T<n>_<Name
// or TAG> for the identifier and, with a dash, J_N<n>_TAG. The sanitised
// key in a J_K name is decoration: groupKey maps it back.
func buildTemplateRE(open, closeStr, ref string, replace map[string]any) *templateCacheEntry {
	var sb strings.Builder
	sb.WriteString(`(?P<J_O>` + open + `)`)
	sb.WriteString(`(?P<J_R>` + ref + `)`)
	sb.WriteString(`(?P<J_C>` + closeStr + `)`)

	keys := sortedKeys(replace)
	sortReplaceKeys(keys)

	groupKey := make(map[string]string, len(keys))
	counter := 1

	for _, k := range keys {
		gname := fmt.Sprintf("J_K%d_%s", counter, idenstrTemplate(k))
		counter++
		groupKey[gname] = k

		var body string
		switch {
		case isRegexKey(k):
			body = k[1 : len(k)-1]
			if unsupportedLookRE.MatchString(body) {
				return &templateCacheEntry{err: fmt.Errorf("%w: %s", ErrLookbehind, k)}
			}
			body = renameUserGroups(body, &counter)

		case isTagKey(k):
			body = buildTagRegex(k, &counter)

		default:
			body = regexp.QuoteMeta(k)
		}
		sb.WriteString("|(?P<" + gname + ">" + body + ")")
	}

	re, err := regexp.Compile(sb.String())
	if err != nil {
		return &templateCacheEntry{err: fmt.Errorf("template: failed to compile assembled regex: %w", err)}
	}
	return &templateCacheEntry{re: re, groupKey: groupKey}
}

// isRegexKey is TS's /^\/.+\/$/: at least one character between the
// slashes, none of them a line terminator, so '/' and '//' are literal
// keys.
func isRegexKey(k string) bool {
	return len(k) >= 3 && k[0] == '/' && k[len(k)-1] == '/' &&
		!strings.ContainsAny(k[1:len(k)-1], "\n\r\u2028\u2029")
}

var tagKeyRE = regexp.MustCompile(`^#([A-Za-z0-9]+)(-[A-Z][a-z0-9]+)?$`)

func isTagKey(k string) bool {
	return tagKeyRE.MatchString(k)
}

// buildTagRegex synthesises the regex for a #Tag or #Tag-Name key, in
// TS's layout (the [ \t] classes hold a real tab, as the TS source does).
func buildTagRegex(k string, counter *int) string {
	m := tagKeyRE.FindStringSubmatch(k)
	tag, dash := m[1], m[2]

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("(?P<J_N%d_indent>[ \t]*)", *counter))
	*counter++
	sb.WriteString(`\/\/`)
	sb.WriteString("[ \t]*#")

	if dash == "" {
		sb.WriteString(fmt.Sprintf("(?P<J_T%d_TAG>%s)", *counter, tag))
		*counter++
	} else {
		name := dash[1:]
		sb.WriteString(fmt.Sprintf("(?P<J_T%d_%s>[A-Za-z0-9]+)", *counter, name))
		*counter++
		sb.WriteString(fmt.Sprintf("-(?P<J_N%d_TAG>%s)", *counter, name))
		*counter++
	}
	sb.WriteString("[ \t]*" + `\n?`)
	return sb.String()
}

var userGroupRE = regexp.MustCompile(`\(\?P?<([\w\d_]+)>`)

func renameUserGroups(src string, counter *int) string {
	return userGroupRE.ReplaceAllStringFunc(src, func(m string) string {
		sub := userGroupRE.FindStringSubmatch(m)
		out := fmt.Sprintf(`(?P<J_N%d_%s>`, *counter, sub[1])
		*counter++
		return out
	})
}

// idenstrTemplate is TS's idenstr(k).replace(/_+/g, '_'): every character
// that is not an ASCII word character becomes '_', and runs of '_'
// collapse. The result can be empty, which still makes a valid group name
// once prefixed.
func idenstrTemplate(s string) string {
	var sb strings.Builder
	under := false
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			sb.WriteRune(r)
			under = false
			continue
		}
		if !under {
			sb.WriteByte('_')
		}
		under = true
	}
	return sb.String()
}

// sortReplaceKeys orders replace keys as TS replaceKeyOrder does, by one
// total order that depends only on the key set: '#Tag-Name' keys first,
// then longer before shorter (in UTF-16 units), then by UTF-16 code unit.
func sortReplaceKeys(keys []string) {
	rank := func(k string) int {
		if strings.HasPrefix(k, "#") && strings.Contains(k, "-") {
			return 0
		}
		return 1
	}
	sort.SliceStable(keys, func(i, j int) bool {
		a, b := keys[i], keys[j]
		if ra, rb := rank(a), rank(b); ra != rb {
			return ra < rb
		}
		if la, lb := utf16Len(a), utf16Len(b); la != lb {
			return la > lb
		}
		return jsLess(a, b)
	})
}

func sortedKeysJoin(m map[string]any) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return strings.Join(keys, "\x00")
}

// namedGroups extracts named subgroups from a successful match's index
// array. groups[k] is empty if group k didn't match.
func namedGroups(re *regexp.Regexp, src string, loc []int) map[string]string {
	names := re.SubexpNames()
	out := make(map[string]string, len(names))
	for i, n := range names {
		if n == "" {
			continue
		}
		start, end := loc[2*i], loc[2*i+1]
		if start < 0 || end < 0 {
			continue
		}
		out[n] = src[start:end]
	}
	return out
}

// applyEject returns src with content outside the eject markers removed.
func applyEject(src string, eject any) (string, error) {
	if eject == nil {
		return src, nil
	}
	starts, ends, ok := decomposeEject(eject)
	// Both markers or neither, as TS requires both non-null before it
	// ejects: one nil marker leaves the source alone.
	if !ok || isNilMarker(starts) || isNilMarker(ends) {
		return src, nil
	}
	startIdx := 0
	endIdx := len(src)
	if startRE, err := compileEjectMarker(starts); err != nil {
		return src, err
	} else if startRE != nil {
		if loc := startRE.FindStringIndex(src); loc != nil {
			startIdx = loc[1]
		}
	}
	if endRE, err := compileEjectMarker(ends); err != nil {
		return src, err
	} else if endRE != nil {
		if loc := endRE.FindStringIndex(src); loc != nil {
			endIdx = loc[0]
		}
	}
	// An end marker resolving before the start marker is malformed: there
	// is no region between them. Leave the source alone, which is what
	// already happens when neither marker is found. Mirrors
	// ts/src/util/basic.ts.
	if startIdx > endIdx {
		return src, nil
	}
	return src[startIdx:endIdx], nil
}

// isNilMarker reports an absent marker: nil, or a typed nil
// *regexp.Regexp.
func isNilMarker(v any) bool {
	if v == nil {
		return true
	}
	re, ok := v.(*regexp.Regexp)
	return ok && re == nil
}

// decomposeEject extracts the start and end markers from any of the
// accepted eject value forms.
func decomposeEject(eject any) (start, end any, ok bool) {
	switch v := eject.(type) {
	case [2]string:
		return v[0], v[1], true
	case [2]any:
		return v[0], v[1], true
	// A slice carrying MORE than two markers yields its first pair, which
	// is what TS does -- util/basic.ts indexes eject[0] and eject[1] and
	// never looks past them. Requiring exactly two here silently disabled
	// eject for a longer slice handed straight to TemplateSpec.Eject.
	case []any:
		if len(v) < 2 {
			return nil, nil, false
		}
		return v[0], v[1], true
	case []string:
		if len(v) < 2 {
			return nil, nil, false
		}
		return v[0], v[1], true
	}
	return nil, nil, false
}

var ejectCacheMu sync.Mutex
var ejectCache = make(map[string]*regexp.Regexp, 100)

func compileEjectMarker(v any) (*regexp.Regexp, error) {
	switch v := v.(type) {
	case nil:
		return nil, nil
	case *regexp.Regexp:
		return v, nil
	case string:
		// A STRING MARKER IS LITERAL, slashes and all, and the empty
		// string included (TS getCachedEjectRE('') is `[ \t]*[ \t]*\n?`).
		// Go used to unwrap "/START/" as a regex body on a citation that
		// pointed at the function-replacement branch instead; TS's eject
		// path always escapes, so the two disagreed on exactly that shape.
		// Regex ejection is still genuine API, through a *regexp.Regexp
		// above, which both ports take (DEPENDENCY_PLAN.md 9.3).
		//
		// Markers consume surrounding whitespace plus an optional
		// trailing newline, matching TS getCachedEjectRE.
		ejectCacheMu.Lock()
		defer ejectCacheMu.Unlock()
		if re, ok := ejectCache[v]; ok {
			return re, nil
		}
		re, err := regexp.Compile(`[ \t]*` + regexp.QuoteMeta(v) + `[ \t]*\n?`)
		if err != nil {
			return nil, err
		}
		if len(ejectCache) >= 100 {
			ejectCache = make(map[string]*regexp.Regexp, 100)
		}
		ejectCache[v] = re
		return re, nil
	}
	return nil, fmt.Errorf("eject marker: unsupported type %T", v)
}
