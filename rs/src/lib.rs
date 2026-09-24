pub mod util;
pub mod diff;
pub mod template;
pub mod getx;
pub mod errors;
pub mod log;
pub mod dlog;
pub mod node;
pub mod options;
pub mod fs;
pub mod buildmeta;
pub mod buildctx;
pub mod filehandler;
pub mod build;
pub mod jostraca;

// Re-export the primary public surface.
pub use jostraca::{J, New, GenerateResult, Files, Audit, AuditEntry};
pub use options::{Options, Existing, ExistingTxt, ExistingBin, Control, CmpOptions,
                  CopyCmpOptions, NameOptions, NameAffix};
pub use node::{Node, Kind};
pub use errors::{JostracaError, NodeError};
pub use fs::{FS, MemFS, OsFS, FileInfo, DirEntry};
pub use diff::{lines, lcs, Merge, Diff, MergeResult, DiffResult, DiffSpec, MergeOutcome,
               DiffOutcome, HasConflicts};
