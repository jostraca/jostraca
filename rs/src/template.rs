// template.rs — Full template engine ported from go/template.go / ts/src/util/basic.ts.

use regex::Regex;
use std::collections::HashMap;
use std::sync::Mutex;

// ─── Public types ────────────────────────────────────────────────────────────

/// A function that generates replacement text for regex/literal replacements.
/// `groups` holds named capture groups; `match_str` is the full matched string.
pub type ReplaceFunc = Box<dyn Fn(&HashMap<String, String>, &str) -> String + Send + Sync>;

/// An entry in the replace map — can be a static string, a dynamic function,
/// or any other value that will be formatted as a string.
pub enum ReplaceValue {
    Str(String),
    Func(ReplaceFunc),
    Json(serde_json::Value),
}

impl ReplaceValue {
    pub fn invoke(&self, groups: &HashMap<String, String>, match_str: &str) -> String {
        match self {
            ReplaceValue::Str(s) => s.clone(),
            ReplaceValue::Func(f) => f(groups, match_str),
            ReplaceValue::Json(v) => match v {
                serde_json::Value::Null => String::new(),
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
                serde_json::Value::Number(n) => {
                    crate::util::format_js_float(n.as_f64().unwrap_or(0.0))
                }
                other => serde_json::to_string(other).unwrap_or_else(|_| other.to_string()),
            },
        }
    }
}

/// An eject marker — either a literal string or a regex pattern.
pub enum EjectMarker {
    Str(String),
    Regex(Regex),
}

/// Spec for template rendering; mirrors Go `TemplateSpec`.
#[derive(Default)]
pub struct TemplateSpec {
    /// Key→value replace map. Keys may be: literal string, /regex/, or #Tag.
    pub replace: HashMap<String, ReplaceValue>,
    /// Eject markers: `[start, end]` — content before start and after end is removed.
    pub eject: Option<[EjectMarker; 2]>,
    /// Custom open delimiter regex pattern; defaults to `\$\$`.
    pub open: String,
    /// Custom close delimiter regex pattern; defaults to `\$\$`.
    pub close: String,
    /// Custom ref pattern; defaults to `[^$]+`.
    pub ref_pat: String,
    /// Override the assembled regex directly (advanced use).
    pub insert: Option<Regex>,
    /// When set, receives every output segment instead of building the returned string.
    pub handle: Option<Box<dyn FnMut(String) + Send + Sync>>,
}

// ─── Cache ───────────────────────────────────────────────────────────────────

struct CacheEntry {
    re: Regex,
    canon_keys: Vec<CanonKey>,
}

/// (canon_name, orig_key) mapping.
#[derive(Clone)]
struct CanonKey {
    orig: String,
    canon: String,
}

const TEMPLATE_CACHE_MAX: usize = 100;

lazy_static::lazy_static! {
    static ref TEMPLATE_CACHE: Mutex<HashMap<String, CacheEntry>> =
        Mutex::new(HashMap::with_capacity(TEMPLATE_CACHE_MAX));
    static ref EJECT_CACHE: Mutex<HashMap<String, Regex>> =
        Mutex::new(HashMap::with_capacity(100));
}

// ─── Public entry points ─────────────────────────────────────────────────────

/// Simplest variant: substitute model values only, no replace map.
/// Equivalent to `template(src, model, None)`.
pub fn template_f(src: &str, model: &serde_json::Value) -> Result<String, String> {
    template(src, model, None)
}

/// Model-less variant for replace-only substitutions.
pub fn template_r(src: &str, replace: HashMap<String, ReplaceValue>) -> Result<String, String> {
    let spec = TemplateSpec { replace, ..Default::default() };
    template(src, &serde_json::Value::Null, Some(spec))
}

/// Full template rendering. Mirrors Go `Template`.
pub fn template(
    src: &str,
    model: &serde_json::Value,
    spec: Option<TemplateSpec>,
) -> Result<String, String> {
    if src.is_empty() {
        return Ok(String::new());
    }

    let mut out_src = src.to_string();

    // Apply eject first.
    if let Some(ref s) = spec {
        if let Some(ref eject) = s.eject {
            out_src = apply_eject(&out_src, eject)?;
        }
    }

    let (open, close, ref_pat) = delimiters(spec.as_ref());
    let spec_replace: &HashMap<String, ReplaceValue> = spec
        .as_ref()
        .map(|s| &s.replace as &HashMap<String, ReplaceValue>)
        .unwrap_or_else(|| {
            // We need a 'static ref — use a thread-local or a lazy static.
            static EMPTY: std::sync::OnceLock<HashMap<String, ReplaceValue>> =
                std::sync::OnceLock::new();
            EMPTY.get_or_init(HashMap::new)
        });

    let cache_key = format!(
        "{}\x00{}\x00{}\x00{}",
        open,
        close,
        ref_pat,
        sorted_keys_join(spec_replace)
    );

    let (re, canon_keys): (Regex, Vec<CanonKey>) = {
        let mut cache = TEMPLATE_CACHE.lock().unwrap();
        if let Some(entry) = cache.get(&cache_key) {
            // Clone out what we need. Regex is not Clone, so rebuild pattern.
            let pattern = entry.re.as_str().to_string();
            let ck = entry.canon_keys.clone();
            drop(cache);
            (Regex::new(&pattern).map_err(|e| e.to_string())?, ck)
        } else {
            let built = build_template_re(&open, &close, &ref_pat, spec_replace)?;
            let pattern = built.re.as_str().to_string();
            let ck = built.canon_keys.clone();
            if cache.len() >= TEMPLATE_CACHE_MAX {
                cache.clear();
            }
            cache.insert(cache_key, CacheEntry { re: built.re, canon_keys: built.canon_keys });
            drop(cache);
            (Regex::new(&pattern).map_err(|e| e.to_string())?, ck)
        }
    };

    // If spec has a custom Insert regex, use it instead.
    let insert_re: Regex = if let Some(ref s) = spec {
        if let Some(ref ins) = s.insert {
            Regex::new(ins.as_str()).map_err(|e| e.to_string())?
        } else {
            re
        }
    } else {
        re
    };

    // Build canon→value lookup.
    let mut canon_values: HashMap<String, &ReplaceValue> = HashMap::with_capacity(canon_keys.len());
    for ck in &canon_keys {
        if let Some(v) = spec_replace.get(&ck.orig) {
            canon_values.insert(ck.canon.clone(), v);
        }
    }

    let mut result = String::with_capacity(src.len());
    let mut remain = out_src.as_str();

    loop {
        match insert_re.find(remain) {
            None => {
                if let Some(ref mut s) = spec.as_ref().and_then(|_| None::<&mut TemplateSpec>) {
                    let _ = s;
                }
                result.push_str(remain);
                break;
            }
            Some(m) => {
                if m.start() == m.end() {
                    return Err(format!(
                        "jostraca: empty match regex: {}",
                        insert_re.as_str()
                    ));
                }
                result.push_str(&remain[..m.start()]);
                let match_str = m.as_str();
                let caps = insert_re.captures(match_str).unwrap();
                let groups = named_groups(&insert_re, match_str, &caps);
                let insert =
                    resolve_match(&insert_re, model, match_str, &groups, &canon_values)?;
                result.push_str(&insert);
                remain = &remain[m.end()..];
                if remain.is_empty() {
                    break;
                }
            }
        }
    }

    Ok(result)
}

// ─── Template build helpers ──────────────────────────────────────────────────

fn delimiters(spec: Option<&TemplateSpec>) -> (String, String, String) {
    let open  = spec.and_then(|s| if s.open.is_empty() { None } else { Some(s.open.clone()) })
        .unwrap_or_else(|| r"\$\$".to_string());
    let close = spec.and_then(|s| if s.close.is_empty() { None } else { Some(s.close.clone()) })
        .unwrap_or_else(|| r"\$\$".to_string());
    let ref_p = spec.and_then(|s| if s.ref_pat.is_empty() { None } else { Some(s.ref_pat.clone()) })
        .unwrap_or_else(|| "[^$]+".to_string());
    (open, close, ref_p)
}

struct BuildResult {
    re: Regex,
    canon_keys: Vec<CanonKey>,
}

fn build_template_re(
    open: &str,
    close: &str,
    ref_pat: &str,
    replace: &HashMap<String, ReplaceValue>,
) -> Result<BuildResult, String> {
    let mut sb = String::new();
    sb.push_str(&format!(r"(?P<J_O>{open})(?P<J_R>{ref_pat})(?P<J_C>{close})"));

    let mut keys: Vec<String> = replace.keys().cloned().collect();
    sort_replace_keys(&mut keys);

    let mut canon_keys: Vec<CanonKey> = Vec::with_capacity(keys.len());
    let mut counter = 1usize;

    for k in &keys {
        let canon = idenstr_template(k);
        canon_keys.push(CanonKey { orig: k.clone(), canon: canon.clone() });

        if is_regex_key(k) {
            let body = &k[1..k.len() - 1];
            let renamed = rename_user_groups(body, &mut counter);
            sb.push_str(&format!("|(?P<J_K{counter}_{canon}>{renamed})"));
            counter += 1;
        } else if is_tag_key(k) {
            let pattern = build_tag_regex(k, &mut counter)?;
            sb.push_str(&format!("|(?P<J_T{counter}_{canon}>{pattern})"));
            counter += 1;
        } else {
            let escaped = regex::escape(k);
            sb.push_str(&format!("|(?P<J_K{counter}_{canon}>{escaped})"));
            counter += 1;
        }
    }

    let re = Regex::new(&sb)
        .map_err(|e| format!("template: failed to compile assembled regex: {e}"))?;
    Ok(BuildResult { re, canon_keys })
}

fn is_regex_key(k: &str) -> bool {
    k.len() >= 2 && k.starts_with('/') && k.ends_with('/')
}

fn is_tag_key(k: &str) -> bool {
    // #Tag or #Tag-Name
    if !k.starts_with('#') { return false; }
    let rest = &k[1..];
    let mut chars = rest.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    // rest must be [A-Za-z0-9]+(-[A-Z][a-z0-9]+)?
    let mut in_dash = false;
    for c in chars {
        if c == '-' {
            if in_dash { return false; }
            in_dash = true;
        } else if in_dash {
            if !c.is_ascii_uppercase() { return false; }
            in_dash = false;
        } else if !c.is_ascii_alphanumeric() {
            return false;
        }
    }
    true
}

/// Builds the regex for a `#Tag` or `#Tag-Name` key. Mirrors Go `buildTagRegex`.
fn build_tag_regex(k: &str, counter: &mut usize) -> Result<String, String> {
    // parse #TagPart(-DashPart)?
    let rest = &k[1..]; // strip '#'
    let (tag_part, dash_part): (&str, Option<&str>) = if let Some(dash_pos) = rest.find('-') {
        (&rest[..dash_pos], Some(&rest[dash_pos + 1..]))
    } else {
        (rest, None)
    };

    let mut sb = String::new();
    let indent_ctr = *counter;
    *counter += 1;
    sb.push_str(&format!(r"(?P<J_N{indent_ctr}_indent>[ \t]*)"));
    sb.push_str(r"//");
    sb.push_str(r"[ \t]*#");

    if let Some(dash) = dash_part {
        // #Foo-Bar: capture an identifier as Bar
        let name_ctr = *counter;
        *counter += 1;
        let tag_ctr = *counter;
        *counter += 1;
        sb.push_str(&format!(
            r"(?P<J_N{name_ctr}_{dash}>[A-Za-z0-9]+)-(?P<J_N{tag_ctr}_TAG>{tag_esc})",
            tag_esc = regex::escape(dash),
        ));
    } else {
        // #Foo: capture the literal tag
        let tag_ctr = *counter;
        *counter += 1;
        sb.push_str(&format!(
            r"(?P<J_N{tag_ctr}_TAG>{tag_esc})",
            tag_esc = regex::escape(tag_part),
        ));
    }
    sb.push_str(r"[ \t]*\n?");
    Ok(sb)
}

lazy_static::lazy_static! {
    static ref USER_GROUP_RE: Regex = Regex::new(r"\(\?P?<([\w\d_]+)>").unwrap();
}

fn rename_user_groups(src: &str, counter: &mut usize) -> String {
    // Replace each `(?P<name>` or `(?<name>` with `(?P<J_N{n}_{name}>`
    let mut result = String::new();
    let mut last = 0;
    for caps in USER_GROUP_RE.captures_iter(src) {
        let m = caps.get(0).unwrap();
        let name = &caps[1];
        result.push_str(&src[last..m.start()]);
        result.push_str(&format!("(?P<J_N{}_{}>" , counter, name));
        *counter += 1;
        last = m.end();
    }
    result.push_str(&src[last..]);
    result
}

fn idenstr_template(s: &str) -> String {
    let mut out: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
        .collect();
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out = out.trim_matches('_').to_string();
    if out.is_empty() { "x".to_string() } else { out }
}

/// Mirrors Go `sortReplaceKeys`.
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

fn sorted_keys_join(m: &HashMap<String, ReplaceValue>) -> String {
    let mut keys: Vec<&str> = m.keys().map(|s| s.as_str()).collect();
    keys.sort_unstable();
    keys.join("\x00")
}

fn named_groups<'a>(re: &Regex, src: &'a str, caps: &regex::Captures<'a>) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (i, name) in re.capture_names().enumerate() {
        if let Some(n) = name {
            if let Some(m) = caps.get(i) {
                out.insert(n.to_string(), m.as_str().to_string());
            }
        }
    }
    out
}

/// Strip J_K{n}_, J_T{n}_, or J_N{n}_ prefix from a group name.
fn strip_jk_prefix(k: &str) -> &str {
    for prefix in &["J_K", "J_T"] {
        if let Some(rest) = k.strip_prefix(prefix) {
            // skip digits then '_'
            let digit_end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
            let rest2 = &rest[digit_end..];
            if let Some(s) = rest2.strip_prefix('_') {
                return s;
            }
        }
    }
    k
}

/// Strip J_K{n}_, J_T{n}_, J_N{n}_ prefix and return the short user name.
fn strip_internal_prefix(k: &str) -> Option<&str> {
    for prefix in &["J_K", "J_T", "J_N"] {
        if let Some(rest) = k.strip_prefix(prefix) {
            let digit_end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
            if digit_end == 0 { continue; }
            let rest2 = &rest[digit_end..];
            if let Some(s) = rest2.strip_prefix('_') {
                if !s.is_empty() { return Some(s); }
            }
        }
    }
    None
}

/// Returns a user-friendly view of named groups, stripping internal prefixes.
fn user_group_view(groups: &HashMap<String, String>, match_str: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut sorted_keys: Vec<&str> = groups.keys().map(|s| s.as_str()).collect();
    sorted_keys.sort_unstable();
    for k in sorted_keys {
        let v = &groups[k];
        if v.is_empty() { continue; }
        if let Some(short) = strip_internal_prefix(k) {
            out.entry(short.to_string()).or_insert_with(|| v.clone());
        }
        out.insert(k.to_string(), v.clone());
    }
    out.insert("$&".to_string(), match_str.to_string());
    out
}

fn resolve_match(
    _re: &Regex,
    model: &serde_json::Value,
    match_str: &str,
    groups: &HashMap<String, String>,
    canon_values: &HashMap<String, &ReplaceValue>,
) -> Result<String, String> {
    // Check for model ref (J_R group).
    if let Some(ref_str) = groups.get("J_R") {
        if !ref_str.is_empty() {
            return Ok(resolve_model_ref(model, match_str, ref_str));
        }
    }

    let user = user_group_view(groups, match_str);
    let mut sorted_group_keys: Vec<&str> = groups.keys().map(|s| s.as_str()).collect();
    sorted_group_keys.sort_unstable();

    // Pass 1: J_K* groups (literal/regex user keys).
    for k in &sorted_group_keys {
        if !k.starts_with("J_K") { continue; }
        let v = groups.get(*k).map(|s| s.as_str()).unwrap_or("");
        if v.is_empty() { continue; }
        let canon = strip_jk_prefix(k);
        if let Some(val) = canon_values.get(canon) {
            return Ok(val.invoke(&user, match_str));
        }
    }
    // Pass 2: J_T* groups (tag wrappers).
    for k in &sorted_group_keys {
        if !k.starts_with("J_T") { continue; }
        let v = groups.get(*k).map(|s| s.as_str()).unwrap_or("");
        if v.is_empty() { continue; }
        let canon = strip_jk_prefix(k);
        if let Some(val) = canon_values.get(canon) {
            return Ok(val.invoke(&user, match_str));
        }
    }

    Ok(match_str.to_string())
}

fn resolve_model_ref(model: &serde_json::Value, full_match: &str, ref_str: &str) -> String {
    // Quoted string literal.
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
            // JSON-encode without HTML escaping.
            serde_json::to_string(other).unwrap_or_else(|_| other.to_string())
        }
    }
}

// ─── Eject ───────────────────────────────────────────────────────────────────

fn apply_eject(src: &str, eject: &[EjectMarker; 2]) -> Result<String, String> {
    let mut start_idx = 0usize;
    let mut end_idx = src.len();

    if let Some(re) = compile_eject_marker(&eject[0])? {
        if let Some(m) = re.find(src) {
            start_idx = m.end();
        }
    }
    if let Some(re) = compile_eject_marker(&eject[1])? {
        if let Some(m) = re.find(src) {
            end_idx = m.start();
        }
    }

    if start_idx > end_idx {
        return Ok(src.to_string());
    }
    Ok(src[start_idx..end_idx].to_string())
}

fn compile_eject_marker(m: &EjectMarker) -> Result<Option<Regex>, String> {
    match m {
        EjectMarker::Regex(re) => {
            // Clone by rebuilding from pattern.
            Ok(Some(Regex::new(re.as_str()).map_err(|e| e.to_string())?))
        }
        EjectMarker::Str(s) => {
            if s.is_empty() {
                return Ok(None);
            }
            // Slash-wrapped strings are regex bodies.
            if s.len() >= 2 && s.starts_with('/') && s.ends_with('/') {
                let body = &s[1..s.len() - 1];
                let mut cache = EJECT_CACHE.lock().unwrap();
                if let Some(re) = cache.get(s) {
                    let pattern = re.as_str().to_string();
                    drop(cache);
                    return Ok(Some(Regex::new(&pattern).map_err(|e| e.to_string())?));
                }
                let re = Regex::new(body).map_err(|e| e.to_string())?;
                if cache.len() >= 100 { cache.clear(); }
                cache.insert(s.clone(), re);
                let pattern = cache[s].as_str().to_string();
                drop(cache);
                return Ok(Some(Regex::new(&pattern).map_err(|e| e.to_string())?));
            }
            // Bare string marker — consume surrounding whitespace + optional trailing newline.
            let pattern = format!(r"[ \t]*{}[ \t]*\n?", regex::escape(s));
            let mut cache = EJECT_CACHE.lock().unwrap();
            if let Some(re) = cache.get(s) {
                let p = re.as_str().to_string();
                drop(cache);
                return Ok(Some(Regex::new(&p).map_err(|e| e.to_string())?));
            }
            let re = Regex::new(&pattern).map_err(|e| e.to_string())?;
            if cache.len() >= 100 { cache.clear(); }
            cache.insert(s.clone(), re);
            let p = cache[s].as_str().to_string();
            drop(cache);
            Ok(Some(Regex::new(&p).map_err(|e| e.to_string())?))
        }
    }
}

// ─── Convenience: template with a plain str→str replace map ─────────────────

/// Build a `HashMap<String, ReplaceValue>` from a plain `HashMap<String, String>`.
pub fn str_replace_map(map: HashMap<String, String>) -> HashMap<String, ReplaceValue> {
    map.into_iter()
        .map(|(k, v)| (k, ReplaceValue::Str(v)))
        .collect()
}

/// Build a `HashMap<String, ReplaceValue>` from a plain `HashMap<String, serde_json::Value>`.
pub fn json_replace_map(
    map: HashMap<String, serde_json::Value>,
) -> HashMap<String, ReplaceValue> {
    map.into_iter()
        .map(|(k, v)| (k, ReplaceValue::Json(v)))
        .collect()
}
