package jostraca

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/rjrodger/shape/go/shape"
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

var templateSpecSchema = shape.MustShape(map[string]any{
	"replace": shape.Optional(map[string]any{}),
	"eject":   shape.Optional([]any{shape.String, shape.String}),
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

	if e, ok := validated["eject"].([]any); ok && len(e) == 2 {
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
func resolveMatch(insertRE *regexp.Regexp, model any, match string, groups map[string]string,
	canonValues map[string]any, canonKeys []canonKey) (string, error) {
	if ref, ok := groups["J_R"]; ok && ref != "" {
		return resolveModelRef(insertRE, model, match, ref), nil
	}
	user := userGroupView(groups, match)
	// Else find which J_K* group matched.
	for k, v := range groups {
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
	// Tag-style replacement uses keys named J_T*.
	for k, v := range groups {
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
func userGroupView(groups map[string]string, match string) map[string]string {
	out := make(map[string]string, len(groups)+1)
	for k, v := range groups {
		if v == "" {
			continue
		}
		short := stripInternalPrefix(k)
		if short != "" {
			// First-write wins: the most-specific group (longest internal
			// prefix path) wins because we iterate map order; collisions
			// within one match are rare in practice.
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
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(b)
	default:
		// Best-effort: numbers and unknown types via Go's %v.
		return fmt.Sprintf("%v", v)
	}
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

	keys := make([]string, 0, len(replace))
	for k := range replace {
		keys = append(keys, k)
	}
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
	if startIdx > endIdx {
		return "", nil
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
	case []any:
		if len(v) != 2 {
			return nil, nil, false
		}
		return v[0], v[1], true
	case []string:
		if len(v) != 2 {
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
