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
// THE PROP SURFACE, HELD TO THE COMPONENTS (docs/cmp-surface.tsv).
//
// That file says what every component reads, what type each prop takes,
// and what an unknown prop does. It is published so that a generator
// driving Jostraca from another language can pin its own schema against
// data rather than against a page of prose -- which only works while
// the data is true, and prose is where this kind of file goes stale.
//
// Three checks, and none of them is a restatement of the file:
//
//   1. THE COMPONENTS ARE THE ONES ON DISK. Every file in `src/cmp/`
//      has rows, every row names one. `None` is internal and excluded,
//      the same exemption the tree registry's drift guard makes.
//   2. THE PROPS ARE THE ONES THE CODE READS. Each component's source
//      is scanned for `props.<name>`, and the result must equal the
//      declared set. A prop added without a row fails here; so does a
//      row for a prop nothing reads.
//   3. THE `*` ROW IS TRUE. A component declared `refused:` must
//      actually refuse an unknown prop, and one declared `ignored:`
//      must actually accept it. That is the fact a consumer most needs,
//      and it is the one that cannot be checked by reading the file.
//
// Check 2 scans text, which is crude, and the crudeness has already
// cost something: `Fragment` had a filter callback whose parameter was
// also called `props`, so the scan read `props.name` and reported a
// prop Fragment does not have. The parameter was renamed rather than
// the scan made cleverer -- a component whose own props are ambiguous
// in its own source is worth fixing for a reader too.
const node_test_1 = require("node:test");
const Assert = __importStar(require("node:assert"));
const Fs = __importStar(require("node:fs"));
const Path = __importStar(require("node:path"));
const memfs_1 = require("../dist/util/memfs");
const __1 = require("../");
const REPO = Path.join(__dirname, '..', '..');
const SURFACE = Path.join(REPO, 'docs', 'cmp-surface.tsv');
const CMP_DIR = Path.join(REPO, 'ts', 'src', 'cmp');
// Written into every props object by `cmp()`, never by an author, and
// so deliberately absent from the published surface.
const AMBIENT = 'ctx$';
function rows() {
    const text = Fs.readFileSync(SURFACE, 'utf8');
    const out = [];
    let header = false;
    text.split('\n').forEach((raw, i) => {
        const line = raw.replace(/\r$/, '');
        if ('' === line.trim() || line.startsWith('#')) {
            return;
        }
        const cols = line.split('\t');
        Assert.equal(cols.length, 5, `docs/cmp-surface.tsv:${i + 1} wants 5 tab-separated columns, ` +
            `got ${cols.length}: ${line}`);
        if (!header) {
            Assert.deepEqual(cols, ['cmp', 'prop', 'type', 'required', 'note'], 'docs/cmp-surface.tsv: unexpected header row');
            header = true;
            return;
        }
        out.push({
            cmp: cols[0], prop: cols[1], type: cols[2],
            required: cols[3], note: cols[4], line: i + 1,
        });
    });
    Assert.ok(header, 'docs/cmp-surface.tsv: no header row');
    Assert.ok(30 < out.length, `docs/cmp-surface.tsv: only ${out.length} rows loaded`);
    return out;
}
// The props one component reads, from its source. `(props as any).from`
// and `props?.eject` are the two spellings in the tree beyond the plain
// one, so both are normalised before the scan.
function readsOf(cmp) {
    const src = Fs.readFileSync(Path.join(CMP_DIR, cmp + '.ts'), 'utf8')
        .replace(/\(\s*props\s+as\s+any\s*\)/g, 'props');
    const found = new Set();
    for (const m of src.matchAll(/\bprops\s*\??\.\s*([A-Za-z_$][\w$]*)/g)) {
        if (AMBIENT !== m[1]) {
            found.add(m[1]);
        }
    }
    return [...found].sort();
}
// One node per component, in a place its op accepts, so that a case can
// generate it with an extra prop and see what happens. The seed holds
// the files the three reading components need.
const SEED = {
    '/frag.txt': 'HEADER\n<[SLOT]>\nFOOTER\n',
    '/src/copied.txt': 'COPIED\n',
    '/top/inject.txt': 'A\n#--START--#\n\n#--END--#\nB\n',
};
function sample(cmp, extra) {
    const props = (p) => ({ ...p, ...extra });
    const inFile = (node) => ({
        cmp: 'File', props: { name: 'x.txt' }, children: [node],
    });
    switch (cmp) {
        case 'Project':
            return { cmp, props: props({ folder: 'sdk' }) };
        case 'Folder':
            return { cmp, props: props({ name: 'f' }) };
        case 'File':
            return { cmp, props: props({ name: 'x.txt' }) };
        case 'Content':
        case 'Line':
            return inFile({ cmp, props: props({ src: 'c' }) });
        case 'Fragment':
            return inFile({
                cmp, props: props({ from: '/frag.txt' }),
                children: [{ cmp: 'Slot', props: { name: 's' } }],
            });
        case 'Slot':
            return inFile({
                cmp: 'Fragment', props: { from: '/frag.txt' },
                children: [{ cmp, props: props({ name: 's' }) }],
            });
        case 'Inject':
            return { cmp, props: props({ name: 'inject.txt' }) };
        case 'CopyFiles':
            return inFile({
                cmp, props: props({ from: '/src/copied.txt', to: 'c.txt' }),
            });
        case 'ListItems':
            return inFile({
                cmp, props: props({ item: [{ n: 1 }] }),
                children: [{ cmp: 'Content', props: { src: 'i' } }],
            });
        default:
            throw new Error('cmp-surface: no sample node for ' + cmp);
    }
}
async function generates(node) {
    const { fs } = (0, memfs_1.memfs)({ ...SEED });
    try {
        await (0, __1.Jostraca)().generate({ fs: () => fs, folder: '/top' }, (0, __1.cmpTree)(node));
    }
    catch (err) {
        return err.message;
    }
    return undefined;
}
(0, node_test_1.describe)('cmp-surface', () => {
    // 1. The components are the ones on disk.
    (0, node_test_1.test)('every-component-has-rows', () => {
        const onDisk = Fs.readdirSync(CMP_DIR)
            .filter((f) => f.endsWith('.ts'))
            .map((f) => f.replace(/\.ts$/, ''))
            .filter((n) => 'None' !== n)
            .sort();
        const declared = [...new Set(rows().map((r) => r.cmp))].sort();
        Assert.deepEqual(declared, onDisk, 'docs/cmp-surface.tsv and src/cmp/ disagree about the component set');
        // ... and the surface covers what a data tree can name, which is
        // the consumer this file is published for.
        Assert.deepEqual(declared, Object.keys(__1.TREE_CMP).sort(), 'docs/cmp-surface.tsv and TREE_CMP disagree');
    });
    // 2. The props are the ones the code reads.
    (0, node_test_1.test)('every-declared-prop-is-read-and-every-read-prop-is-declared', () => {
        const byCmp = new Map();
        for (const row of rows()) {
            byCmp.set(row.cmp, [...(byCmp.get(row.cmp) || []), row]);
        }
        for (const [cmp, cmprows] of byCmp) {
            const stars = cmprows.filter((r) => '*' === r.prop);
            Assert.equal(stars.length, 1, `docs/cmp-surface.tsv: ${cmp} wants exactly one \`*\` row, ` +
                `got ${stars.length}`);
            const declared = cmprows.filter((r) => '*' !== r.prop);
            // A note beginning `unused:` marks a prop both ports accept and
            // neither reads. Declaring one is allowed; declaring one that IS
            // read is a stale note.
            const unused = declared
                .filter((r) => r.note.startsWith('unused:')).map((r) => r.prop);
            const names = declared.map((r) => r.prop).sort();
            const read = readsOf(cmp);
            Assert.deepEqual(names, [...new Set(names)], `docs/cmp-surface.tsv: ${cmp} declares a prop twice`);
            Assert.deepEqual(names.filter((n) => !unused.includes(n)), read, `docs/cmp-surface.tsv and src/cmp/${cmp}.ts disagree about props ` +
                `(a prop marked \`unused:\` is exempt)`);
            for (const prop of unused) {
                Assert.ok(!read.includes(prop), `docs/cmp-surface.tsv: ${cmp}.${prop} is marked \`unused:\` ` +
                    `and src/cmp/${cmp}.ts reads it`);
            }
            for (const row of declared) {
                Assert.match(row.required, /^(yes|no)$/, `docs/cmp-surface.tsv:${row.line} required is yes or no`);
                Assert.ok('' !== row.type && '-' !== row.type, `docs/cmp-surface.tsv:${row.line} needs a type`);
                Assert.ok('' !== row.note, `docs/cmp-surface.tsv:${row.line} needs a note`);
            }
        }
    });
    // 3. The `*` row is true, and it is the fact a consumer most needs:
    // two of the ten components validate a CLOSED prop set and eight do
    // not, so the same typo is a hard failure in one place and a silently
    // dropped prop in another.
    (0, node_test_1.test)('an-unknown-prop-does-what-the-star-row-says', async () => {
        const stars = rows().filter((r) => '*' === r.prop);
        Assert.equal(stars.length, Object.keys(__1.TREE_CMP).length);
        for (const row of stars) {
            Assert.match(row.note, /^(refused|ignored):/, `docs/cmp-surface.tsv:${row.line} a \`*\` note starts ` +
                `\`refused:\` or \`ignored:\``);
            // The control: the same node with no extra prop must generate,
            // otherwise the case below proves nothing.
            Assert.equal(await generates(sample(row.cmp, {})), undefined, `cmp-surface: the sample node for ${row.cmp} does not generate`);
            const err = await generates(sample(row.cmp, { nosuchprop: 1 }));
            if (row.note.startsWith('refused:')) {
                Assert.ok(null != err, `docs/cmp-surface.tsv:${row.line} says ${row.cmp} refuses an ` +
                    `unknown prop, and it accepted one`);
                Assert.match(err, /nosuchprop/, `${row.cmp} refused an unknown prop without naming it`);
            }
            else {
                Assert.equal(err, undefined, `docs/cmp-surface.tsv:${row.line} says ${row.cmp} ignores an ` +
                    `unknown prop, and it refused one`);
            }
        }
    });
});
//# sourceMappingURL=cmp-surface.test.js.map