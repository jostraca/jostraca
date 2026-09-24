// buildmeta.rs — persists per-output-path metadata. Ported from go/buildmeta.go.

use crate::filehandler::FileHandler;
use crate::util::humanify_digits;

pub struct BuildMeta {
    pub fh:   *mut FileHandler,
    pub prev: Option<serde_json::Value>,
    pub next: MetaSnapshot,
}

// SAFETY: BuildMeta is only used single-threaded.
unsafe impl Send for BuildMeta {}
unsafe impl Sync for BuildMeta {}

pub struct MetaSnapshot {
    pub foldername: String,
    pub filename:   String,
    pub last:       i64,
    pub files:      Vec<Box<MetaEntry>>,
    pub by_path:    std::collections::HashMap<String, usize>, // index into files
}

pub struct MetaEntry {
    pub path:     String,
    pub action:   String,
    pub exists:   bool,
    pub actions:  Vec<String>,
    pub protect:  bool,
    pub conflict: bool,
    pub when:     i64,
}

impl BuildMeta {
    pub fn new(fh: *mut FileHandler) -> Box<Self> {
        let fh_ref = unsafe { &*fh };
        let now = (fh_ref.now)();
        let mut bm = Box::new(BuildMeta {
            fh,
            prev: None,
            next: MetaSnapshot {
                foldername: ".jostraca".to_string(),
                filename:   "jostraca.meta.log".to_string(),
                last:       now,
                files:      Vec::new(),
                by_path:    std::collections::HashMap::new(),
            },
        });
        bm.load();
        bm
    }

    fn fh(&self) -> &FileHandler { unsafe { &*self.fh } }

    pub fn meta_path(&self) -> String {
        format!("{}/.jostraca/jostraca.meta.log", self.fh().folder)
    }

    pub fn gitignore_path(&self) -> String {
        format!("{}/.jostraca/.gitignore", self.fh().folder)
    }

    /// Returns the previous build's epoch-ms, or -1 if absent.
    pub fn last(&self) -> i64 {
        self.prev.as_ref()
            .and_then(|p| p.get("last"))
            .and_then(|v| v.as_f64())
            .map(|f| f as i64)
            .unwrap_or(-1)
    }

    pub fn load(&mut self) {
        let fh = self.fh();
        let mp = self.meta_path();
        if !fh.fs.exists(&mp) { return; }
        match fh.fs.read_file(&mp) {
            Err(_) => {}
            Ok(data) => {
                match serde_json::from_slice::<serde_json::Value>(&data) {
                    Ok(v) => self.prev = Some(v),
                    Err(_) => self.prev = Some(serde_json::json!({})),
                }
            }
        }
    }

    pub fn record_action(&mut self, rpath: &str, action: &str, exists: bool, conflict: bool, protect: bool) {
        if let Some(idx) = self.next.by_path.get(rpath).copied() {
            let e = &mut self.next.files[idx];
            e.action = action.to_string();
            e.actions.push(action.to_string());
            if conflict { e.conflict = true; }
            if protect  { e.protect  = true; }
        } else {
            let fh = self.fh();
            let when = (fh.now)();
            let e = Box::new(MetaEntry {
                path:     rpath.to_string(),
                action:   action.to_string(),
                exists,
                actions:  vec![action.to_string()],
                protect,
                conflict,
                when,
            });
            let idx = self.next.files.len();
            self.next.files.push(e);
            self.next.by_path.insert(rpath.to_string(), idx);
        }
    }

    pub fn record_protect(&mut self, rpath: &str, protect: bool) {
        if !protect { return; }
        if let Some(idx) = self.next.by_path.get(rpath).copied() {
            self.next.files[idx].protect = true;
        }
    }

    pub fn done(&mut self) -> Result<(), String> {
        let out = self.encode();
        let mp = self.meta_path();
        let gp = self.gitignore_path();
        let fh = unsafe { &mut *self.fh };
        fh.ensure_dir_of(&mp)?;
        if !fh.control.dryrun {
            fh.fs.write_file(&mp, &out)?;
            if !fh.control.version {
                let _ = fh.fs.write_file(&gp, b"\njostraca.meta.log\ngenerated\n");
            }
        }
        Ok(())
    }

    /// Produces JSON with the exact field order TS uses.
    pub fn encode(&self) -> Vec<u8> {
        let now = self.next.last;
        let hlast = humanify_digits(now);
        let mut out = String::new();
        out.push_str("{\n");

        let json_str = |s: &str| serde_json::to_string(s).unwrap_or_else(|_| format!("\"{}\"", s));
        let json_num = |n: i64| n.to_string();
        let json_bool = |b: bool| if b { "true" } else { "false" };

        out.push_str(&format!("  {}: {},\n", json_str("foldername"), json_str(&self.next.foldername)));
        out.push_str(&format!("  {}: {},\n", json_str("filename"),   json_str(&self.next.filename)));
        out.push_str(&format!("  {}: {},\n", json_str("last"),   json_num(now)));
        out.push_str(&format!("  {}: {},\n", json_str("hlast"),  json_num(hlast)));

        out.push_str("  \"files\": {");
        if self.next.files.is_empty() {
            out.push_str("}\n");
        } else {
            out.push('\n');
            for (i, e) in self.next.files.iter().enumerate() {
                let hwhen = humanify_digits(e.when);
                out.push_str(&format!("    {}: {{\n", json_str(&e.path)));
                let fields: Vec<(&str, String)> = vec![
                    ("action",   json_str(&e.action)),
                    ("path",     json_str(&e.path)),
                    ("exists",   json_bool(e.exists).to_string()),
                    ("actions",  json_strs_slice(&e.actions)),
                    ("protect",  json_bool(e.protect).to_string()),
                    ("conflict", json_bool(e.conflict).to_string()),
                    ("when",     json_num(e.when)),
                    ("hwhen",    json_num(hwhen)),
                ];
                let n = fields.len();
                for (j, (k, v)) in fields.iter().enumerate() {
                    if j < n - 1 {
                        out.push_str(&format!("      {}: {},\n", json_str(k), v));
                    } else {
                        out.push_str(&format!("      {}: {}\n", json_str(k), v));
                    }
                }
                out.push_str("    }");
                if i < self.next.files.len() - 1 { out.push(','); }
                out.push('\n');
            }
            out.push_str("  }\n");
        }
        out.push('}');
        out.into_bytes()
    }
}

fn json_strs_slice(ss: &[String]) -> String {
    if ss.is_empty() { return "[]".to_string(); }
    let mut b = String::new();
    b.push_str("[\n");
    for (i, s) in ss.iter().enumerate() {
        let j = serde_json::to_string(s).unwrap_or_else(|_| format!("\"{}\"", s));
        if i < ss.len() - 1 {
            b.push_str(&format!("        {},\n", j));
        } else {
            b.push_str(&format!("        {}\n", j));
        }
    }
    b.push_str("      ]");
    b
}
