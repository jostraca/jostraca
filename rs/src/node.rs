// node.rs — Node, Kind, FilterFunc, AfterRef; ported from go/node.go

/// Identifies the role a Node plays during the build phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Kind {
    None     = 0,
    Project  = 1,
    Folder   = 2,
    File     = 3,
    Content  = 4,
    Copy     = 5,
    Inject   = 6,
    Fragment = 7,
    Slot     = 8,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::None     => "none",
            Kind::Project  => "project",
            Kind::Folder   => "folder",
            Kind::File     => "file",
            Kind::Content  => "content",
            Kind::Copy     => "copy",
            Kind::Inject   => "inject",
            Kind::Fragment => "fragment",
            Kind::Slot     => "slot",
        }
    }
}

/// FilterFunc decides which Slot children a Fragment replays.
pub type FilterFunc = Box<dyn Fn(&str, &str) -> bool + Send + Sync>;

/// Post-walk action marker used by CopyOp.
#[derive(Debug, Clone)]
pub struct AfterRef {
    pub kind: String,
}

/// The build-tree node assembled during the define phase.
/// Mirrors Go `Node` / TS `Node`.
pub struct Node {
    pub kind:      Kind,
    pub name:      String,
    pub path:      Vec<String>,
    pub full_path: String,
    pub folder:    String,
    pub from:      String,
    pub indent:    Option<serde_json::Value>,
    pub exclude:   Option<serde_json::Value>,
    pub mode:      u32, // POSIX permission bits; 0 = unset
    pub replace:   std::collections::HashMap<String, serde_json::Value>,
    pub markers:   [String; 2],
    pub filter:    Option<FilterFunc>,
    pub children:  Vec<Box<Node>>,
    pub content:   Vec<String>,
    pub meta:      std::collections::HashMap<String, MetaVal>,
    pub after:     Option<AfterRef>,
}

/// Values stored in `Node.meta`. Encompasses all types the build pipeline
/// stores there without resorting to `Any`.
#[derive(Debug, Clone)]
pub enum MetaVal {
    Str(String),
    Bool(bool),
    Strs(Vec<String>),
}

impl MetaVal {
    pub fn as_str(&self) -> Option<&str> {
        if let MetaVal::Str(s) = self { Some(s) } else { None }
    }
    pub fn as_strs(&self) -> Option<&[String]> {
        if let MetaVal::Strs(v) = self { Some(v) } else { None }
    }
    pub fn as_bool(&self) -> Option<bool> {
        if let MetaVal::Bool(b) = self { Some(*b) } else { None }
    }
}

impl Node {
    pub fn new(kind: Kind) -> Box<Self> {
        Box::new(Node {
            kind,
            name: String::new(),
            path: vec![],
            full_path: String::new(),
            folder: String::new(),
            from: String::new(),
            indent: None,
            exclude: None,
            mode: 0,
            replace: Default::default(),
            markers: [String::new(), String::new()],
            filter: None,
            children: vec![],
            content: vec![],
            meta: Default::default(),
            after: None,
        })
    }
}

/// Builds a child path: parent.path + name (if non-empty).
pub fn child_path(parent: &Node, name: &str) -> Vec<String> {
    let mut p = parent.path.clone();
    if !name.is_empty() {
        p.push(name.to_string());
    }
    p
}
