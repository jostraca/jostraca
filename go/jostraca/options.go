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

type Control struct {
	Dryrun    bool
	Duplicate bool
	Version   bool
}

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
func WithFS(fs FS) Option              { return func(o *Options) { o.FS = fs } }
func WithNow(f func() int64) Option    { return func(o *Options) { o.Now = f } }
func WithExisting(e Existing) Option   { return func(o *Options) { o.Existing = e } }
func WithControl(c Control) Option     { return func(o *Options) { o.Control = c } }
func WithBuild(b bool) Option          { return func(o *Options) { o.Build = &b } }

// applyOptions builds an Options value from the variadic constructors.
func applyOptions(opts []Option) Options {
	var o Options
	for _, fn := range opts {
		fn(&o)
	}
	return o
}

// OptionsFromMap builds an Options value from an untyped map. Unknown
// keys are ignored in v0; this will gain a shape-validated schema in
// Phase 12 doc pass when the map surface stabilises. For Phase 1 the
// contract is "no error on empty map".
func OptionsFromMap(m map[string]any) (Options, error) {
	if m == nil {
		return Options{}, nil
	}
	var o Options
	for k, v := range m {
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
		}
		// Unknown keys silently ignored in Phase 1.
	}
	return o, nil
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
	return out
}
