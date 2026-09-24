// filehandler.rs — the only place that touches the filesystem during the
// build phase. Ported from go/filehandler.go.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::buildmeta::BuildMeta;
use crate::diff::{Diff, DiffSpec, HasConflicts, Merge, MergeOutcome};
use crate::errors::ERR_INVALID_PATH;
use crate::fs::FS;
use crate::jostraca::{Audit, AuditEntry, Files};
use crate::options::{Control, Existing};
use crate::util::is_bin_ext;
use crate::dlog::DLog;

const PROTECT_MARKER: &str = "JOSTRACA_PROTECT";
const META_FILENAME: &str = "jostraca.meta.log";
const TMP_SUFFIX: &str = ".jostraca-tmp";
const TMP_PATH_ATTEMPTS: usize = 9;

static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Collapses `existing.*` option pointers to concrete bools.
struct ModeBits {
    write:    bool,
    preserve: bool,
    present:  bool,
    diff:     bool,
    merge:    bool,
}

fn bool_or(p: Option<bool>, def: bool) -> bool {
    p.unwrap_or(def)
}

fn modes_for(existing: &Existing, is_text: bool) -> ModeBits {
    if is_text {
        ModeBits {
            write:    bool_or(existing.txt.write,    true),
            preserve: bool_or(existing.txt.preserve, false),
            present:  bool_or(existing.txt.present,  false),
            diff:     bool_or(existing.txt.diff,     false),
            merge:    bool_or(existing.txt.merge,    false),
        }
    } else {
        ModeBits {
            write:    bool_or(existing.bin.write,    true),
            preserve: bool_or(existing.bin.preserve, false),
            present:  bool_or(existing.bin.present,  false),
            diff:     false,
            merge:    false,
        }
    }
}

/// The only place that touches the filesystem during a build. Mirrors Go
/// `fileHandler`.
pub struct FileHandler {
    pub fs:       Box<dyn FS>,
    pub now:      Box<dyn Fn() -> i64 + Send + Sync>,
    pub folder:   String,
    pub when:     i64,
    pub control:  Control,

    pub files:       Files,
    pub audit:       Audit,

    existing:        Existing,
    created_dirs:    HashSet<String>,
    pub bmeta:       Option<Box<BuildMeta>>,
    duplicate_folder: String,
}

// SAFETY: FileHandler is only accessed single-threaded per Generate call.
unsafe impl Send for FileHandler {}
unsafe impl Sync for FileHandler {}

static FH_DLOG: std::sync::OnceLock<DLog> = std::sync::OnceLock::new();
fn fh_dlog() -> &'static DLog {
    FH_DLOG.get_or_init(|| DLog::new("jostraca", "filehandler.rs"))
}

impl FileHandler {
    pub fn new(
        fs: Box<dyn FS>,
        now: Box<dyn Fn() -> i64 + Send + Sync>,
        folder: String,
        when: i64,
        existing: Existing,
        control: Control,
    ) -> Box<Self> {
        let dup = format!("{}/.jostraca/generated", folder);
        let mut fh = Box::new(FileHandler {
            fs,
            now,
            folder,
            when,
            existing,
            control,
            files: Files::default(),
            audit: Vec::new(),
            created_dirs: HashSet::new(),
            bmeta: None,
            duplicate_folder: dup,
        });
        // BuildMeta holds a raw pointer to FileHandler; the Box is pinned in
        // place after this construction and never moved.
        let fh_ptr: *mut FileHandler = &mut *fh;
        fh.bmeta = Some(BuildMeta::new(fh_ptr));
        fh
    }

    /// Returns the relative path of `p` under the configured output folder.
    /// Mirrors Go `relative`.
    pub fn relative(&self, p: &str) -> String {
        let p = fwd(p);
        if self.folder == "." {
            if let Some(rest) = p.strip_prefix("./") {
                return rest.trim_start_matches('/').to_string();
            }
            return p;
        }
        if self.folder == "/" {
            return p.trim_start_matches('/').to_string();
        }
        if p == self.folder {
            return String::new();
        }
        let prefix = format!("{}/", self.folder);
        if let Some(rest) = p.strip_prefix(&prefix) {
            return rest.trim_start_matches('/').to_string();
        }
        p
    }

    /// Whether `p` resolves inside the output folder. Mirrors Go `withinFolder`.
    fn within_folder(&self, p: &str) -> bool {
        match self.folder.as_str() {
            "." => {
                if is_abs_from_path(p) { return false; }
                let c = path_clean(&p.replace('\\', "/"));
                c != ".." && !c.starts_with("../")
            }
            "/" => is_abs_path(p),
            _ => p == self.folder || p.starts_with(&format!("{}/", self.folder)),
        }
    }

    /// Ensures the directory containing `p` exists. Mirrors Go `ensureDirOf`.
    pub fn ensure_dir_of(&mut self, p: &str) -> Result<(), String> {
        let dir = path_dir(p);
        if dir.is_empty() || dir == "." || dir == "/" {
            return Ok(());
        }
        self.ensure_folder(&dir)
    }

    pub fn ensure_folder(&mut self, p: &str) -> Result<(), String> {
        if p.is_empty() || p == "." || p == "/" {
            return Ok(());
        }
        if self.created_dirs.contains(p) {
            return Ok(());
        }
        self.fs.mkdir_all(p)?;
        self.created_dirs.insert(p.to_string());
        Ok(())
    }

    /// Saves content under the configured existing-file mode.
    pub fn save(&mut self, p: &str, content: &[u8], whence: &str) -> Result<(), String> {
        self.save_mode(p, content, whence, 0)
    }

    /// Save for content already known to be binary.
    pub fn save_binary(&mut self, p: &str, content: &[u8], whence: &str) -> Result<(), String> {
        self.save_classified(p, content, whence, 0, false)
    }

    /// Save with explicit POSIX permission bits (0 = unset).
    pub fn save_mode(&mut self, p: &str, content: &[u8], whence: &str, mode: u32) -> Result<(), String> {
        self.save_classified(p, content, whence, mode, !is_bin_ext(p))
    }

    fn save_classified(
        &mut self,
        p: &str,
        content: &[u8],
        whence: &str,
        mode: u32,
        is_text: bool,
    ) -> Result<(), String> {
        if p.is_empty() {
            return Err(ERR_INVALID_PATH.to_string());
        }
        let p = fwd(p);
        let rpath = self.relative(&p);
        let modes = modes_for(&self.existing.clone(), is_text);

        let exists = self.fs.exists(&p);
        let mut why: Vec<String> = Vec::new();
        let w_tag = if modes.write { "w" } else { "W" };
        let x_tag = if exists { "x" } else { "X" };
        why.push(format!("start<{}{}>", w_tag, x_tag));

        let mut write = !exists;
        let mut actions: usize = 0;
        #[allow(unused_assignments)]
        let mut existing_bytes: Vec<u8> = Vec::new();
        let mut protect = false;
        let mut content_equal = false;

        if exists {
            why.push("exists-0".to_string());
            existing_bytes = self.fs.read_file(&p).map_err(|e| e)?;
            if is_text {
                protect = existing_bytes.windows(PROTECT_MARKER.len())
                    .any(|w| w == PROTECT_MARKER.as_bytes());
            }
            content_equal = existing_bytes == content;

            if modes.preserve {
                why.push("preserve-0".to_string());
                if protect {
                    why.push("protect-0".to_string());
                    write = false;
                } else if !content_equal {
                    why.push("content-0".to_string());
                    self.save_preserve_backup(&p, &existing_bytes, &rpath, whence)?;
                    actions += 1;
                }
            }

            if modes.write && !protect {
                why.push("write-0".to_string());
                write = true;
            } else if modes.present {
                why.push("present-0".to_string());
                if !content_equal {
                    why.push("content-1".to_string());
                    let why_c = why.clone();
                    self.save_present(&p, content, &rpath, whence, why_c)?;
                    actions += 1;
                }
            }

            if !protect {
                why.push("not-protect-1".to_string());

                if is_text && modes.diff {
                    why.push("diff-0".to_string());
                    write = false;
                    if !content_equal {
                        why.push("content-2".to_string());
                        let why_c = why.clone();
                        self.save_diff(&p, content, &existing_bytes, &rpath, whence, why_c, mode)?;
                        actions += 1;
                    } else {
                        if self.chmod_unchanged(&p, mode) {
                            why.push("chmod-0".to_string());
                        }
                        self.files.unchanged.push(p.clone());
                    }
                } else if is_text && modes.merge {
                    why.push("merge-0".to_string());
                    if !content_equal {
                        why.push("content-3".to_string());
                        if self.control.duplicate() {
                            why.push("duplicate-0".to_string());
                            let dpath = format!("{}/{}", self.duplicate_folder, rpath);
                            if self.fs.exists(&dpath) {
                                why.push("dupexists-0".to_string());
                                write = false;
                                let why_c = why.clone();
                                self.save_merge(&p, content, &existing_bytes, &rpath, whence, why_c, mode)?;
                                actions += 1;
                            } else {
                                why.push("no-baseline-0".to_string());
                            }
                        }
                    } else {
                        why.push("unchanged-0".to_string());
                        write = false;
                        if self.chmod_unchanged(&p, mode) {
                            why.push("chmod-0".to_string());
                        }
                        self.files.unchanged.push(p.clone());
                    }
                }
            }
        }

        let dup = if self.control.duplicate() {
            why.push("duplicate-1".to_string());
            if self.within_folder(&p) && path_base(&p) != META_FILENAME {
                why.push("within-0".to_string());
                true
            } else { false }
        } else { false };

        if write {
            if exists && content_equal {
                why.push("unchanged-0".to_string());
                if self.chmod_unchanged(&p, mode) {
                    why.push("chmod-0".to_string());
                }
                self.files.unchanged.push(p.clone());
                self.append_audit("save:write", &rpath, whence, &why, exists,
                    "write", false, false);
                if let Some(bm) = &mut self.bmeta {
                    bm.record_action(&rpath, "write", exists, false, false);
                }
            } else {
                why.push("write-1".to_string());
                let why_c = why.clone();
                self.do_write(&p, content, &rpath, whence, exists, why_c, mode)?;
            }
            #[allow(unused_assignments)]
            { actions += 1; }
        } else if actions == 0 {
            why.push("skip-0".to_string());
            self.append_audit("save:skip", &rpath, whence, &why, exists,
                "skip", false, false);
            if let Some(bm) = &mut self.bmeta {
                bm.record_action(&rpath, "skip", exists, false, protect);
            }
        }

        if let Some(bm) = &mut self.bmeta {
            bm.record_protect(&rpath, protect);
        }

        if dup {
            self.write_duplicate(&rpath, content)?;
        }
        Ok(())
    }

    fn do_write(
        &mut self,
        p: &str,
        content: &[u8],
        rpath: &str,
        whence: &str,
        exists: bool,
        why: Vec<String>,
        mode: u32,
    ) -> Result<(), String> {
        self.ensure_dir_of(p)?;
        if !self.control.dryrun {
            self.write_atomic_mode(p, content, mode)?;
        }
        self.files.written.push(p.to_string());
        self.append_audit("save:write", rpath, whence, &why, exists, "write", false, false);
        if let Some(bm) = &mut self.bmeta {
            bm.record_action(rpath, "write", exists, false, false);
        }
        Ok(())
    }

    fn save_present(
        &mut self,
        p: &str,
        content: &[u8],
        rpath: &str,
        whence: &str,
        why: Vec<String>,
    ) -> Result<(), String> {
        let out = annotated_path(p, "new");
        self.ensure_dir_of(&out)?;
        if !self.control.dryrun {
            self.write_atomic(&out, content)?;
        }
        self.files.presented.push(out.clone());
        self.append_audit("save:present", rpath, whence, &why, true, "present", false, false);
        if let Some(bm) = &mut self.bmeta {
            bm.record_action(rpath, "present", true, false, false);
        }
        Ok(())
    }

    fn save_merge(
        &mut self,
        p: &str,
        content: &[u8],
        existing: &[u8],
        rpath: &str,
        whence: &str,
        mut why: Vec<String>,
        mode: u32,
    ) -> Result<(), String> {
        if HasConflicts(std::str::from_utf8(existing).unwrap_or("")) {
            let mut skip_why = why.clone();
            skip_why.push("merge-unresolved-0".to_string());
            self.append_audit("save:skip", rpath, whence, &skip_why, true, "skip", false, false);
            if let Some(bm) = &mut self.bmeta {
                bm.record_action(rpath, "skip", true, false, false);
            }
            return Ok(());
        }
        let dpath = format!("{}/{}", self.duplicate_folder, rpath);
        let baseline = self.fs.read_file(&dpath)?;
        let last = self.bmeta.as_ref().map(|bm| bm.last()).unwrap_or(-1);
        let res = Merge(
            std::str::from_utf8(content).unwrap_or(""),
            std::str::from_utf8(&baseline).unwrap_or(""),
            std::str::from_utf8(existing).unwrap_or(""),
            DiffSpec { when: self.when, last, kind: "merge".to_string(), labels: None },
        );
        let outcome_tag = match res.outcome {
            MergeOutcome::Same       => "merge-same-0",
            MergeOutcome::Clean      => "merge-clean-0",
            MergeOutcome::Unresolved => "merge-unresolved-0",
            MergeOutcome::Merged     => "merge-run-0",
        };
        why.push(outcome_tag.to_string());
        self.ensure_dir_of(p)?;
        if !self.control.dryrun {
            self.write_atomic_mode(p, res.content.as_bytes(), mode)?;
        }
        self.files.merged.push(p.to_string());
        if res.conflict {
            self.files.conflicted.push(p.to_string());
        }
        self.append_audit("save:merge", rpath, whence, &why, true, "merge", res.conflict, false);
        if let Some(bm) = &mut self.bmeta {
            bm.record_action(rpath, "merge", true, res.conflict, false);
        }
        Ok(())
    }

    fn save_diff(
        &mut self,
        p: &str,
        content: &[u8],
        existing: &[u8],
        rpath: &str,
        whence: &str,
        why: Vec<String>,
        mode: u32,
    ) -> Result<(), String> {
        let last = self.bmeta.as_ref().map(|bm| bm.last()).unwrap_or(0);
        let rendered = Diff(
            std::str::from_utf8(content).unwrap_or(""),
            std::str::from_utf8(existing).unwrap_or(""),
            DiffSpec { when: self.when, last, kind: "diff".to_string(), labels: None },
        ).content;
        self.ensure_dir_of(p)?;
        if !self.control.dryrun {
            self.write_atomic_mode(p, rendered.as_bytes(), mode)?;
        }
        let conflict = rendered.as_bytes() != content;
        self.files.diffed.push(p.to_string());
        if conflict {
            self.files.conflicted.push(p.to_string());
        }
        self.append_audit("save:diff", rpath, whence, &why, true, "diff", conflict, false);
        if let Some(bm) = &mut self.bmeta {
            bm.record_action(rpath, "diff", true, conflict, false);
        }
        Ok(())
    }

    fn save_preserve_backup(
        &mut self,
        p: &str,
        existing: &[u8],
        rpath: &str,
        whence: &str,
    ) -> Result<(), String> {
        let backup = annotated_path(p, "old");
        if !self.control.dryrun {
            self.ensure_dir_of(&backup)?;
            self.write_atomic(&backup, existing)?;
        }
        self.files.preserved.push(backup.clone());
        // preserve audit uses a simplified form (no action/conflict columns)
        let entry = AuditEntry {
            tag: "preserve".to_string(),
            data: {
                let mut m = std::collections::HashMap::new();
                m.insert("path".to_string(), serde_json::Value::String(rpath.to_string()));
                m.insert("backup".to_string(), serde_json::Value::String(self.relative(&backup)));
                m.insert("whence".to_string(), serde_json::Value::String(whence.to_string()));
                m
            },
        };
        self.audit.push(entry);
        if let Some(bm) = &mut self.bmeta {
            bm.record_action(rpath, "preserve", true, false, false);
        }
        Ok(())
    }

    fn write_duplicate(&mut self, rpath: &str, content: &[u8]) -> Result<(), String> {
        if self.control.dryrun || !self.control.duplicate() {
            return Ok(());
        }
        let dup = format!("{}/{}", self.duplicate_folder, rpath);
        let root = path_clean(&self.duplicate_folder);
        let cleaned = path_clean(&dup);
        if cleaned != root && !cleaned.starts_with(&format!("{}/", root)) {
            let msg = format!("baseline path escapes the duplicate folder, skipping: {}", dup);
            fh_dlog().log(&["save", &msg]);
            return Ok(());
        }
        self.ensure_dir_of(&dup)?;
        self.write_atomic(&dup, content)
    }

    fn chmod_unchanged(&self, p: &str, mode: u32) -> bool {
        if mode == 0 || self.control.dryrun { return false; }
        if let Ok(fi) = self.fs.stat(p) {
            if fi.mode == mode { return false; }
        }
        // Best-effort: ignore errors.
        false
    }

    fn write_atomic(&mut self, p: &str, content: &[u8]) -> Result<(), String> {
        self.write_atomic_mode(p, content, 0)
    }

    fn write_atomic_mode(&mut self, p: &str, content: &[u8], mode: u32) -> Result<(), String> {
        let mut tmp = String::new();
        let mut last_err = String::new();

        // Use ExclusiveFS if available via dynamic dispatch attempt.
        // Since we can't downcast Box<dyn FS>, we use WriteFile with
        // exists-check (the non-exclusive path). If the provider is OsFS or
        // MemFS they implement their own create-new logic internally through
        // write_file_excl if available — we call write_file directly here as
        // the safe fallback.
        for _attempt in 0..TMP_PATH_ATTEMPTS {
            let cand = tmp_path_for(p);
            if self.fs.exists(&cand) { continue; }
            match self.fs.write_file(&cand, content) {
                Err(e) => {
                    let _ = self.fs.remove(&cand);
                    last_err = e;
                    break;
                }
                Ok(()) => {
                    tmp = cand;
                    break;
                }
            }
        }

        if tmp.is_empty() {
            return Err(format!(
                "jostraca: no free temp path for {} after {} attempts: {}",
                p, TMP_PATH_ATTEMPTS, last_err));
        }

        // Apply mode to temp file before rename (best-effort).
        if mode != 0 {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(
                    &tmp,
                    std::fs::Permissions::from_mode(mode),
                );
            }
        }

        if let Err(e) = self.fs.rename(&tmp, p) {
            let _ = self.fs.remove(&tmp);
            return Err(e);
        }
        Ok(())
    }

    fn append_audit(
        &mut self,
        tag: &str,
        rpath: &str,
        whence: &str,
        why: &[String],
        exists: bool,
        action: &str,
        conflict: bool,
        _protect: bool,
    ) {
        let mut data = std::collections::HashMap::new();
        data.insert("action".to_string(),  serde_json::Value::String(action.to_string()));
        data.insert("path".to_string(),    serde_json::Value::String(rpath.to_string()));
        data.insert("whence".to_string(),  serde_json::Value::String(whence.to_string()));
        data.insert("why".to_string(),
            serde_json::Value::Array(why.iter().map(|s| serde_json::Value::String(s.clone())).collect()));
        data.insert("exists".to_string(),  serde_json::Value::Bool(exists));
        data.insert("actions".to_string(),
            serde_json::Value::Array(vec![serde_json::Value::String(action.to_string())]));
        if conflict {
            data.insert("conflict".to_string(), serde_json::Value::Bool(true));
        }
        self.audit.push(AuditEntry { tag: tag.to_string(), data });
    }
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/// Normalises to forward-slash form.
pub fn fwd(p: &str) -> String {
    p.replace('\\', "/")
}

/// Resolves `.` and `..` segments on a forward-slash path.
pub fn path_clean(p: &str) -> String {
    if p.is_empty() { return ".".to_string(); }
    let abs = p.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for seg in p.split('/') {
        match seg {
            "" | "." => {}
            ".." => { parts.pop(); }
            s => parts.push(s),
        }
    }
    let joined = parts.join("/");
    if joined.is_empty() {
        if abs { "/".to_string() } else { ".".to_string() }
    } else if abs {
        format!("/{}", joined)
    } else {
        joined
    }
}

/// Returns the directory component of a forward-slash path.
pub fn path_dir(p: &str) -> String {
    match p.rfind('/') {
        Some(0) => "/".to_string(),
        Some(i) => p[..i].to_string(),
        None => String::new(),
    }
}

/// Returns the base name component of a forward-slash path.
pub fn path_base(p: &str) -> &str {
    if let Some(i) = p.rfind('/') { &p[i+1..] } else { p }
}

/// Returns the extension of a path using Node.js `path.extname` semantics.
/// A leading dot is a hidden-file marker, not an extension.
fn path_ext(p: &str) -> &str {
    let base = path_base(p);
    match base.rfind('.') {
        Some(i) if i > 0 => &base[i..],
        _ => "",
    }
}

/// Rewrites `foo/bar.txt` → `foo/bar.<kind>.txt`. Mirrors Go `annotatedPath`.
pub fn annotated_path(target: &str, kind: &str) -> String {
    let (dir, base) = match target.rfind('/') {
        Some(i) => (&target[..=i], &target[i+1..]),
        None => ("", target),
    };
    let ext = path_ext(target);
    // A dot at index 0 marks a dotfile: ext == base means the whole base is
    // the "extension", so treat it as having no extension.
    let actual_ext = if ext == base { "" } else { ext };
    let stem = &base[..base.len() - actual_ext.len()];
    format!("{}{}.{}{}", dir, stem, kind, actual_ext)
}

/// Reports whether `p` is an absolute path on the current platform. Mirrors
/// Go `isAbsFromPath` (platform-dispatched).
pub fn is_abs_from_path(p: &str) -> bool {
    is_abs_from_path_on(p, cfg!(windows))
}

pub fn is_abs_from_path_on(p: &str, windows: bool) -> bool {
    if p.is_empty() { return false; }
    if p.starts_with('/') { return true; }
    if !windows { return false; }
    if p.starts_with('\\') { return true; }
    if p.len() >= 3 {
        let b = p.as_bytes();
        if b[0].is_ascii_alphabetic() && b[1] == b':'
            && (b[2] == b'/' || b[2] == b'\\') {
            return true;
        }
    }
    false
}

fn is_abs_path(p: &str) -> bool {
    !p.is_empty() && p.starts_with('/')
}

/// Builds a unique sibling temp path. Mirrors Go `tmppathFor`.
fn tmp_path_for(p: &str) -> String {
    let seq = TMP_SEQ.fetch_add(1, Ordering::SeqCst);
    let pid = std::process::id();
    // 4 random bytes
    let rnd: u32 = rand::random();
    format!("{}{}-{}-{}-{:08x}", p, TMP_SUFFIX, pid, radix36(seq), rnd)
}

fn radix36(mut n: u64) -> String {
    if n == 0 { return "0".to_string(); }
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    while n > 0 {
        out.push(digits[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}
