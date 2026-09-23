package jostraca

import (
	"sort"
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
