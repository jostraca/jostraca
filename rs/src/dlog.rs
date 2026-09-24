// dlog.rs — package-level debug log, ported from go/dlog.go

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const DLOG_MAX: usize = 1000;

#[derive(Debug, Clone)]
pub struct DLogEntry {
    pub tag: String,
    pub file: String,
    pub when: i64,
    pub args: Vec<String>,
}

static DLOG: Mutex<Vec<DLogEntry>> = Mutex::new(Vec::new());

/// Tagged debug logger. Mirrors Go `DLog`.
pub struct DLog {
    tag: &'static str,
    file: &'static str,
}

impl DLog {
    pub const fn new(tag: &'static str, file: &'static str) -> Self {
        DLog { tag, file }
    }

    pub fn log(&self, args: &[&str]) {
        let when = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let mut g = DLOG.lock().unwrap_or_else(|e| e.into_inner());
        if g.len() >= DLOG_MAX {
            let keep = g.len() - DLOG_MAX + 1;
            *g = g.split_off(keep);
        }
        g.push(DLogEntry {
            tag: self.tag.to_string(),
            file: self.file.to_string(),
            when,
            args: args.iter().map(|s| s.to_string()).collect(),
        });
    }
}

pub fn dlog_snapshot(clear: bool) -> Vec<DLogEntry> {
    let mut g = DLOG.lock().unwrap_or_else(|e| e.into_inner());
    let out = g.clone();
    if clear { g.clear(); }
    out
}

#[cfg(test)]
pub fn dlog_reset() {
    let mut g = DLOG.lock().unwrap_or_else(|e| e.into_inner());
    g.clear();
}
