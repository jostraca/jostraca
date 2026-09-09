// template.rs — `$$path$$` substitution with optional replace map.
// Ported from go/template.go / ts/src/util/basic.ts.

use regex::Regex;
use std::collections::HashMap;

/// Spec for template rendering; mirrors Go `TemplateSpec`.
#[derive(Default)]
pub struct TemplateSpec {
    pub replace: HashMap<String, serde_json::Value>,
}

/// Renders `src` substituting `$$path.to.value$$` placeholders from `model`
/// and performing optional literal/regex replacements from `spec.replace`.
///
/// Returns an error if an empty-match regex is encountered, mirroring Go.
pub fn template(
    src: &str,
    model: &serde_json::Value,
    spec: Option<&TemplateSpec>,
) -> Result<String, String> {
    if src.is_empty() {
        return Ok(String::new());
    }

    // Build the assembled regex.
    let replace = spec.map(|s| &s.replace);
    let (re, canon_keys) = build_template_re(replace)?;

    let mut out = String::with_capacity(src.len());
    let mut remain = src;

    loop {
        match re.find(remain) {
            None => {
                out.push_str(remain);
                break;
            }
            Some(m) => {
                if m.start() == m.end() {
                    return Err(format!("empty match regex: {}", re.as_str()));
                }
                out.push_str(&remain[..m.start()]);

                let match_str = m.as_str();
                let caps = re.captures(match_str).unwrap();

                let insert = resolve_match(&re, model, match_str, &caps, replace, &canon_keys)?;
                out.push_str(&insert);
                remain = &remain[m.end()..];
                if remain.is_empty() { break; }
            }
        }
    }

    Ok(out)
}

/// (canon_name, orig_key) mapping.
type CanonKey = (String, String);

fn build_template_re(
    replace: Option<&HashMap<String, serde_json::Value>>,
) -> Result<(Regex, Vec<CanonKey>), String> {
    let mut pattern = String::from(r"(?P<J_O>\$\$)(?P<J_R>[^$]+)(?P<J_C>\$\$)");
    let mut canon_keys: Vec<CanonKey> = Vec::new();
    let mut counter = 1usize;

    if let Some(rep) = replace {
        let mut keys: Vec<String> = rep.keys().cloned().collect();
        sort_replace_keys(&mut keys);

        for k in &keys {
            let canon = idenstr_template(k);
            canon_keys.push((canon.clone(), k.clone()));

            if is_regex_key(k) {
                let body = &k[1..k.len() - 1];
                pattern.push_str(&format!("|(?P<J_K{counter}_{canon}>{body})"));
            } else {
                let escaped = regex::escape(k);
                pattern.push_str(&format!("|(?P<J_K{counter}_{canon}>{escaped})"));
            }
            counter += 1;
        }
    }

    Regex::new(&pattern).map_err(|e| format!("empty match regex: {e}")).map(|re| (re, canon_keys))
}

fn is_regex_key(k: &str) -> bool {
    k.len() >= 2 && k.starts_with('/') && k.ends_with('/')
}

fn idenstr_template(s: &str) -> String {
    let mut out: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }
        })
        .collect();
    // Collapse runs of underscores
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out = out.trim_matches('_').to_string();
    if out.is_empty() { "x".to_string() } else { out }
}

/// Mirrors Go `sortReplaceKeys`: # tags first (dash variants longer-first,
/// then plain by length), other keys by length descending.
fn sort_replace_keys(keys: &mut Vec<String>) {
    keys.sort_by(|a, b| {
        let a_tag = a.starts_with('#');
        let b_tag = b.starts_with('#');
        if a_tag && !b_tag { return std::cmp::Ordering::Less; }
        if !a_tag && b_tag { return std::cmp::Ordering::Greater; }
        if a_tag && b_tag {
            let a_dash = a.contains('-');
            let b_dash = b.contains('-');
            if a_dash && b_dash { return b.len().cmp(&a.len()); }
            if a_dash && !b_dash { return std::cmp::Ordering::Less; }
            if !a_dash && b_dash { return std::cmp::Ordering::Greater; }
            return b.len().cmp(&a.len());
        }
        b.len().cmp(&a.len())
    });
}

fn resolve_match(
    _re: &Regex,
    model: &serde_json::Value,
    match_str: &str,
    caps: &regex::Captures,
    replace: Option<&HashMap<String, serde_json::Value>>,
    canon_keys: &[CanonKey],
) -> Result<String, String> {
    // Check for a model ref (J_R group).
    if let Some(ref_m) = caps.name("J_R") {
        let ref_str = ref_m.as_str();
        if !ref_str.is_empty() {
            return Ok(resolve_model_ref(model, match_str, ref_str));
        }
    }

    // Check replace keys (J_K* groups).
    if let Some(rep) = replace {
        for (canon, orig) in canon_keys {
            let _group_prefix = format!("J_K");
            // Find the numbered group: J_K{n}_{canon}
            // We scan named groups
            for name in _re.capture_names().flatten() {
                if name.starts_with("J_K") && name.ends_with(canon.as_str()) {
                    if let Some(m) = caps.name(name) {
                        if !m.as_str().is_empty() {
                            // Found matching group
                            if let Some(val) = rep.get(orig) {
                                return Ok(invoke_replace(val, match_str));
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(match_str.to_string())
}

fn resolve_model_ref(model: &serde_json::Value, full_match: &str, ref_str: &str) -> String {
    // Quoted string literal: `"value"`
    if ref_str.starts_with('"') && ref_str.ends_with('"') && ref_str.len() >= 2 {
        return ref_str[1..ref_str.len() - 1].to_string();
    }
    match crate::util::lookup(model, ref_str) {
        Some(v) => format_value(v, full_match),
        None => full_match.to_string(),
    }
}

fn format_value(v: &serde_json::Value, fallback: &str) -> String {
    match v {
        serde_json::Value::Null => fallback.to_string(),
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
        serde_json::Value::Number(n) => crate::util::format_js_float(n.as_f64().unwrap_or(0.0)),
        other => {
            // Map/array: JSON-encode without HTML escaping
            serde_json::to_string(other)
                .unwrap_or_else(|_| format!("{}", other))
        }
    }
}

fn invoke_replace(val: &serde_json::Value, _match_str: &str) -> String {
    match val {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(s) => s.clone(),
        other => format!("{}", other),
    }
}
