// util.rs — pure helper functions ported from src/util/basic.ts and go/util.go
//
// All functions mirror the Go port exactly, which is itself a faithful port of
// the canonical TypeScript implementation. TS is canonical; when in doubt the
// Go source's comments explain the exact semantics.

// ---------------------------------------------------------------------------
// Name conversion helpers
// ---------------------------------------------------------------------------

/// Splits an input into words on `-`, `_`, space, and ASCII camelCase
/// boundaries, first collapsing acronym runs so `XMLParser` → `XmlParser`.
/// Mirrors Go `Partify` / TS `partify`.
pub fn partify(input: &serde_json::Value) -> Vec<String> {
    use serde_json::Value::*;
    match input {
        Null => vec!["null".to_string()],
        String(s) => {
            if s.is_empty() {
                return vec![];
            }
            glue_initials(split_on_upper_and_seps(&collapse_acronyms(s)))
        }
        Array(arr) => arr
            .iter()
            .filter_map(|v| {
                let s = spec_sprint(v);
                if s.is_empty() { None } else { Some(s) }
            })
            .collect(),
        Bool(b) => vec![if *b { "true" } else { "false" }.to_string()],
        Number(n) => {
            let s = format_json_number(n);
            if s.is_empty() { vec![] } else { vec![s] }
        }
        _ => {
            let s = spec_sprint(input);
            if s.is_empty() { vec![] } else { vec![s] }
        }
    }
}

/// collapseAcronyms mirrors the TS `.replace(/([A-Z])([A-Z]+)(?![a-z])/g, …)` pass.
fn collapse_acronyms(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if !is_ascii_upper(b[i]) {
            out.push(b[i]);
            i += 1;
            continue;
        }
        let mut j = i;
        while j < b.len() && is_ascii_upper(b[j]) {
            j += 1;
        }
        let mut end = j;
        if j < b.len() && is_ascii_lower(b[j]) {
            end = j - 1;
        }
        if end - i < 2 {
            out.push(b[i]);
            i += 1;
            continue;
        }
        out.push(b[i]);
        for k in (i + 1)..end {
            out.push(b[k] + (b'a' - b'A'));
        }
        i = end;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

/// splitOnUpperAndSeps mirrors TS `.split(/[-_ ]|([A-Z])/)` + empty filter.
fn split_on_upper_and_seps(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    for ch in s.chars() {
        match ch {
            '-' | '_' | ' ' => {
                if !cur.is_empty() {
                    out.push(cur.clone());
                    cur.clear();
                }
            }
            c if c.is_ascii_uppercase() => {
                if !cur.is_empty() {
                    out.push(cur.clone());
                    cur.clear();
                }
                out.push(c.to_string());
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// glueInitials re-attaches a single uppercase letter to the lowercase tail
/// that follows it, mirroring the TS reduce.
fn glue_initials(parts: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in parts {
        if let Some(prev) = out.last_mut() {
            if prev.len() == 1
                && is_ascii_upper(prev.as_bytes()[0])
                && !p.is_empty()
                && !is_ascii_upper(p.as_bytes()[0])
            {
                prev.push_str(&p);
                continue;
            }
        }
        out.push(p);
    }
    out
}

fn is_ascii_upper(c: u8) -> bool { c >= b'A' && c <= b'Z' }
fn is_ascii_lower(c: u8) -> bool { c >= b'a' && c <= b'z' }

/// Converts to PascalCase (TS `camelify`).
pub fn camelify(input: &serde_json::Value) -> String {
    let parts = partify(input);
    let mut out = String::new();
    for p in &parts {
        if p.is_empty() { continue; }
        let mut chars = p.chars();
        if let Some(first) = chars.next() {
            for c in first.to_uppercase() { out.push(c); }
            out.push_str(chars.as_str());
        }
    }
    out
}

/// Converts to snake_case (TS `snakify`).
pub fn snakify(input: &serde_json::Value) -> String {
    let parts = partify(input);
    parts.iter().map(|p| p.to_lowercase()).collect::<Vec<_>>().join("_")
}

/// Converts to kebab-case (TS `kebabify`).
pub fn kebabify(input: &serde_json::Value) -> String {
    let parts = partify(input);
    parts.iter().map(|p| p.to_lowercase()).collect::<Vec<_>>().join("-")
}

/// Lowercases the first rune. Coerces non-string inputs like TS.
pub fn lcf(input: &serde_json::Value) -> String {
    let s = spec_sprint(input);
    if s.is_empty() { return s; }
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => {
            let lower: String = first.to_lowercase().collect();
            lower + chars.as_str()
        }
        None => s,
    }
}

/// Uppercases the first rune. Coerces non-string inputs like TS.
pub fn ucf(input: &serde_json::Value) -> String {
    let s = spec_sprint(input);
    if s.is_empty() { return s; }
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => {
            let upper: String = first.to_uppercase().collect();
            upper + chars.as_str()
        }
        None => s,
    }
}

/// Returns s with regex special chars backslash-escaped. Mirrors Go `EscRE`.
pub fn esc_re(s: &str) -> String {
    regex::escape(s)
}

/// Prepends ind (string or count of spaces) before every line, mirroring
/// Go `Indent` / TS `indent`.
pub fn indent(src: &str, ind: &serde_json::Value) -> String {
    if src.is_empty() { return src.to_string(); }

    let pad: String = match ind {
        serde_json::Value::Null => "  ".to_string(),
        serde_json::Value::Number(n) => {
            let count = n.as_f64().unwrap_or(0.0);
            if count <= 0.0 { return src.to_string(); }
            " ".repeat(count as usize)
        }
        serde_json::Value::String(s) => s.clone(),
        _ => {
            let s = spec_sprint(ind);
            s
        }
    };

    if pad.is_empty() { return src.to_string(); }

    let bytes = src.as_bytes();
    let n = bytes.len();
    let mut b = String::with_capacity(n + pad.len());

    // TS regex `(\n|^)(?!$)`: see Go implementation comments for the
    // single-char case (n==1 and starts with \n).
    if bytes[0] != b'\n' || n == 1 {
        b.push_str(&pad);
    }
    for i in 0..n {
        b.push(bytes[i] as char);
        if bytes[i] == b'\n' && i < n - 1 {
            b.push_str(&pad);
        }
    }
    b
}

/// Mutates base by attaching name variants keyed off prop. Mirrors Go `Names`.
pub fn names(
    base: &mut serde_json::Map<String, serde_json::Value>,
    name: &str,
    prop: Option<&str>,
) -> serde_json::Map<String, serde_json::Value> {
    let p = prop.unwrap_or("name");
    let name_val = serde_json::Value::String(name.to_string());

    base.insert(format!("{p}__orig"), serde_json::Value::String(name.to_string()));
    base.insert(camelify(&serde_json::Value::String(p.to_string())), serde_json::Value::String(camelify(&name_val)));
    base.insert(
        format!("{}_", snakify(&serde_json::Value::String(p.to_string()))),
        serde_json::Value::String(snakify(&name_val)),
    );
    base.insert(
        format!("{}-", kebabify(&serde_json::Value::String(p.to_string()))),
        serde_json::Value::String(kebabify(&name_val)),
    );
    base.insert(p.to_lowercase(), serde_json::Value::String(name.to_lowercase()));
    base.insert(p.to_uppercase(), serde_json::Value::String(name.to_uppercase()));

    base.clone()
}

// ---------------------------------------------------------------------------
// Binary helpers
// ---------------------------------------------------------------------------

/// Reports whether the bytes look binary (NUL in first 8 KB).
pub fn is_bin_content(content: &[u8]) -> bool {
    let n = content.len().min(8192);
    content[..n].contains(&0u8)
}

/// Reports whether the path's extension is in the curated binary list.
pub fn is_bin_ext(path: &str) -> bool {
    let ext = node_ext(path);
    if ext.is_empty() { return false; }
    let ext_lower = ext.trim_start_matches('.').to_lowercase();
    if ext_lower.is_empty() { return false; }
    BINARY_EXTS.contains(ext_lower.as_str())
}

/// Node's path.extname semantics: a leading dot means hidden file, not ext.
fn node_ext(path: &str) -> String {
    let base = if let Some(i) = path.rfind(|c| c == '/' || c == '\\') {
        &path[i + 1..]
    } else {
        path
    };
    // dot at index 0 is the hidden-file marker, not an extension separator
    match base.rfind('.') {
        Some(i) if i > 0 => base[i..].to_string(),
        _ => String::new(),
    }
}

// ---------------------------------------------------------------------------
// Deep merge and OMap
// ---------------------------------------------------------------------------

/// Deep-merges src maps/slices into dst, right-precedence. Mirrors Go `Deep`.
pub fn deep(dst: serde_json::Value, srcs: &[serde_json::Value]) -> serde_json::Value {
    let mut out = dst;
    for src in srcs {
        if src.is_null() {
            // Treat top-level null as absent argument (like TS `undefined === over`).
            // But only at the argument level — member null still overwrites.
            continue;
        }
        out = merge_one(out, src.clone());
    }
    out
}

fn merge_one(dst: serde_json::Value, src: serde_json::Value) -> serde_json::Value {
    use serde_json::Value::*;
    match (dst, src) {
        (Object(mut dm), Object(sm)) => {
            for (k, sv) in sm {
                let entry = dm.remove(&k);
                dm.insert(k, match entry {
                    Some(dv) => merge_one(dv, sv),
                    None => sv,
                });
            }
            Object(dm)
        }
        (Array(da), Array(sa)) => {
            let n = da.len().max(sa.len());
            let mut out = da.clone();
            out.resize(n, Null);
            for (i, sv) in sa.into_iter().enumerate() {
                if i < da.len() {
                    out[i] = merge_one(da[i].clone(), sv);
                } else {
                    out[i] = sv;
                }
            }
            Array(out)
        }
        (_, src) => src,
    }
}

/// Returns m's keys paired with their values in JS property-enumeration
/// order: integer-index keys numerically first, then remaining keys sorted.
/// Mirrors Go `OMap`.
pub fn omap(m: &serde_json::Map<String, serde_json::Value>) -> Vec<[serde_json::Value; 2]> {
    let keys = js_key_order(m);
    keys.into_iter()
        .map(|k| {
            let v = m.get(&k).cloned().unwrap_or(serde_json::Value::Null);
            [serde_json::Value::String(k), v]
        })
        .collect()
}

/// jsKeyOrder: integer-index keys numerically first, then rest sorted.
fn js_key_order(m: &serde_json::Map<String, serde_json::Value>) -> Vec<String> {
    let mut idx: Vec<String> = Vec::new();
    let mut rest: Vec<String> = Vec::new();
    for k in m.keys() {
        if is_array_index_key(k) {
            idx.push(k.clone());
        } else {
            rest.push(k.clone());
        }
    }
    idx.sort_by(|a, b| {
        let x: u64 = a.parse().unwrap_or(0);
        let y: u64 = b.parse().unwrap_or(0);
        x.cmp(&y)
    });
    rest.sort();
    idx.extend(rest);
    idx
}

fn is_array_index_key(k: &str) -> bool {
    if k.is_empty() || k.len() > 10 { return false; }
    if k == "0" { return true; }
    if k.starts_with('0') { return false; }
    if !k.bytes().all(|b| b.is_ascii_digit()) { return false; }
    match k.parse::<u64>() {
        Ok(n) => n < (1u64 << 32) - 1,
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Get (dot-path lookup)
// ---------------------------------------------------------------------------

/// Simple dot-path lookup over serde_json::Value data. Mirrors Go `Get`.
pub fn get(root: &serde_json::Value, path: &str) -> serde_json::Value {
    if path.is_empty() { return serde_json::Value::Null; }
    match lookup(root, path) {
        Some(v) => v.clone(),
        None => serde_json::Value::Null,
    }
}

pub fn lookup<'a>(root: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut cur = root;
    for p in path.split('.') {
        match cur {
            serde_json::Value::Object(m) => {
                cur = m.get(p)?;
            }
            serde_json::Value::Array(a) => {
                let i: usize = p.parse().ok()?;
                cur = a.get(i)?;
            }
            _ => return None,
        }
    }
    Some(cur)
}

// ---------------------------------------------------------------------------
// spec_sprint helper (mirrors Go specSprint / TS string coercion)
// ---------------------------------------------------------------------------

pub fn spec_sprint(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
        serde_json::Value::Number(n) => format_json_number(n),
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(a) => {
            // TS: `'' + array` → [item,item,...] but we only need this for
            // Partify scalar fallback, not for arrays themselves.
            let items: Vec<String> = a.iter().map(|x| spec_sprint(x)).collect();
            format!("[{}]", items.join(","))
        }
        serde_json::Value::Object(_) => {
            serde_json::to_string(v).unwrap_or_else(|_| "[object Object]".to_string())
        }
    }
}

fn format_json_number(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    if let Some(f) = n.as_f64() {
        return format_js_float(f);
    }
    n.to_string()
}

/// Formats a float the way ECMAScript Number::toString does. Mirrors Go `formatJSNumber`.
pub fn format_js_float(f: f64) -> String {
    if f.is_nan() { return "NaN".to_string(); }
    if f.is_infinite() {
        return if f > 0.0 { "Infinity".to_string() } else { "-Infinity".to_string() };
    }
    if f == 0.0 { return "0".to_string(); }
    let abs = f.abs();
    if abs >= 1e21 || abs < 1e-6 {
        // Exponential notation, strip exponent zero-padding
        let s = format!("{:e}", f);
        trim_exponent_zeros(&s)
    } else {
        // Strip trailing zeros from decimal form (Rust's {:?} keeps them)
        // Use %g-style via ryu or manual
        let s = format!("{}", f);
        // Rust's Display for floats may include .0; JS omits it for integers
        // e.g. 42.0 → "42" in JS
        if s.ends_with(".0") {
            s[..s.len()-2].to_string()
        } else {
            s
        }
    }
}

fn trim_exponent_zeros(s: &str) -> String {
    // Rust formats like "1e7" or "1.5e10"; JS uses "1e7" or "1.5e10" but
    // without zero-padding. Rust doesn't zero-pad so we mainly handle sign.
    // e.g. Rust "1e-7" should stay "1e-7", which already matches JS.
    // Rust uses "e" lowercase. We need to convert to JS style: no leading zeros.
    if let Some(at) = s.find('e') {
        let mantissa = &s[..at];
        let exp_part = &s[at+1..];
        let (sign, digits) = if exp_part.starts_with('-') {
            ("-", &exp_part[1..])
        } else if exp_part.starts_with('+') {
            ("+", &exp_part[1..])
        } else {
            ("", exp_part)
        };
        let trimmed = digits.trim_start_matches('0');
        let trimmed = if trimmed.is_empty() { "0" } else { trimmed };
        if sign == "+" {
            format!("{}e+{}", mantissa, trimmed)
        } else if sign == "-" {
            format!("{}e-{}", mantissa, trimmed)
        } else {
            format!("{}e{}", mantissa, trimmed)
        }
    } else {
        s.to_string()
    }
}

// ---------------------------------------------------------------------------
// Binary extension set (mirrors Go binaryExts / TS BINARY_EXT)
// ---------------------------------------------------------------------------

static BINARY_EXTS: phf::Set<&'static str> = phf::phf_set! {
    "3dm","3ds","3g2","3gp","7z","a","aac","adp","afdesign",
    "afphoto","afpub","ai","aif","aiff","alz","ape","apk",
    "appimage","ar","arj","asf","au","avi","bak","baml","bh",
    "bin","bk","bmp","btif","bz2","bzip2","cab","caf","cgm",
    "class","cmx","cpio","cr2","cur","dat","dcm","deb","dex",
    "djvu","dll","dmg","dng","doc","docm","docx","dot","dotm",
    "dra","ds_store","dsk","dts","dtshd","dvb","dwg","dxf",
    "ecelp4800","ecelp7470","ecelp9600","egg","eol","eot","epub",
    "exe","f4v","fbs","fh","fla","flac","flatpak","fli","flv",
    "fpx","fst","fvt","g3","gh","gif","graffle","gz","gzip",
    "h261","h263","h264","icns","ico","ief","img","ipa","iso",
    "jar","jpeg","jpg","jpgv","jpm","jxr","key","ktx","lha",
    "lib","lvp","lz","lzh","lzma","lzo","m3u","m4a","m4v",
    "mar","mdi","mht","mid","midi","mj2","mka","mkv","mmr",
    "mng","mobi","mov","movie","mp3","mp4","mp4a","mpeg","mpg",
    "mpga","mxu","nef","npx","numbers","nupkg","o","odp","ods",
    "odt","oga","ogg","ogv","otf","ott","pages","pbm","pcx",
    "pdb","pdf","pea","pgm","pic","png","pnm","pot","potm",
    "potx","ppa","ppam","ppm","pps","ppsm","ppsx","ppt","pptm",
    "pptx","psd","pya","pyc","pyo","pyv","qt","rar","ras",
    "raw","resources","rgb","rip","rlc","rmf","rmvb","rpm",
    "rtf","rz","s3m","s7z","scpt","sgi","shar","snap","sil",
    "sketch","slk","smv","snk","so","stl","suo","sub","swf",
    "tar","tbz","tbz2","tga","tgz","thmx","tif","tiff","tlz",
    "ttc","ttf","txz","udf","uvh","uvi","uvm","uvp","uvs",
    "uvu","viv","vob","war","wav","wax","wbmp","wdp","weba",
    "webm","webp","whl","wim","wm","wma","wmv","wmx","woff",
    "woff2","wrm","wvx","xbm","xif","xla","xlam","xls","xlsb",
    "xlsm","xlsx","xlt","xltm","xltx","xm","xmind","xpi","xpm",
    "xwd","xz","z","zip","zipx"
};

// ---------------------------------------------------------------------------
// Each / EachF / EachI / EachKV / EachKVRaw — mirrors go/util.go
// ---------------------------------------------------------------------------

/// Configures `each`. Mirrors Go `EachSpec`.
#[derive(Default, Clone)]
pub struct EachSpec {
    /// If true, items are returned as-is (no `{val$, index$}` wrap).
    pub raw: bool,
    /// If true, suppress the `index$`/`key$` marker TS adds by default.
    pub no_mark: bool,
    /// Sort items by stringified value (slices) or key (maps).
    pub sort: bool,
}

/// Iterates a `serde_json::Value` (array or object) and applies a transform.
/// Mirrors Go `Each`.
pub fn each(
    subject: &serde_json::Value,
    spec: EachSpec,
    apply: Option<&dyn Fn(serde_json::Value) -> serde_json::Value>,
) -> Vec<serde_json::Value> {
    use serde_json::Value::*;
    match subject {
        Null => vec![],
        Array(items) => {
            let mut items: Vec<serde_json::Value> = items.clone();
            if spec.sort {
                items.sort_by(|a, b| {
                    let sa = crate::util::spec_sprint(a);
                    let sb = crate::util::spec_sprint(b);
                    sa.cmp(&sb)
                });
            }
            items.into_iter().enumerate().map(|(i, item)| {
                let val = if !spec.raw {
                    match item {
                        Object(mut m) => {
                            if !spec.no_mark {
                                m.insert("index$".to_string(), Number(serde_json::Number::from(i)));
                            }
                            Object(m)
                        }
                        other => {
                            let mut m = serde_json::Map::new();
                            m.insert("val$".to_string(), other);
                            m.insert("index$".to_string(), Number(serde_json::Number::from(i)));
                            Object(m)
                        }
                    }
                } else if !spec.no_mark {
                    match item {
                        Object(mut m) => {
                            m.insert("index$".to_string(), Number(serde_json::Number::from(i)));
                            Object(m)
                        }
                        other => other,
                    }
                } else {
                    item
                };
                apply.map(|f| f(val.clone())).unwrap_or(val)
            }).collect()
        }
        Object(map) => {
            let mut keys: Vec<std::string::String> = map.keys().cloned().collect();
            keys.sort();
            keys.into_iter().map(|k| {
                let v = map[&k].clone();
                let val = if spec.raw {
                    if !spec.no_mark {
                        match v {
                            Object(mut m) => {
                                m.insert("key$".to_string(), serde_json::Value::String(k));
                                Object(m)
                            }
                            other => other,
                        }
                    } else { v }
                } else {
                    match v {
                        Object(mut m) => {
                            if !spec.no_mark {
                                m.insert("key$".to_string(), serde_json::Value::String(k));
                            }
                            Object(m)
                        }
                        other => {
                            let mut m = serde_json::Map::new();
                            m.insert("key$".to_string(), serde_json::Value::String(k));
                            m.insert("val$".to_string(), other);
                            Object(m)
                        }
                    }
                };
                apply.map(|f| f(val.clone())).unwrap_or(val)
            }).collect()
        }
        _ => vec![],
    }
}

/// Simple map variant: pure transform of each item, no wrapping. Mirrors Go `EachF`.
pub fn each_f(
    items: &serde_json::Value,
    f: &dyn Fn(serde_json::Value) -> serde_json::Value,
) -> Vec<serde_json::Value> {
    each(items, EachSpec { raw: true, ..Default::default() }, Some(f))
}

/// Iterates a JSON array and calls `f(item, idx)`. Mirrors Go `EachI`.
pub fn each_i(
    items: &serde_json::Value,
    f: &dyn Fn(serde_json::Value, usize) -> serde_json::Value,
) -> Vec<serde_json::Value> {
    match items {
        serde_json::Value::Array(arr) => arr
            .iter()
            .enumerate()
            .map(|(i, v)| f(v.clone(), i))
            .collect(),
        _ => vec![],
    }
}

/// Iterates a JSON object sorted by key, calling `f(wrapped, key, idx)`.
/// `wrapped` is `{key$, val$}`. Mirrors Go `EachKV`.
pub fn each_kv(
    m: &serde_json::Value,
    f: &dyn Fn(serde_json::Value, &str, usize) -> serde_json::Value,
) -> Vec<serde_json::Value> {
    match m {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<String> = map.keys().cloned().collect();
            keys.sort();
            keys.into_iter().enumerate().map(|(i, k)| {
                let v = map[&k].clone();
                let wrapped = serde_json::json!({"key$": k.clone(), "val$": v});
                f(wrapped, &k, i)
            }).collect()
        }
        _ => vec![],
    }
}

/// Like `each_kv` but passes raw value (not wrapped). Mirrors Go `EachKVRaw`.
pub fn each_kv_raw(
    m: &serde_json::Value,
    f: &dyn Fn(serde_json::Value, &str, usize) -> serde_json::Value,
) -> Vec<serde_json::Value> {
    match m {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<String> = map.keys().cloned().collect();
            keys.sort();
            keys.into_iter().enumerate().map(|(i, k)| {
                let v = map[&k].clone();
                f(v, &k, i)
            }).collect()
        }
        _ => vec![],
    }
}

// ---------------------------------------------------------------------------
// Humanify — mirrors go/util.go Humanify / TS humanify
// ---------------------------------------------------------------------------

/// Formats a unix-millis timestamp. With no parts/terse flags returns the
/// digit-stripped int64. With parts=true returns named fields.
/// Mirrors Go `Humanify`.
pub fn humanify(when: i64, parts: bool, terse: bool) -> serde_json::Value {
    // Format as ISO string
    let iso = {
        use std::time::{Duration, UNIX_EPOCH};
        let d = if when >= 0 {
            UNIX_EPOCH + Duration::from_millis(when as u64)
        } else {
            UNIX_EPOCH - Duration::from_millis((-when) as u64)
        };
        let secs = d.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        let millis = (when.unsigned_abs() % 1000) as u32;
        let (y, mo, dy, hh, mm, ss) = crate::diff::secs_to_ymd_hms_pub(secs);
        format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", y, mo, dy, hh, mm, ss, millis)
    };

    if parts {
        // Split on -, :, T, ., Z
        let splits: Vec<&str> = iso.split(|c| c == '-' || c == ':' || c == 'T' || c == '.' || c == 'Z')
            .filter(|s| !s.is_empty())
            .collect();
        let to_i = |s: &str| -> i64 { s.parse().unwrap_or(0) };
        if terse {
            serde_json::json!({
                "ty": to_i(splits.get(0).copied().unwrap_or("0")),
                "tm": to_i(splits.get(1).copied().unwrap_or("0")),
                "td": to_i(splits.get(2).copied().unwrap_or("0")),
                "th": to_i(splits.get(3).copied().unwrap_or("0")),
                "tn": to_i(splits.get(4).copied().unwrap_or("0")),
                "ts": to_i(splits.get(5).copied().unwrap_or("0")),
                "ti": to_i(splits.get(6).copied().unwrap_or("0")),
            })
        } else {
            serde_json::json!({
                "year":   to_i(splits.get(0).copied().unwrap_or("0")),
                "month":  to_i(splits.get(1).copied().unwrap_or("0")),
                "day":    to_i(splits.get(2).copied().unwrap_or("0")),
                "hour":   to_i(splits.get(3).copied().unwrap_or("0")),
                "minute": to_i(splits.get(4).copied().unwrap_or("0")),
                "second": to_i(splits.get(5).copied().unwrap_or("0")),
                "milli":  to_i(splits.get(6).copied().unwrap_or("0")),
            })
        }
    } else {
        // Strip non-digits, drop the last digit.
        let digits: String = iso.chars().filter(|c| c.is_ascii_digit()).collect();
        let s = if digits.len() > 0 { &digits[..digits.len()-1] } else { "" };
        let n: i64 = s.parse().unwrap_or(0);
        serde_json::Value::Number(serde_json::Number::from(n))
    }
}

/// Returns the digit-stripped int64 form of a unix-ms timestamp. Mirrors Go `HumanifyDigits`.
pub fn humanify_digits(when: i64) -> i64 {
    match humanify(when, false, false) {
        serde_json::Value::Number(n) => n.as_i64().unwrap_or(0),
        _ => 0,
    }
}

// ---------------------------------------------------------------------------
// CMap / VMap — mirrors go/util.go CMap / VMap
// ---------------------------------------------------------------------------

/// CMap sentinel values.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CMapSentinel {
    Copy,
    Filter,
    Key,
}

/// A CMap transform function.
pub type CMapTransform = Box<dyn Fn(serde_json::Value, CMapCtx) -> serde_json::Value + Send + Sync>;

/// Context passed to a CMap transform.
pub struct CMapCtx {
    pub s_key: String,
    pub self_val: serde_json::Value,
    pub key: String,
    pub parent: serde_json::Value,
}

/// Per-spec-entry value: a sentinel, a transform, or a literal.
pub enum CMapSpec {
    Sentinel(CMapSentinel),
    Transform(CMapTransform),
    Literal(serde_json::Value),
}

fn cmap_apply(
    spec: &CMapSpec,
    self_val: &serde_json::Value,
    key: &str,
    sk: &str,
    parent: &serde_json::Value,
) -> Option<serde_json::Value> {
    // get sub-key from self_val
    let child_val = match self_val {
        serde_json::Value::Object(m) => m.get(sk).cloned().unwrap_or(serde_json::Value::Null),
        _ => serde_json::Value::Null,
    };
    match spec {
        CMapSpec::Transform(f) => Some(f(child_val, CMapCtx {
            s_key: sk.to_string(),
            self_val: self_val.clone(),
            key: key.to_string(),
            parent: parent.clone(),
        })),
        CMapSpec::Sentinel(s) => match s {
            CMapSentinel::Copy   => Some(child_val),
            CMapSentinel::Key    => Some(serde_json::Value::String(key.to_string())),
            CMapSentinel::Filter => None,
        },
        CMapSpec::Literal(v) => Some(v.clone()),
    }
}

/// Projects an object's children through a spec map. Mirrors Go `CMap`.
pub fn cmap(
    o: &serde_json::Value,
    p: &std::collections::BTreeMap<String, CMapSpec>,
) -> serde_json::Value {
    let map = match o {
        serde_json::Value::Object(m) => m,
        _ => return serde_json::Value::Object(serde_json::Map::new()),
    };
    let mut keys: Vec<&str> = map.keys().map(|s| s.as_str()).collect();
    keys.sort_unstable();
    let mut out = serde_json::Map::new();
    for key in keys {
        let child = &map[key];
        let mut entry = serde_json::Map::new();
        let mut drop = false;
        let mut spec_keys: Vec<&str> = p.keys().map(|s| s.as_str()).collect();
        spec_keys.sort_unstable();
        for sk in spec_keys {
            match cmap_apply(&p[sk], child, key, sk, o) {
                None => { drop = true; break; }
                Some(v) => { entry.insert(sk.to_string(), v); }
            }
        }
        if !drop {
            out.insert(key.to_string(), serde_json::Value::Object(entry));
        }
    }
    serde_json::Value::Object(out)
}

/// Slice-output variant of `cmap`. Mirrors Go `VMap`.
pub fn vmap(
    o: &serde_json::Value,
    p: &std::collections::BTreeMap<String, CMapSpec>,
) -> Vec<serde_json::Value> {
    let map = match o {
        serde_json::Value::Object(m) => m,
        _ => return vec![],
    };
    let mut keys: Vec<&str> = map.keys().map(|s| s.as_str()).collect();
    keys.sort_unstable();
    let mut out = Vec::new();
    for key in keys {
        let child = &map[key];
        let mut entry = serde_json::Map::new();
        let mut drop = false;
        let mut spec_keys: Vec<&str> = p.keys().map(|s| s.as_str()).collect();
        spec_keys.sort_unstable();
        for sk in spec_keys {
            match cmap_apply(&p[sk], child, key, sk, o) {
                None => { drop = true; break; }
                Some(v) => { entry.insert(sk.to_string(), v); }
            }
        }
        if !drop {
            out.push(serde_json::Value::Object(entry));
        }
    }
    out
}

