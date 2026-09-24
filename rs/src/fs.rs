// fs.rs — FS trait, OsFS, and MemFS. Ported from go/fs.go.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

// ─── Public types ─────────────────────────────────────────────────────────────

/// A small subset of file metadata surfaced across the FS boundary.
/// Times are unix milliseconds for stable JSON serialisation.
#[derive(Clone, Debug, Default)]
pub struct FileInfo {
    pub name:     String,
    pub size:     i64,
    pub mode:     u32,
    pub mod_time: i64,
    pub is_dir:   bool,
}

/// A directory entry.
#[derive(Clone, Debug)]
pub struct DirEntry {
    pub name:   String,
    pub is_dir: bool,
}

/// The read+write filesystem interface used internally.
pub trait FS: Send + Sync {
    fn read_file(&self, path: &str)              -> Result<Vec<u8>, String>;
    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String>;
    fn exists(&self, path: &str)                 -> bool;
    fn stat(&self, path: &str)                   -> Result<FileInfo, String>;
    fn mkdir_all(&self, path: &str)              -> Result<(), String>;
    fn read_dir(&self, path: &str)               -> Result<Vec<DirEntry>, String>;
    fn remove(&self, path: &str)                 -> Result<(), String>;
    fn rename(&self, old_path: &str, new_path: &str) -> Result<(), String>;
}

/// Optional capability: exclusive-create (fails if target exists).
pub trait ExclusiveFS: FS {
    fn write_file_excl(&self, path: &str, data: &[u8]) -> Result<(), String>;
}

/// Optional capability: chmod.
pub trait ChmodFS: FS {
    fn chmod(&self, path: &str, mode: u32) -> Result<(), String>;
}

/// Optional capability: realpath resolution.
pub trait RealpathFS: FS {
    fn realpath(&self, path: &str) -> Result<String, String>;
}

// ─── OsFS ────────────────────────────────────────────────────────────────────

/// Adapts the host filesystem to the `FS` interface.
#[derive(Clone, Default)]
pub struct OsFS;

impl OsFS {
    fn sys(&self, p: &str) -> std::path::PathBuf {
        std::path::PathBuf::from(p.replace('/', std::path::MAIN_SEPARATOR_STR))
    }
}

impl FS for OsFS {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        std::fs::read(self.sys(path)).map_err(|e| e.to_string())
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        std::fs::write(self.sys(path), data).map_err(|e| e.to_string())
    }

    fn exists(&self, path: &str) -> bool {
        self.sys(path).exists()
    }

    fn stat(&self, path: &str) -> Result<FileInfo, String> {
        let m = std::fs::metadata(self.sys(path)).map_err(|e| e.to_string())?;
        let mod_time = m.modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let mode = {
            #[cfg(unix)]
            { use std::os::unix::fs::PermissionsExt; m.permissions().mode() }
            #[cfg(not(unix))]
            { if m.permissions().readonly() { 0o444 } else { 0o644 } }
        };
        Ok(FileInfo {
            name:     self.sys(path).file_name()
                          .unwrap_or_default()
                          .to_string_lossy()
                          .into_owned(),
            size:     m.len() as i64,
            mode,
            mod_time,
            is_dir:   m.is_dir(),
        })
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        std::fs::create_dir_all(self.sys(path)).map_err(|e| e.to_string())
    }

    fn read_dir(&self, path: &str) -> Result<Vec<DirEntry>, String> {
        let entries = std::fs::read_dir(self.sys(path)).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for e in entries {
            let e = e.map_err(|e| e.to_string())?;
            out.push(DirEntry {
                name:   e.file_name().to_string_lossy().into_owned(),
                is_dir: e.file_type().map(|t| t.is_dir()).unwrap_or(false),
            });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    fn remove(&self, path: &str) -> Result<(), String> {
        let p = self.sys(path);
        if p.is_dir() {
            std::fs::remove_dir(&p).map_err(|e| e.to_string())
        } else {
            std::fs::remove_file(&p).map_err(|e| e.to_string())
        }
    }

    fn rename(&self, old_path: &str, new_path: &str) -> Result<(), String> {
        std::fs::rename(self.sys(old_path), self.sys(new_path)).map_err(|e| e.to_string())
    }
}

impl ExclusiveFS for OsFS {
    fn write_file_excl(&self, path: &str, data: &[u8]) -> Result<(), String> {
        use std::io::Write;
        let p = self.sys(path);
        let f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&p)
            .map_err(|e| e.to_string())?;
        let mut f = f;
        if let Err(e) = f.write_all(data) {
            drop(f);
            let _ = std::fs::remove_file(&p);
            return Err(e.to_string());
        }
        if let Err(e) = f.flush() {
            drop(f);
            let _ = std::fs::remove_file(&p);
            return Err(e.to_string());
        }
        Ok(())
    }
}

impl ChmodFS for OsFS {
    fn chmod(&self, path: &str, mode: u32) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(mode);
            std::fs::set_permissions(self.sys(path), perms).map_err(|e| e.to_string())
        }
        #[cfg(not(unix))]
        {
            let _ = (path, mode);
            Ok(())
        }
    }
}

impl RealpathFS for OsFS {
    fn realpath(&self, path: &str) -> Result<String, String> {
        std::fs::canonicalize(self.sys(path))
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .map_err(|e| e.to_string())
    }
}

// ─── MemFS ───────────────────────────────────────────────────────────────────

/// In-process filesystem backed by maps. Safe for concurrent use.
pub struct MemFS {
    inner: RwLock<MemFSInner>,
}

struct MemFSInner {
    files: HashMap<String, Vec<u8>>,
    times: HashMap<String, i64>,
    dirs:  HashMap<String, bool>,
}

impl MemFS {
    pub fn new() -> Self {
        MemFS {
            inner: RwLock::new(MemFSInner {
                files: HashMap::new(),
                times: HashMap::new(),
                dirs:  HashMap::new(),
            }),
        }
    }

    /// Returns a defensive copy of the underlying file map.
    pub fn vol(&self) -> HashMap<String, Vec<u8>> {
        let inner = self.inner.read().unwrap();
        inner.files.clone()
    }
}

/// Normalises a memfs path: forward slashes, no trailing /, no `.` or `..`.
pub fn mem_clean(p: &str) -> String {
    let p = p.replace('\\', "/");
    if p.is_empty() || p == "." {
        return String::new();
    }
    let abs = p.starts_with('/');
    let inner = p.trim_start_matches('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in inner.split('/') {
        match part {
            "" | "." => {}
            ".." => { parts.pop(); }
            s => parts.push(s),
        }
    }
    let joined = parts.join("/");
    if abs { format!("/{}", joined) } else { joined }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn path_base(p: &str) -> &str {
    if let Some(i) = p.rfind('/') { &p[i+1..] } else { p }
}

fn mark_dirs_locked(inner: &mut MemFSInner, p: &str) {
    if p.is_empty() || p == "/" { return; }
    let abs = p.starts_with('/');
    let inner_p = p.trim_start_matches('/');
    if inner_p.is_empty() { return; }
    let mut cur = String::new();
    for (i, part) in inner_p.split('/').enumerate() {
        if i == 0 {
            cur = if abs { format!("/{}", part) } else { part.to_string() };
        } else {
            cur = format!("{}/{}", cur, part);
        }
        inner.dirs.insert(cur.clone(), true);
    }
}

impl FS for MemFS {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        let inner = self.inner.read().unwrap();
        let cp = mem_clean(path);
        inner.files.get(&cp).cloned()
            .ok_or_else(|| format!("open {}: no such file or directory", path))
    }

    fn write_file(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let mut inner = self.inner.write().unwrap();
        let cp = mem_clean(path);
        inner.files.insert(cp.clone(), data.to_vec());
        inner.times.insert(cp.clone(), now_millis());
        if let Some(i) = cp.rfind('/') {
            if i > 0 { mark_dirs_locked(&mut inner, &cp[..i]); }
        }
        Ok(())
    }

    fn exists(&self, path: &str) -> bool {
        let inner = self.inner.read().unwrap();
        let cp = mem_clean(path);
        if cp.is_empty() { return true; }
        inner.files.contains_key(&cp) || inner.dirs.contains_key(&cp)
    }

    fn stat(&self, path: &str) -> Result<FileInfo, String> {
        let inner = self.inner.read().unwrap();
        let cp = mem_clean(path);
        if cp.is_empty() {
            return Ok(FileInfo { name: String::new(), is_dir: true, mode: 0o755 | 0o40000, ..Default::default() });
        }
        if let Some(data) = inner.files.get(&cp) {
            return Ok(FileInfo {
                name:     path_base(&cp).to_string(),
                size:     data.len() as i64,
                mode:     0o644,
                mod_time: *inner.times.get(&cp).unwrap_or(&0),
                is_dir:   false,
            });
        }
        if inner.dirs.contains_key(&cp) {
            return Ok(FileInfo {
                name:   path_base(&cp).to_string(),
                mode:   0o755 | 0o40000,
                is_dir: true,
                ..Default::default()
            });
        }
        Err(format!("stat {}: no such file or directory", path))
    }

    fn mkdir_all(&self, path: &str) -> Result<(), String> {
        let mut inner = self.inner.write().unwrap();
        let cp = mem_clean(path);
        if !cp.is_empty() { mark_dirs_locked(&mut inner, &cp); }
        Ok(())
    }

    fn read_dir(&self, path: &str) -> Result<Vec<DirEntry>, String> {
        let inner = self.inner.read().unwrap();
        let cp = mem_clean(path);
        if !cp.is_empty() && !inner.dirs.contains_key(&cp) {
            return Err(format!("readdir {}: no such file or directory", path));
        }
        let prefix = if cp.is_empty() { String::new() } else { format!("{}/", cp) };
        let mut seen: HashMap<String, DirEntry> = HashMap::new();
        for f in inner.files.keys() {
            if !f.starts_with(&prefix) { continue; }
            let rest = &f[prefix.len()..];
            if rest.is_empty() { continue; }
            let name = if let Some(i) = rest.find('/') { &rest[..i] } else { rest };
            let is_dir = rest.contains('/');
            seen.entry(name.to_string()).or_insert(DirEntry { name: name.to_string(), is_dir });
        }
        for d in inner.dirs.keys() {
            if !d.starts_with(&prefix) { continue; }
            let rest = &d[prefix.len()..];
            if rest.is_empty() { continue; }
            let name = if let Some(i) = rest.find('/') { &rest[..i] } else { rest };
            seen.entry(name.to_string()).or_insert(DirEntry { name: name.to_string(), is_dir: true });
        }
        let mut out: Vec<DirEntry> = seen.into_values().collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    fn remove(&self, path: &str) -> Result<(), String> {
        let mut inner = self.inner.write().unwrap();
        let cp = mem_clean(path);
        if inner.files.remove(&cp).is_some() {
            inner.times.remove(&cp);
            return Ok(());
        }
        if inner.dirs.contains_key(&cp) {
            let prefix = format!("{}/", cp);
            if inner.files.keys().any(|f| f.starts_with(&prefix)) ||
               inner.dirs.keys().any(|d| d != &cp && d.starts_with(&prefix)) {
                return Err(format!("remove {}: directory not empty", path));
            }
            inner.dirs.remove(&cp);
            return Ok(());
        }
        Err(format!("remove {}: no such file or directory", path))
    }

    fn rename(&self, old_path: &str, new_path: &str) -> Result<(), String> {
        let mut inner = self.inner.write().unwrap();
        let o = mem_clean(old_path);
        let n = mem_clean(new_path);
        let data = inner.files.remove(&o)
            .ok_or_else(|| format!("rename {}: no such file or directory", old_path))?;
        let t = inner.times.remove(&o).unwrap_or_else(now_millis);
        inner.files.insert(n.clone(), data);
        inner.times.insert(n.clone(), t);
        if let Some(i) = n.rfind('/') {
            if i > 0 { mark_dirs_locked(&mut inner, &n[..i]); }
        }
        Ok(())
    }
}

impl ExclusiveFS for MemFS {
    fn write_file_excl(&self, path: &str, data: &[u8]) -> Result<(), String> {
        let mut inner = self.inner.write().unwrap();
        let cp = mem_clean(path);
        if inner.files.contains_key(&cp) || inner.dirs.contains_key(&cp) {
            return Err(format!("open {}: file exists", path));
        }
        inner.files.insert(cp.clone(), data.to_vec());
        inner.times.insert(cp.clone(), now_millis());
        if let Some(i) = cp.rfind('/') {
            if i > 0 { mark_dirs_locked(&mut inner, &cp[..i]); }
        }
        Ok(())
    }
}
