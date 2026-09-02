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

	// Custom delimiters. Empty values use the defaults `\$\$` / `[^$]+`.
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
	if src == "" {
		return "", nil
	}

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

	// Build the assembled regex (cached) and a parallel canon-key map.
	cacheKey := open + "\x00" + closeStr + "\x00" + ref + "\x00" + sortedKeysJoin(specReplace)
	entry := getCachedTemplateRE(cacheKey, func() *templateCacheEntry {
		return buildTemplateRE(open, closeStr, ref, specReplace)
	})
	if entry.err != nil {
		return "", entry.err
	}

	// Build canon-key value map: each user replace key gets a sanitized
	// key under which the engine looks up the actual replacement value.
	canonValues := make(map[string]any, len(entry.canonKeys))
	for _, ck := range entry.canonKeys {
		canonValues[ck.canon] = specReplace[ck.orig]
	}

	insertRE := entry.re
	if spec != nil && spec.Insert != nil {
		insertRE = spec.Insert
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

		insert, err := resolveMatch(insertRE, model, match, groups, canonValues, entry.canonKeys)
		if err != nil {
			return "", err
		}
		emit(insert)
		remain = remain[mEnd:]
		if remain == "" {
			break
		}
	}

	if emitErr != nil {
		return "", emitErr
	}
	if hasHandle {
		return "", nil
	}
	return sb.String(), nil
}

// resolveMatch picks the replacement string for one matched location.
// Order of attempts: model lookup via J_R, custom replacement via J_K*.
// Iterates groups in alphabetical order so output is deterministic
// across stacks (Go map iteration is random by default).
func resolveMatch(insertRE *regexp.Regexp, model any, match string, groups map[string]string,
	canonValues map[string]any, canonKeys []canonKey) (string, error) {
	if ref, ok := groups["J_R"]; ok && ref != "" {
		return resolveModelRef(insertRE, model, match, ref), nil
	}
	user := userGroupView(groups, match)

	keys := sortedKeys(groups)
	// Pass 1: J_K* (literal/regex user keys).
	for _, k := range keys {
		v := groups[k]
		if !strings.HasPrefix(k, "J_K") || v == "" {
			continue
		}
		canon := stripJKPrefix(k)
		val, ok := canonValues[canon]
		if !ok {
			continue
		}
		return invokeReplace(val, user, match), nil
	}
	// Pass 2: J_T* (tag wrappers).
	for _, k := range keys {
		v := groups[k]
		if !strings.HasPrefix(k, "J_T") || v == "" {
			continue
		}
		canon := stripJKPrefix(k)
		val, ok := canonValues[canon]
		if !ok {
			continue
		}
		return invokeReplace(val, user, match), nil
	}
	// Nothing matched usefully — leave the match in place.
	return match, nil
}

// userGroupView returns a stripped, user-friendly view of the named-group
// map. Internal names like J_N1_indent are exposed as `indent`. The full
// match is exposed as `$&` for parity with JS regex-replace conventions.
//
// Iterates input keys in alphabetical order so the deterministic
// "first non-empty wins on collision" behaviour is the same across
// stacks regardless of Go map iteration randomisation.
func userGroupView(groups map[string]string, match string) map[string]string {
	out := make(map[string]string, len(groups)+1)
	for _, k := range sortedKeys(groups) {
		v := groups[k]
		if v == "" {
			continue
		}
		short := stripInternalPrefix(k)
		if short != "" {
			if _, exists := out[short]; !exists {
				out[short] = v
			}
		}
		// Always keep the raw key too for advanced users.
		out[k] = v
	}
	out["$&"] = match
	return out
}

// stripInternalPrefix removes J_K<n>_, J_T<n>_, or J_N<n>_ prefixes,
// returning the bare user-visible name.
func stripInternalPrefix(k string) string {
	for _, prefix := range []string{"J_K", "J_T", "J_N"} {
		if !strings.HasPrefix(k, prefix) {
			continue
		}
		rest := k[len(prefix):]
		i := 0
		for i < len(rest) && rest[i] >= '0' && rest[i] <= '9' {
			i++
		}
		if i > 0 && i < len(rest) && rest[i] == '_' {
			return rest[i+1:]
		}
	}
	return ""
}

func resolveModelRef(insertRE *regexp.Regexp, model any, fullMatch, ref string) string {
	if ref == "__JOSTRACA_REPLACE__" {
		return formatJSStyleRegex(insertRE)
	}
	if strings.HasPrefix(ref, `"`) && strings.HasSuffix(ref, `"`) && len(ref) >= 2 {
		return ref[1 : len(ref)-1]
	}
	val, ok := lookup(model, ref)
	if !ok {
		return fullMatch
	}
	return formatValue(val, fullMatch)
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

// marshalJSLike renders JSON the way JSON.stringify does: no HTML escaping.
// Go's encoding/json escapes <, > and & to \u003c etc by default, which JS
// does not.
//
// Key order is Go's (sorted). TS sorts too — see the note on `jsonify` in
// ts/src/util/basic.ts for why that is the project's convention.
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

// marshalJSLikeSorted renders v with every object key sorted, at every
// depth, by taking it through a generic decode.
//
// encoding/json sorts MAP keys but emits STRUCT fields in DECLARATION
// order, while TS's jsonify sorts every object - so without this a struct
// would be the one shape whose key order depended on how the Go side
// happened to declare it. Every composite goes through it, not only a
// struct at the top: a struct nested inside a map[string]any took the fast
// path and kept its declaration order, which would have left the two
// spellings of the same value disagreeing. See the note on jsonify in
// ts/src/util/basic.ts for why sorting is the convention here.
//
// UseNumber keeps integers exact: decoding into `any` would route every
// number through float64 and silently round anything past 2^53, which is
// the one thing Go can represent here that TS cannot.
//
// The round trip costs about 7.9us against 2.1us for a plain marshal, on
// the model object from test/spec/perf/workloads.tsv. Taken deliberately:
// it is paid only when a macro resolves to a COMPOSITE, which is rare -
// the scalar path is 5.9ns and untouched, and neither template workload
// resolves a macro to a composite at all. Deterministic key order is worth
// more here than microseconds on an uncommon branch.
func marshalJSLikeSorted(v any) (string, error) {
	first, err := marshalJSLike(v)
	if err != nil {
		return "", err
	}
	dec := json.NewDecoder(strings.NewReader(first))
	dec.UseNumber()
	var generic any
	if err := dec.Decode(&generic); err != nil {
		return "", err
	}
	return marshalJSLike(generic)
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

// canonKey records the mapping between the user's replace key and the
// sanitized identifier used as a regex group name.
type canonKey struct {
	orig  string
	canon string
}

type templateCacheEntry struct {
	re        *regexp.Regexp
	canonKeys []canonKey
	err       error
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

func buildTemplateRE(open, closeStr, ref string, replace map[string]any) *templateCacheEntry {
	var sb strings.Builder
	sb.WriteString(`(?P<J_O>` + open + `)`)
	sb.WriteString(`(?P<J_R>` + ref + `)`)
	sb.WriteString(`(?P<J_C>` + closeStr + `)`)

	// sortedKeys, NOT a bare map range. Go randomises map iteration order per
	// process, and sortReplaceKeys is a STABLE sort whose every comparison ends
	// in `len(b) < len(a)` -- so two keys of equal length are a tie and kept
	// whatever order the map happened to yield. Those keys become alternation
	// branches in one assembled regex, and alternation order picks the winner,
	// so the same input produced different output between runs. Measured before
	// this line changed: 20 processes, 19 one way and 1 the other.
	//
	// This makes Go's tie-break alphabetical where TS's is insertion order, the
	// same deliberate deviation OMap already carries for the same reason: a Go
	// map has no insertion order to reproduce. Deterministic and documented
	// beats matching TS and random. See issue #42.
	keys := sortedKeys(replace)
	sortReplaceKeys(keys)

	canonKeys := make([]canonKey, 0, len(keys))
	counter := 1

	for _, k := range keys {
		canon := idenstrTemplate(k)
		canonKeys = append(canonKeys, canonKey{orig: k, canon: canon})

		switch {
		case isRegexKey(k):
			body := k[1 : len(k)-1]
			if unsupportedLookRE.MatchString(body) {
				return &templateCacheEntry{err: fmt.Errorf("%w: %s", ErrLookbehind, k)}
			}
			body = renameUserGroups(body, &counter)
			sb.WriteString("|")
			sb.WriteString(fmt.Sprintf(`(?P<J_K%d_%s>%s)`, counter, canon, body))
			counter++

		case isTagKey(k):
			pattern, err := buildTagRegex(k, &counter)
			if err != nil {
				return &templateCacheEntry{err: err}
			}
			sb.WriteString("|")
			sb.WriteString(fmt.Sprintf(`(?P<J_T%d_%s>%s)`, counter, canon, pattern))
			counter++

		default:
			sb.WriteString("|")
			sb.WriteString(fmt.Sprintf(`(?P<J_K%d_%s>%s)`, counter, canon, regexp.QuoteMeta(k)))
			counter++
		}
	}

	re, err := regexp.Compile(sb.String())
	if err != nil {
		return &templateCacheEntry{err: fmt.Errorf("template: failed to compile assembled regex: %w", err)}
	}
	return &templateCacheEntry{re: re, canonKeys: canonKeys}
}

func isRegexKey(k string) bool {
	return len(k) >= 2 && strings.HasPrefix(k, "/") && strings.HasSuffix(k, "/")
}

var tagKeyRE = regexp.MustCompile(`^#([A-Za-z0-9]+)(-[A-Z][a-z0-9]+)?$`)

func isTagKey(k string) bool {
	return tagKeyRE.MatchString(k)
}

// buildTagRegex synthesises the regex for a #Tag or #Tag-Name key.
// Mirrors src/util/basic.ts:460-468.
func buildTagRegex(k string, counter *int) (string, error) {
	m := tagKeyRE.FindStringSubmatch(k)
	if m == nil {
		return "", fmt.Errorf("invalid tag key: %s", k)
	}
	tagPart := m[1]
	dashPart := ""
	if len(m) > 2 {
		dashPart = m[2]
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(`(?P<J_N%d_indent>[ \t]*)`, *counter))
	*counter++
	sb.WriteString(`//`)
	sb.WriteString(`[ \t]*#`)

	if dashPart == "" {
		// #Foo: capture the dynamic part as TAG=<the literal tag>.
		sb.WriteString(fmt.Sprintf(`(?P<J_N%d_TAG>%s)`, *counter, regexp.QuoteMeta(tagPart)))
		*counter++
	} else {
		// #Foo-Bar: capture an identifier as Bar (TAG holds tagPart).
		inner := dashPart[1:] // drop leading '-'
		sb.WriteString(fmt.Sprintf(`(?P<J_N%d_%s>[A-Za-z0-9]+)`, *counter, inner))
		*counter++
		sb.WriteString(fmt.Sprintf(`-(?P<J_N%d_TAG>%s)`, *counter, regexp.QuoteMeta(inner)))
		*counter++
	}
	sb.WriteString(`[ \t]*\n?`)
	return sb.String(), nil
}

var userGroupRE = regexp.MustCompile(`\(\?P?<([\w\d_]+)>`)

func renameUserGroups(src string, counter *int) string {
	return userGroupRE.ReplaceAllStringFunc(src, func(m string) string {
		// extract original group name
		sub := userGroupRE.FindStringSubmatch(m)
		if len(sub) < 2 {
			return m
		}
		out := fmt.Sprintf(`(?P<J_N%d_%s>`, *counter, sub[1])
		*counter++
		return out
	})
}

// idenstrTemplate sanitises an arbitrary user replace key into a valid
// regex group identifier.
func idenstrTemplate(s string) string {
	var sb strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '_' {
			sb.WriteRune(r)
		} else {
			sb.WriteByte('_')
		}
	}
	out := sb.String()
	// Collapse runs of underscores.
	for strings.Contains(out, "__") {
		out = strings.ReplaceAll(out, "__", "_")
	}
	out = strings.Trim(out, "_")
	if out == "" {
		out = "x"
	}
	return out
}

// sortReplaceKeys mirrors src/util/basic.ts:437-439: # tags first
// (with -dash longer-first, then plain by length); other keys by length
// descending.
func sortReplaceKeys(keys []string) {
	sort.SliceStable(keys, func(i, j int) bool {
		a, b := keys[i], keys[j]
		aTag := strings.HasPrefix(a, "#")
		bTag := strings.HasPrefix(b, "#")
		if aTag && !bTag {
			return true
		}
		if !aTag && bTag {
			return false
		}
		if aTag && bTag {
			aDash := strings.Contains(a, "-")
			bDash := strings.Contains(b, "-")
			if aDash && bDash {
				return len(b) < len(a)
			}
			if aDash && !bDash {
				return true
			}
			if !aDash && bDash {
				return false
			}
			return len(b) < len(a)
		}
		return len(b) < len(a)
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

// stripJKPrefix turns J_K3_foo or J_T2_foo into foo.
func stripJKPrefix(k string) string {
	// k starts with J_K or J_T followed by digits and then underscore.
	if !strings.HasPrefix(k, "J_K") && !strings.HasPrefix(k, "J_T") {
		return k
	}
	// Find first underscore after the digits.
	rest := k[3:]
	for i := 0; i < len(rest); i++ {
		if rest[i] == '_' {
			return rest[i+1:]
		}
	}
	return rest
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
	if !ok {
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
		if v == "" {
			return nil, nil
		}
		// Slash-wrapped strings are user-supplied regex bodies (matches
		// TS at src/util/basic.ts:584-590).
		if len(v) >= 2 && v[0] == '/' && v[len(v)-1] == '/' {
			body := v[1 : len(v)-1]
			ejectCacheMu.Lock()
			defer ejectCacheMu.Unlock()
			if re, ok := ejectCache[v]; ok {
				return re, nil
			}
			re, err := regexp.Compile(body)
			if err != nil {
				return nil, err
			}
			if len(ejectCache) >= 100 {
				ejectCache = make(map[string]*regexp.Regexp, 100)
			}
			ejectCache[v] = re
			return re, nil
		}
		// Bare string markers consume surrounding whitespace plus an
		// optional trailing newline, matching TS getCachedEjectRE.
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

// lookup follows a dot-path through map[string]any/[]any-shaped data.
func lookup(model any, path string) (any, bool) {
	cur := model
	for _, p := range strings.Split(path, ".") {
		switch obj := cur.(type) {
		case map[string]any:
			next, ok := obj[p]
			if !ok {
				return nil, false
			}
			cur = next
		case []any:
			i, err := strconv.Atoi(p)
			if err != nil || i < 0 || i >= len(obj) {
				return nil, false
			}
			cur = obj[i]
		default:
			return nil, false
		}
	}
	return cur, true
}
