"use strict";
// Unit tests for the diff/merge engine in src/diff.ts, mirroring
// go/diff_engine_test.go case for case. Both suites aim at full branch
// coverage of their respective file; a branch exercised on one side and not
// the other is exactly how the two stacks drifted apart before.
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const expect_1 = require("./expect");
const __1 = require("../");
const { merge, diff, hasConflicts, lines, lcs, alignLcs, hunks, } = __1.DiffUtil;
const MARK_START = '<<<<<<< ';
const MARK_MID = '=======\n';
const MARK_END = '>>>>>>> ';
// Short explicit labels keep the expected strings readable.
const L = { labels: { generated: 'G', existing: 'E' } };
// Deterministic PRNG so any failure is reproducible.
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}
// A small vocabulary produces heavy duplication, which is the realistic
// case for source code and the case most likely to expose a tie-breaking
// difference.
function randLines(r, n, vocab) {
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push('L' + Math.floor(r() * vocab) + '\n');
    }
    return out;
}
// The textbook full-table LCS, kept as the oracle for the space-bounded
// one. Any divergence changes merge output.
function referenceLcs(a, b) {
    if (0 === a.length || 0 === b.length) {
        return [];
    }
    const n = a.length;
    const m = b.length;
    const dp = [];
    for (let i = 0; i <= n; i++) {
        dp.push(new Array(m + 1).fill(0));
    }
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            }
            else if (dp[i - 1][j] >= dp[i][j - 1]) {
                dp[i][j] = dp[i - 1][j];
            }
            else {
                dp[i][j] = dp[i][j - 1];
            }
        }
    }
    const out = [];
    let i = n;
    let j = m;
    while (0 < i && 0 < j) {
        if (a[i - 1] === b[j - 1]) {
            out.push(a[i - 1]);
            i--;
            j--;
        }
        else if (dp[i - 1][j] >= dp[i][j - 1]) {
            i--;
        }
        else {
            j--;
        }
    }
    return out.reverse();
}
(0, node_test_1.describe)('diff-engine', () => {
    // --- lines --------------------------------------------------------------
    (0, node_test_1.test)('lines', () => {
        (0, expect_1.expect)(lines('')).equal([]);
        (0, expect_1.expect)(lines('a')).equal(['a']);
        (0, expect_1.expect)(lines('a\n')).equal(['a\n']);
        (0, expect_1.expect)(lines('a\nb\n')).equal(['a\n', 'b\n']);
        (0, expect_1.expect)(lines('a\nb')).equal(['a\n', 'b']);
        (0, expect_1.expect)(lines('\n\n')).equal(['\n', '\n']);
        (0, expect_1.expect)(lines('a\r\nb\r\n')).equal(['a\r\n', 'b\r\n']);
        // Round-trip is lossless for every shape above.
        for (const s of ['', 'a', 'a\n', 'a\nb', 'a\nb\n', '\n', '\n\n', 'a\r\nb']) {
            (0, expect_1.expect)(lines(s).join('')).equal(s);
        }
    });
    // --- lcs ----------------------------------------------------------------
    (0, node_test_1.test)('lcs-edges', () => {
        (0, expect_1.expect)(lcs([], ['a'])).equal([]);
        (0, expect_1.expect)(lcs(['a'], [])).equal([]);
        (0, expect_1.expect)(lcs(['a', 'b'], ['a', 'b'])).equal(['a', 'b']);
        (0, expect_1.expect)(lcs(['a'], ['b'])).equal([]);
        (0, expect_1.expect)(lcs(['a', 'b'], ['a', 'z'])).equal(['a']);
        (0, expect_1.expect)(lcs(['b', 'a'], ['z', 'a'])).equal(['a']);
        // Single-row base case: found, and not found.
        (0, expect_1.expect)(lcs(['x'], ['a', 'x', 'b'])).equal(['x']);
        (0, expect_1.expect)(lcs(['x'], ['a', 'b'])).equal([]);
        // The single-row base case must take the LAST occurrence, so a
        // following element can still be matched after it.
        (0, expect_1.expect)(lcs(['a', 'b'], ['a', 'x', 'a', 'b'])).equal(['a', 'b']);
    });
    (0, node_test_1.test)('lcs-matches-reference-dp', () => {
        const r = rng(20260725);
        const shapes = [
            { n: 0, m: 0, v: 1 }, { n: 0, m: 5, v: 3 }, { n: 5, m: 0, v: 3 },
            { n: 1, m: 1, v: 1 }, { n: 1, m: 8, v: 2 }, { n: 8, m: 1, v: 2 },
            { n: 6, m: 6, v: 2 }, { n: 12, m: 9, v: 3 }, { n: 20, m: 20, v: 4 },
            { n: 30, m: 25, v: 30 }, { n: 40, m: 40, v: 6 },
            { n: 50, m: 10, v: 2 }, { n: 64, m: 64, v: 3 },
        ];
        for (const s of shapes) {
            for (let iter = 0; iter < 200; iter++) {
                const a = randLines(r, s.n, s.v);
                const b = randLines(r, s.m, s.v);
                const got = lcs(a, b);
                const want = referenceLcs(a, b);
                if (got.join('') !== want.join('')) {
                    throw new Error('LCS differs for ' + JSON.stringify(s) +
                        '\n a=' + JSON.stringify(a) + '\n b=' + JSON.stringify(b) +
                        '\n got=' + JSON.stringify(got) + '\nwant=' + JSON.stringify(want));
                }
            }
        }
    });
    (0, node_test_1.test)('lcs-matches-reference-with-shared-affixes', () => {
        const r = rng(981);
        for (let iter = 0; iter < 400; iter++) {
            const prefix = randLines(r, Math.floor(r() * 6), 3);
            const suffix = randLines(r, Math.floor(r() * 6), 3);
            const a = [...prefix, ...randLines(r, Math.floor(r() * 10), 3), ...suffix];
            const b = [...prefix, ...randLines(r, Math.floor(r() * 10), 3), ...suffix];
            const got = lcs(a, b);
            const want = referenceLcs(a, b);
            if (got.join('') !== want.join('')) {
                throw new Error('LCS differs on shared-affix input' +
                    '\n a=' + JSON.stringify(a) + '\n b=' + JSON.stringify(b) +
                    '\n got=' + JSON.stringify(got) + '\nwant=' + JSON.stringify(want));
            }
        }
    });
    // Property: the result must actually be a subsequence of both inputs.
    (0, node_test_1.test)('lcs-is-a-common-subsequence', () => {
        const r = rng(555);
        for (let iter = 0; iter < 600; iter++) {
            const a = randLines(r, Math.floor(r() * 24), 4);
            const b = randLines(r, Math.floor(r() * 24), 4);
            const common = lcs(a, b);
            for (const seq of [a, b]) {
                let at = 0;
                for (const line of common) {
                    const found = seq.indexOf(line, at);
                    (0, expect_1.expect)(0 <= found).true();
                    at = found + 1;
                }
            }
        }
    });
    (0, node_test_1.test)('lcs-tie-break-prefers-largest-split', () => {
        // The one tie-break in this engine that changes what a user sees.
        //
        // `a` and `b` below have TWO longest common subsequences, both of
        // length 1: ['a'] and ['b']. Neither is more correct. Hirschberg picks
        // between them by which split point it takes when two splits score
        // equally, and taking the LARGEST yields ['a']. Flipping that one `>=`
        // to `>` yields ['b'] here, and changes the merged content on 658 of
        // the 1 190 corpus cases — i.e. it silently rewrites user files.
        //
        // The point of this test is to say so in one screen, rather than
        // leaving the rule to be inferred from a randomised oracle comparison.
        const a = ['a', 'a', 'b'];
        const b = ['b', 'a'];
        (0, expect_1.expect)(lcs(a, b)).equal(['a']);
        // ['b'] is an equally valid answer, which is what makes this a choice
        // and not a correctness question. Both are common subsequences of the
        // same length; the engine just has to pick the same one every time,
        // in both stacks.
        for (const alt of [['a'], ['b']]) {
            (0, expect_1.expect)(alt.length).equal(lcs(a, b).length);
            for (const seq of [a, b]) {
                let at = 0;
                for (const line of alt) {
                    const found = seq.indexOf(line, at);
                    (0, expect_1.expect)(0 <= found).true();
                    at = found + 1;
                }
            }
        }
        // A second case, so a change that happens to preserve the first does
        // not slip through: 'ca' and 'cb' are both length-2 subsequences here.
        (0, expect_1.expect)(lcs(['c', 'a', 'b'], ['c', 'b', 'a'])).equal(['c', 'a']);
    });
    (0, node_test_1.test)('align-lcs', () => {
        (0, expect_1.expect)(alignLcs([], ['a'])).equal([]);
        (0, expect_1.expect)(alignLcs(['a', 'b'], [])).equal([-1, -1]);
        // `b` is absent from the target, so it has no anchor.
        (0, expect_1.expect)(alignLcs(['a', 'b', 'c'], ['a', 'c'])).equal([0, -1, 1]);
    });
    // --- labels -------------------------------------------------------------
    (0, node_test_1.test)('labels-and-conflict-detection', () => {
        // Formatted from when/last, with the default kind.
        let res = merge('X\n', '', 'Y\n', { when: 1735689600000, last: 0 });
        (0, expect_1.expect)(res.content.includes('GENERATED: 2025-01-01T00:00:00.000Z/merge')).true();
        (0, expect_1.expect)(res.content.includes('EXISTING: 1970-01-01T00:00:00.000Z/merge')).true();
        // Explicit kind.
        res = merge('X\n', '', 'Y\n', { kind: 'custom' });
        (0, expect_1.expect)(res.content.includes('/custom')).true();
        // Missing when/last default to the epoch rather than throwing.
        res = merge('X\n', '', 'Y\n', {});
        (0, expect_1.expect)(res.content.includes('1970-01-01T00:00:00.000Z')).true();
        // No spec at all.
        res = merge('X\n', '', 'Y\n');
        (0, expect_1.expect)(res.content.includes('GENERATED: ')).true();
        // Each label overridable independently.
        res = merge('X\n', '', 'Y\n', { labels: { generated: 'G' } });
        (0, expect_1.expect)(res.content.includes(MARK_START + 'G\n')).true();
        (0, expect_1.expect)(res.content.includes(MARK_END + 'EXISTING: ')).true();
        res = merge('X\n', '', 'Y\n', { labels: { existing: 'E' } });
        (0, expect_1.expect)(res.content.includes(MARK_END + 'E\n')).true();
        (0, expect_1.expect)(res.content.includes(MARK_START + 'GENERATED: ')).true();
    });
    (0, node_test_1.test)('has-conflicts', () => {
        (0, expect_1.expect)(hasConflicts('plain\n')).false();
        (0, expect_1.expect)(hasConflicts('a\n>>>>>>> EXISTING: X/merge\n')).true();
        // Half-resolved: opening marker gone, closing one left. Still
        // unresolved, so it must not be re-merged.
        (0, expect_1.expect)(hasConflicts('a\n=======\nb\n>>>>>>> EXISTING: X/merge\n')).true();
        // Diff markers are not an unresolved merge.
        (0, expect_1.expect)(hasConflicts('<<<<<<< GENERATED: X/diff\na\n>>>>>>> GENERATED: X/diff\n')).false();
    });
    // --- merge outcomes -----------------------------------------------------
    (0, node_test_1.test)('merge-outcome-same', () => {
        const res = merge('A\n', 'B\n', 'A\n');
        (0, expect_1.expect)(res.outcome).equal('same');
        (0, expect_1.expect)(res.conflict).false();
        (0, expect_1.expect)(res.content).equal('A\n');
    });
    (0, node_test_1.test)('merge-outcome-clean', () => {
        // The file on disk is untouched since the last generate, so the new
        // generate wins outright.
        const res = merge('NEW\n', 'OLD\n', 'OLD\n');
        (0, expect_1.expect)(res.outcome).equal('clean');
        (0, expect_1.expect)(res.conflict).false();
        (0, expect_1.expect)(res.content).equal('NEW\n');
    });
    (0, node_test_1.test)('merge-outcome-unresolved', () => {
        const existing = 'a\n>>>>>>> EXISTING: T/merge\n';
        const res = merge('NEW\n', 'OLD\n', existing);
        (0, expect_1.expect)(res.outcome).equal('unresolved');
        (0, expect_1.expect)(res.conflict).false();
        (0, expect_1.expect)(res.content).equal(existing);
    });
    (0, node_test_1.test)('merge-only-generator-changed', () => {
        const res = merge('a\nNEW\nc\n', 'a\nORIG\nc\n', 'a\nORIG\nc\n');
        (0, expect_1.expect)(res.content).equal('a\nNEW\nc\n');
        (0, expect_1.expect)(res.conflict).false();
    });
    (0, node_test_1.test)('merge-only-user-changed', () => {
        const res = merge('a\nORIG\nc\n', 'a\nORIG\nc\n', 'a\nUSER\nc\n');
        (0, expect_1.expect)(res.content).equal('a\nUSER\nc\n');
        (0, expect_1.expect)(res.conflict).false();
    });
    (0, node_test_1.test)('merge-both-made-same-change', () => {
        const res = merge('a\nSAME\nc\n', 'a\nORIG\nc\n', 'a\nSAME\nc\n');
        // Identical generated and existing short-circuits as `same`.
        (0, expect_1.expect)(res.outcome).equal('same');
        (0, expect_1.expect)(res.content).equal('a\nSAME\nc\n');
    });
    (0, node_test_1.test)('merge-shared-change-through-region-path', () => {
        const res = merge('a\nSAME\nc\nG\n', 'a\nORIG\nc\n', 'a\nSAME\nc\n');
        (0, expect_1.expect)(res.outcome).equal('merged');
        (0, expect_1.expect)(res.content.includes('ORIG')).false();
    });
    (0, node_test_1.test)('merge-conflict', () => {
        const res = merge('a\nNEW\nc\n', 'a\nORIG\nc\n', 'a\nUSER\nc\n', L);
        (0, expect_1.expect)(res.conflict).true();
        (0, expect_1.expect)(res.outcome).equal('merged');
        (0, expect_1.expect)(res.content).equal('a\n' + MARK_START + 'G\nNEW\n' + MARK_MID + 'USER\n' + MARK_END + 'E\nc\n');
    });
    (0, node_test_1.test)('merge-insertions-before-anchor', () => {
        // Only the generator inserted.
        (0, expect_1.expect)(merge('X\nanchor\n', 'anchor\n', 'anchor\n', L).content)
            .equal('X\nanchor\n');
        // Only the user inserted.
        (0, expect_1.expect)(merge('anchor\n', 'anchor\n', 'Y\nanchor\n', L).content)
            .equal('Y\nanchor\n');
        // Both inserted the same thing.
        (0, expect_1.expect)(merge('S\nanchor\nq\n', 'anchor\n', 'S\nanchor\n', L)
            .content.includes(MARK_START)).false();
        // Both inserted, differently.
        const res = merge('X\nanchor\n', 'anchor\n', 'Y\nanchor\n', L);
        (0, expect_1.expect)(res.conflict).true();
        (0, expect_1.expect)(res.content).equal(MARK_START + 'G\nX\n' + MARK_MID + 'Y\n' + MARK_END + 'E\nanchor\n');
    });
    (0, node_test_1.test)('merge-tail', () => {
        // Only the generator appended.
        (0, expect_1.expect)(merge('a\nX\n', 'a\n', 'a\n', L).content).equal('a\nX\n');
        // Only the user appended.
        (0, expect_1.expect)(merge('a\n', 'a\n', 'a\nY\n', L).content).equal('a\nY\n');
        // Both appended, differently.
        const res = merge('a\nX\n', 'a\n', 'a\nY\n', L);
        (0, expect_1.expect)(res.conflict).true();
        (0, expect_1.expect)(res.content).equal('a\n' + MARK_START + 'G\nX\n' + MARK_MID + 'Y\n' + MARK_END + 'E\n');
    });
    // An empty baseline has no anchors at all, so the whole thing is one
    // region.
    (0, node_test_1.test)('merge-empty-baseline', () => {
        const res = merge('X\n', '', 'Y\n', L);
        (0, expect_1.expect)(res.conflict).true();
        (0, expect_1.expect)(res.content).equal(MARK_START + 'G\nX\n' + MARK_MID + 'Y\n' + MARK_END + 'E\n');
    });
    // A conflicting region whose last line has no trailing newline: the
    // closing marker must still start its own line.
    (0, node_test_1.test)('merge-conflict-without-trailing-newline', () => {
        const res = merge('X', '', 'Y', L);
        (0, expect_1.expect)(res.content).equal(MARK_START + 'G\nX\n' + MARK_MID + 'Y\n' + MARK_END + 'E\n');
    });
    // A deletion by the user, in a region the generator did not touch, must
    // win — that is what "preserve manual edits" means. Worth stating
    // explicitly, because the obvious-looking property "every generated line
    // survives" is FALSE for a three-way merge.
    (0, node_test_1.test)('merge-user-deletion-wins', () => {
        const res = merge('keep\ndrop-me\n', 'keep\ndrop-me\n', 'keep\n');
        (0, expect_1.expect)(res.content).equal('keep\n');
        (0, expect_1.expect)(res.conflict).false();
    });
    (0, node_test_1.test)('merge-generator-deletion-wins', () => {
        const res = merge('keep\n', 'keep\ndrop-me\n', 'keep\ndrop-me\n');
        (0, expect_1.expect)(res.content).equal('keep\n');
        (0, expect_1.expect)(res.conflict).false();
    });
    // Property: the merge never invents content.
    (0, node_test_1.test)('merge-invents-nothing', () => {
        const r = rng(31337);
        for (let iter = 0; iter < 500; iter++) {
            const base = randLines(r, 2 + Math.floor(r() * 8), 4).join('');
            const gen = randLines(r, 2 + Math.floor(r() * 8), 4).join('');
            const exi = randLines(r, 2 + Math.floor(r() * 8), 4).join('');
            const res = merge(gen, base, exi);
            const known = new Set();
            for (const side of [gen, base, exi]) {
                for (const line of lines(side)) {
                    known.add(line);
                }
            }
            for (const line of lines(res.content)) {
                if (line.startsWith(MARK_START) || line.startsWith(MARK_END) ||
                    MARK_MID === line) {
                    continue;
                }
                if (!known.has(line)) {
                    throw new Error('merge invented ' + JSON.stringify(line) +
                        '\n gen=' + JSON.stringify(gen) + ' base=' + JSON.stringify(base) +
                        ' exi=' + JSON.stringify(exi) + '\n out=' + JSON.stringify(res.content));
                }
            }
        }
    });
    // Property: a reported conflict always carries both sides' markers.
    (0, node_test_1.test)('merge-conflict-always-marked', () => {
        const r = rng(777);
        for (let iter = 0; iter < 500; iter++) {
            const base = randLines(r, 2 + Math.floor(r() * 8), 3).join('');
            const gen = randLines(r, 2 + Math.floor(r() * 8), 3).join('');
            const exi = randLines(r, 2 + Math.floor(r() * 8), 3).join('');
            const res = merge(gen, base, exi, L);
            if (!res.conflict) {
                continue;
            }
            for (const want of [MARK_START + 'G\n', MARK_MID, MARK_END + 'E\n']) {
                (0, expect_1.expect)(res.content.includes(want)).true();
            }
        }
    });
    // Property: every conflict marker starts its own line. A marker glued
    // onto the end of a content line cannot be parsed by anything.
    (0, node_test_1.test)('merge-markers-start-their-own-line', () => {
        const r = rng(2468);
        const trim = (s) => s.endsWith('\n') ? s.substring(0, s.length - 1) : s;
        for (let iter = 0; iter < 400; iter++) {
            const base = trim(randLines(r, 1 + Math.floor(r() * 5), 3).join(''));
            const gen = trim(randLines(r, 1 + Math.floor(r() * 5), 3).join(''));
            const exi = trim(randLines(r, 1 + Math.floor(r() * 5), 3).join(''));
            const res = merge(gen, base, exi, L);
            for (const line of lines(res.content)) {
                for (const mark of [MARK_START, MARK_END, '=======']) {
                    (0, expect_1.expect)(0 < line.indexOf(mark)).false();
                }
            }
        }
    });
    // A clean merge (only one side changed) must never report a conflict.
    (0, node_test_1.test)('merge-clean-never-conflicts', () => {
        const r = rng(909);
        for (let iter = 0; iter < 300; iter++) {
            const base = randLines(r, 3 + Math.floor(r() * 8), 5).join('');
            const gen = randLines(r, 3 + Math.floor(r() * 8), 5).join('');
            (0, expect_1.expect)(merge(gen, base, base).conflict).false();
        }
    });
    // --- diff ---------------------------------------------------------------
    (0, node_test_1.test)('diff-same', () => {
        const res = diff('a\nb\n', 'a\nb\n');
        (0, expect_1.expect)(res.outcome).equal('same');
        (0, expect_1.expect)(res.conflict).false();
        (0, expect_1.expect)(res.content).equal('a\nb\n');
    });
    (0, node_test_1.test)('diff-changed', () => {
        const res = diff('a\nNEW\nc\n', 'a\nOLD\nc\n', L);
        (0, expect_1.expect)(res.outcome).equal('changed');
        (0, expect_1.expect)(res.conflict).true();
        // Existing side first, then generated.
        (0, expect_1.expect)(res.content).equal('a\n' +
            MARK_START + 'E\nOLD\n' + MARK_END + 'E\n' +
            MARK_START + 'G\nNEW\n' + MARK_END + 'G\n' +
            'c\n');
    });
    (0, node_test_1.test)('diff-pure-insertion', () => {
        // Only a generated block: nothing was removed.
        (0, expect_1.expect)(diff('a\nb\n', 'a\n', L).content)
            .equal('a\n' + MARK_START + 'G\nb\n' + MARK_END + 'G\n');
    });
    (0, node_test_1.test)('diff-pure-deletion', () => {
        // Only an existing block: nothing was added.
        (0, expect_1.expect)(diff('a\n', 'a\nb\n', L).content)
            .equal('a\n' + MARK_START + 'E\nb\n' + MARK_END + 'E\n');
    });
    // A changed final line with no trailing newline: the closing marker must
    // still start its own line.
    (0, node_test_1.test)('diff-without-trailing-newline', () => {
        (0, expect_1.expect)(diff('a\nZ1', 'a\nZ9', L).content).equal('a\n' +
            MARK_START + 'E\nZ9\n' + MARK_END + 'E\n' +
            MARK_START + 'G\nZ1\n' + MARK_END + 'G\n');
    });
    (0, node_test_1.test)('diff-from-and-to-empty', () => {
        (0, expect_1.expect)(diff('a\n', '', L).content)
            .equal(MARK_START + 'G\na\n' + MARK_END + 'G\n');
        (0, expect_1.expect)(diff('', 'a\n', L).content)
            .equal(MARK_START + 'E\na\n' + MARK_END + 'E\n');
    });
    (0, node_test_1.test)('hunks', () => {
        // Adjacent delete+insert become a single change hunk.
        let hs = hunks(['a\n', 'X\n', 'c\n'], ['a\n', 'Y\n', 'c\n']);
        (0, expect_1.expect)(hs.length).equal(3);
        (0, expect_1.expect)(hs[0].kind).equal(0);
        (0, expect_1.expect)(hs[1].kind).equal(1);
        (0, expect_1.expect)(hs[2].kind).equal(0);
        (0, expect_1.expect)(hs[1].generated).equal(['X\n']);
        (0, expect_1.expect)(hs[1].existing).equal(['Y\n']);
        // Consecutive shared lines collapse into one same-hunk.
        hs = hunks(['a\n', 'b\n'], ['a\n', 'b\n']);
        (0, expect_1.expect)(hs.length).equal(1);
        (0, expect_1.expect)(hs[0].generated).equal(['a\n', 'b\n']);
        // Two changed regions separated by a shared line stay separate.
        hs = hunks(['X\n', 'm\n', 'Y\n'], ['P\n', 'm\n', 'Q\n']);
        (0, expect_1.expect)(hs.filter((h) => 1 === h.kind).length).equal(2);
        // No shared lines: one change hunk from the trailing flush.
        hs = hunks(['X\n'], ['Y\n']);
        (0, expect_1.expect)(hs.length).equal(1);
        (0, expect_1.expect)(hs[0].kind).equal(1);
        // Both empty: no hunks.
        (0, expect_1.expect)(hunks([], []).length).equal(0);
    });
    // --- performance --------------------------------------------------------
    // The reason this engine exists. The previous dependency took ~6.4 s at
    // 5 000 lines and ~62 s at 10 000 on this shape.
    //
    // Skipped under coverage: instrumented timings measure the instrumentation,
    // not the algorithm.
    (0, node_test_1.test)('merge-large-repeated-vocabulary-is-fast', {
        skip: process.env.JOSTRACA_COVERAGE ?
            'timings are meaningless under coverage instrumentation' : false,
    }, () => {
        const n = 8000;
        const mk = (seed) => {
            let s = seed;
            const out = [];
            for (let i = 0; i < n; i++) {
                s = (s * 1103515245 + 12345) & 0x7fffffff;
                out.push('  key_' + (s % 40) + ': value_' + (s % 40) + '\n');
            }
            return out.join('');
        };
        const start = Date.now();
        merge(mk(2), mk(1), mk(3));
        const ms = Date.now() - start;
        (0, expect_1.expect)(ms < 30000).true();
    });
});
//# sourceMappingURL=diff.test.js.map