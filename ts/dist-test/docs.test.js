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
// THE DOCUMENTATION, HELD TO THE GENERATOR. Every fenced snippet in the
// Diátaxis pages under docs/ is either executed here or carries a
// visible, reasoned skip — the rule docs/STYLE-GUIDE.md states and this
// file enforces. The failure mode it exists for is silent and slow: an
// example that was right when it was written stays in the page after
// the surface moves under it, and the reader who trusts it is the one
// who finds out.
//
// Four layers of checking:
//
//   1. SCENARIOS RUN. A `run` fence is written to a temp directory and
//      executed by a real node process with that directory as its cwd,
//      so the example touches the same filesystem code path a reader
//      would. `input` fences seed that directory; re-declaring a path
//      between two runs is how a page models "the user edited the
//      generated file, now regenerate".
//   2. STATED RESULTS ARE CHECKED. `out`/`all` compare the tree the run
//      left behind; `file` compares one generated file byte for byte;
//      `log` compares the run's stdout.
//   3. EVERY TAGGED FENCE IS ACCOUNTED FOR: covered by a directive, or
//      skipped with a non-empty reason. A language-tagged fence with no
//      directive is a page defect, not a silent exclusion.
//   4. THE PAGES HANG TOGETHER: how-to frontmatter is complete and its
//      group is one the taxonomy names, every relative link resolves to
//      a file that exists, and an `input`/`file` path is named in the
//      prose above it so the human and machine channels cannot drift.
//
// Plus the style gate: the enforceable subset of the banned-phrase list
// in docs/STYLE-GUIDE.md, applied to prose (never to fences).
//
// The one rewrite the harness performs on a snippet is the module
// specifier: `from 'jostraca'` becomes the built package in ts/dist, so
// the page can show the import a reader would actually write. Nothing
// else in a fence is touched.
const node_test_1 = require("node:test");
const Assert = __importStar(require("node:assert"));
const Fs = __importStar(require("node:fs"));
const Os = __importStar(require("node:os"));
const Path = __importStar(require("node:path"));
const node_url_1 = require("node:url");
const node_child_process_1 = require("node:child_process");
const REPO = Path.join(__dirname, '..', '..');
const DOCS_DIR = Path.join(REPO, 'docs');
const DIST = (0, node_url_1.pathToFileURL)(Path.join(REPO, 'ts', 'dist', 'jostraca.js')).href;
// The how-to group taxonomy. A guide declaring a group not listed here
// fails; the site repository renders the same slugs, so an addition is
// two edits and both are visible.
const GROUPS = [
    'compose',
    'templates',
    'reuse',
    'regenerate',
    'files',
    'embed',
];
// DOCS_PAGES=<comma-list> narrows a run to named pages — the tight loop
// for writing one page — and suspends the corpus-wide floors, which
// only mean anything over the whole set.
function narrowed() {
    const v = process.env.DOCS_PAGES;
    return null == v || '' === v ? undefined : v.split(',');
}
function docPages() {
    const only = narrowed();
    if (only) {
        return only.filter((f) => Fs.existsSync(Path.join(DOCS_DIR, f)));
    }
    const fixed = [
        'index.md',
        'tutorial.md',
        'explanation.md',
        'reference-components.md',
        'reference-options.md',
        'reference-utilities.md',
        'reference-go.md',
    ].filter((f) => Fs.existsSync(Path.join(DOCS_DIR, f)));
    const howtoDir = Path.join(DOCS_DIR, 'how-to');
    const howto = Fs.existsSync(howtoDir)
        ? Fs.readdirSync(howtoDir)
            .filter((f) => f.endsWith('.md') && 'README.md' !== f)
            .sort()
            .map((f) => Path.join('how-to', f))
        : [];
    return [...fixed, ...howto];
}
// The style gate covers every page above plus the ones with no executed
// content. STYLE-GUIDE.md itself is exempt: it quotes the banned
// phrases in order to ban them.
function stylePages() {
    const only = narrowed();
    if (only) {
        return only.filter((f) => Fs.existsSync(Path.join(DOCS_DIR, f)));
    }
    const extra = ['how-to/README.md'];
    return [...docPages(), ...extra]
        .filter((f, i, a) => a.indexOf(f) === i)
        .filter((f) => Fs.existsSync(Path.join(DOCS_DIR, f)));
}
// LINE ENDINGS ARE THE CHECKOUT'S BUSINESS, not this file's. git on
// Windows checks out with CRLF by default and every pattern below
// anchors on "\n", so without this the extractor would match zero
// blocks and the suite would report a documentation set with no
// examples in it rather than a failure.
function lf(text) {
    return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}
const VERBS = ['input', 'run', 'out', 'all', 'file', 'log', 'skip'];
// One pass, in document order, collecting scenario-opens and fences and
// binding each directive to the fence that follows it. A directive with
// no following fence, or an unknown verb, is a page defect and fails
// loudly rather than being ignored.
function extract(file, md) {
    const lines = lf(md).split('\n');
    const items = [];
    let pending;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const dm = line.match(/^<!--\s*test:\s*(\S+)\s*(.*?)\s*-->\s*$/);
        if (dm) {
            const verb = dm[1];
            const arg = dm[2] || '';
            if ('scenario' === verb) {
                Assert.ok('' !== arg, `${file}:${i + 1} scenario needs a name`);
                Assert.ok(null == pending, `${file}:${i + 1} directive \`${pending?.verb}\` has no fence`);
                items.push({ kind: 'scenario', name: arg, line: i + 1 });
                continue;
            }
            Assert.ok(VERBS.includes(verb), `${file}:${i + 1} unknown directive verb \`${verb}\` ` +
                `(docs/STYLE-GUIDE.md, "Code snippets")`);
            Assert.ok(null == pending, `${file}:${i + 1} directive \`${pending?.verb}\` has no fence`);
            pending = { verb: verb, arg, line: i + 1 };
            continue;
        }
        const fm = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
        if (!fm) {
            continue;
        }
        const lang = fm[1] || '';
        const body = [];
        let j = i + 1;
        for (; j < lines.length; j++) {
            if (/^```\s*$/.test(lines[j])) {
                break;
            }
            body.push(lines[j]);
        }
        Assert.ok(j < lines.length, `${file}:${i + 1} unterminated fence`);
        items.push({
            kind: 'block',
            block: {
                lang,
                body: 0 === body.length ? '' : body.join('\n') + '\n',
                line: i + 1,
                directive: pending,
            },
        });
        pending = undefined;
        i = j;
    }
    Assert.ok(null == pending, `${file}: trailing directive \`${pending?.verb}\` has no fence`);
    return items;
}
function pages() {
    return docPages().map((file) => {
        const md = Fs.readFileSync(Path.join(DOCS_DIR, file), 'utf8');
        const items = extract(file, md);
        return {
            file,
            items,
            blocks: items.filter((it) => 'block' === it.kind)
                .map((it) => it.block),
        };
    });
}
// Sorted, relative, forward-slashed listing of the files under a
// directory. `.jostraca/` is Jostraca's own bookkeeping and is excluded
// unless the page asked for `all`; the run scripts this harness writes
// are never listed.
function listing(dir, meta) {
    const out = [];
    const walk = (rel) => {
        const abs = Path.join(dir, rel);
        if (!Fs.existsSync(abs)) {
            return;
        }
        for (const name of Fs.readdirSync(abs).sort()) {
            const childRel = '' === rel ? name : rel + '/' + name;
            if (!meta && '.jostraca' === name) {
                continue;
            }
            if (/^\.docs-run-\d+\.mjs$/.test(name)) {
                continue;
            }
            const st = Fs.lstatSync(Path.join(dir, childRel));
            if (st.isDirectory()) {
                walk(childRel);
            }
            else {
                out.push(childRel);
            }
        }
    };
    walk('');
    return out.sort();
}
// "..." on a line of its own matches any run of lines, so a listing can
// state the files it is about without pinning the ones it is not.
function matchLines(expect, actual) {
    if (0 === expect.length) {
        return 0 === actual.length;
    }
    const [head, ...rest] = expect;
    if ('...' === head) {
        if (0 === rest.length) {
            return true;
        }
        for (let i = 0; i <= actual.length; i++) {
            if (matchLines(rest, actual.slice(i))) {
                return true;
            }
        }
        return false;
    }
    return 0 < actual.length && head === actual[0]
        && matchLines(rest, actual.slice(1));
}
function nonEmpty(s) {
    return s.split('\n').map((l) => l.trim()).filter((l) => '' !== l);
}
(0, node_test_1.describe)('docs', () => {
    // The scenario runner: layers 1 and 2. Each page is walked in
    // document order; a `scenario` directive opens a fresh temp
    // directory, and everything below it shares that directory until the
    // next scenario or the end of the page.
    (0, node_test_1.test)('scenarios-run-and-match', () => {
        let scenarios = 0;
        let runs = 0;
        let assertions = 0;
        for (const page of pages()) {
            let dir = null;
            let name = '';
            let runIndex = 0;
            let stdout = '';
            let ran = false;
            const open = (label) => {
                if (null != dir) {
                    Fs.rmSync(dir, { recursive: true, force: true });
                }
                dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-docs-'));
                name = label;
                runIndex = 0;
                stdout = '';
                ran = false;
                scenarios++;
            };
            const need = (at) => {
                if (null == dir) {
                    open('anonymous');
                }
                Assert.ok(null != dir, at);
                return dir;
            };
            try {
                for (const item of page.items) {
                    if ('scenario' === item.kind) {
                        open(item.name);
                        continue;
                    }
                    const b = item.block;
                    const d = b.directive;
                    if (null == d || 'skip' === d.verb) {
                        continue;
                    }
                    const at = `${page.file}:${b.line} (scenario ${name})`;
                    if ('input' === d.verb) {
                        Assert.ok('' !== d.arg, `${at} input needs a path`);
                        const target = Path.join(need(at), d.arg);
                        Fs.mkdirSync(Path.dirname(target), { recursive: true });
                        Fs.writeFileSync(target, b.body);
                        continue;
                    }
                    if ('run' === d.verb) {
                        Assert.equal(b.lang, 'js', `${at} a run fence is tagged js (docs/STYLE-GUIDE.md)`);
                        const cwd = need(at);
                        const script = Path.join(cwd, `.docs-run-${runIndex++}.mjs`);
                        // The one rewrite: the specifier a reader would write
                        // becomes the build under test.
                        const source = b.body
                            .replaceAll("from 'jostraca'", `from '${DIST}'`)
                            .replaceAll('from "jostraca"', `from "${DIST}"`);
                        Fs.writeFileSync(script, source);
                        try {
                            stdout = (0, node_child_process_1.execFileSync)(process.execPath, [script], {
                                cwd,
                                encoding: 'utf8',
                                stdio: ['ignore', 'pipe', 'pipe'],
                            });
                        }
                        catch (err) {
                            Assert.fail(`${at} run failed:\n` +
                                `${err.stderr || err.message}`);
                        }
                        Fs.rmSync(script, { force: true });
                        ran = true;
                        runs++;
                        continue;
                    }
                    if ('out' === d.verb || 'all' === d.verb) {
                        Assert.ok(ran, `${at} ${d.verb} with no run above it`);
                        const sub = '' === d.arg ? 'out' : d.arg;
                        const actual = listing(Path.join(need(at), sub), 'all' === d.verb);
                        const expect = nonEmpty(b.body);
                        Assert.ok(matchLines(expect, actual), `${at} tree under ${sub}/ does not match.\n` +
                            `expected:\n  ${expect.join('\n  ')}\n` +
                            `actual:\n  ${actual.join('\n  ')}`);
                        assertions++;
                        continue;
                    }
                    if ('file' === d.verb) {
                        Assert.ok(ran, `${at} file with no run above it`);
                        Assert.ok('' !== d.arg, `${at} file needs a path`);
                        const target = Path.join(need(at), d.arg);
                        Assert.ok(Fs.existsSync(target), `${at} ${d.arg} was not generated. Tree:\n  ` +
                            listing(need(at), true).join('\n  '));
                        Assert.equal(lf(Fs.readFileSync(target, 'utf8')), lf(b.body), `${at} content of ${d.arg} does not match`);
                        assertions++;
                        continue;
                    }
                    if ('log' === d.verb) {
                        Assert.ok(ran, `${at} log with no run above it`);
                        Assert.equal(lf(stdout), lf(b.body), `${at} stdout does not match`);
                        assertions++;
                        continue;
                    }
                }
            }
            finally {
                // A failed assertion throws before this, keeping the directory
                // for inspection; a green page cleans up after itself.
                if (null != dir) {
                    Fs.rmSync(dir, { recursive: true, force: true });
                }
            }
        }
        // Vacuity guards. A refactor that silently stopped extracting
        // blocks would otherwise pass with flying colours.
        if (undefined === narrowed()) {
            Assert.ok(12 <= scenarios, `too few scenarios extracted: ${scenarios}`);
            Assert.ok(20 <= runs, `too few runs executed: ${runs}`);
            Assert.ok(20 <= assertions, `too few output assertions: ${assertions}`);
        }
    });
    // Layer 3: every tagged fence is covered or owns its skip.
    (0, node_test_1.test)('every-snippet-is-tested-or-owns-its-skip', () => {
        const untested = [];
        for (const page of pages()) {
            for (const b of page.blocks) {
                if ('' === b.lang) {
                    continue; // makes no claim: a diagram, a drawn tree
                }
                if (null != b.directive) {
                    if ('skip' === b.directive.verb) {
                        Assert.ok('' !== b.directive.arg, `${page.file}:${b.directive.line} skip needs a reason`);
                    }
                    continue;
                }
                untested.push(`${page.file}:${b.line} (${b.lang})`);
            }
        }
        Assert.deepEqual(untested, [], 'snippets with no directive and no owned skip — give each one ' +
            'a directive, or drop the language tag if it makes no claim ' +
            `(docs/STYLE-GUIDE.md, "Code snippets"):\n${untested.join('\n')}`);
    });
    // Layer 4a: the prose channel names the files the machine channel
    // writes and reads, so the two cannot drift.
    (0, node_test_1.test)('scenario-files-are-named-in-prose', () => {
        for (const page of pages()) {
            const lines = lf(Fs.readFileSync(Path.join(DOCS_DIR, page.file), 'utf8')).split('\n');
            for (const b of page.blocks) {
                const d = b.directive;
                if (null == d || ('input' !== d.verb && 'file' !== d.verb)) {
                    continue;
                }
                const at = d.line - 1;
                const above = lines.slice(Math.max(0, at - 3), at).join('\n');
                // Any trailing run of segments counts: prose that calls the file
                // `src/index.js` is naming `out/app/src/index.js`, and making it
                // spell the output folder would put the harness's bookkeeping
                // into the sentence.
                const parts = d.arg.split('/');
                const named = parts.some((_, i) => above.includes('`' + parts.slice(i).join('/') + '`'));
                Assert.ok(named, `${page.file}:${d.line} the prose above should name ` +
                    `\`${d.arg}\` (or a trailing part of it) in a code span ` +
                    `(docs/STYLE-GUIDE.md)`);
            }
        }
    });
    // Layer 4b: how-to frontmatter is complete and its group is real.
    (0, node_test_1.test)('how-to-frontmatter', () => {
        const dir = Path.join(DOCS_DIR, 'how-to');
        if (!Fs.existsSync(dir)) {
            return;
        }
        const guides = Fs.readdirSync(dir)
            .filter((f) => f.endsWith('.md') && 'README.md' !== f).sort();
        if (undefined === narrowed()) {
            Assert.ok(0 < guides.length, 'no how-to guides found');
        }
        for (const guide of guides) {
            const text = lf(Fs.readFileSync(Path.join(dir, guide), 'utf8'));
            const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
            Assert.ok(fm, `how-to/${guide} has no frontmatter`);
            const front = fm[1];
            const description = front.match(/^description:\s*(.+)$/m);
            const group = front.match(/^group:\s*(\S+)\s*$/m);
            const order = front.match(/^order:\s*(\d+)\s*$/m);
            Assert.ok(description, `how-to/${guide} frontmatter needs a description`);
            Assert.ok(group, `how-to/${guide} frontmatter needs a group`);
            Assert.ok(order, `how-to/${guide} frontmatter needs an order`);
            Assert.ok(GROUPS.includes(group[1]), `how-to/${guide} declares group ` +
                `\`${group[1]}\`, which is not one of ` +
                GROUPS.join(', '));
            // One H1, and it is the title.
            const h1 = text.split('\n').filter((l) => /^# /.test(l));
            Assert.equal(h1.length, 1, `how-to/${guide} should have exactly one H1, found ${h1.length}`);
        }
    });
    // Layer 4c: every relative link resolves to a file that exists. The
    // site sync is a link checker too, but a broken link should fail here
    // first — in the repository that owns the page.
    (0, node_test_1.test)('relative-links-resolve', () => {
        const broken = [];
        const files = [...stylePages(), 'STYLE-GUIDE.md']
            .filter((f, i, a) => a.indexOf(f) === i)
            .filter((f) => Fs.existsSync(Path.join(DOCS_DIR, f)));
        for (const file of files) {
            const text = lf(Fs.readFileSync(Path.join(DOCS_DIR, file), 'utf8'));
            const from = Path.dirname(Path.join(DOCS_DIR, file));
            const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
            let m;
            while (null != (m = re.exec(text))) {
                const href = m[1];
                if (/^(https?:|mailto:|#)/.test(href)) {
                    continue;
                }
                const target = href.split('#')[0];
                if ('' === target) {
                    continue;
                }
                const abs = Path.resolve(from, target);
                if (!Fs.existsSync(abs)) {
                    broken.push(`${file}: ${href}`);
                }
            }
        }
        Assert.deepEqual(broken, [], `links pointing at files that do not exist:\n${broken.join('\n')}`);
    });
});
// ---------------------------------------------------------------------
// The style gate: the enforceable subset of docs/STYLE-GUIDE.md's
// banned list, applied to prose only — fences are code, and quoted
// output inside them is the generator's business. Phrases whose
// legitimate technical uses are common (surface as a noun, navigate a
// tree) are left to review; what is listed here is banned in any
// context these pages produce.
const BANNED = [
    [/\bworth noting\b/i, 'worth noting'],
    [/\bimportant to note\b/i, 'important to note'],
    [/\bat its core\b/i, 'at its core'],
    [/\bwhen it comes to\b/i, 'when it comes to'],
    [/\blet'?s break it down\b/i, 'let us break it down'],
    [/\bdelve\b/i, 'delve'],
    [/\bdive into\b/i, 'dive into'],
    [/\brobust\b/i, 'robust'],
    [/\bseamless(?:ly)?\b/i, 'seamless'],
    [/\bcomprehensive(?:ly)?\b/i, 'comprehensive'],
    [/\bholistic\b/i, 'holistic'],
    [/\bleverag(?:e|es|ed|ing)\b/i, 'leverage'],
    [/\bfoster(?:s|ed|ing)?\b/i, 'foster'],
    [/\bshed(?:s|ding)? light on\b/i, 'shed light on'],
    [/\bpav(?:e|es|ed|ing) the way\b/i, 'pave the way'],
    [/\bpivotal\b/i, 'pivotal'],
    [/\btransformative\b/i, 'transformative'],
    [/\bgame.chang(?:er|ing)\b/i, 'game-changing'],
    [/\bcutting.edge\b/i, 'cutting-edge'],
    [/\bgroundbreaking\b/i, 'groundbreaking'],
    [/\btestament to\b/i, 'testament to'],
    [/\bparadigm shift\b/i, 'paradigm shift'],
    [/\bnorth star\b/i, 'north star'],
    [/\bkey takeaways\b/i, 'key takeaways'],
    [/\bbest practices\b/i, 'best practices'],
    [/\bat the end of the day\b/i, 'at the end of the day'],
    [/\bload.bearing\b/i, 'load-bearing'],
    [/\bheavy lifting\b/i, 'heavy lifting'],
    [/\bnot just\b/i, 'the "not just X" contrast frame'],
    [/\bhere'?s where it gets interesting\b/i, 'here is where it gets interesting'],
    [/\bthe right (?:way|answer|tool|question)\b/i, 'the right way/answer/tool/question'],
    [/\bworth (?:exploring|considering|a look)\b/i, 'the "worth X-ing" frame'],
    [/\bthe whole game\b/i, 'the whole game'],
    [/\bthat'?s the tell\b/i, 'that is the tell'],
];
// Strip frontmatter, fenced blocks and inline code spans; what remains
// is prose.
function prose(md) {
    return lf(md)
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .replace(/^```[a-zA-Z0-9_-]*[ \t]*$[\s\S]*?^```[ \t]*$/gm, '')
        .replace(/`[^`\n]*`/g, '');
}
(0, node_test_1.describe)('docs-style', () => {
    (0, node_test_1.test)('no-banned-phrases-in-prose', () => {
        const hits = [];
        for (const file of stylePages()) {
            const text = prose(Fs.readFileSync(Path.join(DOCS_DIR, file), 'utf8'));
            text.split('\n').forEach((line, i) => {
                for (const [re, name] of BANNED) {
                    if (re.test(line)) {
                        hits.push(`${file}:${i + 1} "${name}": ${line.trim()}`);
                    }
                }
            });
        }
        Assert.deepEqual(hits, [], `banned phrases (docs/STYLE-GUIDE.md):\n${hits.join('\n')}`);
    });
    // At most one em dash per sentence — the guide allows the dash and
    // rations it, which is the half a reviewer forgets.
    (0, node_test_1.test)('em-dashes-are-rationed', () => {
        const hits = [];
        for (const file of stylePages()) {
            prose(Fs.readFileSync(Path.join(DOCS_DIR, file), 'utf8'))
                .split('\n')
                .forEach((line, i) => {
                const n = (line.match(/—/g) || []).length;
                if (1 < n) {
                    hits.push(`${file}:${i + 1} ${n} em dashes: ${line.trim()}`);
                }
            });
        }
        Assert.deepEqual(hits, [], `more than one em dash on a line (docs/STYLE-GUIDE.md):\n` +
            hits.join('\n'));
    });
    (0, node_test_1.test)('no-emoji', () => {
        const hits = [];
        for (const file of stylePages()) {
            lf(Fs.readFileSync(Path.join(DOCS_DIR, file), 'utf8'))
                .split('\n')
                .forEach((line, i) => {
                if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(line)) {
                    hits.push(`${file}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        Assert.deepEqual(hits, [], `emoji are not used in documentation:\n${hits.join('\n')}`);
    });
    // The guide and this gate must agree; the guide names this block, so
    // a reader of either finds the other.
    (0, node_test_1.test)('the-style-guide-names-this-gate', () => {
        const guide = Fs.readFileSync(Path.join(DOCS_DIR, 'STYLE-GUIDE.md'), 'utf8');
        Assert.ok(guide.includes('docs.test.ts'), 'STYLE-GUIDE.md should point at this test file');
    });
});
//# sourceMappingURL=docs.test.js.map