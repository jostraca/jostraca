"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_crypto_1 = require("node:crypto");
const expect_1 = require("./expect");
const memfs_1 = require("../dist/util/memfs");
const __1 = require("../");
const NOW = 1735689600000;
const BASE = '/out/.jostraca/generated/a.txt';
const META = '/out/.jostraca/jostraca.meta.log';
const quiet = { debug: () => null };
const fp = (s) => (0, node_crypto_1.createHash)('sha256').update(s).digest('hex').substring(0, 16);
// One output file, a.txt, regenerated under `txt`, on a volume kept
// across runs. Twin helper of baselineRig in go/baseline_test.go.
function rig(seed = {}) {
    const { fs } = (0, memfs_1.memfs)(seed);
    const run = (body, txt = { merge: true }, control = {}) => (0, __1.Jostraca)({ now: () => NOW, log: quiet }).generate({
        fs: () => fs, folder: '/out', existing: { txt }, control,
    }, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)(body))));
    const read = (p) => fs.readFileSync(p, 'utf8');
    const has = (p) => fs.existsSync(p);
    const write = (p, s) => fs.writeFileSync(p, s);
    const meta = () => JSON.parse(read(META)).files['a.txt'];
    const why = (res) => res.audit()
        .filter((e) => e[0].startsWith('FileHandler:save:'))
        .map((e) => e[1].why.join(' '))
        .pop();
    return { fs, run, read, has, write, meta, why };
}
(0, node_test_1.describe)('baseline', () => {
    // The baseline moves only when the generate lands in the file. Twin of
    // TestBaselineMovesOnlyWhenLanded.
    (0, node_test_1.test)('moves-only-when-landed', async () => {
        const held = async (name, txt, edit, skip) => {
            const r = rig();
            await r.run('A\n', { merge: true });
            r.write('/out/a.txt', edit);
            const res = await r.run('B\n', txt);
            (0, expect_1.expect)({ name, base: r.read(BASE) }).equal({ name, base: 'A\n' });
            // A skip record is the save's last word; a present record is made
            // before the baseline is reached.
            (0, expect_1.expect)({ name, hold: r.why(res).endsWith('within-0 hold-0') })
                .equal({ name, hold: skip });
        };
        await held('write-off', { write: false }, 'A\n', true);
        await held('protect', { merge: true }, 'A\nJOSTRACA_PROTECT\n', true);
        await held('present', { write: false, present: true }, 'A\n', false);
        const moved = async (name, txt, edit) => {
            const r = rig();
            await r.run('A\n', { merge: true });
            r.write('/out/a.txt', edit);
            await r.run('B\n', txt);
            (0, expect_1.expect)({ name, base: r.read(BASE) }).equal({ name, base: 'B\n' });
        };
        await moved('write', { write: true }, 'U\n');
        await moved('merge-clean', { merge: true }, 'A\n');
        await moved('merge-markers', { merge: true }, 'U\n');
        await moved('diff', { diff: true }, 'U\n');
        // A file already holding the generate holds it whatever the mode.
        await moved('write-off-same', { write: false }, 'B\n');
        await moved('present-same', { write: false, present: true }, 'B\n');
    });
    // A file left with an earlier merge's markers keeps the baseline those
    // markers came from, so resolving them and regenerating merges the
    // newer generate in. Before 0.41 the baseline moved on, and the next
    // merge kept the older generate's lines as if they were the user's.
    (0, node_test_1.test)('unresolved-keeps-its-baseline', async () => {
        const r = rig();
        await r.run('a\nb\nc\n');
        r.write('/out/a.txt', 'a\nUSER\nc\n');
        await r.run('a\nGEN1\nc\n');
        (0, expect_1.expect)(r.read('/out/a.txt').includes('<<<<<<< EXISTING: ')).true();
        const res = await r.run('a\nGEN2\nc\nd\n');
        (0, expect_1.expect)(res.files.conflicted).equal(['/out/a.txt']);
        (0, expect_1.expect)(r.read(BASE)).equal('a\nGEN1\nc\n');
        // The user keeps GEN1's line, as resolving the markers in favour of
        // the generate does. The next run brings GEN2 and the new line.
        r.write('/out/a.txt', 'a\nGEN1\nc\n');
        await r.run('a\nGEN2\nc\nd\n');
        (0, expect_1.expect)(r.read('/out/a.txt')).equal('a\nGEN2\nc\nd\n');
    });
    // A file that is one of its own earlier generates takes the new one
    // whole, as a checkout or branch switch leaves it. Twin of
    // TestEarlierGenerateTakesNewOne.
    (0, node_test_1.test)('earlier-generate', async () => {
        const r = rig();
        await r.run('A\nB\nC\n');
        await r.run('A\nB2\nC\n');
        r.write('/out/a.txt', 'A\nB\nC\n');
        let res = await r.run('A\nB2\nC\nD\n');
        (0, expect_1.expect)(r.read('/out/a.txt')).equal('A\nB2\nC\nD\n');
        (0, expect_1.expect)(res.files.merged).equal(['/out/a.txt']);
        (0, expect_1.expect)(res.files.conflicted).equal([]);
        (0, expect_1.expect)(r.why(res).includes('merge-earlier-0')).true();
        // Without a baseline at all, as after a clean of .jostraca/generated.
        r.fs.unlinkSync(BASE);
        r.write('/out/a.txt', 'A\nB2\nC\n');
        res = await r.run('A\nB3\nC\nD\n');
        (0, expect_1.expect)(r.read('/out/a.txt')).equal('A\nB3\nC\nD\n');
        (0, expect_1.expect)(res.files.unmerged).equal([]);
        // An edit is not an earlier generate, and merges as before.
        r.write('/out/a.txt', 'A\nB3\nC\nD\nUSER\n');
        await r.run('A\nB4\nC\nD\n');
        (0, expect_1.expect)(r.read('/out/a.txt')).equal('A\nB4\nC\nD\nUSER\n');
    });
    // The fingerprints of the generates that landed, newest last, at most
    // eight, each once. Twin of TestFingerprintHistory.
    (0, node_test_1.test)('fingerprint-history', async () => {
        const r = rig();
        for (let i = 0; i < 10; i++) {
            await r.run('v' + i + '\n');
        }
        await r.run('v4\n');
        (0, expect_1.expect)(r.meta().fingerprints)
            .equal(['v2', 'v3', 'v5', 'v6', 'v7', 'v8', 'v9', 'v4'].map((v) => fp(v + '\n')));
        // A held generate is not one that landed.
        r.write('/out/a.txt', 'JOSTRACA_PROTECT\n');
        await r.run('held\n');
        (0, expect_1.expect)(r.meta().fingerprints[7]).equal(fp('v4\n'));
        // Anything in a hand-edited log that is not a fingerprint is dropped.
        const log = JSON.parse(r.read(META));
        log.files['a.txt'].fingerprints = ['nope', 7, fp('v4\n')];
        r.write(META, JSON.stringify(log));
        await r.run('v4\n');
        (0, expect_1.expect)(r.meta().fingerprints).equal([fp('v4\n')]);
        // Only merge records them.
        await r.run('w\n', { write: false });
        (0, expect_1.expect)(r.meta().fingerprints).equal(undefined);
    });
    // No baseline: the file is listed, `write` overwrites it, no `write`
    // leaves it, and the baseline is recorded only when the generate
    // landed. Twin of TestNoBaselineIsListed.
    (0, node_test_1.test)('no-baseline', async () => {
        let r = rig({ '/out/a.txt': 'USER\n' });
        let res = await r.run('GEN\n', { merge: true });
        (0, expect_1.expect)(res.files.unmerged).equal(['/out/a.txt']);
        (0, expect_1.expect)(res.files.written).equal(['/out/a.txt']);
        (0, expect_1.expect)(r.read('/out/a.txt')).equal('GEN\n');
        (0, expect_1.expect)(r.why(res).includes('merge-nobase-0')).true();
        (0, expect_1.expect)(r.read(BASE)).equal('GEN\n');
        r = rig({ '/out/a.txt': 'USER\n' });
        res = await r.run('GEN\n', { merge: true, write: false });
        (0, expect_1.expect)(res.files.unmerged).equal(['/out/a.txt']);
        (0, expect_1.expect)(r.read('/out/a.txt')).equal('USER\n');
        (0, expect_1.expect)(r.has(BASE)).false();
        // So it stays listed until something lands, rather than adopting a
        // baseline the file never held.
        res = await r.run('GEN\n', { merge: true, write: false });
        (0, expect_1.expect)(res.files.unmerged).equal(['/out/a.txt']);
        // With `control.duplicate: false` there is never a baseline.
        r = rig({ '/out/a.txt': 'USER\n' });
        res = await r.run('GEN\n', { merge: true }, { duplicate: false });
        (0, expect_1.expect)(res.files.unmerged).equal(['/out/a.txt']);
    });
    // `conflict: 'fail'` leaves every file it cannot merge as it was, with
    // its baseline, writes the rest, and rejects once the build is done.
    // Twin of TestConflictFail.
    (0, node_test_1.test)('conflict-fail', async () => {
        const { fs } = (0, memfs_1.memfs)({});
        const run = (b, c, txt) => (0, __1.Jostraca)({ now: () => NOW, log: quiet }).generate({
            fs: () => fs, folder: '/out', existing: { txt },
        }, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'b.txt' }, () => (0, __1.Content)(b));
            (0, __1.File)({ name: 'c.txt' }, () => (0, __1.Content)(c));
        }));
        const read = (p) => fs.readFileSync(p, 'utf8');
        const fail = { merge: true, conflict: 'fail' };
        await run('b\n', 'c\n', { merge: true });
        fs.writeFileSync('/out/b.txt', 'USER\n');
        let err;
        try {
            await run('B2\n', 'C2\n', fail);
        }
        catch (e) {
            err = e;
        }
        (0, expect_1.expect)(err.message).equal('jostraca: 3-way merge produced conflicts, ' +
            'left unchanged: /out/b.txt (conflict)');
        (0, expect_1.expect)(err.conflicts).equal([{ path: '/out/b.txt', reason: 'conflict' }]);
        (0, expect_1.expect)(err.result.files.conflicted).equal(['/out/b.txt']);
        (0, expect_1.expect)(err.result.files.merged).equal(['/out/b.txt', '/out/c.txt']);
        (0, expect_1.expect)(read('/out/b.txt')).equal('USER\n');
        (0, expect_1.expect)(read('/out/.jostraca/generated/b.txt')).equal('b\n');
        (0, expect_1.expect)(read('/out/c.txt')).equal('C2\n');
        (0, expect_1.expect)(read('/out/.jostraca/generated/c.txt')).equal('C2\n');
        (0, expect_1.expect)(JSON.parse(read(META)).files['b.txt'].conflict).equal(true);
        // The same run fails the same way until the conflict is dealt with.
        await (0, expect_1.expect)(run('B2\n', 'C2\n', fail)).rejects(/b\.txt \(conflict\)/);
        // Folding the incoming change in by hand resolves it.
        fs.writeFileSync('/out/b.txt', 'B2\n');
        const res = await run('B2\n', 'C2\n', fail);
        (0, expect_1.expect)(res.files.conflicted).equal([]);
        // Unresolved markers and a missing baseline fail too.
        fs.writeFileSync('/out/b.txt', '<<<<<<< EXISTING: X/merge\nU\n=======\nB2\n' +
            '>>>>>>> GENERATED: X/merge\n');
        fs.unlinkSync('/out/.jostraca/generated/c.txt');
        fs.writeFileSync('/out/c.txt', 'EDIT\n');
        const again = await run('B3\n', 'C3\n', fail).catch((e) => e);
        (0, expect_1.expect)(again.message).equal('jostraca: 3-way merge produced conflicts, ' +
            'left unchanged: /out/b.txt (unresolved conflict markers), /out/c.txt (no baseline)');
        (0, expect_1.expect)(read('/out/c.txt')).equal('EDIT\n');
        (0, expect_1.expect)(fs.existsSync('/out/.jostraca/generated/c.txt')).false();
    });
    (0, node_test_1.test)('conflict-option', async () => {
        const r = rig();
        await (0, expect_1.expect)(r.run('A\n', { merge: true, conflict: 'skip' })).rejects(/conflict/);
        await (0, expect_1.expect)((0, __1.Jostraca)({ existing: { bin: { conflict: 'fail' } } })
            .generate({ mem: true }, () => null)).rejects(/conflict/);
    });
});
//# sourceMappingURL=baseline.test.js.map