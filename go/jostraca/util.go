package jostraca

import (
	"fmt"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// EachSpec configures Each. Field semantics differ from TS in one place
// (PORT_PLAN §14 D-Each, recorded in Phase 4 BUILD_LOG):
//
//	Raw  — if true, items are returned as-is. If false (default), each
//	       item is wrapped in {val$, index$} or {key$, val$} matching
//	       TS's default oval=true behaviour.
//	Sort — sort by stringified value (slices) or by key (maps).
type EachSpec struct {
	Mark bool // unused in Phase 4; reserved for future TS parity
	Raw  bool
	Sort bool
	Args any
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
				val = map[string]any{"val$": item, "index$": i}
			}
			if apply != nil {
				val = apply(val)
			}
			out = append(out, val)
		}
		return out
	case reflect.Map:
		keys := rv.MapKeys()
		ks := make([]string, 0, len(keys))
		for _, k := range keys {
			ks = append(ks, fmt.Sprint(k.Interface()))
		}
		if spec.Sort {
			sort.Strings(ks)
		}
		out := make([]any, 0, len(ks))
		for _, k := range ks {
			v := rv.MapIndex(reflect.ValueOf(k)).Interface()
			val := any(map[string]any{"key$": k, "val$": v})
			if spec.Raw {
				val = v
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

// Partify splits an input string on -, _, whitespace, and camelCase
// boundaries. A []string input passes through. nil/undefined and
// non-string scalars stringify per TS coercion ('null', 'undefined',
// 'true', etc.).
func Partify(input any) []string {
	switch v := input.(type) {
	case nil:
		return []string{"null"}
	case string:
		if v == "" {
			return []string{}
		}
		raw := []string{}
		cur := strings.Builder{}
		for _, r := range v {
			switch {
			case r == '-' || r == '_' || unicode.IsSpace(r):
				if cur.Len() > 0 {
					raw = append(raw, cur.String())
					cur.Reset()
				}
			default:
				cur.WriteRune(r)
			}
		}
		if cur.Len() > 0 {
			raw = append(raw, cur.String())
		}
		out := []string{}
		for _, p := range raw {
			out = append(out, splitCamel(p)...)
		}
		return out
	case []string:
		out := make([]string, 0, len(v))
		for _, s := range v {
			out = append(out, splitCamel(s)...)
		}
		return out
	case []any:
		out := make([]string, 0, len(v))
		for _, x := range v {
			out = append(out, splitCamel(fmt.Sprint(x))...)
		}
		return out
	}
	// Scalars: stringify and run through Partify recursively.
	return Partify(fmt.Sprint(input))
}

// splitCamel divides a string at uppercase-after-lowercase transitions:
// "FooBar" → ["Foo", "Bar"]; "fooBar" → ["foo", "Bar"].
func splitCamel(s string) []string {
	if s == "" {
		return nil
	}
	out := []string{}
	cur := strings.Builder{}
	prevLower := false
	for _, r := range s {
		if unicode.IsUpper(r) && prevLower && cur.Len() > 0 {
			out = append(out, cur.String())
			cur.Reset()
		}
		cur.WriteRune(r)
		prevLower = unicode.IsLower(r)
	}
	if cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out
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

// Names mutates base, attaching name variants keyed off prop:
//
//	<prop>__orig — original input
//	<UCF(prop)>  — Camelify form
//	<prop>_      — snake_case form
//	<prop>-      — kebab-case form
//	<prop>       — lowercased no-separator concatenation
//	<UPPER(prop)>— uppercased no-separator concatenation
//
// Mirrors src/util/basic.ts:329-342. Defaults prop to "name".
func Names(base map[string]any, name string, prop ...string) map[string]any {
	if base == nil {
		base = map[string]any{}
	}
	p := "name"
	if len(prop) > 0 && prop[0] != "" {
		p = prop[0]
	}
	parts := Partify(name)
	concat := strings.Builder{}
	for _, x := range parts {
		concat.WriteString(strings.ToLower(x))
	}
	concatStr := concat.String()

	base[p+"__orig"] = name
	base[UCF(p)] = Camelify(name)
	base[p+"_"] = Snakify(name)
	base[p+"-"] = Kebabify(name)
	base[p] = concatStr
	base[strings.ToUpper(p)] = strings.ToUpper(concatStr)
	return base
}

// Indent prepends ind (a string or count of spaces) to every line after
// the first. Mirrors src/util/basic.ts:594-601, replacing the JS lookbehind
// with strings.ReplaceAll.
func Indent(src string, ind any) string {
	if src == "" {
		return src
	}
	var pad string
	switch v := ind.(type) {
	case nil:
		return src
	case int:
		if v <= 0 {
			return src
		}
		pad = strings.Repeat(" ", v)
	case string:
		pad = v
	default:
		pad = fmt.Sprint(v)
	}
	if pad == "" {
		return src
	}
	return strings.ReplaceAll(src, "\n", "\n"+pad)
}

// HumanifyFlags configures Humanify.
type HumanifyFlags struct {
	Parts bool
	Terse bool
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
func IsBinExt(path string) bool {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(path)), ".")
	if ext == "" {
		return false
	}
	_, ok := binaryExts[ext]
	return ok
}

// Deep returns a deep-merge of the given maps and slices, with right
// precedence. Mirrors jsonic.util.deep used at src/jostraca.ts:208-256.
// Non-map/slice values right-wins.
func Deep(dst any, srcs ...any) any {
	out := dst
	for _, src := range srcs {
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
// Mirrors src/util/basic.ts:605-617.
func CMap(o map[string]any, p map[string]any) map[string]any {
	out := map[string]any{}
	for key, child := range o {
		ctxParent := o
		_ = ctxParent
		entry := map[string]any{}
		drop := false
		for sk, sv := range p {
			val := cmapApply(sv, child, key, sk, ctxParent)
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

// VMap is the slice-output variant of CMap.
func VMap(o map[string]any, p map[string]any) []any {
	out := []any{}
	for key, child := range o {
		entry := map[string]any{}
		drop := false
		for sk, sv := range p {
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

// OMap returns m's keys in insertion order paired with their values.
// Mirrors jsonic.util.omap. Go map iteration is unordered, so callers
// who need deterministic ordering should sort the result.
func OMap(m map[string]any) [][2]any {
	out := make([][2]any, 0, len(m))
	for k, v := range m {
		out = append(out, [2]any{k, v})
	}
	return out
}

func mergeOne(dst, src any) any {
	if src == nil {
		return dst
	}
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
