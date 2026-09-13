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
// THE COMPONENT PROP SURFACE IS A SET OF TYPES, AND THIS HOLDS IT TRUE.
//
// Every component declares what it reads -- `FileProps`, `ContentProps`,
// and so on -- beside the code that reads it, and the package re-exports
// the lot. That is the whole published surface: a generator written here
// gets it from the compiler, and one driving jostraca from another
// language through `cmpTree` pins its schema against `dist/*.d.ts`
// rather than against a page of prose.
//
// A DECLARATION IS ONLY WORTH WHAT IT IS HELD TO, so this holds it four
// ways, and none of them is a restatement of the types:
//
//   1. THE COMPONENTS ARE THE ONES ON DISK, each has a props type, and
//      the package exports it. `None` is internal -- nothing imports it
//      -- and is the one exemption, the same one the tree registry's
//      drift guard makes.
//   2. THE PROPS ARE THE ONES THE CODE READS. Each component's source is
//      scanned for `props.<name>` and the result must equal the declared
//      set. A prop added without a declaration fails here; so does a
//      declaration for a prop nothing reads.
//   3. THE TYPES REFUSE WHAT THEY SAY THEY REFUSE. typecase/cases.ts is
//      compiled, and the lines that must fail have to fail for the
//      stated reason.
//   4. AND THE RUNTIME DOES WHAT THE TYPES SAY -- which is not the same
//      fact. A data tree carries JSON and never met the compiler, so the
//      same unknown prop goes through a real generate: two of the ten
//      components validate a closed set and eight drop what they do not
//      know.
//
// 1 AND 2 READ `dist/`, not `src/`. The declaration files are the
// artifact a consumer installs, so that is where a claim about the
// published surface has to be checked -- and it is why the props types
// carry `/** */` rather than the house `//`: `tsc` drops a line comment
// on the way out, and a comment that does not survive emit is a comment
// the consumer never sees.
//
// Check 2 scans text, which is crude, and the crudeness has already cost
// something: `Fragment` had a filter callback whose parameter was also
// called `props`, so the scan read `props.name` and reported a prop
// Fragment does not have. The parameter was renamed rather than the scan
// made cleverer -- a component whose own props are ambiguous in its own
// source is worth fixing for a reader too.
const node_test_1 = require("node:test");
const Assert = __importStar(require("node:assert"));
const Fs = __importStar(require("node:fs"));
const Path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const memfs_1 = require("../dist/util/memfs");
const __1 = require("../");
const TSROOT = Path.join(__dirname, '..');
const CMP_SRC = Path.join(TSROOT, 'src', 'cmp');
const CMP_DTS = Path.join(TSROOT, 'dist', 'cmp');
const ENTRY_DTS = Path.join(TSROOT, 'dist', 'jostraca.d.ts');
const TYPECASE = Path.join(TSROOT, 'typecase');
const TSC = Path.join(TSROOT, 'node_modules', 'typescript', 'bin', 'tsc');
// Written into every props object by `cmp()`, never by an author, and so
// deliberately absent from every props type.
const AMBIENT = 'ctx$';
// The component nothing imports.
const INTERNAL = ['None'];
// The two that validate a closed prop set at run time. The other eight
// accept an unknown prop and drop it.
const CLOSED = ['Fragment', 'CopyFiles'];
// --- the declared surface, read out of the emitted declarations ------
// The body of a declared type, following an alias by name: `LineProps`
// is emitted as `type LineProps = ContentProps;`, and the answer wanted
// is Content's seven props rather than a bare name.
function typeBody(name, seen = []) {
    Assert.ok(!seen.includes(name), 'circular type alias: ' + [...seen, name].join(' -> '));
    const head = 'type ' + name + ' = ';
    for (const f of Fs.readdirSync(CMP_DTS).filter((f) => f.endsWith('.d.ts'))) {
        const src = Fs.readFileSync(Path.join(CMP_DTS, f), 'utf8');
        const at = src.indexOf(head);
        if (-1 === at) {
            continue;
        }
        const rhs = src.slice(at + head.length);
        if (rhs.startsWith('{')) {
            return rhs;
        }
        const alias = rhs.match(/^([A-Za-z_$][\w$]*)\s*;/);
        Assert.ok(null != alias, `${name} is neither an object type nor an alias: ` +
            rhs.split('\n')[0]);
        return typeBody(alias[1], [...seen, name]);
    }
    throw new Error(`dist/cmp/ declares no type ${name}; build first`);
}
// Its props, in the order tsc emitted them.
//
// One field per line at four spaces is what declaration emit produces
// for these types, and a doc comment's lines all begin with `*`, so the
// anchored match cannot mistake one for a field.
function declaredProps(cmp) {
    const body = typeBody(cmp + 'Props');
    // A type with no props emits on one line: `type NoneProps = {};`.
    if (body.startsWith('{}')) {
        return [];
    }
    const lines = body.split('\n');
    const out = [];
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].startsWith('};')) {
            return out.sort();
        }
        const m = lines[i].match(/^ {4}([A-Za-z_$][\w$]*)\??:/);
        if (null != m) {
            out.push(m[1]);
        }
    }
    throw new Error(`dist/cmp/: the declaration of ${cmp}Props does not close`);
}
// The props one component reads, from its source.
//
// COMMENTS ARE STRIPPED FIRST, and the dot has to be tight against the
// name. Both because the scan read PROSE otherwise: `None`'s doc comment
// says "takes no props. It is the empty component", and the scan duly
// reported a prop called `It`.
function readsOf(cmp) {
    const src = Fs.readFileSync(Path.join(CMP_SRC, cmp + '.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    const found = new Set();
    for (const m of src.matchAll(/\bprops\s*\??\.([A-Za-z_$][\w$]*)/g)) {
        if (AMBIENT !== m[1]) {
            found.add(m[1]);
        }
    }
    return [...found].sort();
}
// --- what an unknown prop does at RUN time ---------------------------
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
            throw new Error('cmp-props: no sample node for ' + cmp);
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
// --- compiling the type cases ----------------------------------------
// Every diagnostic, by the line of typecase/cases.ts it is against.
//
// SPAWNED rather than driven in-process: TypeScript 7 is the native
// compiler and the old `ts.createProgram` API is not in the package --
// what is there is behind an `unstable/` specifier, which is no place
// for a gate to stand. `tsc` itself is stable, and the exit code and the
// diagnostic text are its contract. Run through `process.execPath` so
// this does not depend on a shell resolving a `.bin` shim.
function diagnostics() {
    let out = '';
    try {
        out = (0, node_child_process_1.execFileSync)(process.execPath, [TSC, '-p', TYPECASE, '--pretty', 'false'], { cwd: TSROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    }
    catch (err) {
        // Errors in the cases are the point, so a non-zero exit is expected.
        out = String(err.stdout || '') + String(err.stderr || '');
        Assert.ok('' !== out.trim(), 'tsc failed without saying anything: ' + (err.message || err));
    }
    const byLine = new Map();
    let at = -1;
    for (const line of out.split('\n')) {
        const head = line.match(/\((\d+),\d+\): error TS\d+: (.*)$/);
        if (null != head) {
            at = parseInt(head[1], 10);
            byLine.set(at, [...(byLine.get(at) || []), head[2]]);
            continue;
        }
        // A continuation line elaborates the diagnostic above it, and the
        // reason a call was refused is usually down there rather than in the
        // head line ("No overload matches this call").
        if (-1 !== at && /^\s+\S/.test(line)) {
            const msgs = byLine.get(at);
            msgs[msgs.length - 1] += ' ' + line.trim();
        }
    }
    return byLine;
}
// `ERR: <text>` at the end of a line says that line must be refused, and
// what the refusal has to say.
function markers() {
    const src = Fs.readFileSync(Path.join(TYPECASE, 'cases.ts'), 'utf8');
    const out = new Map();
    src.split('\n').forEach((line, i) => {
        // Only a case line, never the header prose that describes the
        // format: a marker follows a call.
        const m = line.match(/^\s+\S.*\/\/ ERR: (.+)$/);
        if (null != m) {
            out.set(i + 1, m[1].trim());
        }
    });
    Assert.ok(10 < out.size, `typecase/cases.ts: only ${out.size} markers`);
    return out;
}
(0, node_test_1.describe)('cmp-props', () => {
    // 1. The components are the ones on disk, each has a props type, and
    // the package exports it.
    (0, node_test_1.test)('every-component-declares-and-exports-its-props', () => {
        const onDisk = Fs.readdirSync(CMP_SRC)
            .filter((f) => f.endsWith('.ts'))
            .map((f) => f.replace(/\.ts$/, ''))
            .sort();
        Assert.deepEqual(onDisk.filter((n) => !INTERNAL.includes(n)), Object.keys(__1.TREE_CMP).sort(), 'src/cmp/ and TREE_CMP disagree about the component set');
        const entry = Fs.readFileSync(ENTRY_DTS, 'utf8');
        for (const cmp of onDisk) {
            const props = declaredProps(cmp);
            Assert.ok(!props.includes(AMBIENT), `${cmp}Props declares ${AMBIENT}, which cmp() writes and no ` +
                `caller passes`);
            if (INTERNAL.includes(cmp)) {
                continue;
            }
            Assert.match(entry, new RegExp('\\b' + cmp + 'Props\\b'), `jostraca does not export ${cmp}Props`);
        }
    });
    // 2. The props are the ones the code reads.
    (0, node_test_1.test)('every-declared-prop-is-read-and-every-read-prop-is-declared', () => {
        for (const cmp of Object.keys(__1.TREE_CMP).sort()) {
            Assert.deepEqual(declaredProps(cmp), readsOf(cmp), `${cmp}Props and src/cmp/${cmp}.ts disagree about props`);
        }
        // `None` reads nothing, and says so.
        Assert.deepEqual(declaredProps('None'), []);
        Assert.deepEqual(readsOf('None'), []);
    });
    // 3. The types refuse what they say they refuse.
    (0, node_test_1.test)('the-published-types-accept-and-refuse-the-right-calls', () => {
        const byLine = diagnostics();
        const want = markers();
        for (const [line, text] of want) {
            const got = byLine.get(line) || [];
            byLine.delete(line);
            Assert.ok(0 < got.length, `typecase/cases.ts:${line} should not compile, and did`);
            Assert.ok(got.some((m) => m.includes(text)), `typecase/cases.ts:${line} was refused without saying ` +
                `"${text}": ${got.join(' | ')}`);
        }
        Assert.deepEqual([...byLine.entries()], [], 'typecase/cases.ts has errors on lines with no ERR marker');
    });
    // 4. ... and the runtime does what the types say.
    (0, node_test_1.test)('an-unknown-prop-is-refused-by-two-and-dropped-by-eight', async () => {
        for (const cmp of Object.keys(__1.TREE_CMP).sort()) {
            // The control: the same node with no extra prop must generate,
            // otherwise the case below proves nothing.
            Assert.equal(await generates(sample(cmp, {})), undefined, `the sample node for ${cmp} does not generate`);
            const err = await generates(sample(cmp, { nosuchprop: 1 }));
            if (CLOSED.includes(cmp)) {
                Assert.ok(null != err, `${cmp} validates a closed prop set and accepted an unknown prop`);
                Assert.match(err, /nosuchprop/, `${cmp} refused an unknown prop without naming it`);
            }
            else {
                Assert.equal(err, undefined, `${cmp} refused an unknown prop; only ` +
                    `${CLOSED.join(' and ')} validate a closed set`);
            }
        }
    });
});
//# sourceMappingURL=cmp-props.test.js.map