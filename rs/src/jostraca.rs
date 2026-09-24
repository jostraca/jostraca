// jostraca.rs — J builder, JState, Generate entry point.
// Ported from go/jostraca.go.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::fs::FS;
use crate::log::{Log, NopLog};
use crate::node::{Kind, Node};
use crate::options::{Control, Existing, Options};

pub const VERSION: &str = "0.33.1";

// ─── Public surface types ──────────────────────────────────────────────────────

/// Per-call result. Mirrors Go `Result`.
pub struct GenerateResult {
    pub when:  i64,
    pub files: Files,
    pub audit: Audit,
    pub vol:   Option<HashMap<String, Vec<u8>>>,
}

/// Groups output paths by category. Mirrors Go `Files`.
#[derive(Default, Clone, Debug)]
pub struct Files {
    pub preserved:  Vec<String>,
    pub written:    Vec<String>,
    pub presented:  Vec<String>,
    pub diffed:     Vec<String>,
    pub merged:     Vec<String>,
    pub conflicted: Vec<String>,
    pub unchanged:  Vec<String>,
}

/// An ordered list of build-phase actions. Mirrors Go `Audit`.
pub type Audit = Vec<AuditEntry>;

#[derive(Clone, Debug)]
pub struct AuditEntry {
    pub tag:  String,
    pub data: HashMap<String, serde_json::Value>,
}

// ─── JState ───────────────────────────────────────────────────────────────────

/// Per-Generate-call shared state. Mirrors Go `jstate`.
pub struct JState {
    pub opts:   Options,
    pub fs:     Option<Box<dyn FS>>,
    pub now:    Box<dyn Fn() -> i64 + Send + Sync>,
    pub folder: String,
    pub model:  Option<HashMap<String, serde_json::Value>>,
    pub log:    Box<dyn Log>,
    pub meta:   Option<HashMap<String, serde_json::Value>>,
    pub debug:  String,

    pub root:   Option<*mut Node>,
    pub err:    Option<String>,
}

// SAFETY: JState is only accessed on one thread per Generate call.
unsafe impl Send for JState {}
unsafe impl Sync for JState {}

fn default_now() -> Box<dyn Fn() -> i64 + Send + Sync> {
    Box::new(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    })
}

pub fn new_jstate_from_options(mut o: Options) -> JState {
    let now: Box<dyn Fn() -> i64 + Send + Sync> =
        o.now.take().map(|f| -> Box<dyn Fn() -> i64 + Send + Sync> { f })
            .unwrap_or_else(default_now);
    let log: Box<dyn Log> =
        o.log.take().map(|l| -> Box<dyn Log> { l })
            .unwrap_or_else(|| Box::new(NopLog));
    let folder = if o.folder.is_empty() { ".".to_string() } else { o.folder.clone() };
    let fs_opt = o.fs.take();
    JState {
        now,
        log,
        folder,
        model: o.model.clone(),
        meta:  o.meta.clone(),
        debug: o.debug.clone(),
        fs: fs_opt,
        root: None,
        err:  None,
        opts: o,
    }
}

// ─── J builder ────────────────────────────────────────────────────────────────

/// The receiver-shadowing builder. Mirrors Go `J`.
pub struct J {
    pub st:  *mut JState,
    pub cur: Option<*mut Node>,
}

// SAFETY: J is only created and used on one thread.
unsafe impl Send for J {}
unsafe impl Sync for J {}

impl J {
    pub fn st_ref(&self) -> &JState  { unsafe { &*self.st } }
    pub fn st_mut(&mut self) -> &mut JState { unsafe { &mut *self.st } }

    pub fn is_err(&self) -> bool { self.st_ref().err.is_some() }

    pub fn set_err(&mut self, e: String) { self.st_mut().err = Some(e); }

    pub fn cur_node(&self) -> Option<&Node> {
        self.cur.map(|p| unsafe { &*p })
    }

    pub fn cur_node_mut(&mut self) -> Option<&mut Node> {
        self.cur.map(|p| unsafe { &mut *p })
    }

    pub fn model(&self) -> Option<&HashMap<String, serde_json::Value>> {
        self.st_ref().model.as_ref()
    }

    pub fn model_json(&self) -> serde_json::Value {
        match &self.st_ref().model {
            Some(m) => serde_json::to_value(m).unwrap_or(serde_json::Value::Null),
            None => serde_json::Value::Null,
        }
    }

    pub fn fs(&self) -> Option<&dyn FS> {
        self.st_ref().fs.as_deref()
    }

    pub fn get_folder(&self) -> &str { &self.st_ref().folder }
    pub fn debug(&self) -> &str      { &self.st_ref().debug }
}

// ─── Top-level factory ────────────────────────────────────────────────────────

/// Top-level factory. The caller builds a `J` with `New::with_options` and
/// then calls `.generate(opts, root_fn)`. Mirrors Go `New` + `(*J).Generate`.
pub struct New {
    global_opts: Options,
}

impl New {
    pub fn new() -> Self { New { global_opts: Options::default() } }

    pub fn with_options(o: Options) -> Self { New { global_opts: o } }

    /// Runs the define phase then the build phase.
    pub fn generate(
        self,
        opts: Options,
        root_fn: impl FnOnce(&mut J),
    ) -> Result<GenerateResult, String> {
        let merged = merge_options(self.global_opts, opts);
        let mut st = new_jstate_from_options(merged);
        let st_ptr: *mut JState = &mut st;

        // Synthetic top-level root node — all define-phase nodes attach here.
        let mut root_node = Node::new(Kind::None);
        let root_ptr: *mut Node = &mut *root_node;

        {
            let mut j = J { st: st_ptr, cur: Some(root_ptr) };
            root_fn(&mut j);
        }

        if let Some(ref e) = st.err {
            return Err(e.clone());
        }

        // If define phase produced children, make the synthetic node the root.
        if !root_node.children.is_empty() {
            st.root = Some(root_ptr);
        }

        let do_build = st.opts.build.unwrap_or(true);
        let when = (st.now)();

        if !do_build {
            return Ok(GenerateResult {
                when,
                files: Files::default(),
                audit: vec![],
                vol:   None,
            });
        }

        // Build phase.
        let b = crate::build::run_build(&mut st, root_node)?;

        let files = b.as_ref()
            .and_then(|b| b.fh.as_ref().map(|fh| fh.files.clone()))
            .unwrap_or_default();
        let audit = b.as_ref()
            .and_then(|b| b.fh.as_ref().map(|fh| fh.audit.clone()))
            .unwrap_or_default();
        let build_when = b.as_ref().map(|b| b.when).unwrap_or(when);

        // Return MemFS volume snapshot when the FS is MemFS.
        let vol = None; // TODO: expose MemFS::vol in a future pass

        Ok(GenerateResult { when: build_when, files, audit, vol })
    }
}

// ─── Options merge ────────────────────────────────────────────────────────────

/// Right-precedence field merge. Mirrors Go `mergeOptions`.
pub fn merge_options(global: Options, call: Options) -> Options {
    let mut out = global;
    if !call.folder.is_empty() { out.folder = call.folder; }
    if call.meta.is_some()     { out.meta   = call.meta; }
    if call.fs.is_some()       { out.fs     = call.fs; }
    if call.now.is_some()      { out.now    = call.now; }
    if call.log.is_some()      { out.log    = call.log; }
    if !call.debug.is_empty()  { out.debug  = call.debug; }
    if call.model.is_some()    { out.model  = call.model; }
    if call.build.is_some()    { out.build  = call.build; }
    if call.mem                { out.mem    = true; }
    if call.vol.is_some()      { out.vol    = call.vol; }
    // Existing — override if any sub-field is set (use a non-default sentinel).
    if is_existing_set(&call.existing) { out.existing = call.existing; }
    if is_control_set(&call.control)   { out.control  = call.control; }
    if call.exclude                    { out.exclude   = true; }
    out
}

fn is_existing_set(e: &Existing) -> bool {
    e.txt.write.is_some()    || e.txt.preserve.is_some() ||
    e.txt.present.is_some()  || e.txt.diff.is_some()     ||
    e.txt.merge.is_some()    ||
    e.bin.write.is_some()    || e.bin.preserve.is_some() || e.bin.present.is_some()
}

fn is_control_set(c: &Control) -> bool {
    c.dryrun || c.no_duplicate || c.version
}
