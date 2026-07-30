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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
// Internal module paths, not the package entry: the corpus covers helpers
// such as `get` that are not on the public API surface. point.test.ts
// already reaches into dist/ the same way.
const Basic = __importStar(require("../dist/util/basic"));
const DiffUtil = __importStar(require("../dist/diff"));
// The shared corpus, driven by both stacks. See test/spec/README.md.
// __dirname is ts/dist-test at run time, so the repo root is two up.
const SPEC_DIR = node_path_1.default.join(__dirname, '..', '..', 'test', 'spec');
// One adapter per corpus `fn`. Shapes are chosen so the result serializes
// identically in Go: `omap` yields an ordered pair list because that is
// the only way to assert key order in a language whose maps have none.
const FN = {
    camelify: (a) => Basic.camelify(a[0]),
    snakify: (a) => Basic.snakify(a[0]),
    kebabify: (a) => Basic.kebabify(a[0]),
    partify: (a) => Basic.partify(a[0]),
    lcf: (a) => Basic.lcf(a[0]),
    ucf: (a) => Basic.ucf(a[0]),
    escre: (a) => Basic.escre(a[0]),
    indent: (a) => Basic.indent(a[0], a[1]),
    isbinext: (a) => Basic.isbinext(a[0]),
    isbincontent: (a) => Basic.isbincontent(a[0]),
    get: (a) => Basic.get(a[0], a[1]),
    getx: (a) => Basic.getx(a[0], a[1]),
    deep: (a) => Basic.deep(...a),
    omap: (a) => Object.entries(Basic.omap(a[0])),
    template: (a) => Basic.template(a[0], a[1], a[2]),
    names: (a) => 2 === a.length
        ? Basic.names(a[0], a[1])
        : Basic.names(a[0], a[1], a[2]),
    lines: (a) => DiffUtil.lines(a[0]),
    lcs: (a) => DiffUtil.lcs(a[0], a[1]),
};
function loadCases() {
    const out = [];
    const files = node_fs_1.default.readdirSync(SPEC_DIR)
        .filter((n) => n.endsWith('.tsv'))
        .sort();
    if (0 === files.length) {
        throw new Error('no .tsv files found in ' + SPEC_DIR);
    }
    for (const file of files) {
        const text = node_fs_1.default.readFileSync(node_path_1.default.join(SPEC_DIR, file), 'utf8');
        const rows = text.split('\n');
        let header = null;
        for (const [i, row] of rows.entries()) {
            if ('' === row.trim() || row.startsWith('#')) {
                continue;
            }
            const cells = row.split('\t');
            if (null == header) {
                header = cells;
                const want = ['id', 'fn', 'args', 'expect', 'error'];
                node_assert_1.default.deepStrictEqual(header, want, `${file}: header is ${JSON.stringify(header)}, want ${JSON.stringify(want)}`);
                continue;
            }
            // A short row means a trailing empty cell was trimmed by an editor;
            // pad rather than crash on an out-of-range index.
            while (cells.length < 5) {
                cells.push('');
            }
            node_assert_1.default.equal(cells.length, 5, `${file}:${i + 1}: ${cells.length} cells, want 5`);
            const error = cells[4];
            out.push({
                file,
                line: i + 1,
                id: cells[0],
                fn: cells[1],
                args: JSON.parse(cells[2]),
                expect: '' === error ? JSON.parse(cells[3]) : undefined,
                error,
            });
        }
    }
    return out;
}
// Canonical JSON with object keys sorted, matching what Go's
// json.Marshal produces. Arrays keep their order — they have a
// meaningful one, and that is what the ordering cases rely on.
function canon(val) {
    return JSON.stringify(sorted(val));
}
function sorted(val) {
    if (null == val || 'object' !== typeof val) {
        // undefined is a miss, and both stacks report misses as null.
        return undefined === val ? null : val;
    }
    if (Array.isArray(val)) {
        return val.map(sorted);
    }
    const out = {};
    for (const key of Object.keys(val).sort()) {
        out[key] = sorted(val[key]);
    }
    return out;
}
(0, node_test_1.describe)('spec-corpus', () => {
    const cases = loadCases();
    // A corpus that silently shrinks to nothing would pass. Assert it is
    // actually populated, and report the count so the two stacks can be
    // compared at a glance.
    (0, node_test_1.test)('corpus-loaded', () => {
        node_assert_1.default.ok(100 < cases.length, `only ${cases.length} cases loaded from ${SPEC_DIR}`);
        console.log(`spec corpus: ${cases.length} cases`);
    });
    // Unknown `fn` is a failure, not a skip: a corpus entry one stack
    // ignores is exactly the divergence this suite exists to catch.
    (0, node_test_1.test)('all-fns-dispatched', () => {
        const missing = [...new Set(cases.map((c) => c.fn))]
            .filter((fn) => !(fn in FN))
            .sort();
        node_assert_1.default.deepStrictEqual(missing, [], 'corpus uses undispatched fns: ' + missing.join(', '));
    });
    (0, node_test_1.test)('ids-unique', () => {
        const seen = new Map();
        for (const c of cases) {
            const key = c.file + ':' + c.id;
            node_assert_1.default.ok(!seen.has(key), `duplicate id ${key}`);
            seen.set(key, c.file);
        }
    });
    for (const c of cases) {
        (0, node_test_1.test)(`${c.file}/${c.id}`, () => {
            const where = `${c.file}:${c.line} ${c.id}`;
            if ('' !== c.error) {
                node_assert_1.default.throws(() => FN[c.fn](c.args), (err) => {
                    node_assert_1.default.ok(String(err.message).includes(c.error), `${where}: message ${JSON.stringify(err.message)} ` +
                        `does not contain ${JSON.stringify(c.error)}`);
                    return true;
                }, `${where}: expected a throw containing ${JSON.stringify(c.error)}`);
                return;
            }
            const actual = FN[c.fn](c.args);
            node_assert_1.default.equal(canon(actual), canon(c.expect), where);
        });
    }
});
//# sourceMappingURL=spec.test.js.map