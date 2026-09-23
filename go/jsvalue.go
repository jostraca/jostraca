package jostraca

import (
	"encoding"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strconv"
	"strings"
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

func jsJSONMapKey(k reflect.Value) string {
	switch k.Kind() {
	case reflect.String:
		return k.String()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return strconv.FormatUint(k.Uint(), 10)
	}
	return strconv.FormatInt(k.Int(), 10)
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
