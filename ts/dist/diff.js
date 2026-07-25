"use strict";
/* Copyright (c) 2024 Richard Rodger, MIT License */
Object.defineProperty(exports, "__esModule", { value: true });
exports.merge = merge;
exports.diff = diff;
exports.hasConflicts = hasConflicts;
exports.lines = lines;
exports.lcs = lcs;
exports.alignLcs = alignLcs;
exports.hunks = hunks;
// --- Markers --------------------------------------------------------------
const MARK_START = '<<<<<<< ';
const MARK_MID = '=======\n';
const MARK_END = '>>>>>>> ';
const LABEL_GENERATED = 'GENERATED';
const LABEL_EXISTING = 'EXISTING';
// The end-of-conflict marker for the EXISTING side. A file still holding
// this has an unresolved merge in it.
const UNRESOLVED_MARK = MARK_END + LABEL_EXISTING + ':';
// Whether text still holds an unresolved conflict from an earlier merge.
// Keyed on the closing EXISTING marker alone: a half-resolved file, where
// the opening marker was removed but the closing one was not, must still
// count as unresolved rather than being re-merged.
function hasConflicts(text) {
    return text.includes(UNRESOLVED_MARK);
}
function isoOf(when) {
    return new Date(null == when ? 0 : when).toISOString();
}
function labelsOf(spec, defaultKind) {
    const kind = null == spec?.kind ? defaultKind : spec.kind;
    return {
        generated: null == spec?.labels?.generated ?
            LABEL_GENERATED + ': ' + isoOf(spec?.when) + '/' + kind :
            spec.labels.generated,
        existing: null == spec?.labels?.existing ?
            LABEL_EXISTING + ': ' + isoOf(spec?.last) + '/' + kind :
            spec.labels.existing,
    };
}
// --- Line primitives ------------------------------------------------------
// Split on \n, keeping the newline on each line so join('') round-trips
// exactly, including a final line with no trailing newline.
function lines(text) {
    if ('' === text) {
        return [];
    }
    const out = [];
    let rest = text;
    for (;;) {
        const at = rest.indexOf('\n');
        if (at < 0) {
            out.push(rest);
            return out;
        }
        out.push(rest.substring(0, at + 1));
        rest = rest.substring(at + 1);
        if ('' === rest) {
            return out;
        }
    }
}
// Longest common subsequence of two line arrays.
function lcs(a, b) {
    if (0 === a.length || 0 === b.length) {
        return [];
    }
    // Common prefix, then common suffix of what is left. Those lines are in
    // every optimal LCS, and skipping them is what makes the realistic case
    // (a mostly-unchanged regenerated file) fast.
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) {
        head++;
    }
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head &&
        a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
        tail++;
    }
    const out = a.slice(0, head);
    hirschberg(a.slice(head, a.length - tail), b.slice(head, b.length - tail), out);
    for (let i = a.length - tail; i < a.length; i++) {
        out.push(a[i]);
    }
    return out;
}
// Hirschberg's divide and conquer: recurse on the two halves of `a`, each
// step holding only two rows of the length table.
function hirschberg(a, b, out) {
    if (0 === a.length || 0 === b.length) {
        return;
    }
    if (1 === a.length) {
        // A full-table walk starts at the end of `b` and steps back, so it
        // lands on the LAST occurrence. Match that.
        for (let i = b.length - 1; 0 <= i; i--) {
            if (b[i] === a[0]) {
                out.push(a[0]);
                return;
            }
        }
        return;
    }
    const mid = Math.floor(a.length / 2);
    const headRow = lcsRow(a.slice(0, mid), b, false);
    const tailRow = lcsRow(a.slice(mid), b, true);
    // `>=` so a tie takes the LARGEST split. Using `>` here silently changes
    // merge output; see the tie-breaking note at the top of this file.
    let best = -1;
    let split = 0;
    for (let k = 0; k <= b.length; k++) {
        const sum = headRow[k] + tailRow[b.length - k];
        if (sum >= best) {
            best = sum;
            split = k;
        }
    }
    hirschberg(a.slice(0, mid), b.slice(0, split), out);
    hirschberg(a.slice(mid), b.slice(split), out);
}
// Final row of the LCS length table for `a` against `b`. With `reverse`,
// both sequences are walked back to front, so the result is indexed by
// suffix length rather than prefix length.
function lcsRow(a, b, reverse) {
    let prev = new Array(b.length + 1).fill(0);
    let cur = new Array(b.length + 1).fill(0);
    const at = (xs, i) => reverse ? xs[xs.length - 1 - i] : xs[i];
    for (let i = 0; i < a.length; i++) {
        const ai = at(a, i);
        cur[0] = 0;
        for (let j = 0; j < b.length; j++) {
            if (ai === at(b, j)) {
                cur[j + 1] = prev[j] + 1;
            }
            else if (prev[j + 1] >= cur[j]) {
                cur[j + 1] = prev[j + 1];
            }
            else {
                cur[j + 1] = cur[j];
            }
        }
        const swap = prev;
        prev = cur;
        cur = swap;
    }
    return prev;
}
// Anchor map: `m[i]` is the index in `target` where `base[i]` sits in the
// LCS of the two, or -1 when `base[i]` is not in it.
function alignLcs(base, target) {
    const m = new Array(base.length).fill(-1);
    if (0 === base.length || 0 === target.length) {
        return m;
    }
    const common = lcs(base, target);
    let ci = 0;
    let ti = 0;
    let bi = 0;
    while (ci < common.length && bi < base.length && ti < target.length) {
        while (bi < base.length && base[bi] !== common[ci]) {
            bi++;
        }
        while (ti < target.length && target[ti] !== common[ci]) {
            ti++;
        }
        if (bi < base.length && ti < target.length) {
            m[bi] = ti;
            bi++;
            ti++;
            ci++;
        }
    }
    return m;
}
function sameLines(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}
// Whether the text accumulated so far ends with a newline, so a marker
// always starts on its own line.
//
// Precondition: `parts` is non-empty and holds no empty strings. Both hold
// at every call site — writeConflict pushes its opening marker first, and
// `lines` never yields an empty element.
function endsWithNewline(parts) {
    return parts[parts.length - 1].endsWith('\n');
}
function writeConflict(out, generated, existing, labels) {
    out.push(MARK_START + labels.generated + '\n');
    out.push(...generated);
    if (!endsWithNewline(out)) {
        out.push('\n');
    }
    out.push(MARK_MID);
    out.push(...existing);
    if (!endsWithNewline(out)) {
        out.push('\n');
    }
    out.push(MARK_END + labels.existing + '\n');
}
// --- Three-way merge ------------------------------------------------------
// Merge what was just generated with what is on disk, using the previous
// generate as the common ancestor.
//
//   generated - what this run produced
//   baseline  - what the last run produced (the merge base)
//   existing  - what is on disk now, possibly hand-edited
//
// Taking the previous generate as the ancestor is what preserves manual
// edits: anything in `existing` that is not in `baseline` is the user's.
function merge(generated, baseline, existing, spec) {
    // Fast paths, in order. Each is semantics-identical to running the full
    // merge, and each avoids the quadratic core entirely.
    // Nothing changed on either side.
    if (generated === existing) {
        return { content: existing, conflict: false, outcome: 'same' };
    }
    // The file is untouched since the last generate, so there is nothing of
    // the user's to preserve: the new generate wins outright.
    if (existing === baseline) {
        return { content: generated, conflict: false, outcome: 'clean' };
    }
    // Never merge into an unresolved merge — that stacks conflict markers
    // inside conflict markers and is unreadable. Leave it for the user.
    if (hasConflicts(existing)) {
        return { content: existing, conflict: false, outcome: 'unresolved' };
    }
    const labels = labelsOf(spec, 'merge');
    const gl = lines(generated);
    const bl = lines(baseline);
    const el = lines(existing);
    const gMap = alignLcs(bl, gl);
    const eMap = alignLcs(bl, el);
    const out = [];
    let conflict = false;
    let bi = 0;
    let gi = 0;
    let ei = 0;
    while (bi < bl.length) {
        if (0 <= gMap[bi] && 0 <= eMap[bi]) {
            // Anchor: this baseline line survives on both sides. Reconcile
            // whatever each side inserted in front of it.
            const gIns = gl.slice(gi, gMap[bi]);
            const eIns = el.slice(ei, eMap[bi]);
            if (sameLines(gIns, eIns)) {
                out.push(...gIns);
            }
            else if (0 === gIns.length) {
                out.push(...eIns);
            }
            else if (0 === eIns.length) {
                out.push(...gIns);
            }
            else {
                writeConflict(out, gIns, eIns, labels);
                conflict = true;
            }
            out.push(bl[bi]);
            gi = gMap[bi] + 1;
            ei = eMap[bi] + 1;
            bi++;
            continue;
        }
        // Not an anchor: run forward to the next one and reconcile the whole
        // region between.
        let nextBi = bi;
        while (nextBi < bl.length && (gMap[nextBi] < 0 || eMap[nextBi] < 0)) {
            nextBi++;
        }
        const bRegion = bl.slice(bi, nextBi);
        let gRegion;
        let eRegion;
        if (nextBi < bl.length) {
            gRegion = gl.slice(gi, gMap[nextBi]);
            eRegion = el.slice(ei, eMap[nextBi]);
        }
        else {
            gRegion = gl.slice(gi);
            eRegion = el.slice(ei);
        }
        if (sameLines(bRegion, gRegion)) {
            // Only the user changed this region.
            out.push(...eRegion);
        }
        else if (sameLines(bRegion, eRegion)) {
            // Only the generator changed this region.
            out.push(...gRegion);
        }
        else if (sameLines(gRegion, eRegion)) {
            // Both made the same change.
            out.push(...gRegion);
        }
        else {
            writeConflict(out, gRegion, eRegion, labels);
            conflict = true;
        }
        if (nextBi < bl.length) {
            gi = gMap[nextBi];
            ei = eMap[nextBi];
        }
        else {
            gi = gl.length;
            ei = el.length;
        }
        bi = nextBi;
    }
    // Anything after the last anchor.
    if (gi < gl.length || ei < el.length) {
        const gTail = gl.slice(gi);
        const eTail = el.slice(ei);
        if (sameLines(gTail, eTail)) {
            out.push(...gTail);
        }
        else if (0 === gTail.length) {
            out.push(...eTail);
        }
        else if (0 === eTail.length) {
            out.push(...gTail);
        }
        else {
            writeConflict(out, gTail, eTail, labels);
            conflict = true;
        }
    }
    return { content: out.join(''), conflict, outcome: 'merged' };
}
// --- Two-way diff ---------------------------------------------------------
const HUNK_SAME = 0;
const HUNK_CHANGE = 1;
// Hunks describing the difference between the two line arrays. Adjacent
// insertions and deletions merge into a single change hunk, so a modified
// region is reported once rather than as a delete followed by an add.
function hunks(generated, existing) {
    const common = lcs(generated, existing);
    const out = [];
    let gi = 0;
    let ei = 0;
    // Two change hunks can never end up adjacent: every flush in the loop
    // below is immediately followed by a same-hunk, and the trailing flush is
    // the last thing to run. So there is nothing to merge into.
    const flush = (g, e) => {
        if (0 === g.length && 0 === e.length) {
            return;
        }
        out.push({ kind: HUNK_CHANGE, generated: g, existing: e });
    };
    for (const line of common) {
        const g = [];
        const e = [];
        while (gi < generated.length && generated[gi] !== line) {
            g.push(generated[gi]);
            gi++;
        }
        while (ei < existing.length && existing[ei] !== line) {
            e.push(existing[ei]);
            ei++;
        }
        flush(g, e);
        const last = out[out.length - 1];
        if (null != last && HUNK_SAME === last.kind) {
            last.generated.push(line);
        }
        else {
            out.push({ kind: HUNK_SAME, generated: [line], existing: [] });
        }
        gi++;
        ei++;
    }
    flush(generated.slice(gi), existing.slice(ei));
    return out;
}
// Annotated view of the difference between the new generate and what is on
// disk. Unchanged text passes through; each changed region becomes a pair
// of marked blocks, the existing side first.
function diff(generated, existing, spec) {
    if (generated === existing) {
        return { content: generated, conflict: false, outcome: 'same' };
    }
    const labels = labelsOf(spec, 'diff');
    const out = [];
    const block = (block_lines, label) => {
        out.push(MARK_START + label + '\n');
        for (const line of block_lines) {
            out.push(line);
            if (!line.endsWith('\n')) {
                out.push('\n');
            }
        }
        out.push(MARK_END + label + '\n');
    };
    for (const hunk of hunks(lines(generated), lines(existing))) {
        if (HUNK_SAME === hunk.kind) {
            out.push(...hunk.generated);
            continue;
        }
        if (0 < hunk.existing.length) {
            block(hunk.existing, labels.existing);
        }
        if (0 < hunk.generated.length) {
            block(hunk.generated, labels.generated);
        }
    }
    return { content: out.join(''), conflict: true, outcome: 'changed' };
}
//# sourceMappingURL=diff.js.map