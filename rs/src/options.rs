// options.rs — Options and all sub-structs; ported from go/options.go

use std::collections::HashMap;
use regex::Regex;

/// Full per-call and global configuration. Mirrors Go `Options`.
#[derive(Default)]
pub struct Options {
    pub folder:   String,
    pub meta:     Option<HashMap<String, serde_json::Value>>,
    pub fs:       Option<Box<dyn crate::fs::FS>>,
    pub now:      Option<Box<dyn Fn() -> i64 + Send + Sync>>,
    pub log:      Option<Box<dyn crate::log::Log>>,
    pub debug:    String,
    pub existing: Existing,
    pub model:    Option<HashMap<String, serde_json::Value>>,
    pub build:    Option<bool>,
    pub mem:      bool,
    pub vol:      Option<HashMap<String, Vec<u8>>>,
    pub cmp:      CmpOptions,
    pub control:  Control,
    pub name:     NameOptions,
    pub exclude:  bool,
}

#[derive(Default, Clone)]
pub struct Existing {
    pub txt: ExistingTxt,
    pub bin: ExistingBin,
}

#[derive(Default, Clone)]
pub struct ExistingTxt {
    pub write:    Option<bool>,
    pub preserve: Option<bool>,
    pub present:  Option<bool>,
    pub diff:     Option<bool>,
    pub merge:    Option<bool>,
}

#[derive(Default, Clone)]
pub struct ExistingBin {
    pub write:    Option<bool>,
    pub preserve: Option<bool>,
    pub present:  Option<bool>,
}

/// Build-time toggles. `no_duplicate` inverts TS `duplicate` so Rust's
/// zero-default matches TS default (duplicate=true).
#[derive(Default, Clone)]
pub struct Control {
    pub dryrun:       bool,
    pub no_duplicate: bool,
    pub version:      bool,
}

impl Control {
    pub fn duplicate(&self) -> bool { !self.no_duplicate }
}

#[derive(Default)]
pub struct CmpOptions {
    pub copy: CopyCmpOptions,
}

#[derive(Default)]
pub struct CopyCmpOptions {
    pub ignore: Vec<Regex>,
}

#[derive(Default, Clone)]
pub struct NameOptions {
    pub file:    NameAffix,
    pub folder:  NameAffix,
    pub exclude: Vec<NameMatcher>,
}

#[derive(Default, Clone)]
pub struct NameAffix {
    pub prefix: String,
    pub suffix: String,
}

#[derive(Clone)]
pub struct NameMatcher {
    pub literal: String,
    pub re:      Option<Regex>,
}
