// spec_test.rs — drives the shared TSV corpus in ../../test/spec
//
// Mirrors go/spec_test.go. Each .tsv file has columns:
//   id | fn | args (JSON array) | expect (JSON) | error (substring)
//
// Unknown fn values cause the test to fail (not skip), matching the Go runner.

#[cfg(test)]
mod spec_tests {
    use jostraca::diff;
    use jostraca::getx as getx_mod;
    use jostraca::template as tmpl_mod;
    use jostraca::util;
    use serde_json::Value;
    use std::collections::HashMap;
    use std::path::Path;

    // The spec corpus lives one level up from the rs/ package root.
    // Cargo runs integration tests with CWD = package directory (rs/).
    const SPEC_DIR: &str = "../test/spec";

    #[derive(Debug)]
    struct SpecCase {
        file: String,
        line: usize,
        id: String,
        fn_name: String,
        args: Vec<Value>,
        expect: Option<Value>,
        err_sub: String,
    }

    fn load_spec_cases() -> Vec<SpecCase> {
        let dir = Path::new(SPEC_DIR);
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .expect("cannot read spec dir")
            .filter_map(|e| {
                let e = e.ok()?;
                let name = e.file_name().to_string_lossy().to_string();
                if name.ends_with(".tsv") { Some(name) } else { None }
            })
            .collect();
        names.sort();

        let want_header = ["id", "fn", "args", "expect", "error"];
        let mut cases = Vec::new();

        for name in &names {
            let raw = std::fs::read_to_string(dir.join(name))
                .unwrap_or_else(|_| panic!("cannot read {name}"));
            let text = raw.replace("\r\n", "\n");
            let mut header_seen = false;

            for (i, row) in text.lines().enumerate() {
                let row = row.trim_end_matches('\n');
                if row.trim().is_empty() || row.starts_with('#') {
                    continue;
                }
                let cells: Vec<&str> = row.split('\t').collect();

                if !header_seen {
                    let got: Vec<&str> = cells.clone();
                    assert_eq!(
                        got, want_header,
                        "{name}: bad header: {got:?}"
                    );
                    header_seen = true;
                    continue;
                }

                // Pad to 5 cells
                let mut cells5 = cells.to_vec();
                while cells5.len() < 5 {
                    cells5.push("");
                }
                assert_eq!(cells5.len(), 5, "{name}:{}: {} cells, want 5", i + 1, cells5.len());

                let id = cells5[0].to_string();
                let fn_name = cells5[1].to_string();
                let args_json = cells5[2];
                let expect_json = cells5[3];
                let err_sub = cells5[4].to_string();

                let args: Vec<Value> = serde_json::from_str(args_json)
                    .unwrap_or_else(|e| panic!("{name}:{}: bad args JSON `{args_json}`: {e}", i + 1));

                let expect: Option<Value> = if err_sub.is_empty() {
                    Some(serde_json::from_str(expect_json)
                        .unwrap_or_else(|e| panic!("{name}:{}: bad expect JSON `{expect_json}`: {e}", i + 1)))
                } else {
                    None
                };

                cases.push(SpecCase {
                    file: name.clone(),
                    line: i + 1,
                    id,
                    fn_name,
                    args,
                    expect,
                    err_sub,
                });
            }
        }
        cases
    }

    /// Converts a result value to canonical JSON for comparison (object keys sorted,
    /// no HTML escaping). Mirrors Go `specCanon` / `specNorm`.
    fn canon(v: &Value) -> String {
        let normed = spec_norm(v);
        let mut buf = Vec::new();
        let mut ser = serde_json::Serializer::with_formatter(&mut buf, NoEscapeFormatter);
        serde::Serialize::serialize(&normed, &mut ser).unwrap();
        String::from_utf8(buf).unwrap()
    }

    /// Normalises a value the same way Go specNorm does: nil slices/maps → [],
    /// typed slices/arrays all become []any.
    fn spec_norm(v: &Value) -> Value {
        match v {
            Value::Null => Value::Null,
            Value::Array(arr) => {
                Value::Array(arr.iter().map(|x| spec_norm(x)).collect())
            }
            Value::Object(m) => {
                let mut out = serde_json::Map::new();
                for (k, val) in m {
                    out.insert(k.clone(), spec_norm(val));
                }
                Value::Object(out)
            }
            other => other.clone(),
        }
    }

    // A serde_json formatter that does NOT escape `<`, `>`, `&`. This matches
    // Go's `enc.SetEscapeHTML(false)` and JS `JSON.stringify` behaviour.
    struct NoEscapeFormatter;

    impl serde_json::ser::Formatter for NoEscapeFormatter {
        fn write_string_fragment<W>(&mut self, writer: &mut W, fragment: &str) -> std::io::Result<()>
        where
            W: ?Sized + std::io::Write,
        {
            writer.write_all(fragment.as_bytes())
        }
    }

    fn dispatch(case: &SpecCase) -> Result<Value, String> {
        let a = &case.args;
        match case.fn_name.as_str() {
            "camelify" => Ok(Value::String(util::camelify(&a[0]))),
            "snakify"  => Ok(Value::String(util::snakify(&a[0]))),
            "kebabify" => Ok(Value::String(util::kebabify(&a[0]))),
            "partify"  => Ok(Value::Array(
                util::partify(&a[0]).into_iter().map(Value::String).collect(),
            )),
            "lcf" => Ok(Value::String(util::lcf(&a[0]))),
            "ucf" => Ok(Value::String(util::ucf(&a[0]))),
            "escre" => Ok(Value::String(util::esc_re(a[0].as_str().unwrap_or("")))),

            "indent" => Ok(Value::String(util::indent(
                a[0].as_str().unwrap_or(""),
                &a[1],
            ))),

            "isbinext" => Ok(Value::Bool(util::is_bin_ext(a[0].as_str().unwrap_or("")))),
            "isbincontent" => {
                let s = a[0].as_str().unwrap_or("");
                Ok(Value::Bool(util::is_bin_content(s.as_bytes())))
            }

            "get" => Ok(util::get(&a[0], a[1].as_str().unwrap_or(""))),
            "getx" => Ok(getx_mod::getx(&a[0], &a[1])),

            "deep" => {
                if a.is_empty() { return Ok(Value::Null); }
                let mut srcs: Vec<Value> = Vec::new();
                for v in &a[1..] { srcs.push(v.clone()); }
                Ok(util::deep(a[0].clone(), &srcs))
            }

            "omap" => {
                match &a[0] {
                    Value::Object(m) => {
                        let pairs: Vec<Value> = util::omap(m)
                            .into_iter()
                            .map(|[k, v]| Value::Array(vec![k, v]))
                            .collect();
                        Ok(Value::Array(pairs))
                    }
                    _ => Ok(Value::Array(vec![])),
                }
            }

            "template" => {
                let src = a[0].as_str().unwrap_or("");
                let model = &a[1];
                let spec_opt = if a.len() >= 3 {
                    match &a[2] {
                        Value::Object(raw) => {
                            let mut spec = tmpl_mod::TemplateSpec::default();
                            if let Some(Value::Object(rep)) = raw.get("replace") {
                                for (k, v) in rep {
                                    spec.replace.insert(k.clone(), v.clone());
                                }
                            }
                            Some(spec)
                        }
                        _ => None,
                    }
                } else {
                    None
                };
                tmpl_mod::template(src, model, spec_opt.as_ref())
                    .map(Value::String)
                    .map_err(|e| e)
            }

            "names" => {
                let mut base = match &a[0] {
                    Value::Object(m) => m.clone(),
                    _ => serde_json::Map::new(),
                };
                let name = a[1].as_str().unwrap_or("");
                let prop = a.get(2).and_then(|v| v.as_str());
                let result = util::names(&mut base, name, prop);
                Ok(Value::Object(result))
            }

            "lines" => {
                let text = a[0].as_str().unwrap_or("");
                let ls: Vec<Value> = diff::lines(text).into_iter().map(Value::String).collect();
                Ok(Value::Array(ls))
            }

            "lcs" => {
                let a_strs: Vec<String> = match &a[0] {
                    Value::Array(arr) => arr.iter().map(|v| v.as_str().unwrap_or("").to_string()).collect(),
                    _ => vec![],
                };
                let b_strs: Vec<String> = match &a[1] {
                    Value::Array(arr) => arr.iter().map(|v| v.as_str().unwrap_or("").to_string()).collect(),
                    _ => vec![],
                };
                let result: Vec<Value> = diff::lcs(&a_strs, &b_strs).into_iter().map(Value::String).collect();
                Ok(Value::Array(result))
            }

            other => Err(format!("undispatched fn: {other}")),
        }
    }

    // ----- Tests ----------------------------------------------------------

    #[test]
    fn spec_corpus_loaded() {
        let cases = load_spec_cases();
        assert!(
            cases.len() > 100,
            "only {} cases loaded from {}",
            cases.len(),
            SPEC_DIR
        );
        println!("spec corpus: {} cases", cases.len());
    }

    #[test]
    fn spec_all_fns_dispatched() {
        let cases = load_spec_cases();
        let mut missing: std::collections::BTreeSet<String> = Default::default();
        for c in &cases {
            // Probe dispatch without panicking by doing a cheap match.
            let known = matches!(
                c.fn_name.as_str(),
                "camelify" | "snakify" | "kebabify" | "partify"
                    | "lcf" | "ucf" | "escre" | "indent"
                    | "isbinext" | "isbincontent"
                    | "get" | "getx"
                    | "deep" | "omap"
                    | "template"
                    | "names"
                    | "lines" | "lcs"
            );
            if !known {
                missing.insert(c.fn_name.clone());
            }
        }
        assert!(
            missing.is_empty(),
            "corpus uses undispatched fns: {}",
            missing.into_iter().collect::<Vec<_>>().join(", ")
        );
    }

    #[test]
    fn spec_ids_unique() {
        let cases = load_spec_cases();
        let mut seen: HashMap<String, bool> = HashMap::new();
        for c in &cases {
            let key = format!("{}:{}", c.file, c.id);
            assert!(!seen.contains_key(&key), "duplicate id {key}");
            seen.insert(key, true);
        }
    }

    #[test]
    fn spec_corpus() {
        let cases = load_spec_cases();
        let mut failures = Vec::new();

        for c in &cases {
            let where_str = format!("{}:{} {}", c.file, c.line, c.id);
            let result = dispatch(c);

            if !c.err_sub.is_empty() {
                match result {
                    Err(ref e) if e.contains(&c.err_sub) => {
                        // expected error — pass
                    }
                    Err(ref e) => {
                        failures.push(format!(
                            "{where_str}: error {e:?} does not contain {:?}",
                            c.err_sub
                        ));
                    }
                    Ok(ref v) => {
                        failures.push(format!(
                            "{where_str}: expected an error containing {:?}, got {}",
                            c.err_sub,
                            serde_json::to_string(v).unwrap_or_default()
                        ));
                    }
                }
                continue;
            }

            match result {
                Err(e) => {
                    failures.push(format!("{where_str}: unexpected error: {e}"));
                }
                Ok(got) => {
                    let got_json = canon(&got);
                    let want_json = canon(c.expect.as_ref().unwrap());
                    if got_json != want_json {
                        failures.push(format!(
                            "{where_str}\n  got  {got_json}\n  want {want_json}"
                        ));
                    }
                }
            }
        }

        if !failures.is_empty() {
            panic!("{} spec failure(s):\n{}", failures.len(), failures.join("\n"));
        }
    }
}
