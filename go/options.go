package jostraca

import (
	"fmt"
	"regexp"

	shape "github.com/rjrodger/shape/go"
)

// Options carries every per-call and global configuration field.
// Mirrors OptionsShape at src/jostraca.ts:99-153.
type Options struct {
	Folder   string
	Meta     map[string]any
	FS       FS
	Now      func() int64
	Log      Log
	Debug    string
	Existing Existing
	Model    map[string]any
	Build    *bool
	// Mem is tri-state, like Build: unset inherits the global setting,
	// while an explicit false turns an inherited one OFF. TS distinguishes
	// the same three cases (`null == opts.mem ? gUseMemFs : !!opts.mem`),
	// and a plain bool could not express the third -- a call could turn
	// memory mode on but never off.
	Mem     *bool
	Vol     map[string][]byte
	Cmp     CmpOptions
	Control Control
	Name    NameOptions

	// Exclude, when true, skips regenerating files that have been
	// modified on disk since the last successful build (mtime > meta.last).
	// Mirrors TS opts.exclude at src/op/FileOp.ts:51-62.
	Exclude bool
}

// Existing controls how the build phase treats files that already exist.
type Existing struct {
	Txt ExistingTxt
	Bin ExistingBin
}

type ExistingTxt struct {
	Write    *bool
	Preserve *bool
	Present  *bool
	Diff     *bool
	Merge    *bool
}

type ExistingBin struct {
	Write    *bool
	Preserve *bool
	Present  *bool
}

// Control surfaces build-time toggles. NoDuplicate inverts the TS
// `duplicate` field semantics so Go zero-value matches TS default
// (duplicate=true). Set NoDuplicate=true to opt out of the
// `.jostraca/generated/` baseline copy.
type Control struct {
	Dryrun      bool
	NoDuplicate bool
	Version     bool
}

// Duplicate reports whether the duplicate-baseline copy is enabled.
// Returns true unless explicitly disabled.
func (c Control) Duplicate() bool { return !c.NoDuplicate }

type CmpOptions struct {
	Copy CopyCmpOptions
}

type CopyCmpOptions struct {
	Ignore []*regexp.Regexp
}

type NameOptions struct {
	File    NameAffix
	Folder  NameAffix
	Exclude []NameMatcher
}

type NameAffix struct {
	Prefix string
	Suffix string
}

type NameMatcher struct {
	Literal string
	RE      *regexp.Regexp
}

// Option is a function that mutates an Options struct in place. Use the
// WithX constructors to build option lists.
type Option func(*Options)

func WithFolder(s string) Option        { return func(o *Options) { o.Folder = s } }
func WithModel(m map[string]any) Option { return func(o *Options) { o.Model = m } }
func WithMeta(m map[string]any) Option  { return func(o *Options) { o.Meta = m } }
func WithLog(l Log) Option              { return func(o *Options) { o.Log = l } }
func WithDebug(s string) Option         { return func(o *Options) { o.Debug = s } }
func WithMem() Option {
	return func(o *Options) { t := true; o.Mem = &t }
}

// WithoutMem turns OFF an in-memory filesystem inherited from the builder,
// which is what an explicit `mem: false` does in TS: the call writes to
// the global FS, else OsFS, and never into the builder's volume.
func WithoutMem() Option {
	return func(o *Options) { f := false; o.Mem = &f }
}
func WithVol(v map[string][]byte) Option {
	return func(o *Options) { o.Vol = v }
}
func WithFS(fs FS) Option            { return func(o *Options) { o.FS = fs } }
func WithNow(f func() int64) Option  { return func(o *Options) { o.Now = f } }
func WithExisting(e Existing) Option { return func(o *Options) { o.Existing = e } }
func WithControl(c Control) Option   { return func(o *Options) { o.Control = c } }
func WithBuild(b bool) Option        { return func(o *Options) { o.Build = &b } }

// applyOptions builds an Options value from the variadic constructors.
func applyOptions(opts []Option) Options {
	var o Options
	for _, fn := range opts {
		fn(&o)
	}
	return o
}

// OptionsFromMap builds an Options value from an untyped map, such as
// decoded JSON or YAML.
//
// The map is validated first, by the same closed schema as TS's
// OptionsShape (with ExistingShape for `existing`), through the Go port of
// shape, so an unknown key at any depth or a mistyped value is refused
// with TS's own message text: `control.dryrun: "yes"` is an error, not a
// silent write. A `vol` value is a file (string or []byte) or an empty
// directory (nil), the memfs seed convention.
func OptionsFromMap(m map[string]any) (Options, error) {
	if m == nil {
		return Options{}, nil
	}
	m = volAsAny(m)
	if _, err := optionsSchema.Validate(m); err != nil {
		return Options{}, fmt.Errorf("Jostraca Options: %w", err)
	}
	if ex, ok := m["existing"].(map[string]any); ok {
		in := map[string]any{"txt": map[string]any{}, "bin": map[string]any{}}
		for _, k := range []string{"txt", "bin"} {
			if v, ok := ex[k]; ok {
				in[k] = v
			}
		}
		if _, err := existingSchema.Validate(in); err != nil {
			return Options{}, fmt.Errorf("Jostraca Options (`existing` property): %w", err)
		}
	}

	// Decoded from the input rather than the validated value, which carries
	// the schema's injected defaults: an injected `meta: {}` would replace
	// a global Meta on the merge.
	var o Options
	if v, ok := m["folder"].(string); ok {
		o.Folder = v
	}
	if v, ok := m["debug"].(string); ok {
		o.Debug = v
	}
	if v, ok := m["mem"].(bool); ok {
		o.Mem = &v
	}
	if v, ok := m["exclude"].(bool); ok {
		o.Exclude = v
	}
	if v, ok := m["build"].(bool); ok {
		o.Build = &v
	}
	if v, ok := m["model"].(map[string]any); ok {
		o.Model = v
	}
	if v, ok := m["meta"].(map[string]any); ok {
		o.Meta = v
	}
	if v, ok := m["fs"]; ok && v != nil {
		f, ok := v.(FS)
		if !ok {
			return Options{}, fmt.Errorf("Jostraca Options: property \"fs\" must implement FS, got %T", v)
		}
		o.FS = f
	}
	if v, ok := m["now"]; ok && v != nil {
		f, ok := v.(func() int64)
		if !ok {
			return Options{}, fmt.Errorf("Jostraca Options: property \"now\" must be a func() int64, got %T", v)
		}
		o.Now = f
	}
	if v, ok := m["log"]; ok && v != nil {
		l, ok := v.(Log)
		if !ok {
			return Options{}, fmt.Errorf("Jostraca Options: property \"log\" must implement Log, got %T", v)
		}
		o.Log = l
	}
	if vol, ok := m["vol"].(map[string]any); ok {
		o.Vol = make(map[string][]byte, len(vol))
		for k, v := range vol {
			switch b := v.(type) {
			case string:
				o.Vol[k] = append([]byte{}, b...)
			case []byte:
				o.Vol[k] = b
			case nil:
				o.Vol[k] = nil
			}
		}
	}
	if v, ok := m["existing"].(map[string]any); ok {
		o.Existing = decodeExisting(v)
	}
	if v, ok := m["control"].(map[string]any); ok {
		o.Control = decodeControl(v)
	}
	if v, ok := m["cmp"].(map[string]any); ok {
		cmp, err := decodeCmp(v)
		if err != nil {
			return Options{}, err
		}
		o.Cmp = cmp
	}
	if v, ok := m["name"].(map[string]any); ok {
		o.Name = decodeName(v)
	}
	return o, nil
}

// optionsSchema mirrors OptionsShape in ts/src/jostraca.ts, key for key.
// A Fault stands in where TS names a JavaScript type (Buffer, RegExp) that
// has no Go token, so the message text is still TS's.
var optionsSchema = shape.MustShape(map[string]any{
	"folder": shape.Skip(shape.String),
	"name": map[string]any{
		"file": map[string]any{
			"prefix": shape.Skip(shape.String),
			"suffix": shape.Skip(shape.String),
		},
		"folder": map[string]any{
			"prefix": shape.Skip(shape.String),
			"suffix": shape.Skip(shape.String),
		},
		"exclude": shape.Skip(shape.Fault(
			`Value "$VALUE" for property "$PATH" does not satisfy one of: `+
				`String, RegExp, ["One(String,)"]`,
			shape.Check(isNameExclude))),
	},
	"meta":     map[string]any{},
	"fs":       shape.Skip(shape.Any),
	"now":      shape.Skip(shape.Any),
	"log":      shape.Skip(shape.Any),
	"debug":    shape.Skip(shape.String),
	"exclude":  shape.Skip(shape.Boolean),
	"existing": map[string]any{"txt": map[string]any{}, "bin": map[string]any{}},
	"model":    shape.Skip(map[string]any{}),
	"build":    shape.Skip(shape.Boolean),
	"mem":      shape.Skip(shape.Boolean),
	"vol": shape.Skip(shape.Child(shape.Fault(
		`Value "$VALUE" for property "$PATH" does not satisfy one of: String, Buffer, null`,
		shape.Check(isVolSeed)), map[string]any{})),
	"cmp": map[string]any{
		"Copy": map[string]any{"ignore": []any{}},
	},
	"control": map[string]any{
		"dryrun":    shape.Skip(shape.Boolean),
		"duplicate": shape.Skip(shape.Boolean),
		"version":   shape.Skip(shape.Boolean),
	},
})

// existingSchema mirrors ExistingShape: txt and bin are closed, and bin
// has no diff and no merge.
var existingSchema = shape.MustShape(map[string]any{
	"txt": map[string]any{
		"write":    true,
		"preserve": false,
		"present":  false,
		"diff":     false,
		"merge":    false,
	},
	"bin": map[string]any{
		"write":    true,
		"preserve": false,
		"present":  false,
	},
})

func isVolSeed(v any, _ *shape.Update, _ *shape.State) bool {
	switch v.(type) {
	case string, []byte, nil:
		return true
	}
	return false
}

func isNameExclude(v any, _ *shape.Update, _ *shape.State) bool {
	one := func(x any) bool {
		switch y := x.(type) {
		case string:
			return y != ""
		case *regexp.Regexp:
			return true
		}
		return false
	}
	if one(v) {
		return true
	}
	if l, ok := v.([]any); ok {
		for _, x := range l {
			if !one(x) {
				return false
			}
		}
		return true
	}
	return false
}

// volAsAny widens a typed map[string][]byte vol to map[string]any, which
// is what the schema walks; shape would otherwise read each []byte as an
// array of numbers.
func volAsAny(m map[string]any) map[string]any {
	typed, ok := m["vol"].(map[string][]byte)
	if !ok {
		return m
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	vol := make(map[string]any, len(typed))
	for k, v := range typed {
		if v == nil {
			vol[k] = nil
		} else {
			vol[k] = v
		}
	}
	out["vol"] = vol
	return out
}

func decodeExisting(m map[string]any) Existing {
	var ex Existing
	if t, ok := m["txt"].(map[string]any); ok {
		ex.Txt = ExistingTxt{
			Write:    boolPtrField(t, "write"),
			Preserve: boolPtrField(t, "preserve"),
			Present:  boolPtrField(t, "present"),
			Diff:     boolPtrField(t, "diff"),
			Merge:    boolPtrField(t, "merge"),
		}
	}
	if b, ok := m["bin"].(map[string]any); ok {
		ex.Bin = ExistingBin{
			Write:    boolPtrField(b, "write"),
			Preserve: boolPtrField(b, "preserve"),
			Present:  boolPtrField(b, "present"),
		}
	}
	return ex
}

func boolPtrField(m map[string]any, key string) *bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return &b
		}
	}
	return nil
}

func decodeControl(m map[string]any) Control {
	var c Control
	if b, ok := m["dryrun"].(bool); ok {
		c.Dryrun = b
	}
	// TS field is "duplicate"; Go inverts to NoDuplicate.
	if b, ok := m["duplicate"].(bool); ok {
		c.NoDuplicate = !b
	}
	if b, ok := m["version"].(bool); ok {
		c.Version = b
	}
	return c
}

// decodeCmp compiles each cmp.Copy.ignore entry: a string is a regular
// expression source, and a *regexp.Regexp is used as it is.
func decodeCmp(m map[string]any) (CmpOptions, error) {
	var c CmpOptions
	cm, _ := m["Copy"].(map[string]any)
	ig, _ := cm["ignore"].([]any)
	for _, p := range ig {
		switch pat := p.(type) {
		case *regexp.Regexp:
			c.Copy.Ignore = append(c.Copy.Ignore, pat)
		case string:
			re, err := regexp.Compile(pat)
			if err != nil {
				return CmpOptions{}, fmt.Errorf(
					"Jostraca Options: property \"cmp.Copy.ignore\": %w", err)
			}
			c.Copy.Ignore = append(c.Copy.Ignore, re)
		default:
			return CmpOptions{}, fmt.Errorf(
				"Jostraca Options: property \"cmp.Copy.ignore\" entries must be "+
					"strings or regular expressions, got %T", p)
		}
	}
	return c, nil
}

func decodeName(m map[string]any) NameOptions {
	var n NameOptions
	if fm, ok := m["file"].(map[string]any); ok {
		n.File.Prefix, _ = fm["prefix"].(string)
		n.File.Suffix, _ = fm["suffix"].(string)
	}
	if fm, ok := m["folder"].(map[string]any); ok {
		n.Folder.Prefix, _ = fm["prefix"].(string)
		n.Folder.Suffix, _ = fm["suffix"].(string)
	}
	ex := m["exclude"]
	if l, ok := ex.([]any); ok {
		for _, x := range l {
			n.Exclude = append(n.Exclude, nameMatcher(x))
		}
	} else if ex != nil {
		n.Exclude = append(n.Exclude, nameMatcher(ex))
	}
	return n
}

func nameMatcher(x any) NameMatcher {
	if re, ok := x.(*regexp.Regexp); ok {
		return NameMatcher{RE: re}
	}
	s, _ := x.(string)
	return NameMatcher{Literal: s}
}

// mergeOptions applies the per-call options on top of the global ones.
// A per-call field that is supplied (non-nil, non-empty) replaces the
// global one. Control and Existing are merged per field, as TS deep-merges
// them; Vol merges per key. Meta and Model are replaced whole.
func mergeOptions(global, call Options) Options {
	out := global
	if call.Folder != "" {
		out.Folder = call.Folder
	}
	if call.Meta != nil {
		out.Meta = call.Meta
	}
	if call.FS != nil {
		out.FS = call.FS
	}
	if call.Now != nil {
		out.Now = call.Now
	}
	if call.Log != nil {
		out.Log = call.Log
	}
	if call.Debug != "" {
		out.Debug = call.Debug
	}
	if call.Model != nil {
		out.Model = call.Model
	}
	if call.Build != nil {
		out.Build = call.Build
	}
	// An explicitly supplied Mem wins either way round, including false.
	if call.Mem != nil {
		out.Mem = call.Mem
	}

	// The per-call volume MERGES over the global seed rather than replacing
	// it, which is TS's `deep({}, gVol, opts.vol)`. Replacing it dropped the
	// global Fragment and Copy sources a call was relying on, and could fail
	// its validation outright.
	if call.Vol != nil {
		merged := make(map[string][]byte, len(out.Vol)+len(call.Vol))
		for k, v := range out.Vol {
			merged[k] = v
		}
		for k, v := range call.Vol {
			merged[k] = v
		}
		out.Vol = merged
	}
	// Existing overlays PER FLAG, as TS deep-merges existing.txt and
	// existing.bin: a nil per-call pointer inherits the global flag.
	out.Existing = Existing{
		Txt: ExistingTxt{
			Write:    overBool(global.Existing.Txt.Write, call.Existing.Txt.Write),
			Preserve: overBool(global.Existing.Txt.Preserve, call.Existing.Txt.Preserve),
			Present:  overBool(global.Existing.Txt.Present, call.Existing.Txt.Present),
			Diff:     overBool(global.Existing.Txt.Diff, call.Existing.Txt.Diff),
			Merge:    overBool(global.Existing.Txt.Merge, call.Existing.Txt.Merge),
		},
		Bin: ExistingBin{
			Write:    overBool(global.Existing.Bin.Write, call.Existing.Bin.Write),
			Preserve: overBool(global.Existing.Bin.Preserve, call.Existing.Bin.Preserve),
			Present:  overBool(global.Existing.Bin.Present, call.Existing.Bin.Present),
		},
	}
	// Control merges PER FIELD, as TS's `deep({}, CONTROL_DEFAULTS,
	// gOpts.control, opts.control)` does: a per-call Control that sets one
	// flag leaves every other global flag in force. A bool cannot say
	// "unset", so a per-call false cannot clear a global true.
	out.Control = Control{
		Dryrun:      global.Control.Dryrun || call.Control.Dryrun,
		NoDuplicate: global.Control.NoDuplicate || call.Control.NoDuplicate,
		Version:     global.Control.Version || call.Control.Version,
	}
	if call.Exclude {
		out.Exclude = true
	}
	return out
}

// overBool is the per-call flag when supplied, else the global one.
func overBool(global, call *bool) *bool {
	if call != nil {
		return call
	}
	return global
}
