// diff.rs — line diff, three-way merge, and two-way diff.
// Ported from go/diff.go which mirrors ts/src/diff.ts exactly.

use std::fmt;

// ─── Public types ─────────────────────────────────────────────────────────────

/// Sets conflict-marker labels explicitly, overriding the default formatted ones.
#[derive(Clone, Debug, Default)]
pub struct DiffLabels {
    pub generated: String,
    pub existing: String,
}

/// Configures label formatting for Merge/Diff.
#[derive(Clone, Debug, Default)]
pub struct DiffSpec {
    /// Epoch-ms stamped into the GENERATED label.
    pub when: i64,
    /// Epoch-ms stamped into the EXISTING label.
    pub last: i64,
    /// Label suffix, e.g. "merge" or "diff".
    pub kind: String,
    /// When set, overrides the formatted labels.
    pub labels: Option<DiffLabels>,
}

/// Why a merge produced its output.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MergeOutcome {
    Same,
    Clean,
    Unresolved,
    Merged,
}

impl fmt::Display for MergeOutcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MergeOutcome::Same       => write!(f, "same"),
            MergeOutcome::Clean      => write!(f, "clean"),
            MergeOutcome::Unresolved => write!(f, "unresolved"),
            MergeOutcome::Merged     => write!(f, "merged"),
        }
    }
}

/// The result of [`merge`].
pub struct MergeResult {
    pub content: String,
    pub conflict: bool,
    pub outcome: MergeOutcome,
}

/// Why a diff produced its output.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiffOutcome {
    Same,
    Changed,
}

impl fmt::Display for DiffOutcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DiffOutcome::Same    => write!(f, "same"),
            DiffOutcome::Changed => write!(f, "changed"),
        }
    }
}

/// The result of [`diff`].
pub struct DiffResult {
    pub content: String,
    pub conflict: bool,
    pub outcome: DiffOutcome,
}

// ─── Markers ──────────────────────────────────────────────────────────────────

const MARK_START: &str = "<<<<<<< ";
const MARK_MID:   &str = "=======\n";
const MARK_END:   &str = ">>>>>>> ";

const LABEL_GENERATED: &str = "GENERATED";
const LABEL_EXISTING:  &str = "EXISTING";

/// The canonical unresolved-conflict sentinel: the closing marker for the
/// EXISTING side. A file still holding this has an unresolved merge in it.
const UNRESOLVED_MARK: &str = ">>>>>>> EXISTING:";

/// Reports whether `text` still holds an unresolved conflict from an earlier
/// merge. Mirrors Go `HasConflicts`.
pub fn has_conflicts(text: &str) -> bool {
    has_conflicts_label(text, "")
}

/// `has_conflicts` with an explicitly-supplied custom existing-label taken
/// into account. Mirrors Go `HasConflictsLabel`.
pub fn has_conflicts_label(text: &str, existing_label: &str) -> bool {
    if text.contains(UNRESOLVED_MARK) {
        return true;
    }
    !existing_label.is_empty()
        && text.contains(&format!("{}{}\n", MARK_END, existing_label))
}

// Go exports these as HasConflicts / HasConflictsLabel; keep both spellings.
pub use has_conflicts as HasConflicts;
pub use has_conflicts_label as HasConflictsLabel;

fn iso_of(when: i64) -> String {
    // Format epoch-ms as ISO 8601 UTC: 2006-01-02T15:04:05.000Z
    use std::time::{Duration, UNIX_EPOCH};
    let d = if when >= 0 {
        UNIX_EPOCH + Duration::from_millis(when as u64)
    } else {
        UNIX_EPOCH - Duration::from_millis((-when) as u64)
    };
    let secs = d.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let millis = (when.unsigned_abs() % 1000) as u32;
    // Simple manual UTC formatter — no external deps.
    let (y, mo, dy, hh, mm, ss) = secs_to_ymd_hms(secs);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", y, mo, dy, hh, mm, ss, millis)
}

/// Public re-export for `humanify` in `util.rs`.
pub fn secs_to_ymd_hms_pub(secs: u64) -> (u32, u32, u32, u32, u32, u32) {
    secs_to_ymd_hms(secs)
}

fn secs_to_ymd_hms(secs: u64) -> (u32, u32, u32, u32, u32, u32) {
    let ss = (secs % 60) as u32;
    let mins = secs / 60;
    let mm = (mins % 60) as u32;
    let hours = mins / 60;
    let hh = (hours % 24) as u32;
    let days = hours / 24;
    // Gregorian calendar calculation from day count since 1970-01-01.
    let (y, mo, dy) = days_to_ymd(days);
    (y, mo, dy, hh, mm, ss)
}

fn days_to_ymd(days: u64) -> (u32, u32, u32) {
    // Algorithm: civil date from days since epoch (Fliegel & Van Flandern variant).
    let z = days + 719468;
    let era = z / 146097;
    let doe = z % 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as u32, m as u32, d as u32)
}

fn labels_of(spec: &DiffSpec, default_kind: &str) -> DiffLabels {
    let kind = if spec.kind.is_empty() { default_kind } else { &spec.kind };
    let mut out = DiffLabels {
        generated: format!("{}: {}/{}", LABEL_GENERATED, iso_of(spec.when), kind),
        existing:  format!("{}: {}/{}", LABEL_EXISTING,  iso_of(spec.last), kind),
    };
    if let Some(labels) = &spec.labels {
        if !labels.generated.is_empty() { out.generated = labels.generated.clone(); }
        if !labels.existing.is_empty()  { out.existing  = labels.existing.clone();  }
    }
    out
}

// ─── Line primitives ──────────────────────────────────────────────────────────

/// Splits text on `\n`, keeping the newline attached to each line.
/// An empty input returns an empty vec. Mirrors Go `Lines`.
pub fn lines(text: &str) -> Vec<String> {
    if text.is_empty() {
        return vec![];
    }
    let mut out = Vec::new();
    let mut rest = text;
    loop {
        match rest.find('\n') {
            None => {
                out.push(rest.to_string());
                return out;
            }
            Some(at) => {
                out.push(rest[..at + 1].to_string());
                rest = &rest[at + 1..];
                if rest.is_empty() {
                    return out;
                }
            }
        }
    }
}

/// Returns the Longest Common Subsequence of two string slices.
/// Mirrors Go `LCS` / TS `lcs`.
pub fn lcs(a: &[String], b: &[String]) -> Vec<String> {
    if a.is_empty() || b.is_empty() {
        return vec![];
    }

    // Strip common prefix.
    let mut head = 0;
    while head < a.len() && head < b.len() && a[head] == b[head] {
        head += 1;
    }

    // Strip common suffix of what's left.
    let mut tail = 0;
    while tail < a.len() - head
        && tail < b.len() - head
        && a[a.len() - 1 - tail] == b[b.len() - 1 - tail]
    {
        tail += 1;
    }

    let mut out: Vec<String> = Vec::with_capacity(a.len());
    out.extend_from_slice(&a[..head]);
    hirschberg(&a[head..a.len() - tail], &b[head..b.len() - tail], &mut out);
    out.extend_from_slice(&a[a.len() - tail..]);
    out
}

/// Hirschberg divide-and-conquer over halves of a, using O(|b|) space.
fn hirschberg(a: &[String], b: &[String], out: &mut Vec<String>) {
    if a.is_empty() || b.is_empty() {
        return;
    }
    if a.len() == 1 {
        // Scan backwards (mirrors Go; any match yields the same string).
        for i in (0..b.len()).rev() {
            if b[i] == a[0] {
                out.push(a[0].clone());
                return;
            }
        }
        return;
    }
    let mid = a.len() / 2;
    let head_row = lcs_row(&a[..mid], b, false);
    let tail_row = lcs_row(&a[mid..], b, true);

    // `>=` so a tie takes the LARGEST split — load-bearing tie-break.
    let mut best = -1i64;
    let mut split = 0usize;
    for k in 0..=b.len() {
        let sum = head_row[k] as i64 + tail_row[b.len() - k] as i64;
        if sum >= best {
            best = sum;
            split = k;
        }
    }

    hirschberg(&a[..mid], &b[..split], out);
    hirschberg(&a[mid..], &b[split..], out);
}

/// Returns the final row of the LCS length table for a against b.
fn lcs_row(a: &[String], b: &[String], reverse: bool) -> Vec<usize> {
    let mut prev = vec![0usize; b.len() + 1];
    let mut cur  = vec![0usize; b.len() + 1];

    for i in 0..a.len() {
        let ai = lcs_at(a, i, reverse);
        cur[0] = 0;
        for j in 0..b.len() {
            if ai == lcs_at(b, j, reverse) {
                cur[j + 1] = prev[j] + 1;
            } else if prev[j + 1] >= cur[j] {
                cur[j + 1] = prev[j + 1];
            } else {
                cur[j + 1] = cur[j];
            }
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev
}

fn lcs_at<'a>(xs: &'a [String], i: usize, reverse: bool) -> &'a str {
    if reverse { &xs[xs.len() - 1 - i] } else { &xs[i] }
}

/// Returns the anchor map: `m[i]` is the index in `target` where `base[i]`
/// sits in the LCS, or `-1` when `base[i]` is not in the LCS.
/// Mirrors Go `AlignLCS`.
pub fn align_lcs(base: &[String], target: &[String]) -> Vec<i64> {
    let mut m = vec![-1i64; base.len()];
    if base.is_empty() || target.is_empty() {
        return m;
    }
    let common = lcs(base, target);
    let (mut ci, mut ti, mut bi) = (0usize, 0usize, 0usize);

    while ci < common.len() && bi < base.len() && ti < target.len() {
        while bi < base.len() && base[bi] != common[ci] { bi += 1; }
        while ti < target.len() && target[ti] != common[ci] { ti += 1; }
        if bi < base.len() && ti < target.len() {
            m[bi] = ti as i64;
            bi += 1;
            ti += 1;
            ci += 1;
        }
    }
    m
}

// Go exports this as AlignLCS; keep both spellings.
pub use align_lcs as AlignLCS;

fn same_lines(a: &[String], b: &[String]) -> bool {
    a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| x == y)
}

fn ends_with_newline(out: &[String]) -> bool {
    out.last().map(|s| s.ends_with('\n')).unwrap_or(false)
}

fn write_conflict(
    out: &mut Vec<String>,
    generated: &[String],
    existing: &[String],
    labels: &DiffLabels,
) {
    out.push(format!("{}{}\n", MARK_START, labels.generated));
    out.extend_from_slice(generated);
    if !ends_with_newline(out) { out.push("\n".to_string()); }

    out.push(MARK_MID.to_string());
    out.extend_from_slice(existing);
    if !ends_with_newline(out) { out.push("\n".to_string()); }

    out.push(format!("{}{}\n", MARK_END, labels.existing));
}

// ─── Three-way merge ──────────────────────────────────────────────────────────

/// Combines what was just generated with what is on disk, using the previous
/// generate as the common ancestor. Mirrors Go `Merge`.
pub fn merge(generated: &str, baseline: &str, existing: &str, spec: DiffSpec) -> MergeResult {
    // Fast paths.
    if generated == existing {
        return MergeResult { content: existing.to_string(), conflict: false, outcome: MergeOutcome::Same };
    }
    if existing == baseline {
        return MergeResult { content: generated.to_string(), conflict: false, outcome: MergeOutcome::Clean };
    }
    let custom_existing = spec.labels.as_ref().map(|l| l.existing.as_str()).unwrap_or("");
    if has_conflicts_label(existing, custom_existing) {
        return MergeResult { content: existing.to_string(), conflict: false, outcome: MergeOutcome::Unresolved };
    }

    let labels = labels_of(&spec, "merge");
    let gl = lines(generated);
    let bl = lines(baseline);
    let el = lines(existing);

    let g_map = align_lcs(&bl, &gl);
    let e_map = align_lcs(&bl, &el);

    let mut out: Vec<String> = Vec::new();
    let mut conflict = false;
    let (mut bi, mut gi, mut ei) = (0usize, 0usize, 0usize);

    while bi < bl.len() {
        if g_map[bi] >= 0 && e_map[bi] >= 0 {
            let gmap_bi = g_map[bi] as usize;
            let emap_bi = e_map[bi] as usize;
            let g_ins = &gl[gi..gmap_bi];
            let e_ins = &el[ei..emap_bi];

            if same_lines(g_ins, e_ins) {
                out.extend_from_slice(g_ins);
            } else if g_ins.is_empty() {
                out.extend_from_slice(e_ins);
            } else if e_ins.is_empty() {
                out.extend_from_slice(g_ins);
            } else {
                write_conflict(&mut out, g_ins, e_ins, &labels);
                conflict = true;
            }

            out.push(bl[bi].clone());
            gi = gmap_bi + 1;
            ei = emap_bi + 1;
            bi += 1;
            continue;
        }

        // Not an anchor: run forward to the next one.
        let mut next_bi = bi;
        while next_bi < bl.len() && (g_map[next_bi] < 0 || e_map[next_bi] < 0) {
            next_bi += 1;
        }

        let b_region = &bl[bi..next_bi];
        let (g_region, e_region): (&[String], &[String]) = if next_bi < bl.len() {
            (&gl[gi..g_map[next_bi] as usize], &el[ei..e_map[next_bi] as usize])
        } else {
            (&gl[gi..], &el[ei..])
        };

        if same_lines(b_region, g_region) {
            out.extend_from_slice(e_region);
        } else if same_lines(b_region, e_region) {
            out.extend_from_slice(g_region);
        } else if same_lines(g_region, e_region) {
            out.extend_from_slice(g_region);
        } else {
            write_conflict(&mut out, g_region, e_region, &labels);
            conflict = true;
        }

        if next_bi < bl.len() {
            gi = g_map[next_bi] as usize;
            ei = e_map[next_bi] as usize;
        } else {
            gi = gl.len();
            ei = el.len();
        }
        bi = next_bi;
    }

    // Anything after the last anchor.
    if gi < gl.len() || ei < el.len() {
        let g_tail = &gl[gi..];
        let e_tail = &el[ei..];
        if same_lines(g_tail, e_tail) {
            out.extend_from_slice(g_tail);
        } else if g_tail.is_empty() {
            out.extend_from_slice(e_tail);
        } else if e_tail.is_empty() {
            out.extend_from_slice(g_tail);
        } else {
            write_conflict(&mut out, g_tail, e_tail, &labels);
            conflict = true;
        }
    }

    MergeResult { content: out.join(""), conflict, outcome: MergeOutcome::Merged }
}

// Go exports as Merge; keep both.
pub use merge as Merge;

// ─── Two-way diff ─────────────────────────────────────────────────────────────

const HUNK_SAME:   u8 = 0;
const HUNK_CHANGE: u8 = 1;

struct Hunk {
    kind:      u8,
    generated: Vec<String>,
    existing:  Vec<String>,
}

fn hunks(generated: &[String], existing: &[String]) -> Vec<Hunk> {
    let common = lcs(generated, existing);
    let mut out: Vec<Hunk> = Vec::new();
    let (mut gi, mut ei) = (0usize, 0usize);

    let mut flush = |g: Vec<String>, e: Vec<String>, out: &mut Vec<Hunk>| {
        if g.is_empty() && e.is_empty() { return; }
        out.push(Hunk { kind: HUNK_CHANGE, generated: g, existing: e });
    };

    for line in &common {
        let mut g = Vec::new();
        let mut e = Vec::new();
        while gi < generated.len() && &generated[gi] != line { g.push(generated[gi].clone()); gi += 1; }
        while ei < existing.len()  && &existing[ei]  != line { e.push(existing[ei].clone());  ei += 1; }
        flush(g, e, &mut out);

        let n = out.len();
        if n > 0 && out[n - 1].kind == HUNK_SAME {
            out[n - 1].generated.push(line.clone());
        } else {
            out.push(Hunk { kind: HUNK_SAME, generated: vec![line.clone()], existing: vec![] });
        }
        gi += 1;
        ei += 1;
    }

    let g_tail: Vec<String> = generated[gi..].to_vec();
    let e_tail: Vec<String> = existing[ei..].to_vec();
    flush(g_tail, e_tail, &mut out);
    out
}

/// Produces an annotated view of the difference between the new generate and
/// what is on disk. Mirrors Go `Diff`.
pub fn diff(generated: &str, existing: &str, spec: DiffSpec) -> DiffResult {
    if generated == existing {
        return DiffResult { content: generated.to_string(), conflict: false, outcome: DiffOutcome::Same };
    }
    let labels = labels_of(&spec, "diff");
    let mut out: Vec<String> = Vec::new();

    let block = |block_lines: &[String], label: &str, out: &mut Vec<String>| {
        out.push(format!("{}{}\n", MARK_START, label));
        for line in block_lines {
            out.push(line.clone());
            if !line.ends_with('\n') { out.push("\n".to_string()); }
        }
        out.push(format!("{}{}\n", MARK_END, label));
    };

    for hunk in hunks(&lines(generated), &lines(existing)) {
        if hunk.kind == HUNK_SAME {
            out.extend(hunk.generated);
            continue;
        }
        if !hunk.existing.is_empty()  { block(&hunk.existing,  &labels.existing,  &mut out); }
        if !hunk.generated.is_empty() { block(&hunk.generated, &labels.generated, &mut out); }
    }

    DiffResult { content: out.join(""), conflict: true, outcome: DiffOutcome::Changed }
}

// Go exports as Diff; keep both.
pub use diff as Diff;
