"use strict";
/* Copyright (c) 2026 Richard Rodger, MIT License */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// generate() itself: when it refuses, what it reports, and to whom.
//
// Each case here has a Go twin, named in the comment above it, and each
// began as a measured difference between the two ports.
const node_test_1 = require("node:test");
const Assert = __importStar(require("node:assert"));
const Fs = __importStar(require("node:fs"));
const Os = __importStar(require("node:os"));
const Path = __importStar(require("node:path"));
const memfs_1 = require("../dist/util/memfs");
const basic_1 = require("../dist/util/basic");
const __1 = require("../");
const START_TIME = 1735689600000;
const tmpdir = () => Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-generate-'));
(0, node_test_1.describe)('generate', () => {
    // A Fragment or CopyFiles `from` that does not exist is refused in the
    // DEFINE phase, against the filesystem the run will use, whether that
    // filesystem was supplied or defaulted. Nothing is written: no earlier
    // sibling file, no folder, no .jostraca baseline.
    //
    // A REAL FILESYSTEM with no `fs` option, because the default is the
    // point. Go twins: TestFragmentMissingFromDefaultFSWritesNothing and
    // TestCopyMissingFromDefaultFSWritesNothing.
    (0, node_test_1.describe)('define-time-from', () => {
        const refused = async (body) => {
            const dir = tmpdir();
            const out = Path.join(dir, 'out');
            try {
                await Assert.rejects((0, __1.Jostraca)({ now: () => START_TIME })
                    .generate({ folder: out }, () => (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 'ok.txt' }, () => (0, __1.Content)('OK'));
                    body();
                })));
                Assert.equal(Fs.existsSync(out), false, 'the output folder was created before the refusal');
            }
            finally {
                Fs.rmSync(dir, { recursive: true, force: true });
            }
        };
        (0, node_test_1.test)('fragment-missing-from-writes-nothing', async () => {
            await refused(() => (0, __1.File)({ name: 'b.txt' }, () => (0, __1.Fragment)({ from: 'nope.txt' })));
        });
        (0, node_test_1.test)('copy-missing-from-writes-nothing', async () => {
            await refused(() => (0, __1.CopyFiles)({ from: '/nonexistent-jostraca-define-time/x.txt' }));
        });
    });
    // The provider is chosen per call: the per-call fs, else the in-memory
    // fs when mem is on for this call, else the global fs, else node:fs.
    // vol() and fs() are present exactly when mem is on. Go twins in
    // go/mem_test.go.
    (0, node_test_1.describe)('provider-resolution', () => {
        const root = () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A')));
        // An explicit per-call `mem: false` used to write into the instance's
        // hidden global volume, which neither the disk nor vol() could reach.
        (0, node_test_1.test)('per-call-mem-false-writes-to-disk', async () => {
            const dir = tmpdir();
            try {
                const res = await (0, __1.Jostraca)({ mem: true, now: () => START_TIME })
                    .generate({ folder: dir, mem: false }, root);
                Assert.equal(Fs.readFileSync(Path.join(dir, 'a.txt'), 'utf8'), 'A');
                Assert.equal(res.vol, undefined);
                Assert.equal(res.fs, undefined);
            }
            finally {
                Fs.rmSync(dir, { recursive: true, force: true });
            }
        });
        (0, node_test_1.test)('global-mem-beats-global-fs', async () => {
            const own = (0, memfs_1.memfs)({});
            const res = await (0, __1.Jostraca)({ mem: true, fs: () => own.fs, now: () => START_TIME })
                .generate({ folder: '/out' }, root);
            Assert.deepEqual(own.vol.toJSON(), {});
            Assert.equal(res.vol().toJSON()['/out/a.txt'], 'A');
            Assert.notEqual(res.fs(), own.fs);
        });
        // The instance volume is built from `mem` alone, whatever `fs` says, so
        // calls share it: a fresh volume per call would lose the first output.
        (0, node_test_1.test)('global-mem-beside-global-fs-is-shared-across-calls', async () => {
            const own = (0, memfs_1.memfs)({});
            const j = (0, __1.Jostraca)({ mem: true, fs: () => own.fs, folder: '/out', now: () => START_TIME });
            const one = await j.generate({}, root);
            const two = await j.generate({}, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'b.txt' }, () => (0, __1.Content)('B'))));
            const vol = two.vol().toJSON();
            Assert.equal(vol['/out/a.txt'], 'A');
            Assert.equal(vol['/out/b.txt'], 'B');
            Assert.equal(two.fs(), one.fs());
            Assert.deepEqual(own.vol.toJSON(), {});
        });
        (0, node_test_1.test)('per-call-fs-beats-global-mem', async () => {
            const own = (0, memfs_1.memfs)({});
            const res = await (0, __1.Jostraca)({ mem: true, now: () => START_TIME })
                .generate({ folder: '/out', fs: () => own.fs }, root);
            Assert.equal(own.vol.toJSON()['/out/a.txt'], 'A');
            Assert.equal(res.fs(), own.fs);
            Assert.deepEqual(res.vol().toJSON(), {});
        });
        (0, node_test_1.test)('a-supplied-provider-gets-no-accessors', async () => {
            const own = (0, memfs_1.memfs)({});
            const res = await (0, __1.Jostraca)({ fs: () => own.fs, now: () => START_TIME })
                .generate({ folder: '/out' }, root);
            Assert.equal(own.vol.toJSON()['/out/a.txt'], 'A');
            Assert.equal(res.vol, undefined);
            Assert.equal(res.fs, undefined);
        });
        // Every files category is always a list, including on a run that
        // builds nothing.
        (0, node_test_1.test)('files-lists-are-always-lists', async () => {
            const EMPTY = {
                preserved: [], written: [], presented: [], diffed: [],
                merged: [], conflicted: [], unchanged: [],
            };
            const j = (0, __1.Jostraca)({ mem: true, folder: '/out', now: () => START_TIME });
            Assert.deepEqual((await j.generate({ build: false }, root)).files, EMPTY);
            Assert.deepEqual((await j.generate({}, () => { })).files, EMPTY);
            Assert.deepEqual((await j.generate({}, root)).files, { ...EMPTY, written: ['/out/a.txt'] });
        });
    });
    // After a successful generate, each non-fatal warning raised during THAT
    // call is replayed to that call's `log.debug`, one call per warning. A
    // refused run replays nothing, and a concurrent call's warnings never
    // reach this call's logger. Go twins in go/warning_replay_test.go.
    (0, node_test_1.describe)('warnings', () => {
        const capture = () => {
            const calls = [];
            const log = {};
            for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
                log[level] = (...args) => calls.push([level, ...args]);
            }
            return { log, calls };
        };
        // [kind, text...] of each replayed warning: the dlog entry is
        // [tag, file, when, ...args, stack], and only the args are portable.
        const warned = (calls) => calls.map(([level, payload]) => {
            Assert.equal(level, 'debug');
            Assert.equal(payload.point, 'jostraca-warning');
            Assert.equal(payload.dlogentry[0], 'jostraca');
            Assert.equal('string', typeof payload.note);
            return payload.dlogentry.slice(3, -1);
        });
        const gen = async (vol, root, log) => (0, __1.Jostraca)({ mem: true, vol, folder: '/out', now: () => START_TIME, log })
            .generate({}, root);
        (0, node_test_1.test)('inject-into-an-unmarked-file-warns-once', async () => {
            const { log, calls } = capture();
            await gen({ '/out/t.txt': 'no markers here\n' }, () => (0, __1.Project)({}, () => (0, __1.Inject)({ name: 't.txt' }, () => (0, __1.Content)('X'))), log);
            Assert.deepEqual(warned(calls), [[
                    'inject',
                    'markers not found, nothing injected: path=/out/t.txt ' +
                        'markers=["#--START--#\\n","\\n#--END--#"]',
                ]]);
        });
        (0, node_test_1.test)('an-unreadable-meta-log-warns-once', async () => {
            const { log, calls } = capture();
            await gen({ '/out/.jostraca/jostraca.meta.log': '{not json' }, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A'))), log);
            const w = warned(calls);
            Assert.equal(w.length, 1);
            Assert.equal(w[0][0], 'meta');
            // The parser's own message after the last err= is the runtime's.
            Assert.ok(w[0][1].startsWith('unreadable meta log, continuing with empty state: ' +
                '/out/.jostraca/jostraca.meta.log err=FileHandler:loadJSON: ' +
                'path=/out/.jostraca/jostraca.meta.log err='), w[0][1]);
        });
        (0, node_test_1.test)('a-second-save-of-one-path-warns', async () => {
            const { log, calls } = capture();
            await gen({}, () => (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 't.txt' }, () => (0, __1.Content)('a\n#--START--#\nold\n#--END--#\nz\n'));
                (0, __1.Inject)({ name: 't.txt' }, () => (0, __1.Content)('NEW'));
            }), log);
            Assert.deepEqual(warned(calls), [
                ['save', 'duplicate save, later content wins: /out/t.txt'],
                ['filelog', 'written', 'duplicate: /out/t.txt'],
            ]);
        });
        (0, node_test_1.test)('a-failed-chmod-of-an-unchanged-file-warns', async () => {
            const { fs } = (0, memfs_1.memfs)({});
            let fail = false;
            const provider = {
                ...fs,
                chmodSync: (p, mode) => {
                    if (fail) {
                        throw new Error('EPERM');
                    }
                    return fs.chmodSync(p, mode);
                },
            };
            const j = (0, __1.Jostraca)({ fs: () => provider, folder: '/out', now: () => START_TIME });
            const root = (mode) => () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.sh', mode }, () => (0, __1.Content)('X')));
            await j.generate({}, root(0o755));
            fail = true;
            const { log, calls } = capture();
            const res = await j.generate({ log }, root(0o700));
            Assert.deepEqual(res.files.unchanged, ['/out/a.sh']);
            Assert.deepEqual(warned(calls), [
                ['save', 'chmod of unchanged file failed: /out/a.sh'],
            ]);
        });
        // A failed write refuses the run, so a temp file it could not remove
        // is recorded in the debug buffer and replayed to no logger. A temp
        // file that is already gone was not left behind, so is not reported.
        (0, node_test_1.test)('a-failed-temp-cleanup-is-recorded', async () => {
            const dlog = (0, basic_1.getdlog)('jostraca');
            const fail = (code) => Object.assign(new Error(code), { code });
            const isTmp = (p) => p.includes('.jostraca-tmp-');
            const TMP = ['writeFileAtomic', 'temp cleanup failed: /out/a.txt.jostraca-tmp-*'];
            const cases = [
                ['partial-write-unremovable', (fs) => ({
                        writeFileSync: (p, c, o) => {
                            if (isTmp(p)) {
                                fs.writeFileSync(p, 'partial');
                                throw fail('EIO');
                            }
                            return fs.writeFileSync(p, c, o);
                        },
                        unlinkSync: () => { throw fail('EPERM'); },
                    }), [TMP]],
                ['create-failed-nothing-to-remove', (fs) => ({
                        writeFileSync: (p, c, o) => {
                            if (isTmp(p)) {
                                throw fail('EACCES');
                            }
                            return fs.writeFileSync(p, c, o);
                        },
                    }), []],
                ['rename-failed-unremovable', () => ({
                        renameSync: () => { throw fail('EXDEV'); },
                        unlinkSync: () => { throw fail('EPERM'); },
                    }), [TMP]],
                ['rename-failed-removed', () => ({
                        renameSync: () => { throw fail('EXDEV'); },
                    }), []],
            ];
            for (const [name, override, want] of cases) {
                const { fs, vol } = (0, memfs_1.memfs)({});
                const { log, calls } = capture();
                const mark = dlog.seq();
                await Assert.rejects((0, __1.Jostraca)({
                    fs: () => ({ ...fs, ...override(fs) }), folder: '/out', now: () => START_TIME, log,
                }).generate({}, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A')))), name);
                const got = dlog.log()
                    .filter((e) => e.seq > mark && 'writeFileAtomic' === e[3])
                    .map((e) => [e[3], e[4].replace(/\.jostraca-tmp-.*$/, '.jostraca-tmp-*')]);
                Assert.deepEqual(got, want, name);
                Assert.deepEqual(calls, [], name);
                if (0 === want.length) {
                    Assert.deepEqual(Object.keys(vol.toJSON()).filter(isTmp), [], name);
                }
            }
        });
        (0, node_test_1.test)('a-refused-run-replays-nothing', async () => {
            const { log, calls } = capture();
            await Assert.rejects(gen({ '/out/t.txt': 'no markers here\n' }, () => (0, __1.Project)({}, () => {
                (0, __1.Inject)({ name: 't.txt' }, () => (0, __1.Content)('X'));
                (0, __1.Inject)({ name: 'missing.txt' }, () => (0, __1.Content)('X'));
            }), log));
            Assert.deepEqual(calls, []);
        });
        (0, node_test_1.test)('a-concurrent-call-keeps-its-own-warnings', async () => {
            const one = capture();
            const two = capture();
            const j = (0, __1.Jostraca)({
                mem: true, vol: { '/one/t.txt': 'no markers\n' }, now: () => START_TIME
            });
            await Promise.all([
                j.generate({ folder: '/one', log: one.log }, () => (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 'x.txt' }, () => (0, __1.Content)('x'));
                    (0, __1.Inject)({ name: 't.txt' }, () => (0, __1.Content)('X'));
                })),
                j.generate({ folder: '/two', log: two.log }, () => (0, __1.Project)({}, () => {
                    for (let i = 0; i < 5; i++) {
                        (0, __1.File)({ name: 'f' + i + '.txt' }, () => (0, __1.Content)('y'));
                    }
                })),
            ]);
            Assert.equal(warned(one.calls).length, 1);
            Assert.deepEqual(two.calls, []);
        });
    });
    // Option values the map form can carry. The refusals of a value JSON can
    // hold are corpus rows (test/spec/options.tsv); these hold what a row
    // cannot. Go twins in go/options_map_values_test.go.
    (0, node_test_1.describe)('option-values', () => {
        // A string `cmp.Copy.ignore` entry is a regular expression source. It
        // used to pass validation and fail with a TypeError once a Copy walk
        // reached it, after the files before it were written.
        (0, node_test_1.test)('a-string-ignore-entry-is-a-regexp-source', async () => {
            const res = await (0, __1.Jostraca)({
                mem: true, folder: '/out', now: () => START_TIME,
                vol: { '/src/keep.txt': 'K', '/src/skip.log': 'S' },
                cmp: { Copy: { ignore: ['\\.log$'] } },
            }).generate({}, () => (0, __1.Project)({}, () => (0, __1.CopyFiles)({ from: '/src' })));
            const vol = res.vol().toJSON();
            Assert.equal(vol['/out/keep.txt'], 'K');
            Assert.equal(vol['/out/skip.log'], undefined);
            await Assert.rejects((0, __1.Jostraca)({ mem: true, cmp: { Copy: { ignore: ['['] } } })
                .generate({}, () => { }), (err) => err.message.startsWith('Jostraca Options: property "cmp.Copy.ignore": '));
        });
        // A logger is called through `debug`, so one without it was refused
        // only by the TypeError of the first warning it was sent.
        (0, node_test_1.test)('a-logger-needs-a-debug-function', () => {
            Assert.throws(() => (0, __1.Jostraca)({ log: { info: () => { } } }), { message: 'Jostraca Options: Value "{info:info}" for property "log" ' +
                    'is not a logger with a debug function' });
            (0, __1.Jostraca)({ log: { debug: () => { } } });
        });
    });
    // An empty folder is refused, global or per call, and nothing is
    // written. Go's typed Options cannot tell "" from unset and falls back
    // instead (TestEmptyFolderMeansUnset); its map form refuses it as here.
    (0, node_test_1.describe)('empty-folder', () => {
        const MSG = 'Jostraca Options: Validation failed for property "folder" ' +
            'with string "" because an empty string is not allowed.';
        (0, node_test_1.test)('a-global-empty-folder-throws', () => {
            Assert.throws(() => (0, __1.Jostraca)({ folder: '' }), { message: MSG });
        });
        (0, node_test_1.test)('a-per-call-empty-folder-rejects-and-writes-nothing', async () => {
            const dir = tmpdir();
            const prev = process.cwd();
            try {
                process.chdir(dir);
                await Assert.rejects((0, __1.Jostraca)({ now: () => START_TIME }).generate({ folder: '' }, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A')))), { message: MSG });
                Assert.deepEqual(Fs.readdirSync(dir), []);
            }
            finally {
                process.chdir(prev);
                Fs.rmSync(dir, { recursive: true, force: true });
            }
        });
    });
    // Every error jostraca raises itself has the same message BODY in both
    // ports: the text after TS's `<ERROR:>?<Op>:<phase>: ` prefix and after
    // Go's NodeError wrapper, `jostraca <step> @<path>: `. The wrappers
    // differ by runtime, and so does an embedded filesystem error, which is
    // the host's own text; those cases pin the step and the partial tree.
    // Go twins in go/error_text_test.go.
    (0, node_test_1.describe)('errors', () => {
        const body = (err) => String(err.message).replace(/^(ERROR:)?[A-Za-z]+:[a-z]+: /, '');
        const refusal = async (root) => {
            try {
                await (0, __1.Jostraca)({ mem: true, folder: '/out', now: () => START_TIME })
                    .generate({}, root);
            }
            catch (err) {
                return err;
            }
            throw new Error('expected a refusal');
        };
        (0, node_test_1.test)('duplicate-file-path', async () => {
            for (const folder of [undefined, '.']) {
                const err = await refusal(() => (0, __1.Project)({ folder }, () => {
                    (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('1'));
                    (0, __1.File)({ name: './a.txt' }, () => (0, __1.Content)('2'));
                }));
                Assert.equal(err.step, 'file');
                Assert.equal(body(err), 'two File components resolve to the same output ' +
                    'path, path=/out/a.txt, first=a.txt, second=./a.txt');
            }
        });
        (0, node_test_1.test)('name-traversal', async () => {
            const err = await refusal(() => (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'ok.txt' }, () => (0, __1.Content)('ok'));
                (0, __1.File)({ name: '../x.txt' }, () => (0, __1.Content)('x'));
            }));
            Assert.equal(err.step, 'file');
            Assert.equal(body(err), 'File name must not contain a ".." path segment, name=../x.txt');
        });
        // A Copy `to` is checked as the File a single-file copy becomes, and
        // as `Copy(to)` for a directory.
        (0, node_test_1.test)('copy-to-traversal', async () => {
            const cases = [
                ['/src/x.txt', '../x.txt', 'File name must not contain a ".." path segment, name=../x.txt'],
                ['/src/d', '../x', 'Copy(to) name must not contain a ".." path segment, name=../x'],
            ];
            for (const [from, to, want] of cases) {
                const err = await (0, __1.Jostraca)({
                    mem: true, folder: '/out', now: () => START_TIME,
                    vol: { '/src/x.txt': 'X', '/src/d/a.txt': 'A' },
                }).generate({}, () => (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 'ok.txt' }, () => (0, __1.Content)('ok'));
                    (0, __1.CopyFiles)({ from, to });
                })).then(() => null, (e) => e);
                Assert.ok(err, from + ': expected a refusal');
                Assert.equal(err.step, 'copy', from);
                Assert.equal(body(err), want, from);
            }
        });
        (0, node_test_1.test)('inject-target-missing', async () => {
            const err = await refusal(() => (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'ok.txt' }, () => (0, __1.Content)('ok'));
                (0, __1.Inject)({ name: 'nope.txt' }, () => (0, __1.Content)('X'));
            }));
            Assert.equal(err.step, 'inject');
            Assert.equal(body(err), 'inject target does not exist, path=/out/nope.txt ' +
                '(Inject rewrites an existing file; use File to create one)');
        });
        (0, node_test_1.test)('inject-one-empty-marker', async () => {
            const err = await refusal(() => (0, __1.Project)({}, () => {
                (0, __1.Inject)({ name: 'nope.txt', markers: ['X', ''] }, () => (0, __1.Content)('X'));
            }));
            Assert.equal(err.message, 'Inject: both markers must be non-empty, got ["X",""]');
        });
        // The body names the kind as the step does. Go twin:
        // TestErrorBodyMissingOp.
        (0, node_test_1.test)('missing-op', async () => {
            const Bogus = (0, __1.cmp)(function Bogus(props) {
                props.ctx$.node.kind = 'bogus';
            });
            const err = await refusal(() => (0, __1.Project)({}, () => Bogus({})));
            Assert.equal(err.step, 'bogus');
            Assert.equal(body(err), 'missing op: ' + err.step);
        });
        (0, node_test_1.test)('root-not-a-function', async () => {
            await Assert.rejects((0, __1.Jostraca)({ mem: true }).generate({}, undefined), { message: 'jostraca: generate root callback is not a function' });
        });
        (0, node_test_1.test)('define-time-from', async () => {
            const missing = await refusal(() => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Fragment)({})));
            Assert.equal(missing.message, 'Fragment: Validation failed for property "from" because the property is missing.');
            const frag = await refusal(() => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Fragment)({ from: 'nope.txt' })));
            Assert.ok(frag.message.startsWith('Fragment: Validation failed for property "from" ' +
                'with string "/out/nope.txt" because check "From" failed (threw: '), frag.message);
            // shape clips the value at 111 UTF-16 code units, not bytes.
            for (const [from, shown] of [
                ['/' + 'é'.repeat(80) + '.txt', '/' + 'é'.repeat(80) + '.txt'],
                ['/' + 'é'.repeat(200), '/' + 'é'.repeat(107) + '...'],
            ]) {
                const err = await refusal(() => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Fragment)({ from })));
                Assert.ok(err.message.startsWith('Fragment: Validation failed for property "from" ' +
                    'with string "' + shown + '" because check "From" failed (threw: '), err.message);
            }
            const copy = await refusal(() => (0, __1.CopyFiles)({ from: '/nope' }));
            Assert.ok(copy.message.startsWith('CopyFiles: '), copy.message);
            Assert.ok(copy.message.includes('Validation failed for property "from" ' +
                'with string "/nope" because check "From" failed (threw: '), copy.message);
        });
        // The trees of three parity-corpus scenarios, whose corpus rows record
        // only that they fail. The body is held here, with the host's error
        // after `(threw: ` normalised, and with the decoration TS's CopyFiles
        // adds (a `(model: path): ` prefix and a call-site suffix) removed.
        // Go twin: TestParityErrorScenarioBodies, on the corpus runners.
        (0, node_test_1.test)('parity-error-scenarios', async () => {
            const cases = [
                [() => (0, __1.Project)({ folder: 'app' }, () => (0, __1.File)({ name: 'index.html' }, () => (0, __1.Fragment)({ from: '/templates/does-not-exist.html' }))),
                    'Fragment: Validation failed for property "from" with string ' +
                        '"/templates/does-not-exist.html" because check "From" failed (threw: <os>)'],
                [() => (0, __1.Project)({ folder: 'app' }, () => (0, __1.Copy)({ from: '/src/does-not-exist.txt', to: 'a.txt' })),
                    'CopyFiles: Validation failed for property "from" with string ' +
                        '"/src/does-not-exist.txt" because check "From" failed (threw: <os>)'],
                [() => (0, __1.Project)({ folder: 'app' }, () => (0, __1.Inject)({ name: 'does-not-exist.txt' }, () => (0, __1.Content)('new content'))),
                    'inject target does not exist, path=/out/app/does-not-exist.txt ' +
                        '(Inject rewrites an existing file; use File to create one)'],
                [() => (0, __1.Project)({ folder: 'app' }, () => (0, __1.File)({ name: 'n.txt' }, () => (0, __1.Fragment)({ from: '/tm/noslot.txt' }, () => (0, __1.Content)('lost')))),
                    'jostraca: Fragment has non-Slot children, but /tm/noslot.txt contains no ' +
                        'unnamed <[SLOT]> marker to receive them; their output would be silently ' +
                        'discarded. Add an unnamed <[SLOT]> marker to the fragment source, or wrap ' +
                        'the children in a named Slot.'],
                [() => (0, __1.Project)({ folder: 'app' }, () => (0, __1.File)({ name: 'e.txt' }, () => (0, __1.Fragment)({ from: '/tm/model.txt', replace: { '/x*/': 'y' } }))),
                    'Regular expression matches empty string: ' +
                        '/(?<J_O>\\$\\$)(?<J_R>[^$]+)(?<J_C>\\$\\$)' +
                        '|(?<J_K1__t_t_SLOT_t_t_>[ \\t]*[-<!/#*]*[ \\t]*<\\[SLOT]>[ \\t]*[->/#*]*[ \\t]*)' +
                        '|(?<J_K2__x_>x*)/'],
            ];
            for (const [root, want] of cases) {
                const { fs } = (0, memfs_1.memfs)({
                    '/tm/noslot.txt': 'no markers\n',
                    '/tm/model.txt': 'M=$$name$$\n',
                });
                const err = await (0, __1.Jostraca)({})
                    .generate({ fs: () => fs, folder: '/out', now: () => START_TIME }, root)
                    .then(() => null, (e) => e);
                Assert.ok(err, want);
                Assert.equal(body(err)
                    .replace(/^CopyFiles: \([^)]*\): /, 'CopyFiles: ')
                    .replace(/ \[at [^\]]*\]$/, '')
                    .replace(/\(threw: .*$/s, '(threw: <os>)'), want);
            }
        });
        // A filesystem failure embeds the host's error, so these hold the
        // step and the partial tree the refusal leaves, not the text. A REAL
        // FILESYSTEM, because the failures are the operating system's.
        (0, node_test_1.test)('filesystem-failures-leave-the-same-tree', async () => {
            const walk = (d, rel = '') => Fs.readdirSync(d, { withFileTypes: true })
                .sort((a, b) => a.name < b.name ? -1 : 1)
                .flatMap((e) => e.isDirectory() ?
                [rel + e.name + '/', ...walk(Path.join(d, e.name), rel + e.name + '/')] :
                [rel + e.name]);
            const one = () => (0, __1.Project)({ folder: '.' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A\n')));
            const cases = [
                ['file-where-a-folder-goes',
                    (out) => Fs.writeFileSync(Path.join(out, 'sub'), 'I am a file\n'),
                    () => (0, __1.Project)({ folder: '.' }, () => (0, __1.Folder)({ name: 'sub' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A\n')))),
                    'folder', ['sub']],
                ['folder-where-a-file-goes',
                    (out) => Fs.mkdirSync(Path.join(out, 'a.txt')),
                    one, 'file', ['a.txt/']],
                ['meta-log-is-a-folder',
                    (out) => Fs.mkdirSync(Path.join(out, '.jostraca', 'jostraca.meta.log'), { recursive: true }),
                    one, undefined,
                    ['.jostraca/', '.jostraca/generated/', '.jostraca/generated/a.txt',
                        '.jostraca/jostraca.meta.log/', 'a.txt']],
                ['meta-folder-is-a-file',
                    (out) => Fs.writeFileSync(Path.join(out, '.jostraca'), 'x'),
                    one, 'file', ['.jostraca', 'a.txt']],
                ['preserve-backup-is-a-folder',
                    async (out) => {
                        await (0, __1.Jostraca)({ now: () => START_TIME }).generate({ folder: out }, one);
                        Fs.writeFileSync(Path.join(out, 'a.txt'), 'U\n');
                        Fs.mkdirSync(Path.join(out, 'a.old.txt'));
                    },
                    () => (0, __1.Project)({ folder: '.' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A2\n'))),
                    'file',
                    ['.jostraca/', '.jostraca/.gitignore', '.jostraca/generated/',
                        '.jostraca/generated/a.txt', '.jostraca/jostraca.meta.log',
                        'a.old.txt/', 'a.txt']],
            ];
            for (const [name, prep, root, step, tree] of cases) {
                const dir = tmpdir();
                const out = Path.join(dir, 'out');
                try {
                    Fs.mkdirSync(out);
                    await prep(out);
                    let err;
                    try {
                        await (0, __1.Jostraca)({
                            now: () => START_TIME,
                            ...('preserve-backup-is-a-folder' === name ?
                                { existing: { txt: { preserve: true } } } : {}),
                        }).generate({ folder: out }, root);
                    }
                    catch (e) {
                        err = e;
                    }
                    Assert.ok(err, name + ': expected a refusal');
                    Assert.equal(err.step, step, name);
                    Assert.deepEqual(walk(out), tree, name);
                    if ('preserve-backup-is-a-folder' === name) {
                        Assert.equal(Fs.readFileSync(Path.join(out, 'a.txt'), 'utf8'), 'U\n');
                    }
                }
                finally {
                    Fs.rmSync(dir, { recursive: true, force: true });
                }
            }
        });
    });
});
//# sourceMappingURL=generate.test.js.map