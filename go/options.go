package jostraca

import (
	"fmt"
	"regexp"
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
	Mem      bool
	Vol      map[string][]byte
	Cmp      CmpOptions
	Control  Control
	Name     NameOptions

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
func WithMem() Option                   { return func(o *Options) { o.Mem = true } }
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

// OptionsFromMap builds an Options value from an untyped map. Mirrors
// the TS OptionsShape at src/jostraca.ts:99-153, validating each
// top-level key and recursively decoding nested groups (Existing,
// Control, Cmp, Name).
//
// Returns an error on any type mismatch; unknown keys are ignored.
func OptionsFromMap(m map[string]any) (Options, error) {
	if m == nil {
		return Options{}, nil
	}
	var o Options
	for _, k := range sortedKeys(m) {
		v := m[k]
		switch k {
		case "folder":
			s, ok := v.(string)
			if !ok {
				return o, fmt.Errorf("jostraca: option %q must be string", k)
			}
			o.Folder = s
		case "debug":
			s, ok := v.(string)
			if !ok {
				return o, fmt.Errorf("jostraca: option %q must be string", k)
			}
			o.Debug = s
		case "mem":
			b, ok := v.(bool)
			if !ok {
				return o, fmt.Errorf("jostraca: option %q must be bool", k)
			}
			o.Mem = b
		case "exclude":
			b, ok := v.(bool)
			if !ok {
				return o, fmt.Errorf("jostraca: option %q must be bool", k)
			}
			o.Exclude = b
		case "build":
			b, ok := v.(bool)
			if !ok {
				return o, fmt.Errorf("jostraca: option %q must be bool", k)
			}
			o.Build = &b
		case "model":
			mm, ok := v.(map[string]any)
			if !ok {
				return o, fmt.Errorf("jostraca: option %q must be map", k)
			}
			o.Model = mm
		case "meta":
			mm, ok := v.(map[string]any)
			if !ok {
				return o, fmt.Errorf("jostraca: option %q must be map", k)
			}
			o.Meta = mm
		case "vol":
			vol, ok := v.(map[string]any)
			if !ok {
				return o, fmt.Errorf("jostraca: option %q must be map", k)
			}
			o.Vol = make(map[string][]byte, len(vol))
			for vk, vv := range vol {
				switch vvc := vv.(type) {
				case string:
					o.Vol[vk] = []byte(vvc)
				case []byte:
					o.Vol[vk] = vvc
				default:
					return o, fmt.Errorf("jostraca: vol[%q] must be string or []byte", vk)
				}
			}
		case "existing":
			ex, err := decodeExisting(v)
			if err != nil {
				return o, err
			}
			o.Existing = ex
		case "control":
			ctrl, err := decodeControl(v)
			if err != nil {
				return o, err
			}
			o.Control = ctrl
		case "cmp":
			cmp, err := decodeCmp(v)
			if err != nil {
				return o, err
			}
			o.Cmp = cmp
		case "name":
			name, err := decodeName(v)
			if err != nil {
				return o, err
			}
			o.Name = name
		}
		// Unknown keys silently ignored.
	}
	return o, nil
}

func decodeExisting(v any) (Existing, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return Existing{}, fmt.Errorf("jostraca: option \"existing\" must be map")
	}
	var ex Existing
	if t, ok := m["txt"].(map[string]any); ok {
		ex.Txt = decodeExistingTxt(t)
	}
	if t, ok := m["bin"].(map[string]any); ok {
		ex.Bin = decodeExistingBin(t)
	}
	return ex, nil
}

func decodeExistingTxt(m map[string]any) ExistingTxt {
	var t ExistingTxt
	t.Write = boolPtrField(m, "write")
	t.Preserve = boolPtrField(m, "preserve")
	t.Present = boolPtrField(m, "present")
	t.Diff = boolPtrField(m, "diff")
	t.Merge = boolPtrField(m, "merge")
	return t
}

func decodeExistingBin(m map[string]any) ExistingBin {
	var b ExistingBin
	b.Write = boolPtrField(m, "write")
	b.Preserve = boolPtrField(m, "preserve")
	b.Present = boolPtrField(m, "present")
	return b
}

func boolPtrField(m map[string]any, key string) *bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return &b
		}
	}
	return nil
}

func decodeControl(v any) (Control, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return Control{}, fmt.Errorf("jostraca: option \"control\" must be map")
	}
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
	return c, nil
}

func decodeCmp(v any) (CmpOptions, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return CmpOptions{}, fmt.Errorf("jostraca: option \"cmp\" must be map")
	}
	var c CmpOptions
	if cm, ok := m["Copy"].(map[string]any); ok {
		if ig, ok := cm["ignore"].([]any); ok {
			for _, p := range ig {
				if pat, ok := p.(string); ok {
					if re, err := regexp.Compile(pat); err == nil {
						c.Copy.Ignore = append(c.Copy.Ignore, re)
					}
				}
			}
		}
	}
	return c, nil
}

func decodeName(v any) (NameOptions, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return NameOptions{}, fmt.Errorf("jostraca: option \"name\" must be map")
	}
	var n NameOptions
	if fm, ok := m["file"].(map[string]any); ok {
		if s, ok := fm["prefix"].(string); ok {
			n.File.Prefix = s
		}
		if s, ok := fm["suffix"].(string); ok {
			n.File.Suffix = s
		}
	}
	if fm, ok := m["folder"].(map[string]any); ok {
		if s, ok := fm["prefix"].(string); ok {
			n.Folder.Prefix = s
		}
		if s, ok := fm["suffix"].(string); ok {
			n.Folder.Suffix = s
		}
	}
	return n, nil
}

// mergeOptions applies the per-call options on top of the global ones.
// Right-precedence per-field; matches the TS deep-merge surface for the
// fields used today. Maps are not deep-merged in Phase 1; revisit when
// the Deep utility lands in Phase 4.
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
	if call.Mem {
		out.Mem = true
	}
	if call.Vol != nil {
		out.Vol = call.Vol
	}
	if call.Existing != (Existing{}) {
		out.Existing = call.Existing
	}
	if call.Control != (Control{}) {
		out.Control = call.Control
	}
	if call.Exclude {
		out.Exclude = true
	}
	return out
}
