// build.rs — op dispatch table, step walker, and builder (*J) methods.
// Ported from go/build.go and go/builder.go.

use std::collections::HashMap;

use crate::buildctx::{new_build_ctx, BuildCtx, FolderRef};
use crate::filehandler::{fwd, is_abs_from_path, path_base, path_clean};
use crate::jostraca::JState;
use crate::node::{child_path, AfterRef, Kind, Node};
use crate::template::{template, ReplaceValue, TemplateSpec};
use crate::util::{esc_re, is_bin_content, is_bin_ext, indent as indent_fn};
use crate::errors::{
    ERR_INJECT_TARGET_MISSING, ERR_MISSING_OP, ERR_NAME_TRAVERSAL,
};
use crate::dlog::DLog;

// ─── Op dispatch table ────────────────────────────────────────────────────────

type OpFn = fn(&mut Node, &mut JState, &mut BuildCtx) -> Result<(), String>;

struct Op {
    before: Option<OpFn>,
    after:  Option<OpFn>,
}

static OPS: [Op; 9] = [
    Op { before: None,             after: None           }, // None
    Op { before: Some(project_before), after: None       }, // Project
    Op { before: Some(folder_before),  after: Some(folder_after)  }, // Folder
    Op { before: Some(file_before),    after: Some(file_after)    }, // File
    Op { before: Some(content_before), after: None       }, // Content
    Op { before: Some(copy_before),    after: Some(copy_after)    }, // Copy
    Op { before: Some(inject_before),  after: Some(inject_after)  }, // Inject
    Op { before: Some(fragment_before),after: Some(fragment_after)}, // Fragment
    Op { before: Some(slot_before),    after: Some(slot_after)    }, // Slot
];

/// Depth-first op walker. Mirrors Go `step`.
pub fn step(n: &mut Node, st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    let kind_idx = n.kind as usize;
    if kind_idx >= OPS.len() {
        return Err(format!("{}: {}", ERR_MISSING_OP, kind_idx));
    }
    if let Some(f) = OPS[kind_idx].before {
        f(n, st, b)?;
    }
    // Walk children. We need to iterate by index because ops may need mut refs.
    let mut i = 0;
    while i < n.children.len() {
        // SAFETY: each child is a distinct Box<Node>; we only iterate, not nest.
        let child_ptr: *mut Node = &mut *n.children[i];
        step(unsafe { &mut *child_ptr }, st, b)?;
        i += 1;
    }
    if let Some(f) = OPS[kind_idx].after {
        f(n, st, b)?;
    }
    Ok(())
}

/// Entry point after the define phase. Mirrors Go `runBuild`.
pub fn run_build(st: &mut JState, mut root_node: Box<Node>) -> Result<Option<BuildCtx>, String> {
    if st.root.is_none() {
        return Ok(None);
    }
    let st_ptr: *mut JState = st;
    let mut b = new_build_ctx(st_ptr);

    // Build the FileHandler from JState.
    {
        use crate::filehandler::FileHandler;
        use crate::fs::OsFS;

        let fs_box: Box<dyn crate::fs::FS> = st.fs.take()
            .unwrap_or_else(|| Box::new(OsFS));

        let folder = {
            use crate::filehandler::path_clean;
            let cleaned = path_clean(&fwd(&st.folder));
            if cleaned.is_empty() || cleaned == "." { ".".to_string() } else { cleaned }
        };

        let now: Box<dyn Fn() -> i64 + Send + Sync> = Box::new({
            let when = b.when;
            move || when
        });

        let fh = FileHandler::new(
            fs_box,
            now,
            folder,
            b.when,
            st.opts.existing.clone(),
            st.opts.control.clone(),
        );
        b.fh = Some(fh);
    }

    step(&mut *root_node, st, &mut b)?;

    if let Some(ref mut fh) = b.fh {
        if let Some(ref mut bm) = fh.bmeta {
            bm.done()?;
        }
    }
    Ok(Some(b))
}

// ─── Op implementations ───────────────────────────────────────────────────────

fn project_before(n: &mut Node, st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    b.current.project = Some(n as *mut Node);
    let folder = if st.folder.is_empty() { ".".to_string() } else { st.folder.clone() };
    let parent = if n.folder.is_empty() {
        folder
    } else if is_abs_from_path(&n.folder) {
        n.folder.clone()
    } else {
        format!("{}/{}", folder, n.folder)
    };
    let parent = path_clean(&fwd(&parent));
    b.current.folder = FolderRef {
        node:   Some(n as *mut Node),
        path:   vec![],
        parent,
    };
    if let Some(ref mut fh) = b.fh {
        let _ = fh.ensure_folder(&b.current.folder.parent.clone());
    }
    Ok(())
}

fn folder_before(n: &mut Node, _st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    valid_name(&n.name, "Folder")?;
    b.current.folder.path.push(n.name.clone());
    Ok(())
}

fn folder_after(_n: &mut Node, _st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    b.current.folder.path.pop();
    Ok(())
}

fn file_before(n: &mut Node, _st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    valid_name(&n.name, "File")?;
    b.current.file = Some(n as *mut Node);
    let parent = &b.current.folder.parent;
    let dir = b.current.folder.path.join("/");
    let raw = if dir.is_empty() {
        format!("{}/{}", parent, n.name)
    } else {
        format!("{}/{}/{}", parent, dir, n.name)
    };
    n.full_path = path_clean(&fwd(&raw));
    Ok(())
}

fn file_after(n: &mut Node, st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    let mut sb = String::new();
    for c in &n.children {
        match c.kind {
            Kind::Content | Kind::Fragment | Kind::Inject | Kind::Copy | Kind::Slot => {
                for s in &c.content { sb.push_str(s); }
            }
            _ => {}
        }
    }
    let body = sb;
    n.content = vec![body.clone()];

    let fh = match b.fh {
        Some(ref mut fh) => fh,
        None => return Ok(()),
    };
    if n.full_path.is_empty() { return Ok(()); }

    // Honour Exclude=true (skip if file already exists on disk).
    if let Some(ex) = n.exclude.as_ref().and_then(|v| v.as_bool()) {
        if ex && fh.fs.exists(&n.full_path) { return Ok(()); }
    }
    // Honour global Options.Exclude time-window.
    if st.opts.exclude && fh.fs.exists(&n.full_path) {
        if let Some(ref bm) = fh.bmeta {
            if let Ok(fi) = fh.fs.stat(&n.full_path) {
                let last = bm.last();
                if last > 0 && fi.mod_time > last { return Ok(()); }
            }
        }
    }
    fh.save_mode(&n.full_path.clone(), body.as_bytes(), "FileOp:after", n.mode)
}

fn content_before(_n: &mut Node, _st: &mut JState, _b: &mut BuildCtx) -> Result<(), String> {
    Ok(())
}

fn copy_before(n: &mut Node, st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    let fh = match b.fh { Some(ref mut fh) => fh, None => return Ok(()) };
    valid_name(&n.name, "Copy(To)")?;
    let from = n.from.clone();
    let fi = fh.fs.stat(&from).map_err(|e| format!("Copy: stat {}: {}", from, e))?;
    if fi.is_dir {
        n.after = Some(AfterRef { kind: "copy".to_string() });
        return Ok(());
    }
    let name = if n.name.is_empty() { path_base(&from).to_string() } else { n.name.clone() };
    let parent = b.current.folder.parent.clone();
    let dir = b.current.folder.path.join("/");
    let dest = if dir.is_empty() {
        format!("{}/{}", parent, name)
    } else {
        format!("{}/{}/{}", parent, dir, name)
    };
    let dest = fwd(&dest);

    let body = fh.fs.read_file(&from)?;
    let is_bin = is_bin_ext(&from) || is_bin_content(&body);

    let content_bytes = if !is_bin {
        let model_json = model_to_json(st);
        let replace: HashMap<String, ReplaceValue> = node_replace_to_rv(&n.replace);
        let rendered = template(
            std::str::from_utf8(&body).unwrap_or(""),
            &model_json,
            Some(TemplateSpec { replace, ..Default::default() }),
        )?;
        rendered.into_bytes()
    } else {
        body
    };

    n.after    = Some(AfterRef { kind: "file".to_string() });
    n.full_path = dest;
    n.content  = vec![String::from_utf8_lossy(&content_bytes).into_owned()];
    if is_bin {
        n.meta.insert("copyBinary".to_string(), crate::node::MetaVal::Bool(true));
    }
    Ok(())
}

fn copy_after(n: &mut Node, st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    let after_kind = match &n.after {
        Some(a) => a.kind.clone(),
        None => return Ok(()),
    };
    if b.fh.is_none() { return Ok(()); }
    match after_kind.as_str() {
        "file" => {
            let is_bin = n.meta.get("copyBinary")
                .and_then(|v| v.as_bool()).unwrap_or(false);
            let content = n.content.first().cloned().unwrap_or_default();
            let full_path = n.full_path.clone();
            let fh = b.fh.as_mut().unwrap();
            if is_bin {
                fh.save_binary(&full_path, content.as_bytes(), "CopyOp:after")?;
            } else {
                fh.save(&full_path, content.as_bytes(), "CopyOp:after")?;
            }
        }
        "copy" => copy_walk(n, st, b)?,
        _ => {}
    }
    Ok(())
}

fn copy_walk(n: &mut Node, st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    let from = n.from.clone();
    let parent = b.current.folder.parent.clone();
    let dir = b.current.folder.path.join("/");
    let to = if dir.is_empty() {
        parent.clone()
    } else {
        format!("{}/{}", parent, dir)
    };
    let to = if n.name.is_empty() { to } else { format!("{}/{}", to, n.name) };
    walk_copy_depth(b, st, &from, &to, n, 0, &mut std::collections::HashSet::new(), "")
}

const MAX_COPY_DEPTH: usize = 64;

static COPY_DLOG: std::sync::OnceLock<DLog> = std::sync::OnceLock::new();
fn copy_dlog() -> &'static DLog {
    COPY_DLOG.get_or_init(|| DLog::new("jostraca", "build.rs"))
}

fn walk_copy_depth(
    b: &mut BuildCtx,
    st: &mut JState,
    from: &str,
    to: &str,
    n: &Node,
    depth: usize,
    visited: &mut std::collections::HashSet<String>,
    rel: &str,
) -> Result<(), String> {
    if depth > MAX_COPY_DEPTH {
        return Err(format!(
            "Copy: tree too deep (>{}), possible symlink cycle, path={}", MAX_COPY_DEPTH, from));
    }
    let real = from.to_string(); // simplified; no realpath resolution for MemFS
    if visited.contains(&real) {
        copy_dlog().log(&["copy", "symlink cycle, not descending: ", from]);
        return Ok(());
    }
    visited.insert(real.clone());

    let fh = b.fh.as_mut().unwrap();
    let entries = fh.fs.read_dir(from)?;
    let exclude_val = n.exclude.clone();
    let ignore_res: Vec<regex::Regex> = st.opts.cmp.copy.ignore.clone();

    for entry in entries {
        let src = format!("{}/{}", from, entry.name);
        let dst = format!("{}/{}", to, entry.name);
        let entry_rel = if rel.is_empty() {
            entry.name.clone()
        } else {
            format!("{}/{}", rel, entry.name)
        };
        if should_ignore_copy_path(&entry.name, &entry_rel, &exclude_val, &ignore_res) {
            continue;
        }
        // Check if it's a directory (follow symlinks via stat).
        let is_dir = if entry.is_dir { true } else {
            b.fh.as_ref().unwrap().fs.stat(&src).map(|fi| fi.is_dir).unwrap_or(false)
        };
        if is_dir {
            walk_copy_depth(b, st, &src, &dst, n, depth + 1, visited, &entry_rel)?;
            continue;
        }
        let fh = b.fh.as_mut().unwrap();
        let body = fh.fs.read_file(&src)?;
        let is_bin = is_bin_ext(&src) || is_bin_content(&body);
        let content_bytes = if !is_bin {
            let model_json = model_to_json(st);
            let replace = node_replace_to_rv(&n.replace);
            let rendered = template(
                std::str::from_utf8(&body).unwrap_or(""),
                &model_json,
                Some(TemplateSpec { replace, ..Default::default() }),
            )?;
            rendered.into_bytes()
        } else { body };
        let fh = b.fh.as_mut().unwrap();
        if is_bin {
            fh.save_binary(&dst, &content_bytes, "CopyOp:walk")?;
        } else {
            fh.save(&dst, &content_bytes, "CopyOp:walk")?;
        }
    }
    visited.remove(&real);
    Ok(())
}

use regex::Regex;

static DEFAULT_COPY_IGNORE_RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
fn default_copy_ignore_re() -> &'static Regex {
    DEFAULT_COPY_IGNORE_RE.get_or_init(|| {
        Regex::new(r"(~|-jostraca-off)$").unwrap()
    })
}

fn should_ignore_copy_path(
    name: &str,
    rel: &str,
    exclude: &Option<serde_json::Value>,
    ignores: &[Regex],
) -> bool {
    if default_copy_ignore_re().is_match(name) { return true; }
    for re in ignores {
        if re.is_match(name) { return true; }
    }
    let rel = if rel.is_empty() { name } else { rel };
    match exclude {
        None => false,
        Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(_)) => false,
        Some(serde_json::Value::String(s)) => s == rel,
        Some(serde_json::Value::Array(arr)) => {
            arr.iter().any(|v| match v {
                serde_json::Value::String(s) => s == rel,
                _ => false,
            })
        }
        _ => false,
    }
}

static INJECT_DLOG: std::sync::OnceLock<DLog> = std::sync::OnceLock::new();
fn inject_dlog() -> &'static DLog {
    INJECT_DLOG.get_or_init(|| DLog::new("jostraca", "build.rs"))
}

fn inject_before(n: &mut Node, _st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    valid_name(&n.name, "Inject")?;
    let parent = b.current.folder.parent.clone();
    let dir = b.current.folder.path.join("/");
    n.full_path = if dir.is_empty() {
        format!("{}/{}", parent, n.name)
    } else {
        format!("{}/{}/{}", parent, dir, n.name)
    };
    n.full_path = fwd(&n.full_path);
    b.current.file = Some(n as *mut Node);
    Ok(())
}

fn inject_after(n: &mut Node, _st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    let fh = match b.fh { Some(ref mut fh) => fh, None => return Ok(()) };
    if inject_excluded(&n.name, &n.exclude) { return Ok(()); }

    let mut sb = String::new();
    for c in &n.children {
        if c.kind == Kind::Content {
            for s in &c.content { sb.push_str(s); }
        }
    }
    let body = sb;

    if !fh.fs.exists(&n.full_path) {
        return Err(format!("{}: path={} (Inject rewrites an existing file; use File to create one)",
            ERR_INJECT_TARGET_MISSING, n.full_path));
    }
    let src_bytes = fh.fs.read_file(&n.full_path)?;
    let s = String::from_utf8_lossy(&src_bytes).into_owned();

    let start_m = &n.markers[0];
    let end_m   = &n.markers[1];

    let mut out = String::with_capacity(s.len() + body.len());
    let mut pos = 0usize;
    let mut matched = false;
    loop {
        let si = match s[pos..].find(start_m.as_str()) {
            Some(i) => i + pos,
            None => break,
        };
        let after = si + start_m.len();
        let ei = match s[after..].find(end_m.as_str()) {
            Some(i) => i + after,
            None => break,
        };
        out.push_str(&s[pos..after]);
        out.push_str(&body);
        let prev = pos;
        pos = ei;
        matched = true;
        if pos == prev {
            if pos >= s.len() { break; }
            // advance by one UTF-8 character
            let ch = s[pos..].chars().next().unwrap_or('\0');
            out.push_str(&s[pos..pos + ch.len_utf8()]);
            pos += ch.len_utf8();
        }
    }
    if !matched {
        inject_dlog().log(&["inject", "markers not found, nothing injected: path=", &n.full_path]);
        let full_path = n.full_path.clone();
        return fh.save(&full_path, &src_bytes, "InjectOp:after");
    }
    out.push_str(&s[pos..]);
    let full_path = n.full_path.clone();
    fh.save(&full_path, out.as_bytes(), "InjectOp:after")
}

fn inject_excluded(name: &str, exclude: &Option<serde_json::Value>) -> bool {
    match exclude {
        None => false,
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::String(s)) => s == name,
        Some(serde_json::Value::Array(arr)) => {
            arr.iter().any(|v| match v {
                serde_json::Value::String(s) => s == name,
                _ => false,
            })
        }
        _ => false,
    }
}

fn fragment_before(n: &mut Node, _st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    let file_ptr = b.current.file;
    n.meta.insert("parentFile".to_string(), crate::node::MetaVal::Bool(file_ptr.is_some()));
    Ok(())
}

fn fragment_after(n: &mut Node, st: &mut JState, b: &mut BuildCtx) -> Result<(), String> {
    if b.fh.is_none() { return Ok(()); }

    let from = n.from.clone();
    let src_bytes = b.fh.as_mut().unwrap().fs.read_file(&from)?;
    let src = String::from_utf8_lossy(&src_bytes).into_owned();

    let slot_names: Vec<String> = n.meta.get("slotNames")
        .and_then(|v| v.as_strs())
        .map(|s| s.to_vec())
        .unwrap_or_default();

    // Build replace map: one entry per named slot + default <[SLOT]>.
    let mut replace: HashMap<String, ReplaceValue> = HashMap::new();

    // Named slots.
    for name in &slot_names {
        let name = name.clone();
        let key = format!(
            "/[ \\t]*[-<!/#*]*[ \\t]*<\\[SLOT:{}\\]>[ \\t]*[->/#*]*[ \\t]*/",
            esc_re(&name)
        );
        // We can't capture `n` (partial move), so we collect children into a
        // Slot-filtered text eagerly at define time via the stored body callback.
        // Since Rust closures can't reference `n` at call time (we're inside the
        // after-hook), we produce the text now from n.children.
        let slot_text = collect_slot_children(n, st, b, Some(&name));
        replace.insert(key, ReplaceValue::Str(slot_text));
    }

    // Default <[SLOT]> — non-Slot children.
    let default_text = collect_slot_children(n, st, b, None);
    let has_default_slot_in_src = src.contains("<[SLOT]>");
    replace.insert(
        "/[ \\t]*[-<!/#*]*[ \\t]*<\\[SLOT\\]>[ \\t]*[->/#*]*[ \\t]*/".to_string(),
        ReplaceValue::Str(default_text.clone()),
    );

    let model_json = model_to_json(st);
    let rendered = template(&src, &model_json, Some(TemplateSpec { replace, ..Default::default() }))?;

    if let Some(ref e) = b.replay_err {
        let e = e.clone();
        b.replay_err = None;
        return Err(e);
    }

    // Non-Slot children of a Fragment need an unnamed <[SLOT]> to land.
    // Count non-slot direct children.
    let non_slot_count = n.children.iter().filter(|c| c.kind != Kind::Slot).count();
    if non_slot_count > 0 && !has_default_slot_in_src {
        return Err(format!(
            "jostraca fragment: Fragment has non-Slot children, but {} contains no unnamed \
             <[SLOT]> marker to receive them; their output would be silently discarded. \
             Add an unnamed <[SLOT]> marker to the fragment source, or wrap the children in a named Slot.",
            from));
    }

    let rendered = if let Some(ref ind) = n.indent {
        indent_fn(&rendered, ind)
    } else {
        rendered
    };

    n.content = vec![rendered];
    Ok(())
}

/// Collects content from Fragment's children that match the slot filter.
/// `slot_name = Some(name)` → collect Slot children with that name.
/// `slot_name = None` → collect non-Slot children (the default slot).
fn collect_slot_children(
    n: &Node,
    _st: &mut JState,
    _b: &mut BuildCtx,
    slot_name: Option<&str>,
) -> String {
    let mut sb = String::new();
    for c in &n.children {
        match slot_name {
            Some(sn) => {
                if c.kind == Kind::Slot && c.name == sn {
                    for s in &c.content { sb.push_str(s); }
                    // Also collect content children of the slot.
                    for gc in &c.children {
                        for s in &gc.content { sb.push_str(s); }
                    }
                }
            }
            None => {
                if c.kind != Kind::Slot {
                    for s in &c.content { sb.push_str(s); }
                    for gc in &c.children {
                        for s in &gc.content { sb.push_str(s); }
                    }
                }
            }
        }
    }
    sb
}

fn slot_before(_n: &mut Node, _st: &mut JState, _b: &mut BuildCtx) -> Result<(), String> { Ok(()) }
fn slot_after (_n: &mut Node, _st: &mut JState, _b: &mut BuildCtx) -> Result<(), String> { Ok(()) }

// ─── Path / name helpers ──────────────────────────────────────────────────────

/// Rejects names containing `..` segments. Mirrors Go `validName`.
fn valid_name(name: &str, kind: &str) -> Result<(), String> {
    if name.is_empty() { return Ok(()); }
    for seg in name.split(|c| c == '/' || c == '\\') {
        if seg == ".." {
            return Err(format!("{}: {} name={}", ERR_NAME_TRAVERSAL, kind, name));
        }
    }
    Ok(())
}

// ─── Model helper ─────────────────────────────────────────────────────────────

fn model_to_json(st: &JState) -> serde_json::Value {
    match &st.model {
        Some(m) => serde_json::to_value(m).unwrap_or(serde_json::Value::Null),
        None => serde_json::Value::Null,
    }
}

/// Converts `Node.replace` (HashMap<String, serde_json::Value>) to a
/// `HashMap<String, ReplaceValue>` for use in TemplateSpec.
fn node_replace_to_rv(
    replace: &HashMap<String, serde_json::Value>,
) -> HashMap<String, ReplaceValue> {
    let mut out = HashMap::new();
    let mut keys: Vec<&String> = replace.keys().collect();
    keys.sort();
    for k in keys {
        let v = replace[k].clone();
        out.insert(k.clone(), ReplaceValue::Json(v));
    }
    out
}

// ─── Builder (*J) methods ─────────────────────────────────────────────────────
//
// These mirror Go builder.go.  Each method borrows `&mut self` (the current J
// frame) and drives the define phase by attaching nodes to `self.cur`.

use crate::jostraca::J;

impl J {
    // ── Project ──────────────────────────────────────────────────────────────

    pub fn project(&mut self, name: &str, folder: &str, body: impl FnOnce(&mut J)) {
        if self.is_err() { return; }
        let path = if folder.is_empty() { vec![] } else { vec![folder.to_string()] };
        let mut n = Node::new(Kind::Project);
        n.name   = name.to_string();
        n.folder = folder.to_string();
        n.path   = path;
        self.attach_and_descend(n, body);
    }

    // ── Folder ───────────────────────────────────────────────────────────────

    pub fn folder(&mut self, name: &str, body: impl FnOnce(&mut J)) {
        if self.is_err() { return; }
        let path = child_path_of(self, name);
        let mut n = Node::new(Kind::Folder);
        n.name = name.to_string();
        n.path = path;
        self.attach_and_descend(n, body);
    }

    // ── File ─────────────────────────────────────────────────────────────────

    pub fn file(&mut self, name: &str, body: impl FnOnce(&mut J)) {
        if self.is_err() { return; }
        let path = child_path_of(self, name);
        let mut n = Node::new(Kind::File);
        n.name = name.to_string();
        n.path = path;
        self.attach_and_descend(n, body);
    }

    pub fn file_mode(&mut self, name: &str, mode: u32, body: impl FnOnce(&mut J)) {
        if self.is_err() { return; }
        let path = child_path_of(self, name);
        let mut n = Node::new(Kind::File);
        n.name = name.to_string();
        n.path = path;
        n.mode = mode;
        self.attach_and_descend(n, body);
    }

    pub fn file_exclude(&mut self, name: &str, exclude: serde_json::Value, body: impl FnOnce(&mut J)) {
        if self.is_err() { return; }
        let path = child_path_of(self, name);
        let mut n = Node::new(Kind::File);
        n.name    = name.to_string();
        n.path    = path;
        n.exclude = Some(exclude);
        self.attach_and_descend(n, body);
    }

    // ── Content ───────────────────────────────────────────────────────────────

    /// Emits a string of text (with template applied). Mirrors Go `(*J).Content`.
    pub fn content(&mut self, src: &str) {
        if self.is_err() { return; }
        let model_json = self.model_json();
        let rendered = match template(src, &model_json, None) {
            Ok(r) => r,
            Err(e) => { self.set_err(e); return; }
        };
        let path = child_path_of(self, "");
        let mut n = Node::new(Kind::Content);
        n.path    = path;
        n.content = vec![rendered];
        self.attach_leaf(n);
    }

    /// Like `content` but with a trailing newline. Mirrors Go `(*J).Line`.
    pub fn line(&mut self, src: &str) {
        let s = if src.is_empty() || src.ends_with('\n') {
            src.to_string()
        } else {
            format!("{}\n", src)
        };
        self.content(&s);
    }

    // ── Slot ──────────────────────────────────────────────────────────────────

    pub fn slot(&mut self, name: &str, body: impl FnOnce(&mut J)) {
        if self.is_err() { return; }
        // If the parent has a filter set, honour it.
        if let Some(cur) = self.cur_node() {
            if let Some(ref f) = cur.filter {
                if !f("slot", name) { return; }
            }
        }
        let path = child_path_of(self, name);
        let mut n = Node::new(Kind::Slot);
        n.name = name.to_string();
        n.path = path;
        self.attach_and_descend(n, body);
    }

    // ── Inject ────────────────────────────────────────────────────────────────

    pub fn inject(&mut self, name: &str, body: impl FnOnce(&mut J)) {
        self.inject_markers(name, "#--START--#\n", "\n#--END--#", body);
    }

    pub fn inject_markers(
        &mut self,
        name: &str,
        start: &str,
        end: &str,
        body: impl FnOnce(&mut J),
    ) {
        if self.is_err() { return; }
        if start.is_empty() || end.is_empty() {
            self.set_err(format!(
                "Inject: both markers must be non-empty, got {:?}", [start, end]));
            return;
        }
        let path = child_path_of(self, name);
        let mut n = Node::new(Kind::Inject);
        n.name    = name.to_string();
        n.markers = [start.to_string(), end.to_string()];
        n.path    = path;
        self.attach_and_descend(n, body);
    }

    // ── Fragment ──────────────────────────────────────────────────────────────

    pub fn fragment(
        &mut self,
        from: &str,
        indent: Option<serde_json::Value>,
        replace: HashMap<String, serde_json::Value>,
        body: Option<impl FnOnce(&mut J)>,
    ) {
        if self.is_err() { return; }
        if from.is_empty() {
            self.set_err("Fragment: From is required".to_string());
            return;
        }
        // Resolve relative From against folder.
        let from = resolve_fragment_from(self.st_ref().folder.as_str(), from);
        if let Some(fs) = self.fs() {
            if !fs.exists(&from) {
                self.set_err(format!("Fragment: From file does not exist: {}", from));
                return;
            }
        }

        let path = child_path_of(self, "");
        let mut n = Node::new(Kind::Fragment);
        n.from    = from.clone();
        n.indent  = indent;
        n.replace = replace;
        n.path    = path;

        // Eagerly walk with slot-name-collecting filter to discover named slots.
        // Slot names are discovered during fragment_after by scanning n.children.
        if let Some(body_fn) = body {
            n.filter = None;
            self.attach_and_descend(n, body_fn);
            return;
        }
        self.attach_leaf(n);
    }

    // ── Copy ──────────────────────────────────────────────────────────────────

    pub fn copy(
        &mut self,
        from: &str,
        to: &str,
        replace: HashMap<String, serde_json::Value>,
        exclude: Option<serde_json::Value>,
    ) {
        if self.is_err() { return; }
        if from.is_empty() {
            self.set_err("Copy: From is required".to_string());
            return;
        }
        if let Some(fs) = self.fs() {
            if !fs.exists(from) {
                self.set_err(format!("Copy: From does not exist: {}", from));
                return;
            }
        }
        let path = child_path_of(self, to);
        let mut n = Node::new(Kind::Copy);
        n.from    = from.to_string();
        n.name    = to.to_string();
        n.replace = replace;
        n.exclude = exclude;
        n.path    = path;
        self.attach_leaf(n);
    }

    // ── List ──────────────────────────────────────────────────────────────────

    pub fn list(
        &mut self,
        items: &serde_json::Value,
        body: impl Fn(&mut J, serde_json::Value),
    ) {
        self.list_noline(items, false, &body);
    }

    pub fn list_noline(
        &mut self,
        items: &serde_json::Value,
        no_line: bool,
        body: &impl Fn(&mut J, serde_json::Value),
    ) {
        if self.is_err() { return; }
        for item in crate::util::each(items, crate::util::EachSpec { raw: true, ..Default::default() }, None) {
            body(self, item);
        }
        if !no_line { self.line(""); }
    }

    // ── Cmp ───────────────────────────────────────────────────────────────────

    /// Runs `fn` under the current frame without allocating a new node.
    pub fn cmp(&mut self, name: &str, f: impl FnOnce(&mut J)) {
        if self.is_err() { return; }
        let _ = name;
        f(self);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Appends `n` to the current parent, sets root on first call, then
    /// descends with a child J bound to `n`. Mirrors Go `attachAndDescend`.
    fn attach_and_descend(&mut self, n: Box<Node>, body: impl FnOnce(&mut J)) {
        let n_ptr = self.attach_node(n);
        let st = self.st;
        let mut child_j = J { st, cur: Some(n_ptr) };
        body(&mut child_j);
        // Propagate any error back to the parent state.
        // (st is a shared raw pointer so the error is already there.)
    }

    /// Appends a leaf node (no body). Used by Content, Copy, etc.
    fn attach_leaf(&mut self, n: Box<Node>) {
        self.attach_node(n);
    }

    /// Appends `n` to `self.cur.children` and returns a raw pointer to it.
    fn attach_node(&mut self, n: Box<Node>) -> *mut Node {
        if let Some(cur_ptr) = self.cur {
            let cur = unsafe { &mut *cur_ptr };
            cur.children.push(n);
            let last = cur.children.last_mut().unwrap();
            &mut **last as *mut Node
        } else {
            // No parent — this is the first top-level node. Leak it into a raw
            // pointer so it lives for the duration of the generate call.
            // The Box is reclaimed when root_node is dropped in generate().
            let leaked = Box::into_raw(n);
            let st = unsafe { &mut *self.st };
            if st.root.is_none() { st.root = Some(leaked); }
            leaked
        }
    }
}

// ─── Fragment helpers ─────────────────────────────────────────────────────────

/// Resolves a relative Fragment From against the output folder.
/// Mirrors Go `resolveFragmentFrom`.
fn resolve_fragment_from(folder: &str, from: &str) -> String {
    if from.is_empty() || is_abs_from_path(from) { return from.to_string(); }
    let folder = if folder.is_empty() { "." } else { folder };
    path_clean(&fwd(&format!("{}/{}", folder, from)))
}

// ─── child_path helper ────────────────────────────────────────────────────────

fn child_path_of(j: &J, name: &str) -> Vec<String> {
    if let Some(cur_ptr) = j.cur {
        let cur = unsafe { &*cur_ptr };
        child_path(cur, name)
    } else {
        if name.is_empty() { vec![] } else { vec![name.to_string()] }
    }
}
