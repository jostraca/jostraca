package jostraca

import (
	"encoding"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// jsLess reports whether a sorts before b under JavaScript's `<` on
// strings, which compares UTF-16 code units rather than bytes or code
// points. The two orders differ only where a supplementary-plane
// character (encoded as a surrogate pair, 0xD800..0xDFFF) meets one in
// U+E000..U+FFFF: JS puts the supplementary character first, UTF-8 byte
// order puts it last.
func jsLess(a, b string) bool {
	for a != "" && b != "" {
		ra, na := utf8.DecodeRuneInString(a)
		rb, nb := utf8.DecodeRuneInString(b)
		if ra != rb {
			ua, ub := utf16Lead(ra), utf16Lead(rb)
			if ua != ub {
				return ua < ub
			}
			return ra < rb
		}
		if ra == utf8.RuneError && a[:na] != b[:nb] {
			return a[:na] < b[:nb]
		}
		a, b = a[na:], b[nb:]
	}
	return a == "" && b != ""
}

// utf16Lead is the first UTF-16 code unit of r.
func utf16Lead(r rune) rune {
	if r >= 0x10000 {
		return 0xD800 + ((r - 0x10000) >> 10)
	}
	return r
}

// utf16Len is JavaScript's String.prototype.length for s.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// sortJS sorts ss in place into JavaScript's default string order.
func sortJS(ss []string) {
	sort.Slice(ss, func(i, j int) bool { return jsLess(ss[i], ss[j]) })
}

// sortDirEntriesJS orders directory entries by name the way TS orders
// readdirSync().sort().
func sortDirEntriesJS(entries []DirEntry) {
	sort.SliceStable(entries, func(i, j int) bool { return jsLess(entries[i].Name, entries[j].Name) })
}

// jsJSON renders v the way TS's jsonify does, JSON.stringify(sortKeys(v)):
//
//   - object keys in JavaScript's own enumeration order after the sort:
//     canonical array-index keys first in ascending numeric order, then
//     the rest by UTF-16 code unit (jsKeyOrder);
//   - strings escaped exactly as JSON.stringify escapes them (jsQuote), so
//     '&', '<', '>', DEL and U+2028/U+2029 stay raw;
//   - -0 as 0, and NaN or an infinity as null.
//
// Maps, slices and arrays are walked directly. A struct, or anything with
// its own MarshalJSON or MarshalText, goes through encoding/json first
// (with UseNumber, so integers stay exact) and the result is walked the
// same way, which is what sorts a struct's fields. Integers wider than
// 2^53 stay exact, where TS would round them.
func jsJSON(v any) (string, error) {
	g, ok, err := jsJSONValue(v, map[uintptr]bool{})
	if err != nil {
		return "", err
	}
	if !ok {
		return "", nil
	}
	var b strings.Builder
	writeJSJSON(&b, g)
	return b.String(), nil
}

var (
	jsonMarshalerType = reflect.TypeOf((*json.Marshaler)(nil)).Elem()
	textMarshalerType = reflect.TypeOf((*encoding.TextMarshaler)(nil)).Elem()
)

// jsJSONValue converts v to the generic shape writeJSJSON walks: nil,
// bool, string, float64, int64, uint64, json.Number, map[string]any and
// []any. ok is false for a value JSON.stringify would treat as undefined
// (a function or a channel), which an object omits and an array writes as
// null.
func jsJSONValue(v any, seen map[uintptr]bool) (out any, ok bool, err error) {
	switch x := v.(type) {
	case nil:
		return nil, true, nil
	case string:
		return x, true, nil
	case bool:
		return x, true, nil
	case float64:
		return jsJSONFloat(x), true, nil
	case json.Number:
		return x, true, nil
	}

	rv := reflect.ValueOf(v)
	t := rv.Type()
	if t.Implements(jsonMarshalerType) || t.Implements(textMarshalerType) {
		return jsJSONViaEncoding(v, seen)
	}

	switch rv.Kind() {
	case reflect.String:
		return rv.String(), true, nil
	case reflect.Bool:
		return rv.Bool(), true, nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return rv.Int(), true, nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return rv.Uint(), true, nil
	case reflect.Float32:
		f, _ := strconv.ParseFloat(strconv.FormatFloat(rv.Float(), 'g', -1, 32), 64)
		if math.IsNaN(rv.Float()) || math.IsInf(rv.Float(), 0) {
			return nil, true, nil
		}
		return jsJSONFloat(f), true, nil
	case reflect.Float64:
		return jsJSONFloat(rv.Float()), true, nil

	case reflect.Ptr, reflect.Interface:
		if rv.IsNil() {
			return nil, true, nil
		}
		return jsJSONValue(rv.Elem().Interface(), seen)

	case reflect.Map:
		if rv.IsNil() {
			return nil, true, nil
		}
		switch t.Key().Kind() {
		case reflect.String,
			reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
			reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		default:
			return jsJSONViaEncoding(v, seen)
		}
		ptr := rv.Pointer()
		if seen[ptr] {
			return nil, false, errJSONCycle
		}
		seen[ptr] = true
		defer delete(seen, ptr)
		m := make(map[string]any, rv.Len())
		iter := rv.MapRange()
		for iter.Next() {
			ev, eok, err := jsJSONValue(iter.Value().Interface(), seen)
			if err != nil {
				return nil, false, err
			}
			if eok {
				m[jsJSONMapKey(iter.Key())] = ev
			}
		}
		return m, true, nil

	case reflect.Slice, reflect.Array:
		if rv.Kind() == reflect.Slice {
			if rv.IsNil() {
				return nil, true, nil
			}
			if t.Elem().Kind() == reflect.Uint8 {
				return jsJSONViaEncoding(v, seen)
			}
			if rv.Len() > 0 {
				ptr := rv.Pointer()
				if seen[ptr] {
					return nil, false, errJSONCycle
				}
				seen[ptr] = true
				defer delete(seen, ptr)
			}
		}
		a := make([]any, rv.Len())
		for i := range a {
			ev, _, err := jsJSONValue(rv.Index(i).Interface(), seen)
			if err != nil {
				return nil, false, err
			}
			a[i] = ev
		}
		return a, true, nil

	case reflect.Struct:
		return jsJSONViaEncoding(v, seen)

	case reflect.Func, reflect.Chan, reflect.UnsafePointer:
		return nil, false, nil
	}

	return jsJSONViaEncoding(v, seen)
}

var errJSONCycle = fmt.Errorf("jostraca: converting circular structure to JSON")

// jsJSONMapKey is the property name a Go map key becomes.
func jsJSONMapKey(k reflect.Value) string {
	switch k.Kind() {
	case reflect.String:
		return k.String()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return strconv.FormatInt(k.Int(), 10)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return strconv.FormatUint(k.Uint(), 10)
	}
	return jsString(k.Interface())
}

// jsJSONFloat applies JSON.stringify's number rules: -0 is 0, and a
// non-finite number is null.
func jsJSONFloat(f float64) any {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return nil
	}
	if f == 0 {
		return float64(0)
	}
	return f
}

func jsJSONViaEncoding(v any, seen map[uintptr]bool) (any, bool, error) {
	raw, err := marshalJSLike(v)
	if err != nil {
		return nil, false, err
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	var generic any
	if err := dec.Decode(&generic); err != nil {
		return nil, false, err
	}
	return jsJSONValue(generic, seen)
}

func writeJSJSON(b *strings.Builder, v any) {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case string:
		b.WriteString(jsQuote(x))
	case float64:
		b.WriteString(formatJSNumber(x))
	case int64:
		b.WriteString(strconv.FormatInt(x, 10))
	case uint64:
		b.WriteString(strconv.FormatUint(x, 10))
	case json.Number:
		b.WriteString(jsJSONNumber(x))
	case []any:
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJSJSON(b, e)
		}
		b.WriteByte(']')
	case map[string]any:
		b.WriteByte('{')
		for i, k := range jsKeyOrder(x) {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString(jsQuote(k))
			b.WriteByte(':')
			writeJSJSON(b, x[k])
		}
		b.WriteByte('}')
	}
}

// jsJSONNumber renders a number that came back from encoding/json. An
// integer literal is kept exact; anything else is formatted as JS would.
func jsJSONNumber(n json.Number) string {
	s := string(n)
	if strings.ContainsAny(s, ".eE") {
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return s
		}
		return formatJSNumber(f)
	}
	if s == "-0" {
		return "0"
	}
	return s
}

// jsQuote quotes s exactly as JSON.stringify does: only '"', '\\' and the
// control characters below U+0020 are escaped, the five with a short form
// using it and the rest as lowercase \u00xx. Everything else, including
// '&', '<', '>', DEL and U+2028/U+2029, is written raw -- which
// encoding/json does not do even with SetEscapeHTML(false).
func jsQuote(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 2)
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				b.WriteString(`\u00`)
				b.WriteByte("0123456789abcdef"[r>>4])
				b.WriteByte("0123456789abcdef"[r&0xF])
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// jsUndefinedType is TS's undefined, for the few places that must tell it
// apart from null (nil). It never escapes the package.
type jsUndefinedType struct{}

var jsUndefined any = jsUndefinedType{}

func isUndefined(v any) bool {
	_, ok := v.(jsUndefinedType)
	return ok
}

// jsProp is one step of a path, with TS's own-property rule (step in
// ts/src/util/basic.ts):
//
//   - a map: the key, if present; typed maps too, with a canonical
//     decimal key for an integer-keyed map;
//   - a slice or array: a canonical array index below its length, or
//     "length";
//   - a string: "length" (in UTF-16 units), or a canonical index below it,
//     giving that UTF-16 code unit as a one-unit string;
//   - anything else: absent.
//
// ok reports presence, so a key holding nil is (nil, true).
func jsProp(node any, key string) (any, bool) {
	switch v := node.(type) {
	case nil:
		return nil, false
	case map[string]any:
		x, ok := v[key]
		return x, ok
	case []any:
		if i, ok := jsIndex(key, len(v)); ok {
			return v[i], true
		}
		if key == "length" {
			return len(v), true
		}
		return nil, false
	case string:
		return jsStringProp(v, key)
	}

	rv := reflect.ValueOf(node)
	switch rv.Kind() {
	case reflect.Map:
		k, ok := jsMapKey(rv.Type().Key(), key)
		if !ok {
			return nil, false
		}
		x := rv.MapIndex(k)
		if !x.IsValid() {
			return nil, false
		}
		return x.Interface(), true
	case reflect.Slice, reflect.Array:
		if i, ok := jsIndex(key, rv.Len()); ok {
			return rv.Index(i).Interface(), true
		}
		if key == "length" {
			return rv.Len(), true
		}
	case reflect.String:
		return jsStringProp(rv.String(), key)
	}
	return nil, false
}

// jsIndex parses key as a canonical array index below n: no sign, no
// leading zero, no padding.
func jsIndex(key string, n int) (int, bool) {
	if !isArrayIndexKey(key) {
		return 0, false
	}
	i, err := strconv.Atoi(key)
	if err != nil || i >= n {
		return 0, false
	}
	return i, true
}

func jsStringProp(s, key string) (any, bool) {
	if key == "length" {
		return utf16Len(s), true
	}
	if !isArrayIndexKey(key) {
		return nil, false
	}
	units := utf16.Encode([]rune(s))
	i, err := strconv.Atoi(key)
	if err != nil || i >= len(units) {
		return nil, false
	}
	// A lone surrogate decodes to U+FFFD, which is also what Node writes
	// to disk for one.
	return string(utf16.Decode(units[i : i+1])), true
}

// jsMapKey converts a path key to a map's key type: any string kind, or a
// canonical decimal for an integer kind. Anything else is absent, where a
// raw MapIndex would panic.
func jsMapKey(t reflect.Type, key string) (reflect.Value, bool) {
	switch t.Kind() {
	case reflect.String:
		return reflect.ValueOf(key).Convert(t), true
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		n, err := strconv.ParseInt(key, 10, 64)
		if err != nil || strconv.FormatInt(n, 10) != key {
			return reflect.Value{}, false
		}
		k := reflect.New(t).Elem()
		if k.OverflowInt(n) {
			return reflect.Value{}, false
		}
		k.SetInt(n)
		return k, true
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		n, err := strconv.ParseUint(key, 10, 64)
		if err != nil || strconv.FormatUint(n, 10) != key {
			return reflect.Value{}, false
		}
		k := reflect.New(t).Elem()
		if k.OverflowUint(n) {
			return reflect.Value{}, false
		}
		k.SetUint(n)
		return k, true
	}
	return reflect.Value{}, false
}

// jsString is JavaScript's String(v): nil is "null", numbers format as JS
// formats them, a slice joins its elements with "," (a nil element as ""),
// and a map or struct is "[object Object]".
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case jsUndefinedType:
		return "undefined"
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		return formatJSNumber(x)
	case json.Number:
		return jsJSONNumber(x)
	}

	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.String:
		return rv.String()
	case reflect.Bool:
		return jsString(rv.Bool())
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return strconv.FormatInt(rv.Int(), 10)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return strconv.FormatUint(rv.Uint(), 10)
	case reflect.Float32:
		if math.IsNaN(rv.Float()) || math.IsInf(rv.Float(), 0) {
			return formatJSNumber(rv.Float())
		}
		f, _ := strconv.ParseFloat(strconv.FormatFloat(rv.Float(), 'g', -1, 32), 64)
		return formatJSNumber(f)
	case reflect.Float64:
		return formatJSNumber(rv.Float())
	case reflect.Slice, reflect.Array:
		if rv.Kind() == reflect.Slice && rv.Type().Elem().Kind() == reflect.Uint8 {
			return string(rv.Bytes())
		}
		var b strings.Builder
		for i := 0; i < rv.Len(); i++ {
			if i > 0 {
				b.WriteByte(',')
			}
			e := rv.Index(i).Interface()
			if e != nil && !isUndefined(e) {
				b.WriteString(jsString(e))
			}
		}
		return b.String()
	case reflect.Map, reflect.Struct:
		return "[object Object]"
	case reflect.Ptr, reflect.Interface:
		if rv.IsNil() {
			return "null"
		}
		return jsString(rv.Elem().Interface())
	}
	return fmt.Sprint(v)
}

// JavaScript value kinds, as far as comparison needs them.
const (
	jkUndefined = iota
	jkNull
	jkBool
	jkNumber
	jkString
	jkObject
)

func jsKind(v any) int {
	switch v.(type) {
	case jsUndefinedType:
		return jkUndefined
	case nil:
		return jkNull
	case bool:
		return jkBool
	case string:
		return jkString
	case float64, json.Number:
		return jkNumber
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Bool:
		return jkBool
	case reflect.String:
		return jkString
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr,
		reflect.Float32, reflect.Float64:
		return jkNumber
	case reflect.Ptr, reflect.Interface, reflect.Map, reflect.Slice, reflect.Func, reflect.Chan:
		if rv.IsNil() && rv.Kind() != reflect.Map && rv.Kind() != reflect.Slice {
			return jkNull
		}
	}
	return jkObject
}

// jsNumberOf is the float64 value of a jkNumber.
func jsNumberOf(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case json.Number:
		f, err := strconv.ParseFloat(string(x), 64)
		if err != nil {
			return math.NaN()
		}
		return f
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return float64(rv.Int())
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return float64(rv.Uint())
	case reflect.Float32, reflect.Float64:
		return rv.Float()
	}
	return math.NaN()
}

func jsBoolOf(v any) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return reflect.ValueOf(v).Bool()
}

// jsToPrimitive is ToPrimitive for the values a model holds: an object
// becomes its String() (arrays joined, anything else "[object Object]").
func jsToPrimitive(v any) any {
	if jsKind(v) == jkObject {
		return jsString(v)
	}
	return v
}

// jsToNumber is JavaScript's ToNumber.
func jsToNumber(v any) float64 {
	switch jsKind(v) {
	case jkUndefined:
		return math.NaN()
	case jkNull:
		return 0
	case jkBool:
		if jsBoolOf(v) {
			return 1
		}
		return 0
	case jkNumber:
		return jsNumberOf(v)
	case jkString:
		return jsStringToNumber(jsString(v))
	}
	return jsToNumber(jsToPrimitive(v))
}

var (
	jsSpaceTrimRE = regexp.MustCompile(`^` + jsSpaceClass + `+|` + jsSpaceClass + `+$`)
	jsDecimalRE   = regexp.MustCompile(`^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$`)
	jsRadixRE     = regexp.MustCompile(`^0([xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)$`)
)

// jsStringToNumber is StringToNumber: surrounding JavaScript whitespace
// is ignored, the empty string is 0, 0x/0o/0b literals and [+-]Infinity
// are numbers, and anything that is not a decimal literal is NaN -- so
// Go-only spellings such as "inf", "NaN", "1_000" or "0x1p-2" are NaN.
func jsStringToNumber(s string) float64 {
	s = jsSpaceTrimRE.ReplaceAllString(s, "")
	switch s {
	case "":
		return 0
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if jsRadixRE.MatchString(s) {
		base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]]
		n, ok := new(big.Int).SetString(s[2:], base)
		if !ok {
			return math.NaN()
		}
		f, _ := new(big.Float).SetInt(n).Float64()
		return f
	}
	if jsDecimalRE.MatchString(s) {
		f, _ := strconv.ParseFloat(s, 64)
		return f
	}
	return math.NaN()
}

// jsStrictEqual is ===.
func jsStrictEqual(x, y any) bool {
	kx, ky := jsKind(x), jsKind(y)
	if kx != ky {
		return false
	}
	switch kx {
	case jkUndefined, jkNull:
		return true
	case jkBool:
		return jsBoolOf(x) == jsBoolOf(y)
	case jkNumber:
		return jsNumberOf(x) == jsNumberOf(y)
	case jkString:
		return jsString(x) == jsString(y)
	}
	return jsSameObject(x, y)
}

// jsSameObject is identity for maps, slices and pointers, which is all
// === can mean for two objects.
func jsSameObject(x, y any) bool {
	rx, ry := reflect.ValueOf(x), reflect.ValueOf(y)
	if rx.Type() != ry.Type() {
		return false
	}
	switch rx.Kind() {
	case reflect.Map, reflect.Ptr, reflect.Func, reflect.Chan, reflect.UnsafePointer:
		return rx.Pointer() == ry.Pointer()
	case reflect.Slice:
		return rx.Pointer() == ry.Pointer() && rx.Len() == ry.Len()
	}
	return false
}

// jsLooseEqual is == (IsLooselyEqual).
func jsLooseEqual(x, y any) bool {
	kx, ky := jsKind(x), jsKind(y)
	if kx == ky {
		return jsStrictEqual(x, y)
	}
	xNullish := kx == jkUndefined || kx == jkNull
	yNullish := ky == jkUndefined || ky == jkNull
	if xNullish || yNullish {
		return xNullish && yNullish
	}
	switch {
	case kx == jkNumber && ky == jkString:
		return jsNumberOf(x) == jsStringToNumber(jsString(y))
	case kx == jkString && ky == jkNumber:
		return jsStringToNumber(jsString(x)) == jsNumberOf(y)
	case kx == jkBool:
		return jsLooseEqual(jsToNumber(x), y)
	case ky == jkBool:
		return jsLooseEqual(x, jsToNumber(y))
	case kx == jkObject:
		return jsLooseEqual(jsToPrimitive(x), y)
	case ky == jkObject:
		return jsLooseEqual(x, jsToPrimitive(y))
	}
	return false
}

// jsLessThan is IsLessThan(x, y): two strings compare by UTF-16 code
// unit, anything else by ToNumber. undef reports JavaScript's undefined
// result (a NaN operand), which makes every relational operator false.
func jsLessThan(x, y any) (lt bool, undef bool) {
	px, py := jsToPrimitive(x), jsToPrimitive(y)
	if jsKind(px) == jkString && jsKind(py) == jkString {
		return jsLess(jsString(px), jsString(py)), false
	}
	nx, ny := jsToNumber(px), jsToNumber(py)
	if math.IsNaN(nx) || math.IsNaN(ny) {
		return false, true
	}
	return nx < ny, false
}
