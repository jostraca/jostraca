// diff.rs — line diff and LCS, ported from go/diff.go / ts/src/diff.ts

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
    hirschberg(
        &a[head..a.len() - tail],
        &b[head..b.len() - tail],
        &mut out,
    );
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
    let mut split = 0;
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
    let mut cur = vec![0usize; b.len() + 1];

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

fn lcs_at(xs: &[String], i: usize, reverse: bool) -> &str {
    if reverse { &xs[xs.len() - 1 - i] } else { &xs[i] }
}
