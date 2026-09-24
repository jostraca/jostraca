"use strict";
// File-handler behaviour pinned across both stacks. Each test here has a
// Go twin; the names match the regression rows recorded for the port.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = require("node:test");
const expect_1 = require("./expect");
const memfs_1 = require("../dist/util/memfs");
const __1 = require("../");
const NOW = 1735689600000;
const META = '/out/.jostraca/jostraca.meta.log';
const quiet = {
    trace: () => { }, debug: () => { }, info: () => { },
    warn: () => { }, error: () => { }, fatal: () => { },
};
function metaOf(fs, path = META) {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
}
(0, node_test_1.describe)('filehandler', () => {
    // A JOSTRACA_PROTECT marker protects a target whatever its
    // classification: text, binary by extension, or binary by content.
    (0, node_test_1.test)('binary-protect', async () => {
        const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff]);
        const runs = [
            ['file', {}, () => (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 'a.png' }, () => (0, __1.Content)('P2'));
                })],
            ['copy-one', {}, () => (0, __1.Project)({}, () => {
                    (0, __1.Copy)({ from: '/src/one/a.png', to: 'a.png' });
                })],
            ['copy-tree', {}, () => (0, __1.Project)({}, () => {
                    (0, __1.Copy)({ from: '/src/tree' });
                })],
            ['file-preserve', { existing: { bin: { preserve: true } } },
                () => (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 'a.png' }, () => (0, __1.Content)('P2'));
                })],
            ['copy-preserve', { existing: { bin: { preserve: true } } },
                () => (0, __1.Project)({}, () => {
                    (0, __1.Copy)({ from: '/src/one/a.png', to: 'a.png' });
                })],
        ];
        for (const [name, opts, root] of runs) {
            const { fs } = (0, memfs_1.memfs)({
                '/src/one/a.png': PNG,
                '/src/tree/a.png': PNG,
                '/out/a.png': 'JOSTRACA_PROTECT',
            });
            const res = await (0, __1.Jostraca)({ now: () => NOW, log: quiet })
                .generate({ fs: () => fs, folder: '/out', ...opts }, root);
            (0, expect_1.expect)(fs.readFileSync('/out/a.png', 'utf8')).equal('JOSTRACA_PROTECT');
            (0, expect_1.expect)(res.files.written).equal([]);
            (0, expect_1.expect)(res.files.preserved).equal([]);
            (0, expect_1.expect)(fs.existsSync('/out/a.old.png')).equal(false);
            const entry = metaOf(fs).files['a.png'];
            (0, expect_1.expect)({ name, action: entry.action, protect: entry.protect })
                .equal({ name, action: 'skip', protect: true });
        }
    });
    // Inject exclude is coerced with `!!props.exclude`: any truthy value
    // skips the injection, whatever it names.
    (0, node_test_1.test)('inject-exclude-truthy', async () => {
        const seed = 'a\n#--START--#\nold\n#--END--#\nz\n';
        const injected = 'a\n#--START--#\nNEW\n#--END--#\nz\n';
        const typed = (ex) => () => (0, __1.Project)({}, () => {
            (0, __1.Inject)({ name: 't.txt', exclude: ex }, () => (0, __1.Content)('NEW'));
        });
        const tree = (ex) => (0, __1.cmpTree)({
            cmp: 'Project', props: {},
            children: [{
                    cmp: 'Inject', props: { name: 't.txt', exclude: ex },
                    children: [{ cmp: 'Content', props: { src: 'NEW' } }],
                }],
        });
        const run = async (root) => {
            const { fs } = (0, memfs_1.memfs)({ '/out/t.txt': seed });
            const res = await (0, __1.Jostraca)({ now: () => NOW, log: quiet })
                .generate({ fs: () => fs, folder: '/out' }, root);
            return { res, fs };
        };
        for (const ex of [true, 'other', [], ['other'], {}, 1, -1]) {
            for (const root of [typed(ex), tree(ex)]) {
                const { res, fs } = await run(root);
                (0, expect_1.expect)({ ex, t: fs.readFileSync('/out/t.txt', 'utf8') })
                    .equal({ ex, t: seed });
                (0, expect_1.expect)(res.files.written).equal([]);
                (0, expect_1.expect)(fs.existsSync('/out/.jostraca/generated/t.txt')).equal(false);
                if (fs.existsSync(META)) {
                    (0, expect_1.expect)(metaOf(fs).files['t.txt']).equal(undefined);
                }
            }
        }
        for (const ex of [false, '', 0]) {
            for (const root of [typed(ex), tree(ex)]) {
                const { fs } = await run(root);
                (0, expect_1.expect)({ ex, t: fs.readFileSync('/out/t.txt', 'utf8') })
                    .equal({ ex, t: injected });
            }
        }
    });
    // An Inject's children build the injected region exactly as they would
    // build a File: Fragment output and a single-file Copy's spliced text
    // included, in source order.
    (0, node_test_1.test)('inject-fragment-and-copy-children', async () => {
        const marked = 'A\n#--START--#\nold1\n#--END--#\nB\n#--START--#\nold2\n#--END--#\nC\n';
        const block = (body) => 'A\n#--START--#\n' + body +
            '\n#--END--#\nB\n#--START--#\n' + body + '\n#--END--#\nC\n';
        const run = async (root) => {
            const { fs } = (0, memfs_1.memfs)({
                '/tpl/model.txt': 'M=$$name$$\n',
                '/tpl/single.txt': 'single $$name$$ FOO\n',
                '/out/t.txt': marked,
            });
            await (0, __1.Jostraca)({ now: () => NOW, log: quiet, model: { name: 'World' } })
                .generate({ fs: () => fs, folder: '/out' }, root);
            return fs;
        };
        const fs0 = await run(() => (0, __1.Project)({}, () => {
            (0, __1.Inject)({ name: 't.txt' }, () => {
                (0, __1.Content)('c1;');
                (0, __1.Fragment)({ from: '/tpl/model.txt' });
                (0, __1.Content)('c2;');
            });
        }));
        (0, expect_1.expect)(fs0.readFileSync('/out/t.txt', 'utf8')).equal(block('c1;M=World\nc2;'));
        const fs1 = await run(() => (0, __1.Project)({}, () => {
            (0, __1.Inject)({ name: 't.txt' }, () => {
                (0, __1.Content)('pre;');
                (0, __1.Copy)({ from: '/tpl/single.txt', to: 'copied.txt' });
                (0, __1.Content)('post;');
            });
        }));
        (0, expect_1.expect)(fs1.readFileSync('/out/t.txt', 'utf8'))
            .equal(block('pre;single World FOO\npost;'));
        (0, expect_1.expect)(fs1.readFileSync('/out/copied.txt', 'utf8')).equal('single World FOO\n');
    });
    // A Slot outside a Fragment is transparent: its children render in
    // place in the enclosing File or Inject.
    (0, node_test_1.test)('slot-outside-fragment', async () => {
        const Wrap = (0, __1.cmp)(function Wrap(_props, children) {
            (0, __1.each)(children, { call: true });
        });
        const cases = [
            ['named', () => {
                    (0, __1.Content)('a');
                    (0, __1.Slot)({ name: 'x' }, () => (0, __1.Content)('S'));
                    (0, __1.Content)('b');
                }, 'aSb'],
            ['unnamed', () => {
                    (0, __1.Content)('a');
                    (0, __1.Slot)({}, () => (0, __1.Content)('S'));
                    (0, __1.Content)('b');
                }, 'aSb'],
            ['nested', () => {
                    (0, __1.Content)('a');
                    (0, __1.Slot)({ name: 'x' }, () => {
                        (0, __1.Content)('S');
                        (0, __1.Slot)({ name: 'y' }, () => (0, __1.Content)('T'));
                    });
                    (0, __1.Content)('b');
                }, 'aSTb'],
            ['cmp-wrapped', () => {
                    (0, __1.Content)('a');
                    Wrap(() => { (0, __1.Slot)({ name: 'x' }, () => (0, __1.Content)('S')); });
                    (0, __1.Content)('b');
                }, 'aSb'],
        ];
        for (const [name, body, want] of cases) {
            const { fs } = (0, memfs_1.memfs)({});
            await (0, __1.Jostraca)({ now: () => NOW, log: quiet })
                .generate({ fs: () => fs, folder: '/out' }, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 's.txt' }, body)));
            (0, expect_1.expect)({ name, s: fs.readFileSync('/out/s.txt', 'utf8') })
                .equal({ name, s: want });
        }
        const { fs } = (0, memfs_1.memfs)({ '/out/t.txt': '<\n#--START--#\nold\n#--END--#\n>' });
        await (0, __1.Jostraca)({ now: () => NOW, log: quiet })
            .generate({ fs: () => fs, folder: '/out' }, () => (0, __1.Project)({}, () => {
            (0, __1.Inject)({ name: 't.txt' }, () => {
                (0, __1.Content)('a');
                (0, __1.Slot)({ name: 'x' }, () => (0, __1.Content)('S'));
                (0, __1.Content)('b');
            });
        }));
        (0, expect_1.expect)(fs.readFileSync('/out/t.txt', 'utf8'))
            .equal('<\n#--START--#\naSb\n#--END--#\n>');
    });
    // A File exclude applies only when the target exists. true skips it; a
    // string, or a list holding a string, skips it when equal to the
    // component path: the Project name, the Folder names, the File name.
    // Never the Project folder. A RegExp entry matches nothing.
    (0, node_test_1.test)('file-exclude-string-and-list', async () => {
        const file = (name, exclude) => ({
            cmp: 'File', props: { name, exclude },
            children: [{ cmp: 'Content', props: { src: 'NEW' } }],
        });
        const rows = [
            ['string', '/out/keep.txt', true, () => (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 'keep.txt', exclude: 'keep.txt' }, () => (0, __1.Content)('NEW'));
                }), { cmp: 'Project', props: {}, children: [file('keep.txt', 'keep.txt')] }],
            ['list-in-folder', '/out/sub/keep2.txt', true, () => (0, __1.Project)({}, () => {
                    (0, __1.Folder)({ name: 'sub' }, () => {
                        (0, __1.File)({ name: 'keep2.txt', exclude: ['sub/keep2.txt'] }, () => (0, __1.Content)('NEW'));
                    });
                }), {
                    cmp: 'Project', props: {}, children: [{
                            cmp: 'Folder', props: { name: 'sub' },
                            children: [file('keep2.txt', ['sub/keep2.txt'])],
                        }]
                }],
            ['named-project', '/out/a.txt', true, () => (0, __1.Project)({ name: 'pn' }, () => {
                    (0, __1.File)({ name: 'a.txt', exclude: 'pn/a.txt' }, () => (0, __1.Content)('NEW'));
                }), { cmp: 'Project', props: { name: 'pn' }, children: [file('a.txt', 'pn/a.txt')] }],
            ['project-folder-is-not-the-path', '/out/x/a.txt', false,
                () => (0, __1.Project)({ folder: 'x' }, () => {
                    (0, __1.File)({ name: 'a.txt', exclude: 'x/a.txt' }, () => (0, __1.Content)('NEW'));
                }), { cmp: 'Project', props: { folder: 'x' }, children: [file('a.txt', 'x/a.txt')] }],
            ['regexp-matches-nothing', '/out/a.txt', false, () => (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 'a.txt', exclude: [/a/] }, () => (0, __1.Content)('NEW'));
                }), null],
            ['other-values-do-not-exclude', '/out/a.txt', false, () => (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 'a.txt', exclude: [] }, () => (0, __1.Content)('NEW'));
                }), { cmp: 'Project', props: {}, children: [file('a.txt', [])] }],
        ];
        for (const [name, out, excluded, typed, tree] of rows) {
            for (const root of [typed, null == tree ? null : (0, __1.cmpTree)(tree)]) {
                if (null == root)
                    continue;
                const { fs } = (0, memfs_1.memfs)({ [out]: 'OLD' });
                const res = await (0, __1.Jostraca)({ now: () => NOW, log: quiet })
                    .generate({ fs: () => fs, folder: '/out' }, root);
                const rel = out.substring('/out/'.length);
                const got = {
                    name,
                    content: fs.readFileSync(out, 'utf8'),
                    written: res.files.written.length,
                    baseline: fs.existsSync('/out/.jostraca/generated/' + rel),
                    meta: null != metaOf(fs).files[rel],
                };
                (0, expect_1.expect)(got).equal(excluded ?
                    { name, content: 'OLD', written: 0, baseline: false, meta: false } :
                    { name, content: 'NEW', written: 1, baseline: true, meta: true });
            }
        }
    });
    // Bytes that are not UTF-8 survive byte for byte wherever they are read
    // as text: the Inject target, a Fragment source and a text Copy source,
    // into the written file and its baseline alike. The audit reports byte
    // sizes. Each of the three used to be decoded as UTF-8, and every invalid
    // byte came out as U+FFFD. Twin of TestNonUTF8SourcesByteForByte.
    (0, node_test_1.test)('nonutf8-sources-byte-for-byte', async () => {
        const L = (s) => Buffer.from(s, 'latin1');
        const { fs } = (0, memfs_1.memfs)({
            '/out/t.txt': L('caf\xe9\n#--START--#\nold\n#--END--#\n'),
            '/src/j.txt': L('caf\xe9 $$m$$\n'),
            '/src/f.txt': L('frag caf\xe9 $$m$$\n'),
            '/src/g.txt': L('slot \xff\n'),
            '/src/h.txt': 'outer <[SLOT:s]>|',
        });
        const res = await (0, __1.Jostraca)({ now: () => NOW, log: quiet, model: { m: 'M' } })
            .generate({ fs: () => fs, folder: '/out' }, () => (0, __1.Project)({}, () => {
            (0, __1.Inject)({ name: 't.txt' }, () => {
                (0, __1.Content)('NEW;');
                (0, __1.Fragment)({ from: '/src/g.txt' });
            });
            (0, __1.Copy)({ from: '/src/j.txt' });
            (0, __1.File)({ name: 'fr.txt' }, () => (0, __1.Fragment)({ from: '/src/f.txt', indent: '> ' }));
            (0, __1.File)({ name: 'hk.txt' }, () => (0, __1.Copy)({ from: '/src/j.txt', to: 'k.txt' }));
            (0, __1.File)({ name: 'sl.txt' }, () => (0, __1.Fragment)({ from: '/src/h.txt' }, () => {
                (0, __1.Slot)({ name: 's' }, () => (0, __1.Fragment)({ from: '/src/g.txt' }));
            }));
        }));
        const want = {
            't.txt': L('caf\xe9\n#--START--#\nNEW;slot \xff\n\n#--END--#\n'),
            'j.txt': L('caf\xe9 M\n'),
            'k.txt': L('caf\xe9 M\n'),
            'fr.txt': L('> frag caf\xe9 M\n'),
            'hk.txt': L('caf\xe9 M\n'),
            'sl.txt': L('outerslot \xff\n|'),
        };
        for (const [name, bytes] of Object.entries(want)) {
            for (const at of ['/out/', '/out/.jostraca/generated/']) {
                (0, expect_1.expect)({ at: at + name, hex: fs.readFileSync(at + name).toString('hex') })
                    .equal({ at: at + name, hex: bytes.toString('hex') });
            }
        }
        const sizes = res.audit()
            .filter(([tag, d]) => tag.startsWith('FileHandler:saveFile:') &&
            !d.path.includes('.jostraca'))
            .map(([, d]) => [d.path, d.size]);
        (0, expect_1.expect)(sizes).equal([
            ['/out/t.txt', want['t.txt'].length],
            ['/out/j.txt', want['j.txt'].length],
            ['/out/fr.txt', want['fr.txt'].length],
            ['/out/k.txt', want['k.txt'].length],
            ['/out/hk.txt', want['hk.txt'].length],
            ['/out/sl.txt', want['sl.txt'].length],
        ]);
    });
    // New files and directories take 0666 and 0777 less the process umask.
    (0, node_test_1.test)('umask-default-modes', { skip: 'win32' === process.platform }, async () => {
        const old = process.umask(0o002);
        const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'jostraca-umask-'));
        try {
            const out = node_path_1.default.join(dir, 'out');
            await (0, __1.Jostraca)({ now: () => NOW, log: quiet })
                .generate({ folder: out }, () => (0, __1.Project)({}, () => {
                (0, __1.Folder)({ name: 'sub' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A')));
            }));
            const want = {
                'sub/a.txt': 0o664,
                'sub': 0o775,
                '.jostraca/generated/sub/a.txt': 0o664,
                '.jostraca/generated/sub': 0o775,
                '.jostraca/jostraca.meta.log': 0o664,
                '.jostraca/.gitignore': 0o664,
                '.jostraca': 0o775,
            };
            const got = {};
            for (const rel of Object.keys(want)) {
                got[rel] = node_fs_1.default.statSync(node_path_1.default.join(out, rel)).mode & 0o777;
            }
            (0, expect_1.expect)(got).equal(want);
        }
        finally {
            process.umask(old);
            node_fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
        const { fs } = (0, memfs_1.memfs)({ '/d/a.txt': 'A' });
        (0, expect_1.expect)(fs.statSync('/d/a.txt').mode & 0o777).equal(0o666);
        (0, expect_1.expect)(fs.statSync('/d').mode & 0o777).equal(0o777);
    });
    // In-memory keys are canonical absolute paths: backslashes folded, `.`
    // and `..` resolved, a relative path resolved against the working
    // directory. A vol seeded with the cwd-absolute key and generated with a
    // relative folder addresses the same file.
    (0, node_test_1.test)('memfs-keys-resolve-against-cwd', async () => {
        const cwd = process.cwd().replace(/\\/g, '/');
        const parent = cwd.substring(0, cwd.lastIndexOf('/')) || '/';
        const join = (dir, rest) => ('/' === dir ? '' : dir) + '/' + rest;
        const cases = [
            ['a.txt', join(cwd, 'a.txt')],
            ['', cwd],
            ['.', cwd],
            ['./out/a.txt', join(cwd, 'out/a.txt')],
            ['a\\b.txt', join(cwd, 'a/b.txt')],
            ['../z', join(parent, 'z')],
            ['/', '/'],
            ['/x/../y', '/y'],
            ['/a\\b', '/a/b'],
            ['/out//a/./b', '/out/a/b'],
            ['C:\\x\\y', 'C:/x/y'],
            ['C:/x/../y', 'C:/y'],
        ];
        for (const [p, want] of cases) {
            (0, expect_1.expect)({ p, got: (0, memfs_1.memClean)(p) }).equal({ p, got: want });
        }
        const abs = cwd + '/out/a.txt';
        const j = (0, __1.Jostraca)({ mem: true, vol: { [abs]: 'OLD' }, now: () => NOW, log: quiet });
        const res = await j.generate({
            folder: 'out', existing: { txt: { write: false } },
        }, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('NEW'))));
        (0, expect_1.expect)(res.files.written).equal([]);
        const vol = res.vol().toJSON();
        const keys = Object.keys(vol).filter((k) => k.endsWith('/a.txt') && !k.includes('.jostraca'));
        (0, expect_1.expect)(keys).equal([abs]);
        (0, expect_1.expect)(vol[abs]).equal('OLD');
        for (const k of Object.keys(vol)) {
            (0, expect_1.expect)({ k, under: k.startsWith(cwd + '/out/') }).equal({ k, under: true });
        }
    });
    // An output folder with a trailing slash behaves exactly like the same
    // folder without one: folder-relative meta keys, baselines written, and a
    // later merge that keeps the user's edit.
    (0, node_test_1.test)('folder-trailing-slash', async () => {
        const cwd = process.cwd().replace(/\\/g, '/');
        for (const [folder, base] of [
            ['out/', cwd + '/out'],
            ['./out/', cwd + '/out'],
            ['out//', cwd + '/out'],
            ['out\\', cwd + '/out'],
            ['/abs/out/', '/abs/out'],
            // Separators are folded BEFORE the path is normalised, so a
            // backslash `..` segment resolves as a slash one does.
            ['o\\..\\out', cwd + '/out'],
            ['o/x\\..\\..\\out\\', cwd + '/out'],
            ['/abs/o\\..\\out', '/abs/out'],
        ]) {
            const { fs } = (0, memfs_1.memfs)({});
            const j = (0, __1.Jostraca)({ log: quiet });
            const root = (b) => () => (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)(b));
                (0, __1.Folder)({ name: 'sub' }, () => (0, __1.File)({ name: 'b.txt' }, () => (0, __1.Content)('B\n')));
            });
            await j.generate({ fs: () => fs, folder, now: () => NOW }, root('L1\nL2\nL3\n'));
            (0, expect_1.expect)({ folder, a: fs.existsSync(base + '/.jostraca/generated/a.txt') })
                .equal({ folder, a: true });
            (0, expect_1.expect)(fs.existsSync(base + '/.jostraca/generated/sub/b.txt')).equal(true);
            (0, expect_1.expect)(Object.keys(metaOf(fs, base + '/.jostraca/jostraca.meta.log').files))
                .equal(['a.txt', 'sub/b.txt']);
            fs.writeFileSync(base + '/a.txt', 'L1\nU\nL3\n');
            const res = await j.generate({
                fs: () => fs, folder, now: () => NOW + 1, existing: { txt: { merge: true } },
            }, root('L1\nG\nL3\n'));
            (0, expect_1.expect)({ folder, merged: res.files.merged.length, conflicted: res.files.conflicted.length })
                .equal({ folder, merged: 1, conflicted: 1 });
            (0, expect_1.expect)(res.files.merged[0].endsWith('/a.txt')).equal(true);
            const text = fs.readFileSync(base + '/a.txt', 'utf8');
            (0, expect_1.expect)(text.includes('U\n') && text.includes('G\n')).equal(true);
        }
    });
    // A backslash `..` segment in the output folder or a Project folder is
    // folded, then resolved, so the run leaves no stray directory for the
    // segment it walked back out of, and its bookkeeping sits under the folder
    // its files are written to.
    (0, node_test_1.test)('backslash-dot-dot-folders', async () => {
        const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'jostraca-bsdd-'));
        try {
            const base = dir.replace(/\\/g, '/');
            await (0, __1.Jostraca)({ now: () => NOW, log: quiet })
                .generate({ folder: base + '/o\\..\\out' }, () => {
                (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A')));
                (0, __1.Project)({ folder: 'p\\..\\q' }, () => (0, __1.File)({ name: 'b.txt' }, () => (0, __1.Content)('B')));
            });
            const got = [];
            const walk = (d) => {
                for (const e of node_fs_1.default.readdirSync(d, { withFileTypes: true })) {
                    const p = node_path_1.default.join(d, e.name);
                    got.push(node_path_1.default.relative(dir, p).replace(/\\/g, '/') + (e.isDirectory() ? '/' : ''));
                    if (e.isDirectory())
                        walk(p);
                }
            };
            walk(dir);
            got.sort();
            (0, expect_1.expect)(got).equal([
                'out/',
                'out/.jostraca/',
                'out/.jostraca/.gitignore',
                'out/.jostraca/generated/',
                'out/.jostraca/generated/a.txt',
                'out/.jostraca/generated/q/',
                'out/.jostraca/generated/q/b.txt',
                'out/.jostraca/jostraca.meta.log',
                'out/a.txt',
                'out/q/',
                'out/q/b.txt',
            ]);
            (0, expect_1.expect)(Object.keys(metaOf(node_fs_1.default, base + '/out/.jostraca/jostraca.meta.log').files))
                .equal(['a.txt', 'q/b.txt']);
        }
        finally {
            node_fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
    // An output name ending in `/`, or an empty one, names a directory, and
    // the path keeps its trailing slash as Path.normalize keeps it. No file
    // is written there: the read or the write is refused, with this body
    // before the host's own error text, and the tree stops where the refusal
    // came. Twin of TestTrailingSlashOutputNames.
    (0, node_test_1.test)('trailing-slash-output-names', async () => {
        const cases = [
            ['empty', () => {
                    (0, __1.File)({ name: 'first.txt' }, () => (0, __1.Content)('F'));
                    (0, __1.Folder)({ name: 'sub' }, () => (0, __1.File)({ name: '' }, () => (0, __1.Content)('X')));
                }, 'file', 'FileHandler:loadFile: path=/out/sub/ err=',
                ['/out/.jostraca/generated/first.txt', '/out/first.txt', '/out/sub']],
            ['file', () => (0, __1.File)({ name: 'x/' }, () => (0, __1.Content)('X')),
                'file', 'FileHandler:saveFile:FileOp:after:write: path=/out/x/:', []],
            ['inject', () => (0, __1.Inject)({ name: 't.txt/' }, () => (0, __1.Content)('X')),
                'inject', 'FileHandler:saveFile:write: path=/out/t.txt/:', []],
            ['copy', () => (0, __1.Copy)({ from: '/src/one.txt', to: 'y/' }),
                'copy', 'FileHandler:saveFile:Copy:copyFile:write: path=/out/y/:', []],
        ];
        for (const [name, def, step, body, wrote] of cases) {
            const { fs, vol } = (0, memfs_1.memfs)({
                '/src/one.txt': 'ONE\n',
                '/out/t.txt': 'a\n#--START--#\nold\n#--END--#\n',
            });
            let err = null;
            try {
                await (0, __1.Jostraca)({ now: () => NOW, log: quiet })
                    .generate({ fs: () => fs, folder: '/out' }, () => (0, __1.Project)({}, def));
            }
            catch (e) {
                err = e;
            }
            (0, expect_1.expect)({ name, step: err?.step, body: String(err?.message).startsWith(body) })
                .equal({ name, step, body: true });
            (0, expect_1.expect)({ name, wrote: Object.keys(vol.toJSON()).filter((k) => k.startsWith('/out/') && '/out/t.txt' !== k).sort() })
                .equal({ name, wrote });
        }
    });
    // A backslash in an output-path component is a separator on every
    // platform: the folded path is used for the directory, the read, the
    // write, the baseline, the meta key and the files lists, and no literal
    // backslash directory is left behind.
    (0, node_test_1.test)('backslash-in-output-names', async () => {
        const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'jostraca-bs-'));
        try {
            const out = node_path_1.default.join(dir, 'out').replace(/\\/g, '/');
            node_fs_1.default.mkdirSync(node_path_1.default.join(dir, 'out', 'a'), { recursive: true });
            node_fs_1.default.writeFileSync(node_path_1.default.join(dir, 'out', 'a', 't.txt'), '<\n#--START--#\nold\n#--END--#\n>');
            const res = await (0, __1.Jostraca)({ now: () => NOW, log: quiet })
                .generate({ folder: out }, () => {
                (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 'a\\b.txt' }, () => (0, __1.Content)('B'));
                    (0, __1.Folder)({ name: 'x\\y' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A')));
                    (0, __1.Inject)({ name: 'a\\t.txt' }, () => (0, __1.Content)('NEW'));
                });
                (0, __1.Project)({ folder: 'p\\q' }, () => (0, __1.File)({ name: 'c.txt' }, () => (0, __1.Content)('C')));
            });
            const got = [];
            const walk = (d) => {
                for (const e of node_fs_1.default.readdirSync(d, { withFileTypes: true })) {
                    const p = node_path_1.default.join(d, e.name);
                    const rel = node_path_1.default.relative(dir, p).replace(/\\/g, '/');
                    got.push(rel + (e.isDirectory() ? '/' : ''));
                    if (e.isDirectory())
                        walk(p);
                }
            };
            walk(dir);
            got.sort();
            (0, expect_1.expect)(got).equal([
                'out/',
                'out/.jostraca/',
                'out/.jostraca/.gitignore',
                'out/.jostraca/generated/',
                'out/.jostraca/generated/a/',
                'out/.jostraca/generated/a/b.txt',
                'out/.jostraca/generated/a/t.txt',
                'out/.jostraca/generated/p/',
                'out/.jostraca/generated/p/q/',
                'out/.jostraca/generated/p/q/c.txt',
                'out/.jostraca/generated/x/',
                'out/.jostraca/generated/x/y/',
                'out/.jostraca/generated/x/y/a.txt',
                'out/.jostraca/jostraca.meta.log',
                'out/a/',
                'out/a/b.txt',
                'out/a/t.txt',
                'out/p/',
                'out/p/q/',
                'out/p/q/c.txt',
                'out/x/',
                'out/x/y/',
                'out/x/y/a.txt',
            ]);
            (0, expect_1.expect)(node_fs_1.default.readFileSync(node_path_1.default.join(dir, 'out', 'a', 't.txt'), 'utf8'))
                .equal('<\n#--START--#\nNEW\n#--END--#\n>');
            const meta = JSON.parse(node_fs_1.default.readFileSync(out + '/.jostraca/jostraca.meta.log', 'utf8'));
            (0, expect_1.expect)(Object.keys(meta.files).sort())
                .equal(['a/b.txt', 'a/t.txt', 'p/q/c.txt', 'x/y/a.txt']);
            (0, expect_1.expect)(meta.files['a/t.txt'].exists).equal(true);
            for (const w of ['/a/b.txt', '/x/y/a.txt', '/a/t.txt', '/p/q/c.txt']) {
                (0, expect_1.expect)({ w, has: res.files.written.includes(out + w) }).equal({ w, has: true });
            }
        }
        finally {
            node_fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
    // A SOURCE path keeps its platform meaning. On POSIX a backslash is an
    // ordinary name character, so a Copy source holding `b\in.png` and
    // `we\ird.txt` is read at those names, binary and text alike; the
    // DESTINATION names fold it, as every output path does. Windows cannot
    // hold such a name.
    (0, node_test_1.test)('backslash-in-copy-source-names', { skip: 'win32' === process.platform }, async () => {
        const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'jostraca-bssrc-'));
        try {
            const src = node_path_1.default.join(dir, 'src');
            node_fs_1.default.mkdirSync(src);
            node_fs_1.default.writeFileSync(node_path_1.default.join(src, 'b\\in.png'), Buffer.from([0x89, 0x50, 1, 2]));
            node_fs_1.default.writeFileSync(node_path_1.default.join(src, 'we\\ird.txt'), 'W $$m$$\n');
            const out = node_path_1.default.join(dir, 'out');
            const res = await (0, __1.Jostraca)({ now: () => NOW, log: quiet, model: { m: 'M' } })
                .generate({ folder: out }, () => (0, __1.Project)({}, () => {
                (0, __1.Copy)({ from: src, to: 'd' });
                (0, __1.Copy)({ from: node_path_1.default.join(src, 'b\\in.png'), to: 'one.png' });
            }));
            (0, expect_1.expect)([...node_fs_1.default.readFileSync(node_path_1.default.join(out, 'd', 'b', 'in.png'))])
                .equal([0x89, 0x50, 1, 2]);
            (0, expect_1.expect)(node_fs_1.default.readFileSync(node_path_1.default.join(out, 'd', 'we', 'ird.txt'), 'utf8')).equal('W M\n');
            (0, expect_1.expect)([...node_fs_1.default.readFileSync(node_path_1.default.join(out, 'one.png'))]).equal([0x89, 0x50, 1, 2]);
            (0, expect_1.expect)(res.files.written.map((f) => f.substring(out.length)).sort())
                .equal(['/d/b/in.png', '/d/we/ird.txt', '/one.png']);
        }
        finally {
            node_fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
    // A previous meta log's `last` is used only when it is a finite number a
    // Date can carry; anything else is treated as absent (-1), so a merge
    // labels EXISTING with the epoch minus one millisecond.
    (0, node_test_1.test)('meta-last-type', async () => {
        for (const last of ['"1735689600000"', 'true', '"2025-01-01"', '{}', '1e20', '[]', 'null']) {
            const { fs } = (0, memfs_1.memfs)({
                '/out/.jostraca/jostraca.meta.log': '{"last":' + last + ',"hlast":"x","files":[1]}',
                '/out/.jostraca/generated/a.txt': 'L1\nL2\n',
                '/out/a.txt': 'L1\nU\n',
            });
            const res = await (0, __1.Jostraca)({ now: () => NOW, log: quiet }).generate({
                fs: () => fs, folder: '/out', existing: { txt: { merge: true } },
            }, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('L1\nG\n'))));
            (0, expect_1.expect)({ last, merged: res.files.merged, conflicted: res.files.conflicted })
                .equal({ last, merged: ['/out/a.txt'], conflicted: ['/out/a.txt'] });
            const text = fs.readFileSync('/out/a.txt', 'utf8');
            (0, expect_1.expect)({ last, label: text.includes('>>>>>>> EXISTING: 1969-12-31T23:59:59.999Z/merge') })
                .equal({ last, label: true });
        }
    });
    // Every meta entry carries when/hwhen, skip entries included, whether or
    // not a baseline copy is made.
    (0, node_test_1.test)('skip-entry-when', async () => {
        const nodup = { duplicate: false };
        const rows = [
            ['write-off', { '/out/a.txt': 'OLD' },
                { existing: { txt: { write: false } }, control: nodup },
                () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('NEW'))), 'a.txt'],
            ['protected', { '/out/a.txt': 'JOSTRACA_PROTECT' }, { control: nodup },
                () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('NEW'))), 'a.txt'],
            ['unchanged-merge', { '/out/a.txt': 'SAME' },
                { existing: { txt: { merge: true } }, control: nodup },
                () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('SAME'))), 'a.txt'],
            ['unchanged-diff', { '/out/a.txt': 'SAME' },
                { existing: { txt: { diff: true } }, control: nodup },
                () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('SAME'))), 'a.txt'],
            ['outside-folder', { '/elsewhere/a.txt': 'OLD' },
                { existing: { txt: { write: false } } },
                () => (0, __1.Project)({ folder: '/elsewhere' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('NEW'))),
                '/elsewhere/a.txt'],
        ];
        for (const [name, seed, opts, root, key] of rows) {
            const { fs } = (0, memfs_1.memfs)(seed);
            await (0, __1.Jostraca)({ now: () => NOW, log: quiet })
                .generate({ fs: () => fs, folder: '/out', ...opts }, root);
            const e = metaOf(fs).files[key];
            (0, expect_1.expect)({ name, action: e.action, when: e.when, hwhen: e.hwhen })
                .equal({ name, action: 'skip', when: NOW, hwhen: 2025010100000000 });
        }
    });
    // A path saved twice in one run appears once per files kind, at its first
    // position, and has one meta entry, at its first key position, carrying
    // the LAST save's values.
    (0, node_test_1.test)('duplicate-save-bookkeeping', async () => {
        const M = 'a\n#--START--#\nold\n#--END--#\nz\n';
        const entry = (path, exists) => ({
            action: 'write', path, exists, actions: ['write'], protect: false,
            conflict: false, when: NOW, hwhen: 2025010100000000,
        });
        const log = (...entries) => JSON.stringify({
            foldername: '.jostraca', filename: 'jostraca.meta.log',
            last: NOW, hlast: 2025010100000000,
            files: Object.fromEntries(entries.map((e) => [e.path, e])),
        }, null, 2);
        const rows = [
            ['file-then-inject', {}, () => (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 't.txt' }, () => (0, __1.Content)(M));
                    (0, __1.Inject)({ name: 't.txt' }, () => (0, __1.Content)('NEW'));
                }), ['/out/t.txt'], log(entry('t.txt', true))],
            ['inject-twice', { '/out/t.txt': M }, () => (0, __1.Project)({}, () => {
                    (0, __1.Inject)({ name: 't.txt' }, () => (0, __1.Content)('ONE'));
                    (0, __1.Inject)({ name: 't.txt' }, () => (0, __1.Content)('TWO'));
                }), ['/out/t.txt'], log(entry('t.txt', true))],
            ['copy-then-file', { '/src/single.txt': 'S\n' }, () => (0, __1.Project)({}, () => {
                    (0, __1.Copy)({ from: '/src/single.txt' });
                    (0, __1.File)({ name: 'single.txt' }, () => (0, __1.Content)('F\n'));
                }), ['/out/single.txt'], log(entry('single.txt', true))],
            ['file-then-copy', { '/src/single.txt': 'S\n' }, () => (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 'single.txt' }, () => (0, __1.Content)('F\n'));
                    (0, __1.Copy)({ from: '/src/single.txt' });
                }), ['/out/single.txt'], log(entry('single.txt', true))],
            ['file-g-h-inject-g', {}, () => (0, __1.Project)({}, () => {
                    (0, __1.File)({ name: 'g.txt' }, () => (0, __1.Content)(M));
                    (0, __1.File)({ name: 'h.txt' }, () => (0, __1.Content)('H'));
                    (0, __1.Inject)({ name: 'g.txt' }, () => (0, __1.Content)('NEW'));
                }), ['/out/g.txt', '/out/h.txt'], log(entry('g.txt', true), entry('h.txt', false))],
        ];
        for (const [name, seed, root, written, meta] of rows) {
            const { fs } = (0, memfs_1.memfs)(seed);
            const res = await (0, __1.Jostraca)({ now: () => NOW, log: quiet })
                .generate({ fs: () => fs, folder: '/out' }, root);
            (0, expect_1.expect)({ name, written: res.files.written }).equal({ name, written });
            (0, expect_1.expect)({ name, meta: fs.readFileSync(META, 'utf8') }).equal({ name, meta });
        }
    });
    // The merge engine decides the outcome. A clean merge over a file whose
    // generated text contains the marker sentinel is written; a file still
    // holding an earlier merge's markers is left byte-for-byte untouched, a
    // requested mode still applied, and reported merged AND conflicted.
    (0, node_test_1.test)('merge-marker-files', async () => {
        const merge = { txt: { merge: true } };
        // (1) clean over the sentinel.
        {
            const { fs } = (0, memfs_1.memfs)({});
            const gen = async (v) => {
                const res = await (0, __1.Jostraca)({ now: () => NOW, log: quiet }).generate({
                    fs: () => fs, folder: '/out', existing: merge,
                }, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'doc.md' }, () => (0, __1.Content)('How a conflict looks:\n>>>>>>> EXISTING: 2020-01-01T00:00:00.000Z/merge\n' + v + '\n'))));
                return res;
            };
            await gen('v1');
            for (const v of ['v2', 'v3']) {
                const res = await gen(v);
                (0, expect_1.expect)(fs.readFileSync('/out/doc.md', 'utf8').endsWith(v + '\n')).equal(true);
                (0, expect_1.expect)(res.files.merged).equal(['/out/doc.md']);
                (0, expect_1.expect)(res.files.conflicted).equal([]);
                (0, expect_1.expect)(metaOf(fs).files['doc.md'].action).equal('merge');
                const rec = res.audit().find((e) => 'FileHandler:save:merge' === e[0]);
                (0, expect_1.expect)(rec[1].why.includes('merge-clean-0')).equal(true);
            }
        }
        // (2)-(4) over an unresolved file, on the OS filesystem.
        const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'jostraca-unres-'));
        try {
            for (const [name, opts, mode, actions] of [
                ['plain', { existing: merge }, undefined, ['merge']],
                ['mode', { existing: merge }, 0o755, ['merge']],
                ['preserve', { existing: { txt: { merge: true, preserve: true } } }, undefined,
                    ['preserve', 'merge']],
            ]) {
                const out = node_path_1.default.join(dir, name);
                const a = node_path_1.default.join(out, 'a.txt');
                const gen = (body, extra = {}, m) => (0, __1.Jostraca)({ now: () => NOW, log: quiet }).generate({ folder: out, ...extra }, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt', ...(null == m ? {} : { mode: m }) }, () => (0, __1.Content)(body))));
                await gen('A\n');
                node_fs_1.default.writeFileSync(a, 'A\nuser\n');
                await gen('A\ngen\n', { existing: merge });
                const before = node_fs_1.default.readFileSync(a);
                const ino = node_fs_1.default.statSync(a).ino;
                const res = await gen('A\ngen2\n', opts, mode);
                (0, expect_1.expect)({ name, same: node_fs_1.default.readFileSync(a).equals(before), ino: node_fs_1.default.statSync(a).ino })
                    .equal({ name, same: true, ino });
                (0, expect_1.expect)(res.files.merged).equal([a.replace(/\\/g, '/')]);
                (0, expect_1.expect)(res.files.conflicted).equal([a.replace(/\\/g, '/')]);
                const e = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(out, '.jostraca', 'jostraca.meta.log'), 'utf8'))
                    .files['a.txt'];
                (0, expect_1.expect)({ name, action: e.action, actions: e.actions, conflict: e.conflict })
                    .equal({ name, action: 'merge', actions, conflict: true });
                if (null != mode && 'win32' !== process.platform) {
                    (0, expect_1.expect)(node_fs_1.default.statSync(a).mode & 0o777).equal(mode);
                }
                (0, expect_1.expect)(node_fs_1.default.readFileSync(node_path_1.default.join(out, '.jostraca', 'generated', 'a.txt'), 'utf8'))
                    .equal('A\ngen2\n');
            }
            // (5) diff-mode markers followed by a merge run.
            const out = node_path_1.default.join(dir, 'diffthen');
            const a = node_path_1.default.join(out, 'a.txt');
            const gen = (body, existing) => (0, __1.Jostraca)({ now: () => NOW, log: quiet }).generate({ folder: out, existing }, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)(body))));
            await gen('A\nB\n', { txt: { diff: true } });
            node_fs_1.default.writeFileSync(a, 'A\nU\n');
            await gen('A\nG\n', { txt: { diff: true } });
            const before = node_fs_1.default.readFileSync(a);
            const res = await gen('A\nG2\n', merge);
            (0, expect_1.expect)(node_fs_1.default.readFileSync(a).equals(before)).equal(true);
            (0, expect_1.expect)(res.files.merged).equal([a.replace(/\\/g, '/')]);
            (0, expect_1.expect)(res.files.conflicted).equal([a.replace(/\\/g, '/')]);
            // (6) an unresolved file holding a non-UTF-8 byte keeps it.
            const out6 = node_path_1.default.join(dir, 'latin1');
            const a6 = node_path_1.default.join(out6, 'a.txt');
            const gen6 = (body, existing) => (0, __1.Jostraca)({ now: () => NOW, log: quiet }).generate({ folder: out6, existing }, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)(body))));
            await gen6('A\n');
            node_fs_1.default.writeFileSync(a6, 'A\nuser\n');
            await gen6('A\ngen\n', merge);
            const marked = Buffer.concat([node_fs_1.default.readFileSync(a6), Buffer.from([0xe9, 0x0a])]);
            node_fs_1.default.writeFileSync(a6, marked);
            await gen6('A\ngen2\n', merge);
            (0, expect_1.expect)(node_fs_1.default.readFileSync(a6).equals(marked)).equal(true);
        }
        finally {
            node_fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
    // The existing file is handled as bytes: bytes a user saved in Latin-1
    // survive merge and diff exactly, and a file holding 0xFF where the
    // generator emits U+FFFD counts as changed.
    (0, node_test_1.test)('utf8-lossy', async () => {
        const run = async (steps) => {
            const { fs } = (0, memfs_1.memfs)({});
            let res;
            for (const st of steps) {
                if (Buffer.isBuffer(st)) {
                    fs.writeFileSync('/out/a.txt', st);
                    continue;
                }
                const [body, existing] = st;
                res = await (0, __1.Jostraca)({ now: () => NOW, log: quiet }).generate({
                    fs: () => fs, folder: '/out', existing,
                }, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)(body))));
            }
            return { res, bytes: fs.readFileSync('/out/a.txt') };
        };
        const latin1 = Buffer.from([0x41, 0x0a, 0xe9, 0x74, 0xe9, 0x0a, 0x42, 0x0a]);
        // (1) merge keeps the user's Latin-1 bytes.
        const m = await run([['A\nB\n'], latin1, ['A\nB\nC\n', { txt: { merge: true } }]]);
        (0, expect_1.expect)(m.bytes.toString('hex'))
            .equal(Buffer.from([0x41, 0x0a, 0xe9, 0x74, 0xe9, 0x0a, 0x42, 0x0a, 0x43, 0x0a])
            .toString('hex'));
        // (2) diff keeps them in the EXISTING block.
        const d = await run([['A\nB\n'], latin1, ['A\nB\nC\n', { txt: { diff: true } }]]);
        (0, expect_1.expect)(d.bytes.includes(Buffer.from([0xe9, 0x74, 0xe9]))).equal(true);
        (0, expect_1.expect)(d.res.files.conflicted).equal(['/out/a.txt']);
        // (3) 0xFF against a generated U+FFFD is a change, merged.
        const ff = Buffer.from([0x41, 0x0a, 0xff, 0x0a]);
        const fm = await run([['A\n�\n'], ff, ['A\n�\n', { txt: { merge: true } }]]);
        (0, expect_1.expect)(fm.res.files.merged).equal(['/out/a.txt']);
        (0, expect_1.expect)(fm.res.files.unchanged).equal([]);
        (0, expect_1.expect)(fm.bytes.toString('hex')).equal(ff.toString('hex'));
        // (4) and written, in write mode, as U+FFFD.
        const fw = await run([['A\n�\n'], ff, ['A\n�\n']]);
        (0, expect_1.expect)(fw.res.files.written).equal(['/out/a.txt']);
        (0, expect_1.expect)(fw.bytes.toString('hex')).equal(Buffer.from('A\n�\n').toString('hex'));
    });
    // A decision record is a snapshot taken when it is pushed, and an audit
    // size is a byte count.
    (0, node_test_1.test)('audit-snapshots-and-byte-sizes', async () => {
        const { fs } = (0, memfs_1.memfs)({ '/out/a.txt': 'OLD\n' });
        const res = await (0, __1.Jostraca)({ now: () => NOW, log: quiet }).generate({
            fs: () => fs, folder: '/out', existing: { txt: { preserve: true } },
        }, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('NEW\n'));
            (0, __1.File)({ name: 'u.txt' }, () => (0, __1.Content)('é\u{1F600}'));
        }));
        const audit = res.audit();
        const preserve = audit.find((e) => 'FileHandler:save:preserve' === e[0]);
        (0, expect_1.expect)(preserve[1].actions).equal(['preserve']);
        (0, expect_1.expect)(preserve[1].why).equal(['start<Wx>', 'exists-0', 'preserve-0', 'content-0']);
        const write = audit.find((e) => 'FileHandler:save:write' === e[0] && '/out/a.txt' === e[1].path);
        (0, expect_1.expect)(write[1].actions).equal(['preserve', 'write']);
        const u = audit.find((e) => e[0].startsWith('FileHandler:saveFile:') && '/out/u.txt' === e[1].path);
        (0, expect_1.expect)(u[1].size).equal(6);
    });
    // The clock is sampled once for Result.when when the build context is
    // constructed, once per low-level file call, once per recorded action,
    // and once for `last`; build:false and an empty define still construct
    // the context and check for the meta log.
    (0, node_test_1.test)('clock-sampling', async () => {
        const t0 = 1735689600000;
        const counter = () => {
            let n = t0;
            return { now: () => n++, calls: () => n - t0 };
        };
        const two = (a, b) => () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)(a));
            (0, __1.Folder)({ name: 'sub' }, () => (0, __1.File)({ name: 'b.txt' }, () => (0, __1.Content)(b)));
        });
        {
            const c = counter();
            const { fs } = (0, memfs_1.memfs)({});
            const res = await (0, __1.Jostraca)({ now: c.now, log: quiet })
                .generate({ fs: () => fs, folder: '/out' }, two('A\n', 'B\n'));
            const meta = metaOf(fs);
            (0, expect_1.expect)([res.when, meta.files['a.txt'].when, meta.files['sub/b.txt'].when,
                meta.last, c.calls()]).equal([t0, t0 + 3, t0 + 5, t0 + 6, 10]);
        }
        {
            const c = counter();
            const { fs } = (0, memfs_1.memfs)({});
            const j = (0, __1.Jostraca)({ now: c.now, log: quiet });
            let res = await j.generate({ fs: () => fs, folder: '/out', build: false }, two('A\n', 'B\n'));
            (0, expect_1.expect)([res.when, c.calls(), res.audit().map((e) => e[0])])
                .equal([t0, 2, ['FileHandler:existsFile:']]);
            res = await j.generate({ fs: () => fs, folder: '/out' }, two('A\n', 'B\n'));
            (0, expect_1.expect)([res.when, c.calls()]).equal([t0 + 2, 12]);
        }
        {
            const c = counter();
            const res = await (0, __1.Jostraca)({ now: c.now, log: quiet })
                .generate({ fs: () => (0, memfs_1.memfs)({}).fs, folder: '/out' }, () => { });
            (0, expect_1.expect)([res.audit().map((e) => e[0]), c.calls()])
                .equal([['FileHandler:existsFile:'], 2]);
        }
        {
            const c = counter();
            const { fs } = (0, memfs_1.memfs)({});
            const whens = [];
            const runs = [['x: 1\n', 'B\n'], ['x: 2\n', 'B\n'], ['x: 2\n', 'B\n']];
            for (let i = 0; i < runs.length; i++) {
                if (2 === i)
                    fs.writeFileSync('/out/b.txt', 'USER EDIT\n');
                const [a, b] = runs[i];
                const res = await (0, __1.Jostraca)({ now: c.now, log: quiet }).generate({
                    fs: () => fs, folder: '/out',
                }, () => (0, __1.Project)({}, () => {
                    (0, __1.Folder)({ name: 'model' }, () => (0, __1.File)({ name: 'a.aontu' }, () => (0, __1.Content)(a)));
                    (0, __1.File)({ name: 'b.txt' }, () => (0, __1.Content)(b));
                }));
                whens.push((res.when - t0) + '/' + (metaOf(fs).last - t0));
            }
            (0, expect_1.expect)(whens.join(' ') + ' ' + c.calls()).equal('0/6 10/19 23/32 36');
        }
    });
    // The handler refuses a path whose directory has more than 22 segments,
    // counted as composed. The run fails after the Folder directories exist
    // and before any file, meta log or .gitignore is written.
    (0, node_test_1.test)('path-depth', async () => {
        const deep = (n) => () => (0, __1.Project)({}, () => {
            const nest = (i) => {
                if (i === n) {
                    (0, __1.File)({ name: 'deep.txt' }, () => (0, __1.Content)('D'));
                    return;
                }
                (0, __1.Folder)({ name: 'd' + i }, () => nest(i + 1));
            };
            nest(0);
        });
        const gen = (fs, folder, n) => (0, __1.Jostraca)({ now: () => NOW, log: quiet }).generate({ fs: () => fs, folder }, deep(n));
        await gen((0, memfs_1.memfs)({}).fs, 'out', 21);
        const mfs = (0, memfs_1.memfs)({});
        const dirs = Array.from({ length: 22 }, (_, i) => 'd' + i).join('/');
        await (0, expect_1.expect)(gen(mfs.fs, 'out', 22)).rejects(new RegExp('saveFile: path too deep, path=out/' + dirs + '/deep.txt'));
        (0, expect_1.expect)(Object.values(mfs.vol.toJSON()).filter((v) => null != v)).equal([]);
        (0, expect_1.expect)(mfs.fs.existsSync('out/' + dirs)).equal(true);
        const root = '/' + Array.from({ length: 19 }, (_, i) => 'r' + (i + 1)).join('/');
        await gen((0, memfs_1.memfs)({}).fs, root, 3);
        await (0, expect_1.expect)(gen((0, memfs_1.memfs)({}).fs, root, 4)).rejects(new RegExp('saveFile: path too deep, path=' + root + '/d0/d1/d2/d3/deep.txt'));
    });
    // The meta log and .gitignore go through the atomic, audited writer: a
    // failure writing either is returned, and an unreadable previous meta
    // log is not fatal.
    (0, node_test_1.test)('meta-atomic', async () => {
        const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'jostraca-meta-'));
        const gen = (out) => (0, __1.Jostraca)({ now: () => NOW, log: quiet })
            .generate({ folder: out }, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A'))));
        const canDeny = (() => {
            if ('win32' === process.platform)
                return false;
            const p = node_path_1.default.join(dir, 'probe');
            node_fs_1.default.writeFileSync(p, 'x');
            node_fs_1.default.chmodSync(p, 0);
            try {
                node_fs_1.default.readFileSync(p);
                return false;
            }
            catch (e) {
                return true;
            }
        })();
        try {
            const out1 = node_path_1.default.join(dir, 'gi');
            node_fs_1.default.mkdirSync(node_path_1.default.join(out1, '.jostraca', '.gitignore'), { recursive: true });
            await (0, expect_1.expect)(gen(out1)).rejects(/FileHandler:saveFile: path=/);
            (0, expect_1.expect)(node_fs_1.default.existsSync(node_path_1.default.join(out1, '.jostraca', 'jostraca.meta.log'))).equal(true);
            if (canDeny) {
                const out2 = node_path_1.default.join(dir, 'unreadable');
                await gen(out2);
                const meta = node_path_1.default.join(out2, '.jostraca', 'jostraca.meta.log');
                node_fs_1.default.chmodSync(meta, 0);
                await gen(out2);
                (0, expect_1.expect)(node_fs_1.default.statSync(meta).mode & 0o777).equal(0);
                node_fs_1.default.chmodSync(meta, 0o666);
                const out3 = node_path_1.default.join(dir, 'ro');
                await gen(out3);
                const meta3 = node_path_1.default.join(out3, '.jostraca', 'jostraca.meta.log');
                const before = node_fs_1.default.readFileSync(meta3, 'utf8');
                node_fs_1.default.chmodSync(node_path_1.default.join(out3, '.jostraca'), 0o555);
                node_fs_1.default.writeFileSync(node_path_1.default.join(out3, 'a.txt'), 'EDIT');
                await (0, expect_1.expect)(gen(out3)).rejects();
                node_fs_1.default.chmodSync(node_path_1.default.join(out3, '.jostraca'), 0o777);
                (0, expect_1.expect)(node_fs_1.default.readFileSync(meta3, 'utf8')).equal(before);
            }
        }
        finally {
            node_fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=filehandler.test.js.map