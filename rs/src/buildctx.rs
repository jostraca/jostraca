// buildctx.rs — per-Generate-call build state. Ported from go/buildctx.go.

use crate::jostraca::JState;
use crate::node::Node;

/// Per-generate build state.
pub struct BuildCtx {
    pub st:         *mut JState,
    pub when:       i64,
    pub current:    CurrentRefs,
    pub logx:       BuildLog,
    pub fh:         Option<Box<crate::filehandler::FileHandler>>,

    /// Carries the first error raised inside a replayed subtree (see build.rs).
    pub replay_err: Option<String>,
}

// SAFETY: BuildCtx is only used on a single thread per Generate call.
unsafe impl Send for BuildCtx {}
unsafe impl Sync for BuildCtx {}

impl BuildCtx {
    pub fn st(&self) -> &JState { unsafe { &*self.st } }
    pub fn st_mut(&mut self) -> &mut JState { unsafe { &mut *self.st } }
}

#[derive(Default)]
pub struct CurrentRefs {
    pub project: Option<*mut Node>,
    pub folder:  FolderRef,
    pub file:    Option<*mut Node>,
}

// SAFETY: BuildCtx is only used on a single thread per Generate call.
unsafe impl Send for CurrentRefs {}
unsafe impl Sync for CurrentRefs {}

#[derive(Default, Clone)]
pub struct FolderRef {
    pub node:   Option<*mut Node>,
    pub path:   Vec<String>,
    pub parent: String,
}

unsafe impl Send for FolderRef {}
unsafe impl Sync for FolderRef {}

#[derive(Default)]
pub struct BuildLog {
    pub exclude: Vec<String>,
    pub last:    i64,
}

pub fn new_build_ctx(st: *mut JState) -> BuildCtx {
    let folder = {
        let st_ref = unsafe { &*st };
        if st_ref.folder.is_empty() { ".".to_string() } else { st_ref.folder.clone() }
    };
    let when = {
        let st_ref = unsafe { &*st };
        (st_ref.now)()
    };
    BuildCtx {
        st,
        when,
        current: CurrentRefs {
            folder: FolderRef { path: vec![], parent: folder, ..Default::default() },
            ..Default::default()
        },
        logx:       BuildLog::default(),
        fh:         None,
        replay_err: None,
    }
}
