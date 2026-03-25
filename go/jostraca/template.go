package jostraca

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/rjrodger/shape/go/shape"
)

// ReplaceFunc generates replacement text for regex/literal replacements.
type ReplaceFunc func(groups map[string]string, match string) string

// TemplateSpec customizes template rendering.
type TemplateSpec struct {
	Replace map[string]any
	Eject   [2]string
}

var macroRe = regexp.MustCompile(`\$\$([^$]+)\$\$`)

// templateSpecSchema validates TemplateSpec fields when provided as a map.
var templateSpecSchema = shape.MustShape(map[string]any{
	"replace": shape.Optional(map[string]any{}),
	"eject":   shape.Optional([]any{shape.String, shape.String}),
})

// ParseTemplateSpec validates and builds a TemplateSpec from a raw map.
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
		if s0, ok := e[0].(string); ok {
			spec.Eject[0] = s0
		}
		if s1, ok := e[1].(string); ok {
			spec.Eject[1] = s1
		}
	}

	return spec, nil
}

// Template renders src using $$path.to.value$$ placeholders and optional replacements.
func Template(src string, model any, spec *TemplateSpec) (string, error) {
	if src == "" {
		return "", nil
	}

	out := src
	if spec != nil && (spec.Eject[0] != "" || spec.Eject[1] != "") {
		out = eject(out, spec.Eject)
	}

	if spec != nil && len(spec.Replace) > 0 {
		var err error
		out, err = applyReplacements(out, spec.Replace)
		if err != nil {
			return "", err
		}
	}

	out = macroRe.ReplaceAllStringFunc(out, func(m string) string {
		g := macroRe.FindStringSubmatch(m)
		if len(g) < 2 {
			return m
		}

		ref := g[1]
		if strings.HasPrefix(ref, `"`) && strings.HasSuffix(ref, `"`) && len(ref) >= 2 {
			return ref[1 : len(ref)-1]
		}

		val, ok := lookup(model, ref)
		if !ok {
			return m
		}
		switch v := val.(type) {
		case nil:
			return m
		case string:
			return v
		case fmt.Stringer:
			return v.String()
		default:
			return fmt.Sprintf("%v", v)
		}
	})

	return out, nil
}

func applyReplacements(src string, replace map[string]any) (string, error) {
	out := src
	for k, v := range replace {
		if strings.HasPrefix(k, "/") && strings.HasSuffix(k, "/") {
			re, err := regexp.Compile(k[1 : len(k)-1])
			if err != nil {
				return "", err
			}
			out = re.ReplaceAllStringFunc(out, func(match string) string {
				if fn, ok := v.(ReplaceFunc); ok {
					groups := map[string]string{}
					sub := re.FindStringSubmatch(match)
					for i, n := range re.SubexpNames() {
						if i > 0 && n != "" && i < len(sub) {
							groups[n] = sub[i]
						}
					}
					return fn(groups, match)
				}
				return fmt.Sprintf("%v", v)
			})
			continue
		}

		re := regexp.MustCompile(regexp.QuoteMeta(k))
		if fn, ok := v.(ReplaceFunc); ok {
			out = re.ReplaceAllStringFunc(out, func(match string) string {
				return fn(map[string]string{}, match)
			})
		} else {
			out = re.ReplaceAllString(out, fmt.Sprintf("%v", v))
		}
	}
	return out, nil
}

func eject(src string, markers [2]string) string {
	start := 0
	end := len(src)
	if markers[0] != "" {
		if idx := strings.Index(src, markers[0]); idx >= 0 {
			start = idx + len(markers[0])
		}
	}
	if markers[1] != "" {
		if idx := strings.Index(src, markers[1]); idx >= 0 {
			end = idx
		}
	}
	if start > end {
		return ""
	}
	return src[start:end]
}

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
