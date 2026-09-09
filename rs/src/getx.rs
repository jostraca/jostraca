// getx.rs — rich-path lookup, ported from go/getx.go / ts/src/util/basic.ts

use regex::Regex;

/// Rich-path lookup. Supports dot/space-separated navigation, ancestry (`:`),
/// comparison filters (`=`, `!=`, `<`, `<=`, `>`, `>=`, `==`, `~`),
/// array filters (`?`), and quoted segments.
///
/// Returns `serde_json::Value::Null` for any miss or invalid path.
pub fn getx(root: &serde_json::Value, path: &serde_json::Value) -> serde_json::Value {
    if root.is_null() {
        return serde_json::Value::Null;
    }
    if !matches!(root, serde_json::Value::Object(_) | serde_json::Value::Array(_)) {
        return serde_json::Value::Null;
    }

    let tokens: Vec<String> = match path {
        serde_json::Value::Null => return serde_json::Value::Null,
        serde_json::Value::String(s) => getx_tokenize(s),
        serde_json::Value::Array(arr) => arr.iter().map(|v| crate::util::spec_sprint(v)).collect(),
        _ => return serde_json::Value::Null,
    };

    if tokens.is_empty() {
        return serde_json::Value::Null;
    }

    let mut node: serde_json::Value = root.clone();
    let mut out: serde_json::Value = serde_json::Value::Null;
    let mut ancestry = false;
    let mut i = 0;

    while i < tokens.len() {
        if node.is_null() { break; }

        let t0 = &tokens[i];
        let t1 = tokens.get(i + 1).map(|s| s.as_str()).unwrap_or("");

        // Compare op: t1 is an operator
        if !t1.is_empty() && is_compare_op(t1) {
            let val = getx_index(&node, t0);
            let arg_raw = tokens.get(i + 2).map(|s| s.as_str()).unwrap_or("");
            let pass = getx_compare(&val, t1, arg_raw);
            if pass {
                i += 2;
            } else {
                node = serde_json::Value::Null;
            }
            if !(ancestry && !node.is_null()) {
                out = node.clone();
            }
            i += 1;
            continue;
        }

        // Ancestry op: t1 is ":"
        if t1 == ":" {
            let next = tokens.get(i + 2).map(|s| s.as_str()).unwrap_or("");
            if next != "=" {
                if !ancestry {
                    out = node.clone();
                }
                node = getx_index(&node, t0);
                if node.is_null() {
                    out = serde_json::Value::Null;
                }
            }
            ancestry = true;
            i += 2;
            continue;
        }

        // Array filter
        if t0 == "?" {
            let ftokens: Vec<String> = tokens[i + 1..].to_vec();
            // Find filter end: two adjacent identifier tokens
            let mut j = 0;
            while j < ftokens.len() {
                if j + 1 < ftokens.len()
                    && is_ident(&ftokens[j])
                    && is_ident(&ftokens[j + 1])
                {
                    j += 1;
                    break;
                }
                j += 1;
            }
            let ftokens = &ftokens[..j];

            let children = iter_children(&node);
            let filtered: Vec<_> = children
                .into_iter()
                .filter(|(_, v)| {
                    let path_val = serde_json::Value::Array(
                        ftokens.iter().map(|s| serde_json::Value::String(s.clone())).collect(),
                    );
                    !getx(v, &path_val).is_null()
                })
                .collect();

            node = rebuild(&node, &filtered);
            out = node.clone();
            i += j + 1;
            continue;
        }

        // Normal navigation
        if !t1.is_empty() {
            node = getx_index(&node, t0);
            if ancestry {
                ancestry = false;
                if node.is_null() {
                    out = serde_json::Value::Null;
                } else {
                    node = out.clone();
                }
            }
            i += 1;
            continue;
        }

        // Last token
        node = getx_index(&node, t0);
        if !(ancestry && !node.is_null()) {
            out = node.clone();
        }
        i += 1;
    }

    out
}

/// Token regex: mirrors `src/util/basic.ts:120`
fn getx_tokenize(p: &str) -> Vec<String> {
    // Mirrors Go getxTokenRE: `\s*("(\\.|[^"\\])*"|[\w\d_]+|\s+|[^\w\d_]+)\s*`
    let re = Regex::new(r#"\s*("(?:\\.|[^"\\])*"|[\w\d_]+|\s+|[^\w\d_]+)\s*"#).unwrap();
    let mut out = Vec::new();
    for cap in re.captures_iter(p) {
        let tok = &cap[1];
        if tok.is_empty() { continue; }
        if tok.trim().is_empty() || tok.trim_matches('.').is_empty() { continue; }
        // Strip surrounding double-quotes
        if tok.starts_with('"') && tok.ends_with('"') && tok.len() >= 2 {
            out.push(tok[1..tok.len() - 1].to_string());
        } else {
            out.push(tok.to_string());
        }
    }
    out
}

fn is_compare_op(t: &str) -> bool {
    matches!(t, "=" | "!=" | "<" | "<=" | ">" | ">=" | "==" | "~")
}

fn is_ident(t: &str) -> bool {
    !t.is_empty() && t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Index a JSON value by a string key (map) or integer index (array).
pub fn getx_index(node: &serde_json::Value, key: &str) -> serde_json::Value {
    match node {
        serde_json::Value::Object(m) => m.get(key).cloned().unwrap_or(serde_json::Value::Null),
        serde_json::Value::Array(a) => {
            if let Ok(i) = key.parse::<usize>() {
                a.get(i).cloned().unwrap_or(serde_json::Value::Null)
            } else {
                serde_json::Value::Null
            }
        }
        _ => serde_json::Value::Null,
    }
}

fn getx_compare(val: &serde_json::Value, op: &str, arg_raw: &str) -> bool {
    let arg: serde_json::Value = match arg_raw {
        "true" => serde_json::Value::Bool(true),
        "false" => serde_json::Value::Bool(false),
        s if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 => {
            serde_json::Value::String(s[1..s.len() - 1].to_string())
        }
        s => serde_json::Value::String(s.to_string()),
    };

    let val_s = crate::util::spec_sprint(val);
    let arg_s = crate::util::spec_sprint(&arg);
    let vn: Option<f64> = val_s.parse().ok();
    let an: Option<f64> = arg_s.parse().ok();
    let both_num = vn.is_some() && an.is_some();

    let val_str = val.as_str();
    let arg_str = arg.as_str();
    let both_str = val_str.is_some() && arg_str.is_some();

    match op {
        "<" => {
            if both_str { val_str.unwrap() < arg_str.unwrap() }
            else { both_num && vn.unwrap() < an.unwrap() }
        }
        "<=" => {
            if both_str { val_str.unwrap() <= arg_str.unwrap() }
            else { both_num && vn.unwrap() <= an.unwrap() }
        }
        ">" => {
            if both_str { val_str.unwrap() > arg_str.unwrap() }
            else { both_num && vn.unwrap() > an.unwrap() }
        }
        ">=" => {
            if both_str { val_str.unwrap() >= arg_str.unwrap() }
            else { both_num && vn.unwrap() >= an.unwrap() }
        }
        "=" => {
            if both_num { vn.unwrap() == an.unwrap() }
            else { val_s == arg_s }
        }
        "==" => val == &arg,
        "!=" => {
            if both_num { vn.unwrap() != an.unwrap() }
            else { val_s != arg_s }
        }
        "~" => {
            Regex::new(&arg_s).map(|re| re.is_match(&val_s)).unwrap_or(false)
        }
        _ => false,
    }
}

/// Returns children as (key, value) pairs, sorted by key for maps.
fn iter_children(node: &serde_json::Value) -> Vec<(String, serde_json::Value)> {
    match node {
        serde_json::Value::Object(m) => {
            let mut keys: Vec<String> = m.keys().cloned().collect();
            keys.sort();
            keys.into_iter().map(|k| { let v = m[&k].clone(); (k, v) }).collect()
        }
        serde_json::Value::Array(a) => {
            a.iter().enumerate().map(|(i, v)| (i.to_string(), v.clone())).collect()
        }
        _ => vec![],
    }
}

fn rebuild(node: &serde_json::Value, items: &[(String, serde_json::Value)]) -> serde_json::Value {
    match node {
        serde_json::Value::Object(_) => {
            let mut m = serde_json::Map::new();
            for (k, v) in items {
                m.insert(k.clone(), v.clone());
            }
            serde_json::Value::Object(m)
        }
        serde_json::Value::Array(_) => {
            serde_json::Value::Array(items.iter().map(|(_, v)| v.clone()).collect())
        }
        _ => serde_json::Value::Null,
    }
}
