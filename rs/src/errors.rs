// errors.rs — sentinel errors and NodeError, ported from go/errors.go

use std::fmt;

/// Sentinel error type. Mirrors the Go `var ErrXxx = errors.New(...)` sentinels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JostracaError(pub &'static str);

impl fmt::Display for JostracaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for JostracaError {}

pub const ERR_MISSING_OP: JostracaError = JostracaError("jostraca: missing op for node kind");
pub const ERR_INVALID_PATH: JostracaError = JostracaError("jostraca: invalid path");
pub const ERR_EMPTY_MATCH_REGEX: JostracaError =
    JostracaError("jostraca: regex matches empty string");
pub const ERR_LOOKBEHIND: JostracaError =
    JostracaError("jostraca: lookbehind not supported (RE2)");
pub const ERR_MERGE_CONFLICT: JostracaError =
    JostracaError("jostraca: 3-way merge produced conflicts");
pub const ERR_NIL_ROOT: JostracaError =
    JostracaError("jostraca: Generate root callback is nil");
pub const ERR_NAME_TRAVERSAL: JostracaError =
    JostracaError(r#"jostraca: name must not contain a ".." path segment"#);
pub const ERR_INJECT_TARGET_MISSING: JostracaError =
    JostracaError("jostraca: inject target does not exist");

/// Wraps any build-phase error with step/path context.
/// Mirrors Go `NodeError`.
#[derive(Debug)]
pub struct NodeError {
    pub step: String,
    pub path: Vec<String>,
    pub callsite: String,
    pub source: Box<dyn std::error::Error + Send + Sync>,
}

impl fmt::Display for NodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "jostraca")?;
        if !self.step.is_empty() {
            write!(f, " {}", self.step)?;
        }
        if !self.path.is_empty() {
            write!(f, " @{}", self.path.join("/"))?;
        }
        write!(f, ": {}", self.source)?;
        if !self.callsite.is_empty() {
            write!(f, "\n  at {}", self.callsite)?;
        }
        Ok(())
    }
}

impl std::error::Error for NodeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.source.as_ref())
    }
}

impl NodeError {
    pub fn new(step: &str, err: impl Into<Box<dyn std::error::Error + Send + Sync>>) -> Self {
        NodeError {
            step: step.to_string(),
            path: vec![],
            callsite: String::new(),
            source: err.into(),
        }
    }
}

/// General error type used throughout the crate.
#[derive(Debug)]
pub enum Error {
    Node(NodeError),
    Msg(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Node(e) => write!(f, "{}", e),
            Error::Msg(s) => write!(f, "{}", s),
        }
    }
}

impl std::error::Error for Error {}

impl From<NodeError> for Error {
    fn from(e: NodeError) -> Self { Error::Node(e) }
}

impl From<String> for Error {
    fn from(s: String) -> Self { Error::Msg(s) }
}

impl From<&str> for Error {
    fn from(s: &str) -> Self { Error::Msg(s.to_string()) }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self { Error::Msg(e.to_string()) }
}

pub type Result<T> = std::result::Result<T, Error>;

pub fn err(msg: impl ToString) -> Error { Error::Msg(msg.to_string()) }
