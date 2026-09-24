"use strict";
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
const node_test_1 = require("node:test");
const Assert = __importStar(require("node:assert"));
const Fs = __importStar(require("node:fs"));
const Os = __importStar(require("node:os"));
const Path = __importStar(require("node:path"));
const expect_1 = require("./expect");
const memfs_1 = require("../dist/util/memfs");
const __1 = require("../");
const META_FOLDER = '.jostraca';
const META_FILE = 'jostraca.meta.log';
const TOP_META = '/top/' + META_FOLDER + '/' + META_FILE;
// 2025-01-01T00:00:00.000Z
const START_TIME = 1735689600000;
(0, node_test_1.describe)('jostraca', () => {
    (0, node_test_1.test)('happy', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        (0, expect_1.expect)(__1.Jostraca).exist();
        const jostraca = (0, __1.Jostraca)({ now });
        (0, expect_1.expect)(jostraca).exist();
        const { fs, vol } = (0, memfs_1.memfs)({});
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, () => (0, __1.Project)({ folder: 'sdk' }, () => {
            (0, __1.Folder)({ name: 'js' }, () => {
                (0, __1.File)({ name: 'foo.js' }, () => {
                    (0, __1.Content)('// custom-foo\n');
                });
                (0, __1.File)({ name: 'bar.js' }, () => {
                    (0, __1.Content)('// custom-bar\n');
                });
            });
            (0, __1.Folder)({ name: 'go' }, () => {
                (0, __1.File)({ name: 'zed.go' }, () => {
                    (0, __1.Content)('// custom-zed\n');
                });
            });
        }));
        (0, expect_1.expect)(info).include({
            when: 1735689660000,
            files: {
                preserved: [],
                written: [
                    '/top/sdk/js/foo.js',
                    '/top/sdk/js/bar.js',
                    '/top/sdk/go/zed.go'
                ],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, expect_1.expect)(JSON.parse(voljson[TOP_META]).last > START_TIME).true();
        (0, expect_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/top/sdk/js/foo.js': '// custom-foo\n',
            '/top/sdk/js/bar.js': '// custom-bar\n',
            '/top/sdk/go/zed.go': '// custom-zed\n'
        });
    });
    // A `Line` RENDERS LIKE A `Content`, which it did not: it passed the
    // model alone, so `replace` and `extra` were dropped and a Line
    // inside a List emitted `{item.n}` verbatim where a Content in the
    // same position substituted. The Go port was already right --
    // `LineP` delegates to `ContentP` -- so this pins the TS side to it.
    (0, node_test_1.test)('line-renders-like-content', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        await (0, __1.Jostraca)().generate({ fs: () => fs, folder: '/top' }, () => {
            (0, __1.File)({ name: 'a.txt' }, () => {
                (0, __1.List)({ item: [{ n: 1 }, { n: 2 }], line: false }, [
                    ({ item, replace }) => (0, __1.Line)({ src: 'n={item.n}', replace }),
                ]);
            });
            (0, __1.File)({ name: 'b.txt' }, () => {
                (0, __1.Line)({ src: 'x=$$x$$', extra: { x: 'X' } });
            });
        });
        const voljson = vol.toJSON();
        (0, expect_1.expect)(voljson['/top/a.txt']).equal('n=1\nn=2\n');
        (0, expect_1.expect)(voljson['/top/b.txt']).equal('x=X\n');
    });
    // RAW HANDS THE BYTES THROUGH UNTOUCHED, and the control is the same
    // payload without it. `Content` templates unconditionally, so every
    // `$$...$$` sequence in content jostraca did not author is
    // substituted from the generate model -- a shell script, a makefile,
    // a doc comment or a regex carrying `$$` is corrupted with no
    // diagnostic and exit 0.
    //
    // AN EMPTY MODEL IS NOT THE SAME GUARD. `$$"quoted"$$` renders its
    // own literal and `$$__JOSTRACA_REPLACE__$$` renders the matcher,
    // both with no model at all, so the two are pinned here beside the
    // model-path case: a caller who reached for `model: {}` instead of
    // `raw` still loses those two.
    (0, node_test_1.test)('content-raw', async () => {
        // Every $$ shape a generated file plausibly carries, in one payload.
        const payload = [
            '#!/bin/sh',
            'sed -i "s/$$path$$/x/" f', // a model path: substituted
            'echo $$"quoted"$$', // its own literal: substituted, model or not
            'echo $$__JOSTRACA_REPLACE__$$', // the matcher: substituted, model or not
            "awk '{print $$1}'", // no closing pair: survives either way
            'make: $$(VAR)$$', // no such model path: left in place
        ].join('\n') + '\n';
        const gen = async (raw) => {
            const { fs, vol } = (0, memfs_1.memfs)({});
            await (0, __1.Jostraca)().generate({ fs: () => fs, folder: '/top', model: { path: 'ZZZ' } }, () => {
                (0, __1.File)({ name: 'a.sh' }, () => {
                    (0, __1.Content)({ src: payload, raw });
                });
                (0, __1.File)({ name: 'b.sh' }, () => {
                    (0, __1.Line)({ src: 'L $$path$$', raw });
                });
            });
            const voljson = vol.toJSON();
            return [voljson['/top/a.sh'], voljson['/top/b.sh']];
        };
        // WITH raw: byte-identical, the whole payload.
        const [rawA, rawB] = await gen(true);
        (0, expect_1.expect)(rawA).equal(payload);
        (0, expect_1.expect)(rawB).equal('L $$path$$\n');
        // WITHOUT raw, unchanged as a control: three of the six lines move.
        const [subA, subB] = await gen(false);
        (0, expect_1.expect)(subA).equal([
            '#!/bin/sh',
            'sed -i "s/ZZZ/x/" f',
            'echo quoted',
            'echo /(?<J_O>\\$\\$)(?<J_R>[^$]+)(?<J_C>\\$\\$)/',
            "awk '{print $$1}'",
            'make: $$(VAR)$$',
        ].join('\n') + '\n');
        (0, expect_1.expect)(subB).equal('L ZZZ\n');
        // ... and an absent `raw` is the same as `raw: false`: templating
        // is the default, and stays it.
        const [defA, defB] = await gen(undefined);
        (0, expect_1.expect)(defA).equal(subA);
        (0, expect_1.expect)(defB).equal(subB);
    });
    // `raw` skips the RENDER, not the placement: `indent` is where the
    // span sits in the file rather than what it says, and applies to raw
    // content exactly as to templated content. `replace` and `extra` do
    // go with it -- they are inputs to the render that is not happening.
    (0, node_test_1.test)('content-raw-keeps-indent-and-drops-replace', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        await (0, __1.Jostraca)().generate({ fs: () => fs, folder: '/top' }, () => {
            (0, __1.File)({ name: 'a.txt' }, () => {
                (0, __1.Content)({ src: 'class X {\n' });
                (0, __1.Content)({
                    src: 'y = $$n$$ {tok}\n',
                    indent: 2,
                    raw: true,
                    replace: { '{tok}': 'TOK' },
                    extra: { n: 9 },
                });
                (0, __1.Content)({ src: '}\n' });
            });
        });
        const voljson = vol.toJSON();
        (0, expect_1.expect)(voljson['/top/a.txt']).equal('class X {\n  y = $$n$$ {tok}\n}\n');
    });
    (0, node_test_1.test)('content', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)({ now });
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, () => {
            (0, __1.Folder)({}, () => {
                (0, __1.File)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('A');
                });
            });
        });
        (0, expect_1.expect)(info).include({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/top/foo.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, expect_1.expect)(JSON.parse(voljson[TOP_META]).last > 0).true();
        (0, expect_1.expect)(voljson).include({
            '/top/foo.txt': 'A',
            '/top/.jostraca/generated/foo.txt': 'A',
            '/top/.jostraca/jostraca.meta.log': '{\n' +
                '  "foldername": ".jostraca",\n' +
                '  "filename": "jostraca.meta.log",\n' +
                '  "last": 1735689900000,\n' +
                '  "hlast": 2025010100050000,\n' +
                '  "files": {\n' +
                '    "foo.txt": {\n' +
                '      "action": "write",\n' +
                '      "path": "foo.txt",\n' +
                '      "exists": false,\n' +
                '      "actions": [\n' +
                '        "write"\n' +
                '      ],\n' +
                '      "protect": false,\n' +
                '      "conflict": false,\n' +
                '      "when": 1735689840000,\n' +
                '      "hwhen": 2025010100040000\n' +
                '    }\n' +
                '  }\n' +
                '}',
            '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
        });
    });
    // TWO FILES AT ONE PATH IS REFUSED, on every road in rather than only
    // the one that asked for it. `aontu render` refuses an absolute path,
    // a `..` segment and a DUPLICATE over its unit list; the first two
    // were already here (`validName`, and `cmpTree`'s folder check) and
    // the third was the gap. It is the build phase's business because
    // that is where the path is final.
    //
    // FileHandler already noticed the same thing at `savedPaths` and
    // could only warn, because `Inject` legitimately saves to a path a
    // `File` in the same run created. This sees the two statements that
    // cannot both be true.
    (0, node_test_1.test)('two-files-at-one-path-are-refused', async () => {
        const refused = async (root) => {
            const { fs } = (0, memfs_1.memfs)({});
            try {
                await (0, __1.Jostraca)().generate({ fs: () => fs, folder: '/top' }, root);
            }
            catch (err) {
                return err.message;
            }
            return undefined;
        };
        Assert.match(await refused(() => {
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('one'));
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('two'));
        }), /two File components resolve to the same output path/);
        // Two different statements of nesting arriving at one file: neither
        // name is a duplicate of the other.
        Assert.match(await refused(() => {
            (0, __1.Folder)({ name: 'x' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('one')));
            (0, __1.File)({ name: 'x/a.txt' }, () => (0, __1.Content)('two'));
        }), /path=\/top\/x\/a\.txt/);
        // A LIST OVER FILES IS THE NORMAL GENERATOR and must not break: the
        // name is computed in the host language, so each pass names a
        // different file.
        const { fs, vol } = (0, memfs_1.memfs)({});
        const info = await (0, __1.Jostraca)().generate({ fs: () => fs, folder: '/top' }, () => (0, __1.List)({ item: [{ n: 1 }, { n: 2 }], line: false }, [
            ({ item }) => (0, __1.File)({ name: 'f' + item.n + '.txt' }, () => (0, __1.Content)('n=' + item.n)),
        ]));
        (0, expect_1.expect)(info.files.written).equal(['/top/f1.txt', '/top/f2.txt']);
        const voljson = vol.toJSON();
        (0, expect_1.expect)(voljson['/top/f1.txt']).equal('n=1');
        (0, expect_1.expect)(voljson['/top/f2.txt']).equal('n=2');
    });
    // THE CLAIM IS ON THE CANONICAL PATH, so two lexically different
    // names for one file are one file. `a.txt` and `./a.txt` claimed two
    // paths and `FileHandler.save` then normalised both to one and let the
    // second overwrite the first -- the exact loss the guard exists to
    // refuse, slipping past it on a `./`. Go has never had it:
    // `fileBefore` cleans the path before it records anything.
    (0, node_test_1.test)('a-duplicate-path-is-refused-however-it-is-spelled', async () => {
        const refused = async (root) => {
            const { fs } = (0, memfs_1.memfs)({});
            try {
                await (0, __1.Jostraca)().generate({ fs: () => fs, folder: '/top' }, root);
            }
            catch (err) {
                return err.message;
            }
            return undefined;
        };
        Assert.match(await refused(() => {
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('FIRST'));
            (0, __1.File)({ name: './a.txt' }, () => (0, __1.Content)('SECOND'));
        }), /same output path, path=\/top\/a\.txt/);
        Assert.match(await refused(() => {
            (0, __1.Folder)({ name: 'x' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('FIRST')));
            (0, __1.File)({ name: 'x/./a.txt' }, () => (0, __1.Content)('SECOND'));
        }), /path=\/top\/x\/a\.txt/);
        // A `..` in a File NAME is refused by validName before any of this,
        // so the canonical form can never climb out of the output folder.
        Assert.match(await refused(() => {
            (0, __1.File)({ name: '../escaped.txt' }, () => (0, __1.Content)('x'));
        }), /must not contain a "\.\." path segment/);
        // Two files that only LOOK similar are still two files.
        const { fs, vol } = (0, memfs_1.memfs)({});
        const info = await (0, __1.Jostraca)().generate({ fs: () => fs, folder: '/top' }, () => {
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A'));
            (0, __1.File)({ name: './b.txt' }, () => (0, __1.Content)('B'));
        });
        (0, expect_1.expect)(info.files.written).equal(['/top/a.txt', '/top/b.txt']);
        const voljson = vol.toJSON();
        (0, expect_1.expect)(voljson['/top/a.txt']).equal('A');
        (0, expect_1.expect)(voljson['/top/b.txt']).equal('B');
    });
    // AN INJECT INTO A FILE THE SAME RUN CREATED IS NOT A DUPLICATE, and
    // is why the guard counts `File` nodes rather than saves. Both reach
    // `FileHandler.save` with the same path, and the second is the
    // intended edit of the first.
    (0, node_test_1.test)('inject-into-a-generated-file-is-not-a-duplicate', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        await (0, __1.Jostraca)().generate({ fs: () => fs, folder: '/top' }, () => {
            (0, __1.File)({ name: 'a.txt' }, () => {
                (0, __1.Content)('A\n#--START--#\n\n#--END--#\nB\n');
            });
            (0, __1.Inject)({ name: 'a.txt' }, () => {
                (0, __1.Content)('INJECTED\n');
            });
        });
        const voljson = vol.toJSON();
        (0, expect_1.expect)(voljson['/top/a.txt'])
            .equal('A\n#--START--#\nINJECTED\n\n#--END--#\nB\n');
    });
    (0, node_test_1.test)('basic-copy', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/tm/bar.txt': '// BAR $$x.z$$ TXT\n',
            '/tm/bar.txt~': '// BAR TXT\n',
            '/tm/sub/a.txt': '// SUB-A $$x.y$$ TXT\n',
            '/tm/sub/b.txt': '// SUB-B $$x.y$$ TXT\n',
            '/tm/sub/c/d.txt': '// SUB-C-D $$x.y$$ $$x.z$$ TXT\n',
        });
        const jostraca = (0, __1.Jostraca)({
            now,
            model: { x: { y: 'Y', z: 'Z' } }
        });
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({ folder: 'sdk' }, () => {
                (0, __1.Folder)({ name: 'js' }, () => {
                    (0, __1.File)({ name: 'foo.js' }, () => {
                        (0, __1.Content)('// custom-foo\n');
                    });
                    (0, __1.Copy)({ from: '/tm/bar.txt', to: 'bar.txt' });
                    (0, __1.Copy)({ from: '/tm/sub' });
                });
            });
        }));
        (0, expect_1.expect)(info).include({
            when: 1735689660000,
            files: {
                preserved: [],
                written: [
                    '/top/sdk/js/foo.js',
                    '/top/sdk/js/bar.txt',
                    '/top/sdk/js/a.txt',
                    '/top/sdk/js/b.txt',
                    '/top/sdk/js/c/d.txt'
                ],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, expect_1.expect)(JSON.parse(voljson[TOP_META]).last > 0).true();
        (0, expect_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/tm/bar.txt': '// BAR $$x.z$$ TXT\n',
            '/tm/bar.txt~': '// BAR TXT\n',
            '/tm/sub/a.txt': '// SUB-A $$x.y$$ TXT\n',
            '/tm/sub/b.txt': '// SUB-B $$x.y$$ TXT\n',
            '/tm/sub/c/d.txt': '// SUB-C-D $$x.y$$ $$x.z$$ TXT\n',
            '/top/sdk/js/foo.js': '// custom-foo\n',
            '/top/sdk/js/bar.txt': '// BAR Z TXT\n',
            '/top/sdk/js/a.txt': '// SUB-A Y TXT\n',
            '/top/sdk/js/b.txt': '// SUB-B Y TXT\n',
            '/top/sdk/js/c/d.txt': '// SUB-C-D Y Z TXT\n',
        });
    });
    // `cmp.Copy.ignore` — the caller's own ignore list, matched against the
    // bare NAME of every entry, directories included.
    //
    // EVERY PATTERN IN THE LIST APPLIES, which is what this is really pinning.
    // The list is merged over jostraca's own default of `[/~$/]` by `deep`,
    // which used to walk INTO index 0 (two RegExps are both objects) and copy
    // the enumerable properties of one into the other — of which a RegExp has
    // none. So index 0 was discarded and the default silently reinstated: the
    // first pattern a caller passed never matched anything. sdkgen lost
    // `.DS_Store` that way, and worked around it by leading its list with a
    // duplicate `/~$/`.
    (0, node_test_1.test)('copy-ignore', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/tm/keep.txt': 'KEEP\n',
            '/tm/.DS_Store': 'FINDER\n',
            '/tm/backup.txt~': 'BACKUP\n',
            '/tm/__pycache__/mod.pyc': 'COMPILED\n',
            '/tm/sub/keep.txt': 'SUB-KEEP\n',
            '/tm/sub/.DS_Store': 'FINDER\n',
        });
        const jostraca = (0, __1.Jostraca)({ now });
        const info = await jostraca.generate({
            fs: () => fs, folder: '/top',
            // `.DS_Store` FIRST, deliberately: that is the position the merge
            // used to eat.
            cmp: { Copy: { ignore: [/^\.DS_Store$/, /^__pycache__$/] } },
        }, (0, __1.cmp)(() => {
            (0, __1.Project)({ folder: 'sdk' }, () => {
                (0, __1.Copy)({ from: '/tm' });
            });
        }));
        (0, expect_1.expect)(info.files.written).equal([
            '/top/sdk/keep.txt',
            '/top/sdk/sub/keep.txt',
        ]);
        const voljson = vol.toJSON();
        const copied = Object.keys(voljson)
            .filter((p) => p.startsWith('/top/sdk/'))
            .sort();
        // Naming a directory prunes its whole subtree, and the built-in `~`
        // rule still applies alongside the caller's list.
        (0, expect_1.expect)(copied).equal(['/top/sdk/keep.txt', '/top/sdk/sub/keep.txt']);
    });
    // A directory Copy walks its source in readdirSync().sort() order, which
    // is JavaScript's UTF-16 code unit order: a name starting with U+1F600
    // (a surrogate pair) sorts BEFORE one starting with U+FF5A, where byte
    // order puts it after. files.written and the meta log follow the walk,
    // so the order is pinned on memfs and on the real filesystem, and
    // go/copy_test.go pins the same list.
    const COPY_ORDER = [
        '10.txt', '9.txt', 'B.txt', 'Z.txt', '_x.txt', 'a.txt',
        '\u00e9.txt', '\u{1F600}.txt', '\uFF5A.txt',
    ];
    async function copyOrder(fs, src, out, join) {
        const info = await (0, __1.Jostraca)({ now: () => 0 }).generate({ fs: () => fs, folder: out }, (0, __1.cmp)(() => { (0, __1.Project)({ folder: '.' }, () => { (0, __1.Copy)({ from: src }); }); }));
        (0, expect_1.expect)(info.files.written.map((p) => Path.basename(p)))
            .equal(COPY_ORDER);
        const meta = JSON.parse(fs.readFileSync(join(out, '.jostraca', 'jostraca.meta.log'), 'utf8'));
        (0, expect_1.expect)(Object.keys(meta.files)).equal(COPY_ORDER);
    }
    (0, node_test_1.test)('copy-order-utf16-memfs', async () => {
        const files = {};
        for (const n of COPY_ORDER) {
            files['/tpl/order/' + n] = n + '\n';
        }
        await copyOrder((0, memfs_1.memfs)(files).fs, '/tpl/order', '/out', Path.posix.join);
    });
    (0, node_test_1.test)('copy-order-utf16-realfs', async () => {
        const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-order-'));
        try {
            Fs.mkdirSync(Path.join(dir, 'tpl'));
            for (const n of COPY_ORDER) {
                Fs.writeFileSync(Path.join(dir, 'tpl', n), n + '\n');
            }
            await copyOrder(Fs, Path.join(dir, 'tpl'), Path.join(dir, 'out'), Path.join);
        }
        finally {
            Fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    // The meta log is JSON.stringify output, so '&', '<', '>' and U+2028 in
    // a path are written raw. go/filehandler_test.go
    // TestMetaLogQuotesLikeJSONStringify holds these bytes as its golden.
    (0, node_test_1.test)('meta-log-quotes-raw', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        await (0, __1.Jostraca)({ now: () => START_TIME }).generate({ fs: () => fs, folder: '/out' }, (0, __1.cmp)(() => {
            (0, __1.Project)({ folder: '.' }, () => {
                for (const n of ['a&b.txt', 'x<y>.txt', 'u\u2028v.txt']) {
                    (0, __1.File)({ name: n }, () => { (0, __1.Content)('A\n'); });
                }
            });
        }));
        const meta = vol.toJSON()['/out/.jostraca/jostraca.meta.log'];
        for (const raw of ['"a&b.txt": {', '"path": "x<y>.txt"', '"u\u2028v.txt": {']) {
            (0, expect_1.expect)(meta.includes(raw)).equal(true);
        }
        (0, expect_1.expect)(/\\u(0026|003c|003e|2028)/.test(meta)).equal(false);
    });
    // A model path resolves through OWN properties only, so a macro naming
    // an Object.prototype member is an unresolved path and stays in place;
    // it used to render the member ('A[object Undefined]B') or throw. And a
    // path through a null intermediate is a miss rather than a TypeError
    // that aborted the whole generate.
    (0, node_test_1.test)('macro-own-properties-only', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        await (0, __1.Jostraca)({ now: () => START_TIME }).generate({ fs: () => fs, folder: '/out', model: { a: { n: null } } }, (0, __1.cmp)(() => {
            (0, __1.Project)({ folder: '.' }, () => {
                (0, __1.File)({ name: 'a.txt' }, () => {
                    (0, __1.Content)('A$$toString$$B\n');
                    (0, __1.Content)('C$$hasOwnProperty$$D$$a.n.x$$E\n');
                });
            });
        }));
        (0, expect_1.expect)(vol.toJSON()['/out/a.txt'])
            .equal('A$$toString$$B\nC$$hasOwnProperty$$D$$a.n.x$$E\n');
    });
    // A plain replace value formats as a function's return does, in every
    // component that takes a replace map: 0 and false print instead of
    // collapsing to '', and objects are JSON. go/template_test.go
    // TestReplaceValuesFormatInComponents expects the same bytes.
    (0, node_test_1.test)('replace-values-format-in-components', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({
            '/tpl/frag.txt': 'FOO and BAR\n',
            '/tpl/copy.txt': 'copy FOO\n',
        });
        await (0, __1.Jostraca)({ now: () => START_TIME }).generate({ fs: () => fs, folder: '/out' }, (0, __1.cmp)(() => {
            (0, __1.Project)({ folder: '.' }, () => {
                (0, __1.File)({ name: 'c.txt' }, () => {
                    (0, __1.Content)({ src: 'zero=FOO;', replace: { FOO: 0 } });
                    (0, __1.Content)({ src: 'false=FOO;', replace: { FOO: false } });
                    (0, __1.Content)({ src: 'big=FOO;', replace: { FOO: 1e6 } });
                    (0, __1.Content)({ src: 'obj=FOO\n', replace: { FOO: { b: 1, a: [2, 'x'] } } });
                });
                (0, __1.File)({ name: 'f.txt' }, () => {
                    (0, __1.Fragment)({ from: '/tpl/frag.txt', replace: { FOO: false, BAR: 2.5e-8 } });
                });
                (0, __1.Copy)({ from: '/tpl/copy.txt', replace: { FOO: 123456789012 } });
            });
        }));
        const out = vol.toJSON();
        (0, expect_1.expect)(out['/out/c.txt'])
            .equal('zero=0;false=false;big=1000000;obj={"a":[2,"x"],"b":1}\n');
        (0, expect_1.expect)(out['/out/f.txt']).equal('false and 2.5e-8\n');
        (0, expect_1.expect)(out['/out/copy.txt']).equal('copy 123456789012\n');
    });
    // A fixed clock of () => 0 is the natural golden-file choice, so it must
    // give byte-stable output: humanify(0) is the epoch, not the wall clock.
    // go/filehandler_test.go TestNowZeroIsDeterministic pins the same bytes.
    (0, node_test_1.test)('now-zero-is-deterministic', async () => {
        const run = async () => {
            const { fs, vol } = (0, memfs_1.memfs)({});
            await (0, __1.Jostraca)({ now: () => 0 }).generate({ fs: () => fs, folder: '/out' }, (0, __1.cmp)(() => {
                (0, __1.Project)({ folder: '.' }, () => {
                    (0, __1.File)({ name: 'a.txt' }, () => { (0, __1.Content)('A\n'); });
                });
            }));
            return vol.toJSON()['/out/.jostraca/jostraca.meta.log'];
        };
        const first = await run();
        (0, expect_1.expect)(first.includes('"hlast": 1970010100000000,')).equal(true);
        (0, expect_1.expect)(first.includes('"hwhen": 1970010100000000')).equal(true);
        await new Promise((r) => setTimeout(r, 15));
        (0, expect_1.expect)(await run()).equal(first);
    });
    (0, node_test_1.test)('fragment-basic', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/tmp/foo.txt': 'FOO\n',
            '/tmp/bar.txt': 'BAR\n',
            '/tmp/zed.txt': 'ZED+<[SLOT]> \n',
            '/tmp/qaz.txt': 'QAZ+<!--<[SLOT]>-->+// <[SLOT:alice]>+/* <[SLOT:bob]> */+ # <[SLOT:bob]>\n',
        });
        const jostraca = (0, __1.Jostraca)({ now });
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((props) => {
            (0, __1.Project)({ folder: 'sdk' }, () => {
                (0, __1.File)({ name: 'foo.js' }, () => {
                    (0, __1.Content)('// custom-foo\n');
                    (0, __1.Fragment)({ from: '/tmp/foo.txt' });
                    (0, __1.Fragment)({ from: '/tmp/bar.txt', indent: '  ' });
                    (0, __1.Content)('// END\n');
                });
                (0, __1.File)({ name: 'bar.js' }, () => {
                    (0, __1.Fragment)({ from: '/tmp/zed.txt' }, () => {
                        (0, __1.Content)('red');
                    });
                });
                (0, __1.File)({ name: 'qaz.js' }, () => {
                    (0, __1.Fragment)({ from: '/tmp/qaz.txt' }, () => {
                        (0, __1.Content)('A');
                        (0, __1.Slot)({ name: 'bob' }, () => {
                            (0, __1.Content)('B');
                            (0, __1.Content)('OB');
                        });
                        (0, __1.Content)('B');
                        (0, __1.Slot)({ name: 'alice' }, () => {
                            (0, __1.Content)('ALICE');
                        });
                        (0, __1.Content)('C');
                    });
                });
            });
        }));
        (0, expect_1.expect)(info).include({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/top/sdk/foo.js', '/top/sdk/bar.js', '/top/sdk/qaz.js'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, expect_1.expect)(voljson).includes({
            '/tmp/foo.txt': 'FOO\n',
            '/tmp/bar.txt': 'BAR\n',
            '/tmp/zed.txt': 'ZED+<[SLOT]> \n',
            '/tmp/qaz.txt': 'QAZ+<!--<[SLOT]>-->+// <[SLOT:alice]>+/* <[SLOT:bob]> */+ # <[SLOT:bob]>\n',
            '/top/sdk/bar.js': 'ZED+red\n',
            '/top/sdk/qaz.js': 'QAZ+ABC+ALICE+BOB+BOB\n',
            '/top/sdk/foo.js': '// custom-foo\nFOO\n  BAR\n// END\n',
            [TOP_META]: voljson[TOP_META],
        });
    });
    (0, node_test_1.test)('fragment-nonslot-child-without-default-slot', async () => {
        // Non-Slot children fill the unnamed <[SLOT]> marker. With no unnamed
        // marker in the source there is nowhere for them to go; that used to
        // drop them silently (both stacks), so it is now an error.
        const { fs } = (0, memfs_1.memfs)({
            // Named marker only -- no unnamed <[SLOT]>.
            '/tmp/named.txt': 'Q+// <[SLOT:alice]>\n',
            '/tmp/plain.txt': 'Q\n',
            '/tmp/both.txt': 'Q+<[SLOT]>+// <[SLOT:alice]>\n',
        });
        const gen = (from) => (0, __1.Jostraca)({}).generate({ fs: () => fs, folder: '/top' }, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'foo.txt' }, () => {
                (0, __1.Fragment)({ from }, () => {
                    (0, __1.Content)('A');
                    (0, __1.Slot)({ name: 'alice' }, () => (0, __1.Content)('ALICE'));
                });
            });
        }));
        let err = undefined;
        await gen('/tmp/named.txt').catch((e) => err = e);
        (0, expect_1.expect)(null != err).equal(true);
        (0, expect_1.expect)(/no unnamed <\[SLOT\]> marker/.test(err.message)).equal(true);
        (0, expect_1.expect)(err.message.includes('/tmp/named.txt')).equal(true);
        err = undefined;
        await gen('/tmp/plain.txt').catch((e) => err = e);
        (0, expect_1.expect)(null != err).equal(true);
        // An unnamed marker makes the same body legal again.
        err = undefined;
        await gen('/tmp/both.txt').catch((e) => err = e);
        (0, expect_1.expect)(err).equal(undefined);
    });
    (0, node_test_1.test)('inject', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/top/foo.txt': 'FOO\n#--START--#\nBAR\n#--END--#\nZED',
        });
        const jostraca = (0, __1.Jostraca)({ now });
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({}, () => {
                (0, __1.Inject)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('QAZ');
                });
            });
        }));
        const voljson = vol.toJSON();
        (0, expect_1.expect)(info).include({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/top/foo.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        (0, expect_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/top/foo.txt': 'FOO\n#--START--#\nQAZ\n#--END--#\nZED',
        });
    });
    (0, node_test_1.test)('inject-dollar', async () => {
        // Regression: injected content containing `$` sequences (e.g. `$1`, `$&`,
        // `$\``, and shell/PHP/JS variables) must be inserted literally and not be
        // interpreted as String.replace replacement patterns.
        const { fs, vol } = (0, memfs_1.memfs)({
            '/top/foo.txt': 'FOO\n#--START--#\nBAR\n#--END--#\nZED',
        });
        const jostraca = (0, __1.Jostraca)({});
        await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({}, () => {
                (0, __1.Inject)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('price=$100 g$1h $& end$`');
                });
            });
        }));
        const voljson = vol.toJSON();
        (0, expect_1.expect)(voljson['/top/foo.txt'])
            .equal('FOO\n#--START--#\nprice=$100 g$1h $& end$`\n#--END--#\nZED');
    });
    (0, node_test_1.test)('inject-custom-markers', async () => {
        // Regression: custom markers containing regex metacharacters must be
        // matched literally (markers are escaped before building the regex).
        const { fs, vol } = (0, memfs_1.memfs)({
            '/top/bar.txt': 'A/*S*/old/*E*/B',
        });
        const jostraca = (0, __1.Jostraca)({});
        await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({}, () => {
                (0, __1.Inject)({ name: 'bar.txt', markers: ['/*S*/', '/*E*/'] }, () => {
                    (0, __1.Content)('NEW');
                });
            });
        }));
        const voljson = vol.toJSON();
        (0, expect_1.expect)(voljson['/top/bar.txt']).equal('A/*S*/NEW/*E*/B');
    });
    (0, node_test_1.test)('relative-folder', async () => {
        // Regression: a relative non-`.` output folder must not double-prefix the
        // output path. Previously the FileHandler FS methods re-joined
        // `this.folder` onto an already folder-prefixed path, producing e.g.
        // `reltest/reltest/foo.txt` and silently breaking preserve/merge.
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)({});
        await jostraca.generate({ fs: () => fs, folder: 'reltest' }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'foo.txt' }, () => (0, __1.Content)('HELLO\n'));
            });
        }));
        const voljson = vol.toJSON();
        const keys = Object.keys(voljson);
        // No path doubles the output folder.
        (0, expect_1.expect)(keys.filter((k) => k.includes('reltest/reltest'))).equal([]);
        // The generated file is present exactly once with the right content.
        const fooKeys = keys.filter((k) => k.endsWith('reltest/foo.txt'));
        (0, expect_1.expect)(fooKeys.length).equal(1);
        (0, expect_1.expect)(voljson[fooKeys[0]]).equal('HELLO\n');
    });
    (0, node_test_1.test)('top-level-siblings', async () => {
        // Regression (jostraca/jostraca#21): bare top-level components with no
        // Project or Folder wrapper used to have the FIRST one become the tree
        // root, orphaning every sibling after it. generate() returned success
        // and the later files simply were not there.
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)({});
        await jostraca.generate({ fs: () => fs, folder: '/top' }, () => {
            (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('AAA'));
            (0, __1.File)({ name: 'b.txt' }, () => (0, __1.Content)('BBB'));
            (0, __1.Folder)({ name: 'sub' }, () => {
                (0, __1.File)({ name: 'c.txt' }, () => (0, __1.Content)('CCC'));
            });
        });
        const voljson = vol.toJSON();
        (0, expect_1.expect)(voljson['/top/a.txt']).equal('AAA');
        (0, expect_1.expect)(voljson['/top/b.txt']).equal('BBB');
        (0, expect_1.expect)(voljson['/top/sub/c.txt']).equal('CCC');
    });
    (0, node_test_1.test)('line', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({});
        const jostraca = (0, __1.Jostraca)({ now });
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('ONE\n');
                    (0, __1.Line)('TWO');
                    (0, __1.Content)('THREE\n');
                });
            });
        }));
        (0, expect_1.expect)(info).include({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/top/foo.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, expect_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/top/foo.txt': 'ONE\nTWO\nTHREE\n',
        });
    });
    // AN EXPRESSION-BODIED ARROW RETURNS WHAT `each` RETURNS.
    //
    //     '// #Marker': () => each(list, (x) => Line(...))
    //
    // is a generator that emits, and also hands back an array with one
    // undefined per item, purely because the arrow has no braces. Both
    // channels are live, and only the emission was meant.
    //
    // Before the return value was JSONified this reached the output as
    // ',,,' -- close enough to blank to go unseen for a long time. As JSON
    // it became `[null,null,null]` in the middle of generated source:
    // invalid syntax, exit 0, no diagnostic. The block-bodied form of the
    // same generator was always correct, so the two spellings had to stop
    // producing different files.
    //
    // The emission wins; the accidental return is dropped. A handler that
    // emits NOTHING still substitutes its return value, which is what
    // `zed` and `obj` pin here -- see template.test
    // `replace-function-jsonifies-objects` for that contract in full.
    (0, node_test_1.test)('fragment-replace-emit-wins-over-return', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/f01.txt': 'A[arrow]B[block]C[zed]D[obj]E\n'
        });
        const items = [{ name: 'x' }, { name: 'y' }, { name: 'z' }];
        const jostraca = (0, __1.Jostraca)({ now, model: {} });
        await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'foo.txt' }, () => {
                    (0, __1.Fragment)({
                        from: '/f01.txt',
                        replace: {
                            // Emits AND returns each()'s array of undefined.
                            '[arrow]': () => (0, __1.each)(items, (i) => (0, __1.Line)(i.name)),
                            // The same generator, written so it returns nothing.
                            '[block]': () => { (0, __1.each)(items, (i) => (0, __1.Line)(i.name)); },
                            // Emits nothing: the return value is the replacement.
                            '[zed]': () => 'ZED',
                            // Emits nothing: an object return is still JSONified.
                            '[obj]': () => ({ b: 1, a: 2 }),
                        }
                    });
                });
            });
        }));
        const voljson = vol.toJSON();
        // The two generators produce the SAME text, and neither leaves an
        // array behind.
        (0, expect_1.expect)(voljson['/top/foo.txt'])
            .equal('Ax\ny\nz\nBx\ny\nz\nCZEDD{"a":2,"b":1}E\n');
    });
    (0, node_test_1.test)('fragment-subcmp', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n'
        });
        const Foo = (0, __1.cmp)(function Foo(props) {
            (0, __1.Content)('FOO[');
            (0, __1.Content)(props.arg);
            (0, __1.Content)(']');
        });
        const jostraca = (0, __1.Jostraca)({
            now,
            model: { a: 'A' }
        });
        const info = await jostraca.generate({
            fs: () => fs, folder: '/top',
            // build: false
        }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('ONE\n');
                    (0, __1.Fragment)({
                        from: '/f01.txt', replace: {
                            bar: 'BAR',
                            zed: () => 'ZED',
                            con: () => (0, __1.Content)('CON'),
                            foo: () => Foo('B')
                        }
                    }, () => {
                        (0, __1.Content)('S');
                    });
                    (0, __1.Content)('THREE\n');
                });
            });
        }));
        (0, expect_1.expect)(info).include({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/top/foo.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, expect_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n',
            '/top/foo.txt': 'ONE\nTWO-A-BAR-ZED-CON-FOO[B]+S\nTHREE\n',
        });
    });
    (0, node_test_1.test)('custom-cmp', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const Foo = (0, __1.cmp)(function Foo(props, children) {
            const { ctx$: { model } } = props;
            (0, __1.Content)(`FOO[$$a$$:${props.b}`);
            (0, __1.each)(model.foo, (foo) => (0, __1.each)(children, { call: true, args: foo }));
            (0, __1.Content)(']');
        });
        const jostraca = (0, __1.Jostraca)({
            now,
            model: {
                a: 'A', foo: {
                    a: { x: 11 },
                    b: { x: 22 }
                }
            },
            mem: true,
            vol: {
                '/f01.txt': '<foo>'
            }
        });
        const info = await jostraca.generate({ folder: '/' }, (0, __1.cmp)(() => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'foo.txt' }, () => {
                    (0, __1.Content)('{');
                    (0, __1.Fragment)({
                        from: '/f01.txt',
                        replace: {
                            foo: () => Foo({ b: 'B' }, (foo) => {
                                (0, __1.Content)(`:${foo.key$}=(`);
                                (0, __1.Content)(`${foo.x}`);
                                (0, __1.Content)(')');
                            })
                        }
                    });
                    (0, __1.Content)('}');
                });
            });
        }));
        (0, expect_1.expect)(info).includes({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/foo.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            },
        });
        const voljson = info.vol().toJSON();
        (0, expect_1.expect)(voljson).includes({
            '/f01.txt': '<foo>',
            '/foo.txt': '{<FOO[A:B:a=(11):b=(22)]>}',
            ['/' + META_FOLDER + '/' + META_FILE]: voljson['/' + META_FOLDER + '/' + META_FILE],
        });
    });
    (0, node_test_1.test)('existing-file', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const jostraca = (0, __1.Jostraca)({
            now,
            mem: true,
            vol: {
                '/f01.txt': 'a0',
                '/h01.txt': 'c0',
            }
        });
        const info0 = await jostraca.generate({ folder: '/', existing: { txt: { write: false } } }, (0, __1.cmp)(() => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'f01.txt' }, () => {
                    (0, __1.Content)('a1');
                });
                (0, __1.File)({ name: 'g01.txt' }, () => {
                    (0, __1.Content)('b1');
                });
            });
        }));
        (0, expect_1.expect)(info0).includes({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/g01.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            },
        });
        const voljson0 = info0.vol().toJSON();
        (0, expect_1.expect)(voljson0).includes({
            '/f01.txt': 'a0',
            '/g01.txt': 'b1',
            '/h01.txt': 'c0',
            ['/' + META_FOLDER + '/' + META_FILE]: voljson0['/' + META_FOLDER + '/' + META_FILE],
        });
        const info1 = await jostraca.generate({ folder: '/', existing: { txt: { preserve: true } } }, (0, __1.cmp)(() => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'f01.txt' }, () => {
                    (0, __1.Content)('a1');
                });
                (0, __1.File)({ name: 'h01.txt' }, () => {
                    (0, __1.Content)('c0');
                });
            });
        }));
        // h01.txt is generated byte-identical to what is already on disk, so
        // it is reported as unchanged and not rewritten — rewriting it would
        // bump mtime for no reason and re-trigger every downstream watcher.
        (0, expect_1.expect)(info1).includes({
            when: 1735690260000,
            files: {
                preserved: ['/f01.txt'],
                written: ['/f01.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: ['/h01.txt']
            },
        });
        const voljson1 = info1.vol().toJSON();
        (0, expect_1.expect)(voljson1).includes({
            '/f01.txt': 'a1',
            '/f01.old.txt': 'a0',
            '/h01.txt': 'c0',
            ['/' + META_FOLDER + '/' + META_FILE]: voljson1['/' + META_FOLDER + '/' + META_FILE],
        });
        const info2 = await jostraca.generate({ folder: '/', existing: { txt: { write: false, present: true } } }, (0, __1.cmp)(() => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'f01.txt' }, () => {
                    (0, __1.Content)('a2');
                });
            });
        }));
        // console.dir(info2.audit(), { depth: null })
        // One tick earlier than before: the clock in this test advances on
        // every now() call, and skipping the no-op rewrite of h01.txt above
        // removes one such call.
        (0, expect_1.expect)(info2).includes({
            when: 1735691160000,
            files: {
                preserved: [],
                written: [],
                presented: ['/f01.txt'],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            },
        });
        const voljson2 = info2.vol().toJSON();
        (0, expect_1.expect)(voljson2).includes({
            '/f01.txt': 'a1',
            '/f01.new.txt': 'a2',
            '/h01.txt': 'c0',
            ['/' + META_FOLDER + '/' + META_FILE]: voljson2['/' + META_FOLDER + '/' + META_FILE],
        });
    });
    (0, node_test_1.test)('existing-copy', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/top/tm0/foo.txt': 'F0\nF1\nF2\n',
            '/top/tm0/bar.txt': 'B0\nB1\nB2\n',
            '/top/tm1/zed.txt': 'Z0\nZ1\nZ2\n',
            '/top/tm2/qaz.bin': Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]),
            '/top/tm2/haz.bin': Buffer.from([0x05, 0x06, 0x07, 0x08, 0x09]),
            '/top/p0/bar.txt': 'B0\nB8\nB9\n',
            '/top/p0/zed.txt': 'Z0\nZ7\nZ8\nZ9',
            '/top/p0/haz.bin': Buffer.from([0x09, 0x08, 0x07, 0x06, 0x05]),
        });
        const jostraca = (0, __1.Jostraca)({ now });
        const info = await jostraca.generate({
            fs: () => fs, folder: '/top',
            existing: { txt: { diff: true }, bin: { preserve: true } },
        }, (0, __1.cmp)(() => {
            (0, __1.Project)({ folder: 'p0' }, () => {
                (0, __1.Folder)({}, () => {
                    (0, __1.Copy)({ from: '/top/tm0' });
                    (0, __1.Copy)({ from: '/top/tm1/zed.txt' });
                    (0, __1.Copy)({ from: '/top/tm2' });
                });
            });
        }));
        (0, expect_1.expect)(info.files).include({
            preserved: ['/top/p0/haz.bin'],
            written: ['/top/p0/foo.txt', '/top/p0/haz.bin', '/top/p0/qaz.bin'],
            presented: [],
            diffed: ['/top/p0/bar.txt', '/top/p0/zed.txt'],
            merged: [],
            conflicted: ['/top/p0/bar.txt', '/top/p0/zed.txt'],
            unchanged: []
        });
        const voljson = vol.toJSON();
        (0, expect_1.expect)(JSON.parse(voljson[TOP_META]).last > 0).true();
        (0, expect_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/top/tm0/foo.txt': 'F0\nF1\nF2\n',
            '/top/tm0/bar.txt': 'B0\nB1\nB2\n',
            '/top/tm1/zed.txt': 'Z0\nZ1\nZ2\n',
            '/top/tm2/haz.bin': '\x05\x06\x07\b\t',
            '/top/tm2/qaz.bin': '\x00\x01\x02\x03\x04',
            '/top/p0/bar.txt': 'B0\n' +
                '<<<<<<< EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
                'B8\n' +
                'B9\n' +
                '>>>>>>> EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
                '<<<<<<< GENERATED: 2025-01-01T00:01:00.000Z/diff\n' +
                'B1\n' +
                'B2\n' +
                '>>>>>>> GENERATED: 2025-01-01T00:01:00.000Z/diff\n',
            // zed.txt's last existing line has no trailing newline. The previous
            // (jsdiff-based) render glued the closing marker onto it, producing
            // `Z9>>>>>>> EXISTING: ...` — a marker that does not start its own
            // line, which no tool or human can parse as a conflict. The marker
            // now always starts at column 0.
            '/top/p0/zed.txt': 'Z0\n' +
                '<<<<<<< EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
                'Z7\n' +
                'Z8\n' +
                'Z9\n' +
                '>>>>>>> EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
                '<<<<<<< GENERATED: 2025-01-01T00:01:00.000Z/diff\n' +
                'Z1\n' +
                'Z2\n' +
                '>>>>>>> GENERATED: 2025-01-01T00:01:00.000Z/diff\n',
            '/top/p0/haz.bin': '\x05\x06\x07\b\t',
            '/top/p0/foo.txt': 'F0\nF1\nF2\n',
            '/top/p0/haz.old.bin': '\t\b\x07\x06\x05',
            '/top/p0/qaz.bin': '\x00\x01\x02\x03\x04',
            '/top/.jostraca/generated/p0/foo.txt': 'F0\nF1\nF2\n',
            '/top/.jostraca/generated/p0/bar.txt': 'B0\nB1\nB2\n',
            '/top/.jostraca/generated/p0/zed.txt': 'Z0\nZ1\nZ2\n',
            '/top/.jostraca/generated/p0/haz.bin': '\x05\x06\x07\b\t',
            '/top/.jostraca/generated/p0/qaz.bin': '\x00\x01\x02\x03\x04',
        });
    });
    (0, node_test_1.test)('protect', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({
            '/top/t0/p0/foo.txt': 'FOO new',
            '/top/t0/p0/bar.txt': 'BAR new',
            '/top/t0/p1/z0.txt': 'z0 new',
            '/top/t0/p1/z1.txt': 'z1 new',
            '/top/s0/p0/foo.txt': 'foo old # JOSTRACA_PROTECT',
            '/top/s0/p0/bar.txt': 'bar old',
            '/top/s0/p1/z0.txt': 'z0 old',
            '/top/s0/p1/z1.txt': 'z1 old # JOSTRACA_PROTECT',
        });
        const debugs = [];
        const log = {
            info: (...args) => { },
            debug: (...args) => {
                debugs.push(args);
            },
        };
        const jostraca = (0, __1.Jostraca)({ now, log });
        const info = await jostraca.generate({ fs: () => fs, folder: '/top' }, (0, __1.cmp)((_props) => {
            (0, __1.Project)({ folder: 's0' }, () => {
                (0, __1.Folder)({ name: 'p0' }, () => {
                    (0, __1.File)({ name: 'foo.txt' }, () => {
                        (0, __1.Content)('FOO new');
                    });
                    (0, __1.File)({ name: 'bar.txt' }, () => {
                        (0, __1.Content)('BAR new');
                    });
                });
                (0, __1.Copy)({ from: '/top/t0' });
            });
        }));
        // NOTE: this is a deliberate duplicate file write due to the Copy
        (0, expect_1.expect)(debugs[0][0].point).equal('jostraca-warning');
        (0, expect_1.expect)(info).include({
            when: 1735689660000,
            files: {
                preserved: [],
                written: ['/top/s0/p0/bar.txt', '/top/s0/p1/z0.txt'],
                presented: [],
                diffed: [],
                merged: [],
                conflicted: [],
                unchanged: []
            }
        });
        const voljson = vol.toJSON();
        (0, expect_1.expect)(JSON.parse(voljson[TOP_META]).last > 0).true();
        (0, expect_1.expect)(voljson).includes({
            [TOP_META]: voljson[TOP_META],
            '/top/t0/p0/foo.txt': 'FOO new',
            '/top/t0/p0/bar.txt': 'BAR new',
            '/top/t0/p1/z0.txt': 'z0 new',
            '/top/t0/p1/z1.txt': 'z1 new',
            '/top/s0/p0/foo.txt': 'foo old # JOSTRACA_PROTECT',
            '/top/s0/p0/bar.txt': 'BAR new',
            '/top/s0/p1/z0.txt': 'z0 new',
            '/top/s0/p1/z1.txt': 'z1 old # JOSTRACA_PROTECT'
        });
    });
});
// A Copy or an Inject nested INSIDE a File used to destroy the enclosing
// file. Both ops make themselves buildctx.current.file for the duration of
// their own work - Copy indirectly, by calling FileOp.before on its own node
// - and neither put the previous one back. Every later sibling then
// accumulated into the WRONG buffer, and FileOp.after wrote that buffer to
// the WRONG path.
//
// Measured before the fix:
//
//   Copy inside File   -> /out/a.txt never written at all,
//                         /out/h.txt = "HELLO\nAFTER\n" ("BEFORE" lost)
//   Inject inside File -> /out/a.txt never written at all,
//                         the Inject's pre-existing TARGET overwritten
//                         with "new contentAFTER\n", markers and all
//
// Go was correct on both counts, so TS is the side that moved. See #39 and
// the copy_in_file / inject_in_file parity snapshots, which pin the same
// two shapes across both stacks.
(0, node_test_1.describe)('nested-emitters', () => {
    const gen = async (fsdef, def) => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)(fsdef);
        await (0, __1.Jostraca)({ now }).generate({ fs: () => fs, folder: '/out' }, (0, __1.cmp)(def));
        const out = {};
        for (const [k, v] of Object.entries(vol.toJSON())) {
            if (k.startsWith('/out/' + META_FOLDER))
                continue;
            out[k] = v;
        }
        return out;
    };
    (0, node_test_1.test)('copy-inside-file', async () => {
        const out = await gen({ '/tm/h.txt': 'HELLO\n' }, () => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'a.txt' }, () => {
                    (0, __1.Content)('BEFORE\n');
                    (0, __1.Copy)({ from: '/tm/h.txt' });
                    (0, __1.Content)('AFTER\n');
                });
            });
        });
        // The copied text is spliced into the enclosing file where the Copy sat
        // in source order, AND still written to its own destination.
        (0, expect_1.expect)(out).equal({
            '/tm/h.txt': 'HELLO\n',
            '/out/h.txt': 'HELLO\n',
            '/out/a.txt': 'BEFORE\nHELLO\nAFTER\n',
        });
    });
    (0, node_test_1.test)('inject-inside-file', async () => {
        const out = await gen({
            '/tm/x': '',
            '/out/t.txt': 'HEADER\n#--START--#\nold\n#--END--#\nFOOTER\n',
        }, () => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'a.txt' }, () => {
                    (0, __1.Content)('BEFORE\n');
                    (0, __1.Inject)({ name: 't.txt' }, () => (0, __1.Content)('new content'));
                    (0, __1.Content)('AFTER\n');
                });
            });
        });
        // Unlike Fragment and Slot, an Inject contributes NOTHING to the file
        // around it - it writes to its own target. The target keeps everything
        // outside the markers.
        (0, expect_1.expect)(out['/out/a.txt']).equal('BEFORE\nAFTER\n');
        (0, expect_1.expect)(out['/out/t.txt'])
            .equal('HEADER\n#--START--#\nnew content\n#--END--#\nFOOTER\n');
    });
    // Two Copies in one File: each has to restore independently, or the second
    // would splice into the first.
    (0, node_test_1.test)('two-copies-inside-file', async () => {
        const out = await gen({ '/tm/h.txt': 'H\n', '/tm/i.txt': 'I\n' }, () => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'a.txt' }, () => {
                    (0, __1.Copy)({ from: '/tm/h.txt' });
                    (0, __1.Content)('MID\n');
                    (0, __1.Copy)({ from: '/tm/i.txt' });
                });
            });
        });
        (0, expect_1.expect)(out['/out/a.txt']).equal('H\nMID\nI\n');
        (0, expect_1.expect)(out['/out/h.txt']).equal('H\n');
        (0, expect_1.expect)(out['/out/i.txt']).equal('I\n');
    });
    // A Copy that is NOT inside a File is unaffected: it writes its own
    // destination and nothing else. Both orderings, because the fix restores
    // whatever current.file happened to be - which for a Copy following a File
    // is that File, already written by then.
    (0, node_test_1.test)('copy-outside-file-unchanged', async () => {
        const before = await gen({ '/tm/h.txt': 'HELLO\n' }, () => {
            (0, __1.Project)({}, () => {
                (0, __1.Copy)({ from: '/tm/h.txt' });
                (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A\n'));
            });
        });
        (0, expect_1.expect)(before).equal({
            '/tm/h.txt': 'HELLO\n',
            '/out/h.txt': 'HELLO\n',
            '/out/a.txt': 'A\n',
        });
        const after = await gen({ '/tm/h.txt': 'HELLO\n' }, () => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A\n'));
                (0, __1.Copy)({ from: '/tm/h.txt' });
            });
        });
        (0, expect_1.expect)(after).equal({
            '/tm/h.txt': 'HELLO\n',
            '/out/a.txt': 'A\n',
            '/out/h.txt': 'HELLO\n',
        });
    });
    // KNOWN DEVIATION from Go, pinned deliberately rather than closed.
    //
    // A BINARY single-file Copy inside a File contributes nothing to the
    // enclosing file here, and says so on the debug channel. Its content is a
    // Buffer, and a Buffer joined into a JS string is UTF-8 decoded, so every
    // byte that is not valid UTF-8 would become U+FFFD - the splice would
    // silently corrupt the copy. A Go string is a byte string, so Go embeds the
    // bytes losslessly (TestBinaryCopyInsideFileSplicesBytes measures 20 bytes
    // there against 13 here). Closing the gap means a byte-oriented content
    // pipeline through FileHandler, for a shape - a binary inside a text file -
    // that is a user error either way. The copy itself is written intact on
    // both sides.
    (0, node_test_1.test)('binary-copy-inside-file-splices-nothing', async () => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs } = (0, memfs_1.memfs)({});
        const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
        fs.mkdirSync('/tm', { recursive: true });
        fs.writeFileSync('/tm/i.png', raw);
        await (0, __1.Jostraca)({ now }).generate({ fs: () => fs, folder: '/out' }, (0, __1.cmp)(() => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'a.txt' }, () => {
                (0, __1.Content)('BEFORE\n');
                (0, __1.Copy)({ from: '/tm/i.png' });
                (0, __1.Content)('AFTER\n');
            });
        })));
        (0, expect_1.expect)([...fs.readFileSync('/out/a.txt')])
            .equal([...Buffer.from('BEFORE\nAFTER\n')]);
        (0, expect_1.expect)([...fs.readFileSync('/out/i.png')]).equal([...raw]);
    });
    // A DIRECTORY Copy never becomes current.file in the first place, so it
    // contributes no text to the file around it - in either stack. Pinned so
    // the single-file splice cannot quietly grow to cover the tree walk.
    (0, node_test_1.test)('directory-copy-inside-file-splices-nothing', async () => {
        const out = await gen({ '/tm/d/x.txt': 'X\n', '/tm/d/y.txt': 'Y\n' }, () => {
            (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'a.txt' }, () => {
                    (0, __1.Content)('BEFORE\n');
                    (0, __1.Copy)({ from: '/tm/d', to: 'sub' });
                    (0, __1.Content)('AFTER\n');
                });
            });
        });
        (0, expect_1.expect)(out['/out/a.txt']).equal('BEFORE\nAFTER\n');
        (0, expect_1.expect)(out['/out/sub/x.txt']).equal('X\n');
        (0, expect_1.expect)(out['/out/sub/y.txt']).equal('Y\n');
    });
});
// Directory-only state. `vol.toJSON()` records an empty directory as
// `null` -- a populated one is stood for by its children -- and until the
// Go port's MemFS.Vol() learned the same convention nothing could compare
// the two stacks on it. Two behaviours hid behind that: an empty Folder
// was materialised here and not in Go, and a dry run created the whole
// output tree in Go while writing no files.
//
// These pin the TS side of the agreement. See #41 and the empty_folder
// parity snapshot.
(0, node_test_1.describe)('directory-state', () => {
    const gen = async (control, def) => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs, vol } = (0, memfs_1.memfs)({});
        await (0, __1.Jostraca)({ now, control })
            .generate({ fs: () => fs, folder: '/out' }, (0, __1.cmp)(def));
        const json = vol.toJSON();
        const files = [];
        const dirs = [];
        for (const [k, v] of Object.entries(json)) {
            if (null == v) {
                dirs.push(k);
            }
            else {
                files.push(k);
            }
        }
        return { files: files.sort(), dirs: dirs.sort() };
    };
    (0, node_test_1.test)('empty-folder-is-materialised', async () => {
        const { dirs } = await gen({}, () => (0, __1.Project)({ folder: 'app' }, () => {
            (0, __1.Folder)({ name: 'empty' }, () => { });
            (0, __1.Folder)({ name: 'full' }, () => {
                (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('A\n'));
            });
            (0, __1.Folder)({ name: 'outer' }, () => {
                (0, __1.Folder)({ name: 'inner' }, () => { });
            });
        }));
        // A directory appears only while EMPTY: `full` and `outer` each hold a
        // child, so their children stand for them.
        (0, expect_1.expect)(dirs).equal(['/out/app/empty', '/out/app/outer/inner']);
    });
    // An empty FILE is not a directory: it is recorded with its (empty)
    // content, not as null.
    (0, node_test_1.test)('empty-file-is-not-a-directory', async () => {
        const { files, dirs } = await gen({}, () => (0, __1.Project)({ folder: 'app' }, () => (0, __1.File)({ name: 'e.txt' }, () => { })));
        (0, expect_1.expect)(files.includes('/out/app/e.txt')).true();
        (0, expect_1.expect)(dirs.includes('/out/app/e.txt')).false();
    });
    // A dry run creates nothing at all, directories included. ensureFolder is
    // guarded, and so is every ensureDir call behind a write.
    (0, node_test_1.test)('dryrun-creates-no-directories', async () => {
        const { files, dirs } = await gen({ dryrun: true }, () => (0, __1.Project)({ folder: 'app' }, () => {
            (0, __1.Folder)({ name: 'sub' }, () => {
                (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('SECRET\n'));
            });
        }));
        (0, expect_1.expect)(files).equal([]);
        (0, expect_1.expect)(dirs).equal([]);
    });
    // The other side of the guard, so the test above measures it rather than
    // an inert path.
    (0, node_test_1.test)('without-dryrun-directories-are-created', async () => {
        const { files } = await gen({}, () => (0, __1.Project)({ folder: 'app' }, () => {
            (0, __1.Folder)({ name: 'sub' }, () => {
                (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('X\n'));
            });
        }));
        (0, expect_1.expect)(files.includes('/out/app/sub/a.txt')).true();
    });
});
// A STRING child of `List` used to emit nothing at all. The wrapper that
// renders one called `Content({indent, replace})` with no `src`, so the
// string was captured by the typeof test and then dropped:
// `List({item: [...]}, 'n={item.n}\n')` produced just the trailing newline.
//
// Nothing caught it because no fixture, test or doc example passed a string
// child - the component reference documents only the function form. Found
// while probing #40 and filed as #44. Go has no string-children concept, so
// this is TS-only; the `list_string_child` parity snapshot pins that the
// shorthand desugars to exactly the explicit body Go has to write by hand.
(0, node_test_1.describe)('list-string-child', () => {
    const gen = async (def) => {
        let nowI = 0;
        const now = () => START_TIME + (++nowI * (60 * 1000));
        const { fs } = (0, memfs_1.memfs)({});
        await (0, __1.Jostraca)({ now }).generate({ fs: () => fs, folder: '/out' }, (0, __1.cmp)(def));
        return fs.readFileSync('/out/a.txt', 'utf8');
    };
    const ITEMS = [{ n: 'p' }, { n: 'q' }];
    const list = (props, children) => () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.List)(props, children)));
    // The regression: the string is rendered, once per item, and `{item.path}`
    // resolves in it exactly as it does in a function child.
    (0, node_test_1.test)('renders-and-resolves-the-macro', async () => {
        (0, expect_1.expect)(await gen(list({ item: ITEMS, line: false }, 'n={item.n}\n')))
            .equal('n=p\nn=q\n');
    });
    // A string child with no macro is still emitted once per item - the
    // failure was in the wrapper, not in the substitution.
    (0, node_test_1.test)('renders-a-string-with-no-macro', async () => {
        (0, expect_1.expect)(await gen(list({ item: ITEMS, line: false }, 'X\n')))
            .equal('X\nX\n');
    });
    // `indent` reaches a string child automatically, unlike a function child,
    // which has to apply it. The wrapper already threaded it through.
    (0, node_test_1.test)('applies-indent', async () => {
        (0, expect_1.expect)(await gen(list({ item: ITEMS, indent: '>>' }, 'n={item.n}\n')))
            .equal('>>n=p\n>>n=q\n\n');
    });
    // Children iterate INSIDE the item loop, so two string children give
    // a=p,b=p,a=q,b=q rather than a=p,a=q,b=p,b=q.
    (0, node_test_1.test)('two-string-children-interleave-per-item', async () => {
        (0, expect_1.expect)(await gen(list({ item: ITEMS, line: false }, ['a={item.n}\n', 'b={item.n}\n'])))
            .equal('a=p\nb=p\na=q\nb=q\n');
    });
    // A string child and a function child compose.
    (0, node_test_1.test)('mixes-with-a-function-child', async () => {
        (0, expect_1.expect)(await gen(list({ item: ITEMS, line: false }, [
            's={item.n}\n',
            (props) => (0, __1.Content)({ src: 'f={item.n}\n', replace: props.replace }),
        ]))).equal('s=p\nf=p\ns=q\nf=q\n');
    });
    // The documented quiet limits still hold in a string child: a bare
    // `{item}` on a scalar list yields the empty string, because getx cannot
    // address the `val$` key each() wraps a scalar in.
    (0, node_test_1.test)('keeps-the-bare-item-limit', async () => {
        (0, expect_1.expect)(await gen(list({ item: ['a', 'b'], line: false }, 'v={item}\n')))
            .equal('v=\nv=\n');
    });
});
// Component behaviour both ports pin with the same expected output. The Go
// mirrors live beside the tests each one names.
(0, node_test_1.describe)('components', () => {
    const gen = async (fsdef, def, gopts) => {
        const { fs, vol } = (0, memfs_1.memfs)(fsdef);
        await (0, __1.Jostraca)({ now: () => START_TIME, ...(gopts || {}) })
            .generate({ fs: () => fs, folder: '/out' }, (0, __1.cmp)(def));
        const out = {};
        for (const [k, v] of Object.entries(vol.toJSON())) {
            if (k.startsWith('/out/' + META_FOLDER))
                continue;
            out[k] = v;
        }
        return out;
    };
    // A Fragment is templated once. A `$$x$$` that arrives inside a model
    // value, a plain replace value or a replace function's return is text,
    // as it is in a plain Content. Go: TestFragmentTemplatesOnce.
    (0, node_test_1.test)('fragment-templates-once', async () => {
        const out = await gen({
            '/tm/double.txt': '[$$a$$]\n',
            '/tm/replace.txt': 'FOO and BAR $$name$$\n',
        }, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'double.txt' }, () => {
                (0, __1.Fragment)({ from: '/tm/double.txt' });
                (0, __1.Content)('content:$$a$$\n');
            });
            (0, __1.File)({ name: 'r1.txt' }, () => (0, __1.Fragment)({
                from: '/tm/replace.txt', replace: { FOO: '$$b$$', BAR: 'bar' }
            }));
            (0, __1.File)({ name: 'r2.txt' }, () => (0, __1.Fragment)({
                from: '/tm/replace.txt',
                replace: { FOO: '$$"q"$$', BAR: () => '$$name$$' }
            }));
        }), { model: { a: '$$b$$', b: 'X', name: 'N' } });
        (0, expect_1.expect)(out['/out/double.txt']).equal('[$$b$$]\ncontent:$$b$$\n');
        (0, expect_1.expect)(out['/out/r1.txt']).equal('$$b$$ and bar N\n');
        (0, expect_1.expect)(out['/out/r2.txt']).equal('$$"q"$$ and $$name$$ N\n');
    });
    // A Fragment renders when it is called, in the define phase: the source
    // is read, the slots replayed and the template run there, and whatever a
    // slot or replace handler emits becomes a child the build walk visits.
    // Go: go/fragment_timing_test.go, which pins each of these.
    const genErr = async (fsdef, def, gopts) => {
        const { fs, vol } = (0, memfs_1.memfs)(fsdef);
        let err = null;
        try {
            await (0, __1.Jostraca)({ now: () => START_TIME, ...(gopts || {}) })
                .generate({ fs: () => fs, folder: '/out' }, (0, __1.cmp)(def));
        }
        catch (e) {
            err = e;
        }
        return { err, vol: vol.toJSON() };
    };
    const FRAG_SRC = {
        '/tm/noslot.txt': 'no markers $$name$$\n',
        '/tm/model.txt': 'M=$$name$$\n',
        '/tm/twice.txt': '1 <[SLOT:a]>\n2 <[SLOT:a]>\n3 <[SLOT]>\n4 <[SLOT]>\n',
        '/tm/replace.txt': 'FOO and BAR $$name$$\n',
        '/tm/slot.txt': 'HEAD<[SLOT:s]>TAIL\n',
        '/tm/c.txt': 'copied $$name$$\n',
    };
    const noOutput = (vol) => Object.keys(vol).filter((k) => k.startsWith('/out'));
    (0, node_test_1.test)('fragment-render-error-writes-nothing', async () => {
        const nonslot = await genErr(FRAG_SRC, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'ok.txt' }, () => (0, __1.Content)('ok'));
            (0, __1.File)({ name: 'n.txt' }, () => (0, __1.Fragment)({ from: '/tm/noslot.txt' }, () => (0, __1.Content)('lost')));
        }));
        Assert.match(nonslot.err.message, /Fragment has non-Slot children/);
        (0, expect_1.expect)(noOutput(nonslot.vol)).equal([]);
        const empty = await genErr(FRAG_SRC, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'first.txt' }, () => (0, __1.Content)('first'));
            (0, __1.File)({ name: 'e.txt' }, () => (0, __1.Fragment)({ from: '/tm/model.txt', replace: { '/x*/': 'y' } }));
        }), { model: { name: 'World' } });
        Assert.match(empty.err.message, /matches empty string/);
        (0, expect_1.expect)(noOutput(empty.vol)).equal([]);
    });
    (0, node_test_1.test)('fragment-reads-the-model-when-called', async () => {
        const model = { name: 'World' };
        const out = await gen(FRAG_SRC, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'm.txt' }, () => {
                (0, __1.Fragment)({ from: '/tm/model.txt' });
                (0, __1.Content)('content=$$name$$\n');
                model.name = 'CHANGED';
            });
        }), { model });
        (0, expect_1.expect)(out['/out/m.txt']).equal('M=World\ncontent=World\n');
    });
    (0, node_test_1.test)('fragment-body-runs-in-the-define-phase', async () => {
        let n = 0;
        const out = await gen(FRAG_SRC, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'c.txt' }, () => {
                (0, __1.Fragment)({ from: '/tm/twice.txt' }, () => {
                    n++;
                    (0, __1.Slot)({ name: 'a' }, () => (0, __1.Content)('a' + n));
                    (0, __1.Content)('d' + n);
                });
                (0, __1.Content)('after=' + n + '\n');
            });
        }));
        (0, expect_1.expect)(out['/out/c.txt']).equal('1a2\n2a3\n3d4\n4d5\nafter=5\n');
    });
    (0, node_test_1.test)('fragment-reads-its-source-before-the-run-writes-it', async () => {
        const out = await gen({ ...FRAG_SRC, '/out/tpl.txt': 'OLD $$name$$ <[SLOT]>\n' }, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'tpl.txt' }, () => (0, __1.Content)('NEW $$name$$ <[SLOT]>\n'));
            (0, __1.File)({ name: 'use.txt' }, () => (0, __1.Fragment)({ from: 'tpl.txt' }, () => (0, __1.Content)('S')));
        }), { model: { name: 'World' } });
        (0, expect_1.expect)(out['/out/tpl.txt']).equal('NEW World <[SLOT]>\n');
        (0, expect_1.expect)(out['/out/use.txt']).equal('OLD WorldS\n');
    });
    (0, node_test_1.test)('fragment-slot-copy-runs-in-the-build', async () => {
        const out = await gen(FRAG_SRC, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'f.txt' }, () => {
                (0, __1.Fragment)({ from: '/tm/slot.txt' }, () => {
                    (0, __1.Slot)({ name: 's' }, () => {
                        (0, __1.Content)('pre;');
                        (0, __1.CopyFiles)({ from: '/tm/c.txt', to: 'c.txt' });
                        (0, __1.Content)('post;');
                    });
                });
            });
        }), { model: { name: 'World' } });
        (0, expect_1.expect)(out['/out/c.txt']).equal('copied World\n');
        (0, expect_1.expect)(out['/out/f.txt']).equal('HEADpre;copied World\npost;TAIL\n');
    });
    // Everything a replace handler emits lands at the marker, in emission
    // order: ListItems, Line, a nested Fragment and a user component.
    (0, node_test_1.test)('fragment-replace-handler-emissions', async () => {
        const Wrap = (0, __1.cmp)(function Wrap(_props, children) {
            (0, __1.Content)('<');
            (0, __1.each)(children, { call: true });
            (0, __1.Content)('>');
        });
        const out = await gen(FRAG_SRC, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'f.txt' }, () => {
                (0, __1.Fragment)({
                    from: '/tm/replace.txt', replace: {
                        FOO: () => {
                            (0, __1.List)({ item: [{ n: 1 }, { n: 2 }], line: false }, ({ replace }) => (0, __1.Content)({ src: '[{item.n}]', replace }));
                        },
                        BAR: () => { (0, __1.Line)('bar'); },
                    }
                });
                (0, __1.Fragment)({
                    from: '/tm/replace.txt', replace: {
                        FOO: () => { (0, __1.Fragment)({ from: '/tm/model.txt' }); },
                        BAR: () => { Wrap(() => (0, __1.Content)('w')); },
                    }
                });
            });
        }), { model: { name: 'World' } });
        (0, expect_1.expect)(out['/out/f.txt'])
            .equal('[1][2] and bar\n World\nM=World\n and <w> World\n');
    });
    // A Folder or a Project in a Slot never becomes the current file, so
    // the Content inside it lands at the marker, and the directories are
    // still made. Go: TestFragmentFolderAndProjectInASlot.
    (0, node_test_1.test)('fragment-folder-and-project-in-a-slot', async () => {
        const { fs, vol } = (0, memfs_1.memfs)({ '/tm/s2.txt': 'A<[SLOT:s]>B<[SLOT]>C\n' });
        await (0, __1.Jostraca)({ now: () => START_TIME }).generate({ fs: () => fs, folder: '/out' }, (0, __1.cmp)(() => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'f.txt' }, () => (0, __1.Fragment)({ from: '/tm/s2.txt' }, () => {
                (0, __1.Slot)({ name: 's' }, () => (0, __1.Folder)({ name: 'd' }, () => (0, __1.Content)('x')));
                (0, __1.Folder)({ name: 'e' }, () => (0, __1.Content)('y'));
            }));
            (0, __1.File)({ name: 'g.txt' }, () => (0, __1.Fragment)({ from: '/tm/s2.txt' }, () => {
                (0, __1.Slot)({ name: 's' }, () => (0, __1.Project)({ folder: 'p' }, () => (0, __1.Content)('x')));
            }));
        })));
        const out = vol.toJSON();
        (0, expect_1.expect)(out['/out/f.txt']).equal('AxByC\n');
        (0, expect_1.expect)(out['/out/g.txt']).equal('AxBC\n');
        (0, expect_1.expect)([out['/out/d'], out['/out/e'], out['/out/p']]).equal([null, null, null]);
    });
    // A Project's folder applies only to its own subtree. When it closes the
    // enclosing folder state comes back, so a later sibling lands where it
    // would have without the Project, and nothing is written outside the
    // output folder. Go: go/project_scope_test.go.
    const genIn = async (folder, def) => {
        const { fs, vol } = (0, memfs_1.memfs)({});
        const info = await (0, __1.Jostraca)({ now: () => START_TIME })
            .generate({ fs: () => fs, folder }, (0, __1.cmp)(def));
        const files = Object.keys(vol.toJSON())
            .filter((k) => !k.includes('/' + META_FOLDER + '/')).sort();
        return { files, written: info.files.written.slice().sort() };
    };
    (0, node_test_1.test)('project-nested-in-folder', async () => {
        const { files } = await genIn('/out', () => (0, __1.Project)({ folder: '.' }, () => {
            (0, __1.Folder)({ name: 'a' }, () => {
                (0, __1.Project)({ folder: 'p2' }, () => (0, __1.File)({ name: 'x.txt' }, () => (0, __1.Content)('x')));
            });
            (0, __1.File)({ name: 'y.txt' }, () => (0, __1.Content)('y'));
        }));
        (0, expect_1.expect)(files).equal(['/out/a', '/out/p2/x.txt', '/out/y.txt']);
    });
    (0, node_test_1.test)('project-nested-two-folders', async () => {
        const { files } = await genIn('/w/out', () => (0, __1.Project)({ folder: '.' }, () => {
            (0, __1.Folder)({ name: 'a' }, () => {
                (0, __1.Folder)({ name: 'b' }, () => {
                    (0, __1.Project)({ folder: 'p2' }, () => (0, __1.File)({ name: 'x.txt' }, () => (0, __1.Content)('x')));
                });
                (0, __1.File)({ name: 'z.txt' }, () => (0, __1.Content)('z'));
            });
            (0, __1.File)({ name: 'y.txt' }, () => (0, __1.Content)('y'));
        }));
        (0, expect_1.expect)(files).equal(['/w/out/a/b', '/w/out/a/z.txt', '/w/out/p2/x.txt', '/w/out/y.txt']);
    });
    // #26: a File after a sibling Project lands in the enclosing folder, not
    // in the Project's.
    (0, node_test_1.test)('project-then-sibling-file', async () => {
        const nested = await genIn('/out', () => (0, __1.Project)({ folder: '.' }, () => {
            (0, __1.Project)({ folder: 'p' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('a')));
            (0, __1.File)({ name: 'y.txt' }, () => (0, __1.Content)('y'));
        }));
        (0, expect_1.expect)(nested.files).equal(['/out/p/a.txt', '/out/y.txt']);
        const top = await genIn('/out', () => {
            (0, __1.Project)({ folder: 'p' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)('a')));
            (0, __1.File)({ name: 'y.txt' }, () => (0, __1.Content)('y'));
        });
        (0, expect_1.expect)(top.files).equal(['/out/p/a.txt', '/out/y.txt']);
    });
    (0, node_test_1.test)('two-sibling-projects', async () => {
        const { files } = await genIn('/out', () => {
            (0, __1.Project)({ folder: 'a' }, () => (0, __1.File)({ name: 'x.txt' }, () => (0, __1.Content)('x')));
            (0, __1.Project)({ folder: 'b' }, () => (0, __1.File)({ name: 'y.txt' }, () => (0, __1.Content)('y')));
        });
        (0, expect_1.expect)(files).equal(['/out/a/x.txt', '/out/b/y.txt']);
    });
    // A File nested in a File, directly or through a Folder, is written to
    // its own path and the outer File keeps all of its own content, before
    // and after it. Go: TestFileInsideFile in go/nested_emitters_test.go.
    (0, node_test_1.test)('file-inside-file', async () => {
        const direct = await genIn('/out', () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'outer.txt' }, () => {
                (0, __1.Content)('1');
                (0, __1.File)({ name: 'inner.txt' }, () => (0, __1.Content)('2'));
                (0, __1.Content)('3');
            });
        }));
        (0, expect_1.expect)(direct.files).equal(['/out/inner.txt', '/out/outer.txt']);
        (0, expect_1.expect)(direct.written).equal(['/out/inner.txt', '/out/outer.txt']);
        const out = await gen({}, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'outer.txt' }, () => {
                (0, __1.Content)('1');
                (0, __1.File)({ name: 'inner.txt' }, () => (0, __1.Content)('2'));
                (0, __1.Content)('3');
            });
            (0, __1.File)({ name: 'outer2.txt' }, () => {
                (0, __1.Content)('1');
                (0, __1.Folder)({ name: 'sub' }, () => (0, __1.File)({ name: 'inner.txt' }, () => (0, __1.Content)('2')));
                (0, __1.Content)('3');
            });
        }));
        (0, expect_1.expect)(out).equal({
            '/out/outer.txt': '13',
            '/out/inner.txt': '2',
            '/out/outer2.txt': '13',
            '/out/sub/inner.txt': '2',
        });
    });
    // A Folder or a Project inside a File never becomes the current file, so
    // what its children emit lands in the File, in source order, and the
    // directories are still made. A File or an Inject in there writes its own
    // target. Go: TestFolderAndProjectInsideFile.
    (0, node_test_1.test)('folder-and-project-inside-file', async () => {
        const out = await gen({
            '/src/c.txt': 'C$$name$$\n',
            '/tm/f.txt': '[F<[SLOT]>]\n',
            '/out/inj.txt': 'h\n#--START--#\nold\n#--END--#\nt\n',
        }, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'f.txt' }, () => {
                (0, __1.Content)('1');
                (0, __1.Folder)({ name: 'd' }, () => (0, __1.Content)('x'));
                (0, __1.Content)('2');
            });
            (0, __1.File)({ name: 'g.txt' }, () => {
                (0, __1.Content)('1');
                (0, __1.Project)({ folder: 'p' }, () => (0, __1.Content)('y'));
                (0, __1.Content)('2');
            });
            (0, __1.File)({ name: 'h.txt' }, () => {
                (0, __1.Content)('1');
                (0, __1.Folder)({ name: 'e' }, () => (0, __1.Copy)({ from: '/src/c.txt', to: 'c2.txt' }));
                (0, __1.Content)('2');
            });
            (0, __1.File)({ name: 'i.txt' }, () => {
                (0, __1.Content)('1');
                (0, __1.Folder)({ name: 'k' }, () => (0, __1.Folder)({ name: 'l' }, () => (0, __1.Fragment)({ from: '/tm/f.txt' }, () => (0, __1.Content)('S'))));
                (0, __1.Content)('2');
            });
            (0, __1.File)({ name: 'j.txt' }, () => {
                (0, __1.Content)('1');
                (0, __1.Folder)({ name: 'm' }, () => {
                    (0, __1.File)({ name: 'inner.txt' }, () => (0, __1.Content)('I'));
                    (0, __1.Content)('z');
                });
                (0, __1.Content)('2');
            });
            (0, __1.File)({ name: 'n.txt' }, () => {
                (0, __1.Content)('1');
                (0, __1.Folder)({ name: '.' }, () => (0, __1.Inject)({ name: 'inj.txt' }, () => (0, __1.Content)('NEW')));
                (0, __1.Content)('2');
            });
        }), { model: { name: 'N' } });
        (0, expect_1.expect)(out).equal({
            '/src/c.txt': 'C$$name$$\n',
            '/tm/f.txt': '[F<[SLOT]>]\n',
            '/out/d': null,
            '/out/p': null,
            '/out/k/l': null,
            '/out/f.txt': '1x2',
            '/out/g.txt': '1y2',
            '/out/e/c2.txt': 'CN\n',
            '/out/h.txt': '1CN\n2',
            '/out/i.txt': '1[FS]\n2',
            '/out/m/inner.txt': 'I',
            '/out/j.txt': '1z2',
            '/out/inj.txt': 'h\n#--START--#\nNEW\n#--END--#\nt\n',
            '/out/n.txt': '12',
        });
    });
    // The global exclude window compares WHOLE milliseconds: an output file is
    // left alone when floor(mtimeMs) > last. A write inside the millisecond
    // `last` names is not newer than the build. Real filesystem, because the
    // point is a sub-millisecond mtime. Go: TestExcludeWindowWholeMilliseconds.
    (0, node_test_1.test)('exclude-window-whole-milliseconds', async () => {
        const T0 = START_TIME;
        const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-excl-'));
        const p = Path.join(dir, 'a.txt');
        const run = (now, src, exclude) => (0, __1.Jostraca)({ now: () => now }).generate({ fs: () => Fs, folder: dir, exclude }, (0, __1.cmp)(() => (0, __1.Project)({ folder: '.' }, () => (0, __1.File)({ name: 'a.txt' }, () => (0, __1.Content)(src)))));
        try {
            for (const [delta, kept] of [[0.5, false], [0.999, false], [1, true]]) {
                await run(T0, 'A\n', false);
                Fs.writeFileSync(p, 'U\n');
                Fs.utimesSync(p, (T0 + delta) / 1000, (T0 + delta) / 1000);
                const info = await run(T0 + 100000, 'A2\n', true);
                (0, expect_1.expect)([delta, info.files.written.length]).equal([delta, kept ? 0 : 1]);
                (0, expect_1.expect)([delta, Fs.readFileSync(p, 'utf8')]).equal([delta, kept ? 'U\n' : 'A2\n']);
            }
        }
        finally {
            Fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    // A single-file text CopyFiles inside a File or an Inject splices exactly
    // the text it writes to its own target: model substitution AND its
    // `replace`. Go: TestCopyInsideFileReplace.
    (0, node_test_1.test)('copy-inside-file-replace', async () => {
        const out = await gen({ '/tm/single.txt': 'single $$name$$ FOO\n' }, () => (0, __1.Project)({}, () => {
            (0, __1.File)({ name: 'host.txt' }, () => {
                (0, __1.Content)('pre\n');
                (0, __1.CopyFiles)({ from: '/tm/single.txt', to: 'spliced.txt', replace: { FOO: 'bar' } });
                (0, __1.Content)('post\n');
            });
        }), { model: { name: 'World' } });
        (0, expect_1.expect)(out['/out/spliced.txt']).equal('single World bar\n');
        (0, expect_1.expect)(out['/out/host.txt']).equal('pre\nsingle World bar\npost\n');
        const inj = await gen({
            '/tm/single.txt': 'single $$name$$ FOO\n',
            '/out/t.txt': 'head\n#--START--#\nold\n#--END--#\ntail\n',
        }, () => (0, __1.Project)({}, () => {
            (0, __1.Inject)({ name: 't.txt' }, () => {
                (0, __1.Content)('pre;');
                (0, __1.CopyFiles)({ from: '/tm/single.txt', to: 'spliced.txt', replace: { FOO: 'bar' } });
                (0, __1.Content)('post;');
            });
        }), { model: { name: 'World' } });
        (0, expect_1.expect)(inj['/out/spliced.txt']).equal('single World bar\n');
        (0, expect_1.expect)(inj['/out/t.txt'])
            .equal('head\n#--START--#\npre;single World bar\npost;\n#--END--#\ntail\n');
    });
    // Fragment and CopyFiles refuse a wrongly typed prop when they are
    // called, before anything is written, whether the tree is code or data.
    // Content has no shape, so its indent is stringified. Go:
    // TestClosedShapePropTypes, TestCmpTreeClosedPropTypes and
    // TestContentIndentIsNotTypeChecked.
    (0, node_test_1.test)('closed-shape-prop-types', async () => {
        const SRC = { '/tm/model.txt': 'M=$$name$$\n', '/tm/tree/a.txt': 'A\n' };
        const refused = async (def, want) => {
            const { err, vol } = await genErr(SRC, () => (0, __1.Project)({}, () => {
                (0, __1.File)({ name: 'first.txt' }, () => (0, __1.Content)('first'));
                def();
            }), { model: { name: 'World' } });
            (0, expect_1.expect)(null == err).equal(false);
            Assert.match(err.message, want);
            (0, expect_1.expect)(noOutput(vol)).equal([]);
        };
        await refused(() => (0, __1.CopyFiles)({ from: '/tm/tree', to: 'n', exclude: 5 }), /Value "5" for property "exclude" does not satisfy one of: Boolean, String, RegExp/);
        await refused(() => (0, __1.File)({ name: 'b.txt' }, () => (0, __1.Fragment)({ from: '/tm/model.txt', indent: true })), /Fragment: Value "true" for property "indent" does not satisfy one of: String, Number/);
        const tree = (node) => () => (0, __1.cmpTree)([node])();
        await refused(tree({ cmp: 'CopyFiles', props: { from: '/tm/tree', exclude: { a: 1 } } }), /Value "\{a:1\}" for property "exclude"/);
        await refused(tree({ cmp: 'CopyFiles', props: { from: '/tm/tree', to: 5 } }), /property "to" with number "5" because the number is not of type string/);
        await refused(tree({
            cmp: 'File', props: { name: 'b.txt' },
            children: [{ cmp: 'Fragment', props: { from: '/tm/model.txt', indent: ['>'] } }],
        }), /Value "\[>\]" for property "indent"/);
        // A null indent is a value, refused, whether the node states it or a
        // ListItems binds it; an unset one binds nothing, and passes.
        const NULL_INDENT = /Fragment: Value "null" for property "indent" does not satisfy one of: String, Number/;
        const listed = (listProps, fragProps) => tree({
            cmp: 'File', props: { name: 'l.txt' },
            children: [{
                    cmp: 'ListItems', props: { item: [{ n: 1 }], line: false, ...listProps },
                    children: [{ cmp: 'Fragment', props: { from: '/tm/model.txt', ...fragProps } }],
                }],
        });
        await refused(tree({
            cmp: 'File', props: { name: 'b.txt' },
            children: [{ cmp: 'Fragment', props: { from: '/tm/model.txt', indent: null } }],
        }), NULL_INDENT);
        await refused(listed({ indent: null }, {}), NULL_INDENT);
        await refused(listed({ indent: 2 }, { indent: null }), NULL_INDENT);
        for (const [listProps, want] of [[{}, 'M=World\n'], [{ indent: 2 }, '  M=World\n']]) {
            const out = await gen(SRC, () => (0, __1.Project)({}, listed(listProps, {})), { model: { name: 'World' } });
            (0, expect_1.expect)({ listProps, got: out['/out/l.txt'] }).equal({ listProps, got: want });
        }
        const out = await gen({}, () => (0, __1.Project)({}, () => (0, __1.File)({ name: 'c.txt' }, () => (0, __1.Content)({ src: 'x\ny\n', indent: true }))));
        (0, expect_1.expect)(out['/out/c.txt']).equal('truex\ntruey\n');
    });
    // A component used outside a generate callback throws at once, naming
    // itself, before and after a generate has run. Go panics with the same
    // text on the *J that New returned: TestComponentOutsideGenerate.
    (0, node_test_1.test)('component-outside-generate', async () => {
        const Wrap = (0, __1.cmp)(function Wrap() { (0, __1.Content)('w'); });
        const Anon = (0, __1.cmp)(() => { (0, __1.Content)('a'); });
        let ran = false;
        const body = () => { ran = true; };
        const calls = [
            ['Project', () => (0, __1.Project)({ folder: 'p' }, body)],
            ['Folder', () => (0, __1.Folder)({ name: 'd' }, body)],
            ['File', () => (0, __1.File)({ name: 'x.txt' }, body)],
            ['Content', () => (0, __1.Content)('x')],
            ['Line', () => (0, __1.Line)('x')],
            ['Slot', () => (0, __1.Slot)({ name: 's' }, body)],
            ['Inject', () => (0, __1.Inject)({ name: 't.txt' }, body)],
            ['Fragment', () => (0, __1.Fragment)({ from: '/f.txt' }, body)],
            ['CopyFiles', () => (0, __1.CopyFiles)({ from: '/f.txt' })],
            ['CopyFiles', () => (0, __1.Copy)({ from: '/f.txt' })],
            ['ListItems', () => (0, __1.List)({ item: [1] }, body)],
            ['Wrap', () => Wrap({})],
            ['<anon>', () => Anon({})],
        ];
        const check = () => {
            for (const [name, call] of calls) {
                Assert.throws(call, {
                    message: 'jostraca: component ' + name + ' called outside generate(); ' +
                        'components can only be used inside the callback passed to ' +
                        'Jostraca().generate()'
                });
            }
            (0, expect_1.expect)(ran).equal(false);
        };
        check();
        // A call kept from inside the callback and made once generate() has
        // returned throws too, as Go's kept *J panics: TestComponentOutsideGenerate.
        const kept = [];
        const out = await gen({ '/f.txt': 'F\n' }, () => (0, __1.File)({ name: 'ok.txt' }, () => {
            kept.push(() => (0, __1.Content)('late'));
            (0, __1.Content)('OK');
        }));
        (0, expect_1.expect)(out['/out/ok.txt']).equal('OK');
        check();
        Assert.throws(kept[0], {
            message: 'jostraca: component Content called outside generate(); ' +
                'components can only be used inside the callback passed to ' +
                'Jostraca().generate()'
        });
    });
});
//# sourceMappingURL=jostraca.test.js.map