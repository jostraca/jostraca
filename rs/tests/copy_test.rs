// A single-file Copy matches `exclude` against the file's own name, as a
// directory Copy matches the source-relative path. An excluded file is
// neither written nor spliced. A boolean matches nothing. Mirrors
// copy-single-file-exclude in ts/test/jostraca.test.ts.

use std::collections::HashMap;

use jostraca::{New, Options, OsFS};
use serde_json::{json, Value};

fn run(exclude: Option<Value>) -> (Option<String>, String) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap().replace('\\', "/");
    std::fs::create_dir_all(format!("{}/tm", root)).unwrap();
    std::fs::write(format!("{}/tm/h.txt", root), "HELLO\n").unwrap();

    let from = format!("{}/tm/h.txt", root);
    let opts = Options {
        folder: format!("{}/out", root),
        fs: Some(Box::new(OsFS)),
        now: Some(Box::new(|| 1735689600000)),
        ..Default::default()
    };
    New::new()
        .generate(opts, |j| {
            j.project("", "", |j| {
                j.file("a.txt", |j| {
                    j.content("BEFORE\n");
                    j.copy(&from, "out.txt", HashMap::new(), exclude.clone());
                    j.content("AFTER\n");
                });
            });
        })
        .unwrap();

    let copied = std::fs::read_to_string(format!("{}/out/out.txt", root)).ok();
    let file = std::fs::read_to_string(format!("{}/out/a.txt", root)).unwrap();
    (copied, file)
}

#[test]
fn copy_single_file_exclude() {
    let skipped = (None, "BEFORE\nAFTER\n".to_string());
    let copied = (Some("HELLO\n".to_string()), "BEFORE\nHELLO\nAFTER\n".to_string());

    assert_eq!(run(Some(json!("h.txt"))), skipped, "scalar");
    assert_eq!(run(Some(json!(["x.txt", "h.txt"]))), skipped, "list");

    assert_eq!(run(None), copied, "none");
    assert_eq!(run(Some(json!(true))), copied, "true");
    assert_eq!(run(Some(json!(false))), copied, "false");
    assert_eq!(run(Some(json!([]))), copied, "empty");
    assert_eq!(run(Some(json!("out.txt"))), copied, "to-name");
    assert_eq!(run(Some(json!("tm/h.txt"))), copied, "source-path");
}
