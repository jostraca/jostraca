package jostraca

// A Fragment RENDERS WHEN IT IS CALLED, in the define phase, as it does in
// ts/src/cmp/Fragment.ts. The source is read, the body is scanned for slot
// names, and the template runs with the slot and replace handlers replaying
// into the Fragment node itself, so everything they emit -- text, Slots,
// ListItems, user components, nested Fragments, CopyFiles, Inject -- becomes
// a real child that the build walk visits like any other. The build phase
// only concatenates those children and applies Indent (fragmentAfter).
//
// Rendering in the build walk instead, as this port used to, meant that a
// render error left earlier siblings on disk, a model mutation later in the
// define callback reached the Fragment, the body's side effects ran after
// the rest of the define phase, a source written earlier in the same run was
// read with its new bytes, and anything but direct Content emitted by a
// replay was dropped: a CopyFiles in a Slot wrote nothing at all.

// defineFS is the filesystem the define phase reads through, which is the
// one the build writes through: newFileHandler falls back to OsFS the same
// way.
func (st *jstate) defineFS() FS {
	if st.fs != nil {
		return st.fs
	}
	return OsFS{}
}

// The unnamed <[SLOT]> marker, and the named one around an escaped name.
// Byte-identical to the keys ts/src/cmp/Fragment.ts adds to `replace`.
const (
	fragmentDefaultSlotKey = "/[ \\t]*[-<!/#*]*[ \\t]*<\\[SLOT]>[ \\t]*[->/#*]*[ \\t]*/"
	fragmentSlotKeyOpen    = "/[ \\t]*[-<!/#*]*[ \\t]*<\\[SLOT:"
	fragmentSlotKeyClose   = "]>[ \\t]*[->/#*]*[ \\t]*/"
)

// renderFragment runs a Fragment already attached as n. Errors land on
// st.err, where Generate reports them before the build phase starts.
func renderFragment(st *jstate, n *Node, body func(*J), eject any) {
	src, err := st.defineFS().ReadFile(n.From)
	if err != nil {
		st.err = &NodeError{Step: "fragment", Path: append([]string(nil), n.Path...), Err: err}
		return
	}

	fj := &J{st: st, cur: n}

	// Scan: every child is rejected, so nothing attaches and no body below
	// a child runs; only the slot names are learnt.
	slotNames := map[string]struct{}{}
	sawNonSlot := false
	if body != nil {
		n.Filter = func(kind, name string) bool {
			if kind == "slot" {
				slotNames[name] = struct{}{}
			} else {
				sawNonSlot = true
			}
			return false
		}
		body(fj)
		n.Filter = nil
	}

	replay := func(filter FilterFunc) {
		if body == nil {
			return
		}
		n.Filter = filter
		body(fj)
		n.Filter = nil
	}

	// A func(*J) handler emits into the Fragment at the marker. TS's
	// emitWins discards a handler's return once it has emitted, and a
	// func(*J) returns nothing, so the marker's own text is always empty.
	replace := map[string]any{}
	for k, v := range n.Replace {
		if subFn, ok := v.(func(*J)); ok {
			replace[k] = ReplaceFunc(func(_ map[string]string, _ string) string {
				subFn(fj)
				return ""
			})
		} else {
			replace[k] = v
		}
	}

	names := make([]string, 0, len(slotNames))
	for k := range slotNames {
		names = append(names, k)
	}
	sortJS(names)
	for _, name := range names {
		name := name
		replace[fragmentSlotKeyOpen+EscRE(name)+fragmentSlotKeyClose] =
			ReplaceFunc(func(_ map[string]string, _ string) string {
				replay(func(kind, slotName string) bool {
					return kind == "slot" && slotName == name
				})
				return ""
			})
	}

	// Set from inside the replacement rather than by re-testing the marker
	// against the source, so the check below and the substitution cannot
	// disagree about whether the marker is there.
	defaultSlot := false
	replace[fragmentDefaultSlotKey] = ReplaceFunc(func(_ map[string]string, _ string) string {
		defaultSlot = true
		replay(func(kind, _ string) bool { return kind != "slot" })
		return ""
	})

	// Each segment is final text, so it attaches RAW: templating it again
	// would expand a `$$x$$` carried by a model or replace value.
	_, err = Template(string(src), st.model, &TemplateSpec{
		Replace: replace,
		Eject:   eject,
		Handle: func(s string) {
			fj.ContentP(ContentProps{Src: s, Raw: true})
		},
	})
	if st.err != nil {
		return
	}
	if err != nil {
		st.err = &NodeError{Step: "fragment", Path: append([]string(nil), n.Path...), Err: err}
		return
	}

	// Non-Slot children are the content of the unnamed <[SLOT]> marker, and
	// with no such marker there is nowhere for them to go.
	if sawNonSlot && !defaultSlot {
		st.err = &NodeError{Step: "fragment", Err: fmtErrorf(
			"jostraca: Fragment has non-Slot children, but %s contains no unnamed "+
				"<[SLOT]> marker to receive them; their output would be "+
				"silently discarded. Add an unnamed <[SLOT]> marker to the "+
				"fragment source, or wrap the children in a named Slot.",
			n.From)}
	}
}
