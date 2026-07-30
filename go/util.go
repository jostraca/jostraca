package jostraca

import (
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// EachSpec configures Each. Field semantics differ from TS in two
// places (PORT_PLAN §14, Phase-4 BUILD_LOG):
//
//	Raw    — if true, items are returned as-is (TS oval=false). If
//	         false (default), scalar items are wrapped in {val$, index$}
//	         or {key$, val$} matching TS's default oval=true behaviour;
//	         items that are already map[string]any pass through and
//	         only get the index$/key$ stamp.
//	NoMark — if true, suppress the index$/key$ marker that TS adds by
//	         default. Inverted from TS so Go zero value matches TS
//	         default mark=true.
//	Sort   — sort by stringified value (slices) or by key (maps).
type EachSpec struct {
	NoMark bool
	Raw    bool
	Sort   bool
	Args   any
}

// Each iterates a slice or map and applies a transform. Mirrors
// src/util/basic.ts:7-107.
func Each(subject any, spec EachSpec, apply func(any) any) []any {
	if subject == nil {
		return []any{}
	}
	rv := reflect.ValueOf(subject)
	switch rv.Kind() {
	case reflect.Slice, reflect.Array:
		items := make([]any, rv.Len())
		for i := 0; i < rv.Len(); i++ {
			items[i] = rv.Index(i).Interface()
		}
		if spec.Sort {
			sort.SliceStable(items, func(a, b int) bool {
				return fmt.Sprint(items[a]) < fmt.Sprint(items[b])
			})
		}
		out := make([]any, 0, len(items))
		for i, item := range items {
			val := item
			if !spec.Raw {
				// TS basic.ts:39-49: when oval=true (default), object
				// items pass through untouched; non-objects get wrapped
				// as {val$: n}. Then mark=true (default) writes index$
				// onto whichever object now sits in the slot.
				if m, ok := item.(map[string]any); ok {
					if !spec.NoMark {
						m["index$"] = i
					}
					val = m
				} else {
					val = map[string]any{"val$": item, "index$": i}
				}
			} else if !spec.NoMark {
				// Raw=true (oval=false) + mark=true: set index$ only on
				// object items, leave scalars unchanged. Mirrors TS at
				// basic.ts:47-49.
				if m, ok := val.(map[string]any); ok {
					m["index$"] = i
				}
			}
			if apply != nil {
				val = apply(val)
			}
			out = append(out, val)
		}
		return out
	case reflect.Map:
		// Always sort by key for cross-stack determinism; spec.Sort
		// remains for explicit-by-value sort which is unimplemented.
		ks := sortedStringKeys(rv)
		out := make([]any, 0, len(ks))
		for _, k := range ks {
			v := rv.MapIndex(reflect.ValueOf(k)).Interface()
			var val any
			if spec.Raw {
				val = v
				if !spec.NoMark {
					if m, ok := val.(map[string]any); ok {
						m["key$"] = k
					}
				}
			} else {
				// TS basic.ts:79-89: when oval=true and value is already
				// an object, pass through and stamp key$ onto it. Only
				// scalars get wrapped as {key$, val$}.
				if m, ok := v.(map[string]any); ok {
					if !spec.NoMark {
						m["key$"] = k
					}
					val = m
				} else {
					val = map[string]any{"key$": k, "val$": v}
				}
			}
			if apply != nil {
				val = apply(val)
			}
			out = append(out, val)
		}
		return out
	default:
		return []any{}
	}
}

// EachF is the simplest narrower variant of Each: a pure transform of
// each item with no `{val$, index$}` wrapping. Equivalent to
// Each(items, EachSpec{Raw: true}, fn) for slices. Use when you have a
// typed slice and just want to map over it.
func EachF(items any, fn func(val any) any) []any {
	return Each(items, EachSpec{Raw: true}, fn)
}

// EachI iterates a slice (or array-shaped value) and calls fn with each
// raw item plus its 0-based index. Mirrors the TS overload
// `each(items, (item, idx) => ...)` from src/util/basic.ts.
//
// fn may return any value; the return is collected into the result slice.
// nil items input yields an empty slice.
func EachI(items any, fn func(val any, idx int) any) []any {
	if items == nil {
		return []any{}
	}
	rv := reflect.ValueOf(items)
	if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
		return []any{}
	}
	out := make([]any, 0, rv.Len())
	for i := 0; i < rv.Len(); i++ {
		out = append(out, fn(rv.Index(i).Interface(), i))
	}
	return out
}

// EachKV iterates a map and calls fn with the wrapped value
// (`{key$, val$}`), the key, and the 0-based index. Mirrors the
// 3-arg TS callback at test/utility.test.ts:55-58.
//
// Map iteration order in Go is randomised; EachKV sorts by key for
// determinism. Pass EachKVRaw if you want the raw value instead of
// the wrapped form.
func EachKV(m any, fn func(val any, key string, idx int) any) []any {
	if m == nil {
		return []any{}
	}
	rv := reflect.ValueOf(m)
	if rv.Kind() != reflect.Map {
		return []any{}
	}
	keys := make([]string, 0, rv.Len())
	for _, k := range rv.MapKeys() {
		keys = append(keys, fmt.Sprint(k.Interface()))
	}
	sort.Strings(keys)
	out := make([]any, 0, len(keys))
	for i, k := range keys {
		v := rv.MapIndex(reflect.ValueOf(k)).Interface()
		wrapped := map[string]any{"key$": k, "val$": v}
		out = append(out, fn(wrapped, k, i))
	}
	return out
}

// EachKVRaw is EachKV's pass-through variant: fn receives the raw
// value rather than the {key$, val$} wrapper.
func EachKVRaw(m any, fn func(val any, key string, idx int) any) []any {
	if m == nil {
		return []any{}
	}
	rv := reflect.ValueOf(m)
	if rv.Kind() != reflect.Map {
		return []any{}
	}
	keys := make([]string, 0, rv.Len())
	for _, k := range rv.MapKeys() {
		keys = append(keys, fmt.Sprint(k.Interface()))
	}
	sort.Strings(keys)
	out := make([]any, 0, len(keys))
	for i, k := range keys {
		v := rv.MapIndex(reflect.ValueOf(k)).Interface()
		out = append(out, fn(v, k, i))
	}
	return out
}

// Get is a simple dot-path lookup over map[string]any/[]any-shaped data.
func Get(root any, path string) any {
	if path == "" {
		return nil
	}
	v, ok := lookup(root, path)
	if !ok {
		return nil
	}
	return v
}

// Camelify converts foo-bar / foo_bar / foo bar / FooBar variants to
// FooBar (PascalCase). nil / non-string scalars stringify per TS.
func Camelify(input any) string {
	parts := Partify(input)
	var sb strings.Builder
	for _, p := range parts {
		if p == "" {
			continue
		}
		runes := []rune(p)
		// Preserve embedded uppercase when it matches camelCase transitions.
		// "FooBar" → ["Foo", "Bar"] → "FooBar"; "fooBar" → ["foo", "Bar"] → "FooBar".
		runes[0] = unicode.ToUpper(runes[0])
		sb.WriteString(string(runes))
	}
	return sb.String()
}

// Snakify converts variants to lowercase snake_case.
func Snakify(input any) string {
	parts := Partify(input)
	for i, p := range parts {
		parts[i] = strings.ToLower(p)
	}
	return strings.Join(parts, "_")
}

// Kebabify converts variants to lowercase kebab-case.
func Kebabify(input any) string {
	parts := Partify(input)
	for i, p := range parts {
		parts[i] = strings.ToLower(p)
	}
	return strings.Join(parts, "-")
}

// Partify splits an input string into words on `-`, `_`, a literal space,
// and ASCII camelCase boundaries, first collapsing acronym runs so
// `XMLParser` becomes `Xml`+`Parser`. A slice input passes through with
// only empty elements dropped -- it is NOT re-split. nil and non-string
// scalars stringify per TS coercion ('null', 'true', etc.).
//
// A faithful port of `partify` in src/util/basic.ts; see the helpers
// below for the pieces that stand in for its regexes.
func Partify(input any) []string {
	switch v := input.(type) {
	case nil:
		return []string{"null"}

	case string:
		if v == "" {
			return []string{}
		}
		return glueInitials(splitOnUpperAndSeps(collapseAcronyms(v)))

	// Array input is passed through, only stringified and emptied-filtered.
	// TS does NOT split array elements on case or separators
	// (src/util/basic.ts: `input.map(n => '' + n).filter(...)`), so neither
	// does this.
	case []string:
		out := make([]string, 0, len(v))
		for _, s := range v {
			if s != "" {
				out = append(out, s)
			}
		}
		return out

	case []any:
		out := make([]string, 0, len(v))
		for _, x := range v {
			if s := specSprint(x); s != "" {
				out = append(out, s)
			}
		}
		return out
	}

	// Scalars stringify to a single part, unsplit, as in TS's
	// `'' === '' + input ? [] : ['' + input]`.
	s := specSprint(input)
	if s == "" {
		return []string{}
	}
	return []string{s}
}

// collapseAcronyms mirrors the TS pass
// `.replace(/([A-Z])([A-Z]+)(?![a-z])/g, (_, f, r) => f + r.toLowerCase())`,
// which turns `XMLParser` into `XmlParser` while leaving `AService` alone.
// RE2 has no lookahead, so the scan is spelled out: within a maximal run
// of ASCII uppercase, a following lowercase letter means the run's last
// uppercase letter begins the next word and is excluded from the collapse
// (which is what the regex achieves by backtracking). Runs shorter than
// two collapse to nothing, since `[A-Z][A-Z]+` needs two.
//
// ASCII-only, deliberately: the TS character classes are ASCII, so a
// unicode-aware version here would diverge.
func collapseAcronyms(s string) string {
	b := []byte(s)
	out := make([]byte, 0, len(b))

	for i := 0; i < len(b); {
		if !isAsciiUpper(b[i]) {
			out = append(out, b[i])
			i++
			continue
		}

		j := i
		for j < len(b) && isAsciiUpper(b[j]) {
			j++
		}

		end := j
		if j < len(b) && isAsciiLower(b[j]) {
			end = j - 1
		}

		if end-i < 2 {
			out = append(out, b[i])
			i++
			continue
		}

		out = append(out, b[i])
		for k := i + 1; k < end; k++ {
			out = append(out, b[k]+('a'-'A'))
		}
		i = end
	}

	return string(out)
}

// splitOnUpperAndSeps mirrors TS `.split(/[-_ ]|([A-Z])/)` followed by the
// empty-part filter. Separators are dropped; a captured ASCII uppercase
// letter survives as its own part, which is what lets the glue step below
// rebuild words.
//
// Note the separator set is exactly `-`, `_` and a literal space -- a tab
// or newline is not a separator in TS, so it is not one here.
func splitOnUpperAndSeps(s string) []string {
	out := []string{}
	cur := strings.Builder{}

	flush := func() {
		if cur.Len() > 0 {
			out = append(out, cur.String())
			cur.Reset()
		}
	}

	for _, r := range s {
		switch {
		case '-' == r || '_' == r || ' ' == r:
			flush()
		case 'A' <= r && r <= 'Z':
			flush()
			out = append(out, string(r))
		default:
			cur.WriteRune(r)
		}
	}
	flush()

	return out
}

// glueInitials re-attaches a single uppercase letter to the lowercase tail
// that follows it, mirroring the TS reduce. The uppercase guard is what
// stops a lone lowercase part between separators (the `a` in
// `yes-as-a-service`) being glued to its neighbour.
func glueInitials(parts []string) []string {
	out := make([]string, 0, len(parts))

	for _, p := range parts {
		if 0 < len(out) {
			prev := out[len(out)-1]
			if 1 == len(prev) && isAsciiUpper(prev[0]) &&
				0 < len(p) && !isAsciiUpper(p[0]) {
				out[len(out)-1] = prev + p
				continue
			}
		}
		out = append(out, p)
	}

	return out
}

func isAsciiUpper(c byte) bool { return 'A' <= c && c <= 'Z' }
func isAsciiLower(c byte) bool { return 'a' <= c && c <= 'z' }

// specSprint stringifies a scalar the way TS `” + value` does, which
// differs from fmt.Sprint for nil ('null', not '<nil>').
func specSprint(v any) string {
	if v == nil {
		return "null"
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

// LCF lowercases the first rune. Stringifies non-string inputs to match
// TS's coercion behaviour (lcf(null) → 'null', lcf(true) → 'true').
func LCF(s any) string {
	str := fmt.Sprint(s)
	if str == "<nil>" {
		str = "null"
	}
	if str == "" {
		return ""
	}
	r := []rune(str)
	r[0] = unicode.ToLower(r[0])
	return string(r)
}

// UCF uppercases the first rune. Like LCF, coerces non-string inputs.
func UCF(s any) string {
	str := fmt.Sprint(s)
	if str == "<nil>" {
		str = "null"
	}
	if str == "" {
		return ""
	}
	r := []rune(str)
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// EscRE returns s with regex special chars backslash-escaped.
func EscRE(s string) string {
	return regexp.QuoteMeta(s)
}

// NamesP is the narrower Names variant taking an explicit prop name.
// Equivalent to Names(base, name, prop).
func NamesP(base map[string]any, name, prop string) map[string]any {
	return Names(base, name, prop)
}

// Names mutates base, attaching name variants keyed off prop:
//
//	<prop>__orig          — original input
//	<Camelify(prop)>      — Camelify form
//	<Snakify(prop)>_      — snake_case form
//	<Kebabify(prop)>-     — kebab-case form
//	<lower(prop)>         — the input, lowercased verbatim
//	<upper(prop)>         — the input, uppercased verbatim
//
// Mirrors `names` in src/util/basic.ts. Note the last two are the raw
// input recased, NOT a separator-stripped concatenation: TS uses
// `name.toLowerCase()` / `name.toUpperCase()`, so `foo_bar` keeps its
// underscore. The key names are themselves case-converted the same way,
// so a multi-word prop like `fooBar` yields `foo_bar_`, not `fooBar_`.
//
// Defaults prop to "name".
func Names(base map[string]any, name string, prop ...string) map[string]any {
	if base == nil {
		base = map[string]any{}
	}
	p := "name"
	if len(prop) > 0 && prop[0] != "" {
		p = prop[0]
	}

	base[p+"__orig"] = name
	base[Camelify(p)] = Camelify(name)
	base[Snakify(p)+"_"] = Snakify(name)
	base[Kebabify(p)+"-"] = Kebabify(name)
	base[strings.ToLower(p)] = strings.ToLower(name)
	base[strings.ToUpper(p)] = strings.ToUpper(name)

	return base
}

// Indent prepends ind (a string or count of spaces) to every line —
// including the first — and inserts the same indent after every
// newline except a trailing one. Mirrors src/util/basic.ts:594-601
// which uses the JS regex `(\n|^)(?!$)`. Implemented as a manual walk
// to avoid RE2's lack of lookahead.
//
// indent('a', 2) → '  a'
// indent('a\nb', 2) → '  a\n  b'
// indent('a\nb\n', 2) → '  a\n  b\n' (trailing newline not indented)
func Indent(src string, ind any) string {
	if src == "" {
		return src
	}
	var pad string
	switch v := ind.(type) {
	case nil:
		// TS tests `null == indent`, so both null and undefined fall
		// through to the default of two spaces rather than meaning
		// "no indent".
		pad = "  "
	case int:
		if v <= 0 {
			return src
		}
		pad = strings.Repeat(" ", v)
	case float64:
		// JSON and other dynamic sources hand over numbers as float64.
		// TS switches on `'number' === typeof`, which covers both, so a
		// float count must be a count here too and not stringify to pad.
		if v <= 0 {
			return src
		}
		pad = strings.Repeat(" ", int(v))
	case string:
		pad = v
	default:
		pad = fmt.Sprint(v)
	}
	if pad == "" {
		return src
	}
	var b strings.Builder
	b.Grow(len(src) + len(pad))
	n := len(src)
	// TS regex `(\n|^)(?!$)` tries `\n` before `^` via alternation order,
	// so a leading newline normally consumes the match and the pad lands
	// after it. But when that newline is the whole string, `(?!$)` fails
	// on the `\n` branch and the engine backtracks to `^`, putting the pad
	// before it -- hence the n == 1 case.
	if src[0] != '\n' || n == 1 {
		b.WriteString(pad)
	}
	for i := 0; i < n; i++ {
		c := src[i]
		b.WriteByte(c)
		if c == '\n' && i < n-1 {
			b.WriteString(pad)
		}
	}
	return b.String()
}

// sortedStringKeys returns the alphabetically sorted keys of a map[string]V
// via reflection. Used everywhere we iterate user-facing maps so output
// is deterministic regardless of Go's randomised map iteration. Mirrors
// the sort applied to TS Object.entries() iteration in this codebase.
func sortedStringKeys(rv reflect.Value) []string {
	keys := rv.MapKeys()
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		out = append(out, fmt.Sprint(k.Interface()))
	}
	sort.Strings(out)
	return out
}

// sortedKeys returns the alphabetically sorted keys of m. Convenience
// for typed map[string]V iterations.
func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// HumanifyFlags configures Humanify.
type HumanifyFlags struct {
	Parts bool
	Terse bool
}

// HumanifiedParts is the typed return of HumanifyParts. Each field is
// the corresponding component of the ISO timestamp parsed back to int.
type HumanifiedParts struct {
	Year   int
	Month  int
	Day    int
	Hour   int
	Minute int
	Second int
	Milli  int
}

// HumanifiedTerse is the typed terse return of HumanifyTerse, using
// the TS-compatible 2-letter prefixed keys.
type HumanifiedTerse struct {
	TY int // year
	TM int // month
	TD int // day
	TH int // hour
	TN int // minute
	TS int // second
	TI int // milli
}

// HumanifyDigits returns the digit-stripped int64 form of a unix-ms
// timestamp (TS Humanify default). Equivalent to
// Humanify(when, HumanifyFlags{}).(int64) without the type-assertion.
func HumanifyDigits(when int64) int64 {
	return Humanify(when, HumanifyFlags{}).(int64)
}

// HumanifyParts returns the typed parts form of a unix-ms timestamp.
// Equivalent to Humanify(when, HumanifyFlags{Parts: true}) but with a
// stable Go struct type rather than map[string]any.
func HumanifyParts(when int64) HumanifiedParts {
	m := Humanify(when, HumanifyFlags{Parts: true}).(map[string]any)
	return HumanifiedParts{
		Year:   m["year"].(int),
		Month:  m["month"].(int),
		Day:    m["day"].(int),
		Hour:   m["hour"].(int),
		Minute: m["minute"].(int),
		Second: m["second"].(int),
		Milli:  m["milli"].(int),
	}
}

// HumanifyTerse is the terse-named-parts variant.
func HumanifyTerse(when int64) HumanifiedTerse {
	m := Humanify(when, HumanifyFlags{Parts: true, Terse: true}).(map[string]any)
	return HumanifiedTerse{
		TY: m["ty"].(int),
		TM: m["tm"].(int),
		TD: m["td"].(int),
		TH: m["th"].(int),
		TN: m["tn"].(int),
		TS: m["ts"].(int),
		TI: m["ti"].(int),
	}
}

// Humanify formats a unix-millis timestamp as TS does in
// src/util/basic.ts:648-682. With no flags it returns an int64 of the
// form YYYYMMDDhhmmssII (last digit of the millis dropped). With
// Parts=true it returns a map with named fields.
func Humanify(when int64, flags HumanifyFlags) any {
	t := time.UnixMilli(when).UTC()
	iso := t.Format("2006-01-02T15:04:05.000Z")
	if flags.Parts {
		// Split on - : T . Z, parse to numbers.
		split := func(s string, seps string) []string {
			out := []string{}
			cur := strings.Builder{}
			for _, r := range s {
				if strings.ContainsRune(seps, r) {
					if cur.Len() > 0 {
						out = append(out, cur.String())
						cur.Reset()
					}
				} else {
					cur.WriteRune(r)
				}
			}
			if cur.Len() > 0 {
				out = append(out, cur.String())
			}
			return out
		}
		parts := split(iso, "-:T.Z")
		toI := func(s string) int { n, _ := strconv.Atoi(s); return n }
		full := map[string]any{
			"year":   toI(parts[0]),
			"month":  toI(parts[1]),
			"day":    toI(parts[2]),
			"hour":   toI(parts[3]),
			"minute": toI(parts[4]),
			"second": toI(parts[5]),
			"milli":  toI(parts[6]),
		}
		if flags.Terse {
			return map[string]any{
				"ty": full["year"],
				"tm": full["month"],
				"td": full["day"],
				"th": full["hour"],
				"tn": full["minute"],
				"ts": full["second"],
				"ti": full["milli"],
			}
		}
		return full
	}
	// Strip non-digits, drop the last digit (matches TS regex).
	var b strings.Builder
	for _, r := range iso {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	s := b.String()
	if len(s) > 0 {
		s = s[:len(s)-1]
	}
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

// IsBinExt reports whether the path's extension is in the curated list
// of binary file extensions. Case-insensitive. Mirrors
// src/util/basic.ts:716-721.
// IsBinContent reports whether the bytes look binary, judged by a NUL in
// the first 8 KB — the same heuristic git and file(1) use.
//
// An extension list can never be exhaustive: .wasm, .zst, .br, .sqlite,
// .parquet and every extensionless binary are absent from binaryExts.
// Anything it misses would otherwise be decoded as UTF-8, run through
// template substitution and written back, silently corrupting the copy.
// Mirrors isbincontent in ts/src/util/basic.ts.
func IsBinContent(content []byte) bool {
	n := len(content)
	if n > 8192 {
		n = 8192
	}
	for i := 0; i < n; i++ {
		if content[i] == 0 {
			return true
		}
	}
	return false
}

func IsBinExt(path string) bool {
	ext := strings.TrimPrefix(strings.ToLower(nodeExt(path)), ".")
	if ext == "" {
		return false
	}
	_, ok := binaryExts[ext]
	return ok
}

// nodeExt is Node's path.extname, which is not filepath.Ext: Node treats a
// dot that begins the basename as a hidden-file marker rather than an
// extension separator, so `.DS_Store` and `.gitignore` have NO extension
// there, where filepath.Ext returns the whole name. TS is canonical, so
// IsBinExt has to follow Node.
func nodeExt(path string) string {
	base := path
	if i := strings.LastIndexAny(base, `/\`); 0 <= i {
		base = base[i+1:]
	}

	dot := strings.LastIndex(base, ".")

	// No dot, or the only dot starts the name: no extension.
	if dot <= 0 {
		return ""
	}

	return base[dot:]
}

// Deep returns a deep-merge of the given maps and slices, with right
// precedence. Non-map/slice values right-wins.
//
// Mirrors `deep` in src/util/basic.ts, which used to be a re-export of
// jsonic's `util.deep` and is now inlined there. One deviation remains:
// TS mutates and returns its first argument, whereas this builds a new
// map or slice. Callers that rely on the aliasing will see a difference;
// callers that use the return value will not.
func Deep(dst any, srcs ...any) any {
	out := dst
	for _, src := range srcs {
		// A nil *source* is an absent argument and is skipped, matching
		// TS's `undefined === over` check. A nil map value or slice
		// element is different: that is a present key holding nil, and it
		// overwrites the way TS's `null` does. Go has no separate
		// `undefined`, so the two cases are told apart by position --
		// here for arguments, in mergeOne for members.
		if src == nil {
			continue
		}
		out = mergeOne(out, src)
	}
	return out
}

// CMapSentinel is a marker for CMap/VMap special values. Pass
// CMapCopy to copy a value verbatim, CMapFilter to drop the entry, or
// CMapKey to substitute the source key.
type CMapSentinel int

const (
	CMapCopy CMapSentinel = iota
	CMapFilter
	CMapKey
)

// CMapTransform is the per-field transform signature.
type CMapTransform func(val any, p CMapCtx) any

// CMapCtx is the per-field context passed to a CMapTransform.
type CMapCtx struct {
	SKey   string
	Self   any
	Key    string
	Parent any
}

// CMap projects an object's children through a spec map, producing a
// new map. Each spec key names a target field; the spec value is a
// CMapTransform, a CMapSentinel (Copy/Key/Filter), or a literal.
// Mirrors src/util/basic.ts:605-617. Iterates source and spec keys
// alphabetically for cross-stack determinism.
func CMap(o map[string]any, p map[string]any) map[string]any {
	out := map[string]any{}
	for _, key := range sortedKeys(o) {
		child := o[key]
		entry := map[string]any{}
		drop := false
		for _, sk := range sortedKeys(p) {
			sv := p[sk]
			val := cmapApply(sv, child, key, sk, o)
			if val == CMapFilter {
				drop = true
				break
			}
			entry[sk] = val
		}
		if !drop {
			out[key] = entry
		}
	}
	return out
}

// VMap is the slice-output variant of CMap. Sorted iteration as CMap.
func VMap(o map[string]any, p map[string]any) []any {
	out := []any{}
	for _, key := range sortedKeys(o) {
		child := o[key]
		entry := map[string]any{}
		drop := false
		for _, sk := range sortedKeys(p) {
			sv := p[sk]
			val := cmapApply(sv, child, key, sk, o)
			if val == CMapFilter {
				drop = true
				break
			}
			entry[sk] = val
		}
		if !drop {
			out = append(out, entry)
		}
	}
	return out
}

func cmapApply(spec, self any, key, sk string, parent any) any {
	if fn, ok := spec.(CMapTransform); ok {
		v := getxIndex(self, sk)
		return fn(v, CMapCtx{SKey: sk, Self: self, Key: key, Parent: parent})
	}
	if s, ok := spec.(CMapSentinel); ok {
		switch s {
		case CMapCopy:
			return getxIndex(self, sk)
		case CMapKey:
			return key
		case CMapFilter:
			return CMapFilter
		}
	}
	return spec
}

// OMap returns m's keys paired with their values, in the order TS `omap`
// yields them. Mirrors the `omap` surface in src/util/basic.ts.
//
// See jsKeyOrder for why that is not simply sorted.
func OMap(m map[string]any) [][2]any {
	out := make([][2]any, 0, len(m))
	for _, k := range jsKeyOrder(m) {
		out = append(out, [2]any{k, m[k]})
	}
	return out
}

// jsKeyOrder returns m's keys in the order a JavaScript object would
// enumerate them after TS `omap` has rebuilt it: array-index-like keys
// first in ascending numeric order, then the remaining keys sorted.
//
// TS `omap` sorts its entries before assigning them, so the string keys
// come out sorted -- but assignment is to a plain object, and the JS
// property order for integer-index keys is numeric and cannot be
// overridden. So `{10:_, 2:_, 1:_}` enumerates 1, 2, 10 in TS, where a
// plain lexicographic sort would give 1, 10, 2. Matching TS means
// reproducing that split here.
//
// CMap does not need this (Go returns an unordered map, so no order is
// observable), and VMap must not have it: TS `vmap` pushes to an array,
// where the sort is the final word and integer keys get no special
// treatment.
func jsKeyOrder(m map[string]any) []string {
	idx := []string{}
	rest := []string{}

	for k := range m {
		if isArrayIndexKey(k) {
			idx = append(idx, k)
		} else {
			rest = append(rest, k)
		}
	}

	sort.Slice(idx, func(a, b int) bool {
		x, _ := strconv.ParseUint(idx[a], 10, 64)
		y, _ := strconv.ParseUint(idx[b], 10, 64)
		return x < y
	})
	sort.Strings(rest)

	return append(idx, rest...)
}

// isArrayIndexKey reports whether k is a canonical array index in the
// JS sense: the decimal form of an integer in [0, 2^32-1), with no
// leading zeros, no sign and no padding. "0" qualifies, "01" and "1.0"
// and "-1" do not, which is exactly where JS stops applying numeric
// property order.
func isArrayIndexKey(k string) bool {
	if "" == k || len(k) > 10 {
		return false
	}
	if "0" == k {
		return true
	}
	if '0' == k[0] {
		return false
	}
	for i := 0; i < len(k); i++ {
		if k[i] < '0' || '9' < k[i] {
			return false
		}
	}
	n, err := strconv.ParseUint(k, 10, 64)
	return err == nil && n < (1<<32)-1
}

func mergeOne(dst, src any) any {
	// No `src == nil` short-circuit: reaching here means src is a member
	// of a map or slice, so nil is a real value and wins, as TS `null`
	// does. Absent arguments are filtered by Deep before this is called.
	if dst == nil {
		return src
	}
	dm, dok := dst.(map[string]any)
	sm, sok := src.(map[string]any)
	if dok && sok {
		out := make(map[string]any, len(dm)+len(sm))
		for k, v := range dm {
			out[k] = v
		}
		for k, v := range sm {
			if cur, exists := out[k]; exists {
				out[k] = mergeOne(cur, v)
			} else {
				out[k] = v
			}
		}
		return out
	}

	// Slices merge index-by-index, they do not replace wholesale. TS
	// `deep` reaches arrays through the same `for k in over` branch it
	// uses for objects, so `[1,2,3] <- [9]` is `[9,2,3]` and the longer
	// side sets the length. Only `[]any` is handled, which is the shape
	// Deep is documented for; a typed slice takes the right-wins path
	// below, as any other non-map value does.
	ds, dsok := dst.([]any)
	ss, ssok := src.([]any)
	if dsok && ssok {
		n := len(ds)
		if len(ss) > n {
			n = len(ss)
		}
		out := make([]any, n)
		copy(out, ds)
		for i, v := range ss {
			if i < len(ds) {
				out[i] = mergeOne(ds[i], v)
			} else {
				out[i] = v
			}
		}
		return out
	}

	return src
}

// binaryExts is the set of file extensions treated as binary by IsBinExt.
// The list mirrors BINARY_EXT in src/util/basic.ts:716.
var binaryExts = func() map[string]struct{} {
	raw := []string{
		"3dm", "3ds", "3g2", "3gp", "7z", "a", "aac", "adp", "afdesign",
		"afphoto", "afpub", "ai", "aif", "aiff", "alz", "ape", "apk",
		"appimage", "ar", "arj", "asf", "au", "avi", "bak", "baml", "bh",
		"bin", "bk", "bmp", "btif", "bz2", "bzip2", "cab", "caf", "cgm",
		"class", "cmx", "cpio", "cr2", "cur", "dat", "dcm", "deb", "dex",
		"djvu", "dll", "dmg", "dng", "doc", "docm", "docx", "dot", "dotm",
		"dra", "DS_Store", "dsk", "dts", "dtshd", "dvb", "dwg", "dxf",
		"ecelp4800", "ecelp7470", "ecelp9600", "egg", "eol", "eot", "epub",
		"exe", "f4v", "fbs", "fh", "fla", "flac", "flatpak", "fli", "flv",
		"fpx", "fst", "fvt", "g3", "gh", "gif", "graffle", "gz", "gzip",
		"h261", "h263", "h264", "icns", "ico", "ief", "img", "ipa", "iso",
		"jar", "jpeg", "jpg", "jpgv", "jpm", "jxr", "key", "ktx", "lha",
		"lib", "lvp", "lz", "lzh", "lzma", "lzo", "m3u", "m4a", "m4v",
		"mar", "mdi", "mht", "mid", "midi", "mj2", "mka", "mkv", "mmr",
		"mng", "mobi", "mov", "movie", "mp3", "mp4", "mp4a", "mpeg", "mpg",
		"mpga", "mxu", "nef", "npx", "numbers", "nupkg", "o", "odp", "ods",
		"odt", "oga", "ogg", "ogv", "otf", "ott", "pages", "pbm", "pcx",
		"pdb", "pdf", "pea", "pgm", "pic", "png", "pnm", "pot", "potm",
		"potx", "ppa", "ppam", "ppm", "pps", "ppsm", "ppsx", "ppt", "pptm",
		"pptx", "psd", "pya", "pyc", "pyo", "pyv", "qt", "rar", "ras",
		"raw", "resources", "rgb", "rip", "rlc", "rmf", "rmvb", "rpm",
		"rtf", "rz", "s3m", "s7z", "scpt", "sgi", "shar", "snap", "sil",
		"sketch", "slk", "smv", "snk", "so", "stl", "suo", "sub", "swf",
		"tar", "tbz", "tbz2", "tga", "tgz", "thmx", "tif", "tiff", "tlz",
		"ttc", "ttf", "txz", "udf", "uvh", "uvi", "uvm", "uvp", "uvs",
		"uvu", "viv", "vob", "war", "wav", "wax", "wbmp", "wdp", "weba",
		"webm", "webp", "whl", "wim", "wm", "wma", "wmv", "wmx", "woff",
		"woff2", "wrm", "wvx", "xbm", "xif", "xla", "xlam", "xls", "xlsb",
		"xlsm", "xlsx", "xlt", "xltm", "xltx", "xm", "xmind", "xpi", "xpm",
		"xwd", "xz", "z", "zip", "zipx",
	}
	m := make(map[string]struct{}, len(raw))
	for _, e := range raw {
		m[strings.ToLower(e)] = struct{}{}
	}
	return m
}()
