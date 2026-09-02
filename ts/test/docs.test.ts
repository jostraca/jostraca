/* Copyright (c) 2026 Richard Rodger, MIT License */

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

import { describe, test } from 'node:test'
import * as Assert from 'node:assert'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'


const REPO = Path.join(__dirname, '..', '..')
const DOCS_DIR = Path.join(REPO, 'docs')
const DIST = pathToFileURL(Path.join(REPO, 'ts', 'dist', 'jostraca.js')).href

// A doc example is a moment: one generator, a handful of files. Well
// under a second in practice; the ceiling is generous enough that a slow
// Windows runner never trips it and tight enough that a hung example is
// reported rather than waited on.
const RUN_TIMEOUT_MS = 60_000

// DOCS_PLATFORM overrides the platform check, so the Windows branch of the
// `posix` scenario modifier can be exercised on any runner. Without it the
// only proof that branch works is a red Windows job, which is how it was
// found in the first place.
const WINDOWS = 'win32' === (process.env.DOCS_PLATFORM || process.platform)

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
]

// DOCS_PAGES=<comma-list> narrows a run to named pages — the tight loop
// for writing one page — and suspends the corpus-wide floors, which
// only mean anything over the whole set.
//
// A name that does not exist is a hard failure, not a silent drop. With
// the floors suspended, a typo would otherwise select nothing and report
// a fully green run over an empty corpus, which is the one result this
// suite must never give.
function narrowed(): string[] | undefined {
  const v = process.env.DOCS_PAGES
  if (null == v || '' === v) {
    return undefined
  }
  const names = v.split(',').map((s) => s.trim()).filter((s) => '' !== s)
  const missing = names.filter(
    (f) => !Fs.existsSync(Path.join(DOCS_DIR, f)))
  Assert.deepEqual(missing, [],
    `DOCS_PAGES names pages that do not exist under docs/: ` +
    missing.join(', '))
  Assert.ok(0 < names.length, 'DOCS_PAGES is set but names no pages')
  return names
}


function docPages(): string[] {
  const only = narrowed()
  if (only) {
    return only
  }
  const fixed = [
    'index.md',
    'tutorial.md',
    'explanation.md',
    'reference-components.md',
    'reference-options.md',
    'reference-utilities.md',
    'reference-go.md',
  ].filter((f) => Fs.existsSync(Path.join(DOCS_DIR, f)))

  const howtoDir = Path.join(DOCS_DIR, 'how-to')
  const howto = Fs.existsSync(howtoDir)
    ? Fs.readdirSync(howtoDir)
      .filter((f) => f.endsWith('.md') && 'README.md' !== f)
      .sort()
      .map((f) => Path.join('how-to', f))
    : []

  return [...fixed, ...howto]
}


// The style gate covers every page above plus the ones with no executed
// content. STYLE-GUIDE.md itself is exempt: it quotes the banned
// phrases in order to ban them.
function stylePages(): string[] {
  const only = narrowed()
  if (only) {
    return only
  }
  const extra = ['how-to/README.md']
  return [...docPages(), ...extra]
    .filter((f, i, a) => a.indexOf(f) === i)
    .filter((f) => Fs.existsSync(Path.join(DOCS_DIR, f)))
}


// The STYLE checks cover more than docs/. docs/STYLE-GUIDE.md is
// normative for `adr/*.md` too, and the Vale gate lints that directory —
// but Vale is NOT the whole gate here. `.vale.ini` switches Google.We and
// Google.FirstPerson off precisely BECAUSE these tests carry the stricter
// house rule, so widening the guide's scope without widening this function
// left first person and emoji in an ADR passing both gates. Proven by
// putting "I think we should" and an emoji in adr/README.md and watching
// `vale` and `npm test` both stay green.
//
// Returns repo-relative labels with absolute paths, because these files no
// longer share one base directory.
function stylePaths(): { file: string, abs: string }[] {
  const docs = stylePages()
    .map((f) => ({ file: `docs/${f}`, abs: Path.join(DOCS_DIR, f) }))

  // DOCS_PAGES narrows to named pages under docs/; it does not name ADRs,
  // so a narrowed run skips them rather than reporting on all of them.
  const adrDir = Path.join(REPO, 'adr')
  const adr = (null == narrowed() && Fs.existsSync(adrDir))
    ? Fs.readdirSync(adrDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => ({ file: `adr/${f}`, abs: Path.join(adrDir, f) }))
    : []

  return [...docs, ...adr]
}


// A document named by DESCRIPTION rather than by filename needs the shape
// of a citation, not the bare noun. "One decision record per file" is
// `audit()`'s own vocabulary in reference-options.md, and "check the
// build log" is ordinary advice -- neither sends a reader anywhere. Both
// of these fire only when the phrase is being leaned on as a source:
//
//   As the decision record explains, this is settled.   caught
//   The build log records the implementation.           caught
//   ...and one decision record per file, tagged ...     not a citation
//
// The bare-noun version was tried first and failed on reference-options.md
// within a run, which is why it is written this way.
const CITED = '(?:decision|design) records?|build log'
const SAYS = 'explains?|notes?|records?|says?|argues?|states?|covers?'

const CITES_ONE = new RegExp(`\\b(?:see|per|as) the (?:${CITED})\\b`, 'gi')
const ONE_SAYS = new RegExp(`\\bthe (?:${CITED}) (?:${SAYS})\\b`, 'gi')


// Internal working documents: plans, decision records, build logs, review
// notes, and the files that instruct contributors and agents. See
// docs/STYLE-GUIDE.md, "Documentation does not cite internal documents".
//
// The NAME is banned as well as the link. "As the parity plan records"
// strands a reader exactly as a URL does: the sentence cannot be acted on
// without leaving the documentation, and the document it points at is
// working material that moves with the code.
const INTERNAL_DOCS: [RegExp, string][] = [
  [/\bADRs?\b/g, 'ADR'],
  [/architecture decision record/gi, 'architecture decision record'],
  [/(?:^|[^\w.-])adr\//g, 'adr/'],
  [/\b[A-Z][A-Z0-9_]*_PLAN\.md\b/g, 'a plan file'],
  [/\b(?:parity|dependency|port|design) plan\b/gi, 'a plan'],
  [/\bBUILD_LOG\.md\b/g, 'BUILD_LOG.md'],
  [/\bCODE_REVIEW\.md\b/g, 'CODE_REVIEW.md'],
  [/\bCLAUDE\.md\b/g, 'CLAUDE.md'],
  [/\bAGENTS\.md\b/g, 'AGENTS.md'],
  [CITES_ONE, 'an internal document, cited'],
  [ONE_SAYS, 'an internal document, cited'],
]


// The reader-facing set: every page the site renders, plus the three
// READMEs that land on GitHub, npm and pkg.go.dev.
//
// Deliberately NOT stylePaths(). adr/ is excluded because a decision record
// citing the analysis it came from is doing its job -- the rule runs one
// way, out of documentation only. STYLE-GUIDE.md is excluded because it
// names the internal documents in order to ban them, the same exemption it
// already holds for the banned phrases.
function readerPaths(): { file: string, abs: string }[] {
  const docs = stylePages()
    .map((f) => ({ file: `docs/${f}`, abs: Path.join(DOCS_DIR, f) }))

  // DOCS_PAGES narrows to pages under docs/, so a narrowed run leaves the
  // READMEs alone rather than reporting on all of them.
  const readmes = (null == narrowed())
    ? ['README.md', 'ts/README.md', 'go/README.md']
      .map((f) => ({ file: f, abs: Path.join(REPO, f) }))
      .filter(({ abs }) => Fs.existsSync(abs))
    : []

  return [...docs, ...readmes]
}


// CommonMark fence opener: up to three spaces of indent, then three or
// more backticks or tildes, then an optional info string. A block opened
// with ~~~ or with four backticks is an ordinary fence, and a stripper
// that cannot see one reports a citation inside a code block -- failing a
// page that the fence exemption says is fine.
//
// extract() and the prose helpers share this, because a file holding two
// notions of what a fence is will eventually disagree with itself.
const FENCE_OPEN = /^(\s{0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/


// The closer is the same character, at least as long as the opener, per
// CommonMark -- so a four-backtick block may contain three.
function fenceCloser(fence: string): RegExp {
  return new RegExp(
    '^\\s{0,3}' + fence[0] + '{' + fence.length + ',}[ \\t]*$')
}


// Fenced blocks BLANKED rather than dropped, so a reported line number
// still matches the file. Inline code spans are kept: `CLAUDE.md` in a
// sentence is the citation being banned, not an incidental token.
function fenceless(md: string): string {
  const lines = lf(md).split('\n')
  const out = [...lines]

  for (let i = 0; i < lines.length; i++) {
    const fm = lines[i].match(FENCE_OPEN)
    if (!fm) {
      continue
    }
    const closer = fenceCloser(fm[2])
    out[i] = ''
    let j = i + 1
    for (; j < lines.length && !closer.test(lines[j]); j++) {
      out[j] = ''
    }
    if (j < lines.length) {
      out[j] = ''
    }
    i = j
  }

  return out.join('\n')
}


// A paragraph, joined for matching, with each piece's physical line kept.
type Logical = {
  text: string
  starts: number[]
  lines: number[]
  pieces: string[]
}


// Markdown treats a newline inside a paragraph as whitespace, and these
// pages are hard-wrapped near 72 columns -- so "as the parity\nplan
// records" is the ORDINARY shape of a multiword phrase here, not an
// exotic one. A gate matching physical lines would miss most of them,
// which makes wrapping a way through it.
//
// Lines are trimmed, whitespace-collapsed and joined per paragraph;
// `starts` maps a match offset back to the physical line, so a hit still
// names a line the reader can open.
function logical(text: string): Logical[] {
  const out: Logical[] = []
  let pieces: string[] = []
  let starts: number[] = []
  let lines: number[] = []
  let at = 0

  const flush = () => {
    if (0 < pieces.length) {
      out.push({ text: pieces.join(' '), starts, lines, pieces })
      pieces = []
      starts = []
      lines = []
      at = 0
    }
  }

  text.split('\n').forEach((line, i) => {
    if ('' === line.trim()) {
      flush()
      return
    }
    const piece = line.trim().replace(/\s+/g, ' ')
    starts.push(at)
    lines.push(i + 1)
    pieces.push(piece)
    at += piece.length + 1
  })
  flush()

  return out
}


// Which physical line a match offset fell on.
function at(para: Logical, index: number): { line: number, text: string } {
  let k = 0
  for (let n = 0; n < para.starts.length; n++) {
    if (para.starts[n] <= index) {
      k = n
    }
  }
  return { line: para.lines[k], text: para.pieces[k] }
}


// LINE ENDINGS ARE THE CHECKOUT'S BUSINESS, not this file's. git on
// Windows checks out with CRLF by default and every pattern below
// anchors on "\n", so without this the extractor would match zero
// blocks and the suite would report a documentation set with no
// examples in it rather than a failure.
function lf(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}


type Verb = 'input' | 'run' | 'out' | 'all' | 'file' | 'log' | 'skip'

const VERBS: Verb[] = ['input', 'run', 'out', 'all', 'file', 'log', 'skip']

type Directive = {
  verb: Verb
  arg: string
  line: number
}

type Block = {
  lang: string
  body: string
  line: number              // 1-based line of the opening fence
  directive?: Directive
}

type Item =
  | { kind: 'scenario'; name: string; posix: boolean; line: number }
  | { kind: 'block'; block: Block }

type Page = {
  file: string
  items: Item[]
  blocks: Block[]
}


// One pass, in document order, collecting scenario-opens and fences and
// binding each directive to the fence that follows it. A directive with
// no following fence, or an unknown verb, is a page defect and fails
// loudly rather than being ignored.
function extract(file: string, md: string): Item[] {
  const lines = lf(md).split('\n')
  const items: Item[] = []
  let pending: Directive | undefined

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const dm = line.match(/^<!--\s*test:\s*(\S+)\s*(.*?)\s*-->\s*$/)
    if (dm) {
      const verb = dm[1]
      const arg = dm[2] || ''
      if ('scenario' === verb) {
        Assert.ok('' !== arg, `${file}:${i + 1} scenario needs a name`)
        Assert.ok(null == pending,
          `${file}:${i + 1} directive \`${pending?.verb}\` has no fence`)
        // `scenario <name> posix` — the whole scenario is skipped on
        // Windows. For the cases where the platform genuinely cannot
        // produce the output the page shows: a POSIX mode is the one
        // that matters here, since fs.chmod on Windows toggles the
        // read-only attribute and nothing else. The repository's own
        // suites gate the same tests the same way.
        const parts = arg.split(/\s+/)
        const posix = parts.includes('posix')
        const name = parts.filter((p) => 'posix' !== p).join(' ')
        Assert.ok('' !== name, `${file}:${i + 1} scenario needs a name`)
        items.push({ kind: 'scenario', name, posix, line: i + 1 })
        continue
      }
      Assert.ok((VERBS as string[]).includes(verb),
        `${file}:${i + 1} unknown directive verb \`${verb}\` ` +
        `(docs/STYLE-GUIDE.md, "Code snippets")`)
      Assert.ok(null == pending,
        `${file}:${i + 1} directive \`${pending?.verb}\` has no fence`)
      pending = { verb: verb as Verb, arg, line: i + 1 }
      continue
    }

    // CommonMark fences, not just three backticks. See FENCE_OPEN.
    const fm = line.match(FENCE_OPEN)
    if (!fm) {
      continue
    }

    const fence = fm[2]
    const closer = fenceCloser(fence)
    const lang = fm[3] || ''
    const body: string[] = []
    let j = i + 1
    for (; j < lines.length; j++) {
      if (closer.test(lines[j])) {
        break
      }
      body.push(lines[j])
    }
    Assert.ok(j < lines.length, `${file}:${i + 1} unterminated fence`)

    items.push({
      kind: 'block',
      block: {
        lang,
        body: 0 === body.length ? '' : body.join('\n') + '\n',
        line: i + 1,
        directive: pending,
      },
    })
    pending = undefined
    i = j
  }

  Assert.ok(null == pending,
    `${file}: trailing directive \`${pending?.verb}\` has no fence`)

  return items
}


function pages(): Page[] {
  return docPages().map((file) => {
    const md = Fs.readFileSync(Path.join(DOCS_DIR, file), 'utf8')
    const items = extract(file, md)
    return {
      file,
      items,
      blocks: items.filter((it) => 'block' === it.kind)
        .map((it) => (it as { block: Block }).block),
    }
  })
}


// Sorted, relative, forward-slashed listing of the files under a
// directory. `.jostraca/` is Jostraca's own bookkeeping and is excluded
// unless the page asked for `all`; the run scripts this harness writes
// are never listed.
function listing(dir: string, meta: boolean): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    const abs = Path.join(dir, rel)
    if (!Fs.existsSync(abs)) {
      return
    }
    for (const name of Fs.readdirSync(abs).sort()) {
      const childRel = '' === rel ? name : rel + '/' + name
      if (!meta && '.jostraca' === name) {
        continue
      }
      if (/^\.docs-run-\d+\.mjs$/.test(name)) {
        continue
      }
      const st = Fs.lstatSync(Path.join(dir, childRel))
      if (st.isDirectory()) {
        walk(childRel)
      }
      else {
        out.push(childRel)
      }
    }
  }
  walk('')
  return out.sort()
}


// "..." on a line of its own matches any run of lines, so a listing can
// state the files it is about without pinning the ones it is not.
function matchLines(expect: string[], actual: string[]): boolean {
  if (0 === expect.length) {
    return 0 === actual.length
  }
  const [head, ...rest] = expect
  if ('...' === head) {
    if (0 === rest.length) {
      return true
    }
    for (let i = 0; i <= actual.length; i++) {
      if (matchLines(rest, actual.slice(i))) {
        return true
      }
    }
    return false
  }
  return 0 < actual.length && head === actual[0]
    && matchLines(rest, actual.slice(1))
}


// The heading ids a markdown page will have once rendered, by the same
// slug rule rehype-slug applies: lowercase, drop everything that is not a
// word character, space or hyphen, spaces to hyphens, repeats suffixed.
// A code span contributes its text, which is the case that bites.
function headingIds(md: string): Set<string> {
  const ids = new Set<string>()
  const seen = new Map<string, number>()
  for (const line of lf(md).split('\n')) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (!m) {
      continue
    }
    const base = m[2]
      .replace(/`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
    const n = seen.get(base) || 0
    seen.set(base, n + 1)
    ids.add(0 === n ? base : `${base}-${n}`)
  }
  return ids
}


function nonEmpty(s: string): string[] {
  return s.split('\n').map((l) => l.trim()).filter((l) => '' !== l)
}


// A markdown fence cannot express "and there is no newline at the end",
// because closing the fence needs a line of its own. Some generated
// files genuinely have none — Jostraca's own meta log is one — so a page
// says so with git's marker, which a reader already knows how to read.
// Without this the comparison would be exact-but-unsatisfiable, and the
// alternative (tolerating a trailing newline either way) would stop the
// suite noticing a generator that lost one.
const NO_EOL = '\\ No newline at end of file'

function expected(body: string): string {
  const lines = body.split('\n')
  if (2 <= lines.length && '' === lines[lines.length - 1]
    && NO_EOL === lines[lines.length - 2]) {
    return lines.slice(0, -2).join('\n')
  }
  return lf(body)
}


// The one rewrite performed on a snippet: the module specifier a reader
// would write becomes the build under test.
//
// It has to be a scan rather than a replace. This is a code generator's
// documentation, so a snippet's own CONTENT legitimately contains lines
// like `Content("import { X } from 'jostraca'\n")` — a blind replace
// would rewrite the generated file's text and then assert against
// something no reader could reproduce. So: find string literals, and
// rewrite one only when its content is exactly the specifier AND the
// code before it is an import or export. A specifier nested inside
// another literal is part of that literal's span and is never seen.
function rewriteSpecifier(source: string, url: string): string {
  const out: string[] = []
  let i = 0
  let start = 0

  while (i < source.length) {
    const ch = source[i]
    if ('\'' !== ch && '"' !== ch && '`' !== ch) {
      i++
      continue
    }

    // Walk the literal to its close, honouring backslash escapes.
    const quote = ch
    const from = i
    i++
    while (i < source.length) {
      if ('\\' === source[i]) {
        i += 2
        continue
      }
      if (source[i] === quote) {
        break
      }
      i++
    }
    if (i >= source.length) {
      break                 // unterminated; leave the rest alone
    }
    const body = source.slice(from + 1, i)
    i++

    if ('jostraca' === body) {
      const before = source.slice(start, from)
      if (/(?:^|[\s(;])(?:from|import)\s*\(?\s*$/.test(before)) {
        out.push(before, quote, url, quote)
        start = i
      }
    }
  }

  out.push(source.slice(start))
  return out.join('')
}


describe('docs', () => {

  // The scenario runner: layers 1 and 2. Each page is walked in
  // document order; a `scenario` directive opens a fresh temp
  // directory, and everything below it shares that directory until the
  // next scenario or the end of the page.
  test('scenarios-run-and-match', () => {
    let scenarios = 0
    let runs = 0
    let assertions = 0
    let skipped = 0

    for (const page of pages()) {
      let dir: string | null = null
      let name = ''
      let runIndex = 0
      let stdout = ''
      let ran = false
      let skipping = false

      const open = (label: string) => {
        if (null != dir) {
          Fs.rmSync(dir, { recursive: true, force: true })
        }
        dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-docs-'))
        name = label
        runIndex = 0
        stdout = ''
        ran = false
        scenarios++
      }

      const need = (at: string): string => {
        if (null == dir) {
          open('anonymous')
        }
        Assert.ok(null != dir, at)
        return dir as string
      }

      try {
        for (const item of page.items) {
          if ('scenario' === item.kind) {
            skipping = item.posix && WINDOWS
            if (skipping) {
              skipped++
              continue
            }
            open(item.name)
            continue
          }

          if (skipping) {
            continue
          }

          const b = item.block
          const d = b.directive
          if (null == d || 'skip' === d.verb) {
            continue
          }
          const at = `${page.file}:${b.line} (scenario ${name})`

          if ('input' === d.verb) {
            Assert.ok('' !== d.arg, `${at} input needs a path`)
            const target = Path.join(need(at), d.arg)
            Fs.mkdirSync(Path.dirname(target), { recursive: true })
            Fs.writeFileSync(target, b.body)
            continue
          }

          if ('run' === d.verb) {
            Assert.equal(b.lang, 'js',
              `${at} a run fence is tagged js (docs/STYLE-GUIDE.md)`)
            const cwd = need(at)
            const script = Path.join(cwd, `.docs-run-${runIndex++}.mjs`)
            Fs.writeFileSync(script, rewriteSpecifier(b.body, DIST))
            try {
              // A snippet that leaves a timer open, starts a server, or
              // loops forever would otherwise hang the whole job with no
              // indication of which page did it. One malformed example
              // should cost one scenario, not the run.
              stdout = execFileSync(process.execPath, [script], {
                cwd,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: RUN_TIMEOUT_MS,
                killSignal: 'SIGKILL',
              })
            }
            catch (err: any) {
              if ('ETIMEDOUT' === err.code || null != err.signal) {
                Assert.fail(`${at} run did not finish within ` +
                  `${RUN_TIMEOUT_MS}ms (killed). A doc example should be ` +
                  `a moment, not a process that stays up.\n` +
                  `${err.stdout || ''}${err.stderr || ''}`)
              }
              Assert.fail(`${at} run failed:\n` +
                `${err.stderr || err.message}`)
            }
            Fs.rmSync(script, { force: true })
            ran = true
            runs++
            continue
          }

          if ('out' === d.verb || 'all' === d.verb) {
            Assert.ok(ran, `${at} ${d.verb} with no run above it`)
            const sub = '' === d.arg ? 'out' : d.arg
            const actual = listing(
              Path.join(need(at), sub), 'all' === d.verb)
            const expect = nonEmpty(b.body)
            Assert.ok(matchLines(expect, actual),
              `${at} tree under ${sub}/ does not match.\n` +
              `expected:\n  ${expect.join('\n  ')}\n` +
              `actual:\n  ${actual.join('\n  ')}`)
            assertions++
            continue
          }

          if ('file' === d.verb) {
            Assert.ok(ran, `${at} file with no run above it`)
            Assert.ok('' !== d.arg, `${at} file needs a path`)
            const target = Path.join(need(at), d.arg)
            Assert.ok(Fs.existsSync(target),
              `${at} ${d.arg} was not generated. Tree:\n  ` +
              listing(need(at), true).join('\n  '))
            Assert.equal(
              lf(Fs.readFileSync(target, 'utf8')), expected(b.body),
              `${at} content of ${d.arg} does not match`)
            assertions++
            continue
          }

          if ('log' === d.verb) {
            Assert.ok(ran, `${at} log with no run above it`)
            Assert.equal(lf(stdout), lf(b.body),
              `${at} stdout does not match`)
            assertions++
            continue
          }
        }
      }
      finally {
        // A failed assertion throws before this, keeping the directory
        // for inspection; a green page cleans up after itself.
        if (null != dir) {
          Fs.rmSync(dir, { recursive: true, force: true })
        }
      }
    }

    // Vacuity guards. A refactor that silently stopped extracting
    // blocks would otherwise pass with flying colours.
    if (undefined === narrowed()) {
      Assert.ok(12 <= scenarios + skipped,
        `too few scenarios extracted: ${scenarios} (+${skipped} skipped)`)
      Assert.ok(20 <= runs + skipped, `too few runs executed: ${runs}`)
      Assert.ok(20 <= assertions + skipped,
        `too few output assertions: ${assertions}`)
    }
  })


  // Layer 3: every tagged fence is covered or owns its skip.
  test('every-snippet-is-tested-or-owns-its-skip', () => {
    const untested: string[] = []
    for (const page of pages()) {
      for (const b of page.blocks) {
        if ('' === b.lang) {
          continue        // makes no claim: a diagram, a drawn tree
        }
        if (null != b.directive) {
          if ('skip' === b.directive.verb) {
            Assert.ok('' !== b.directive.arg,
              `${page.file}:${b.directive.line} skip needs a reason`)
          }
          continue
        }
        untested.push(`${page.file}:${b.line} (${b.lang})`)
      }
    }
    Assert.deepEqual(untested, [],
      'snippets with no directive and no owned skip — give each one ' +
      'a directive, or drop the language tag if it makes no claim ' +
      `(docs/STYLE-GUIDE.md, "Code snippets"):\n${untested.join('\n')}`)
  })


  // Layer 4a: the prose channel names the files the machine channel
  // writes and reads, so the two cannot drift.
  test('scenario-files-are-named-in-prose', () => {
    for (const page of pages()) {
      const lines = lf(Fs.readFileSync(
        Path.join(DOCS_DIR, page.file), 'utf8')).split('\n')
      for (const b of page.blocks) {
        const d = b.directive
        if (null == d || ('input' !== d.verb && 'file' !== d.verb)) {
          continue
        }
        const at = d.line - 1
        const above = lines.slice(Math.max(0, at - 3), at).join('\n')
        // Any trailing run of segments counts: prose that calls the file
        // `src/index.js` is naming `out/app/src/index.js`, and making it
        // spell the output folder would put the harness's bookkeeping
        // into the sentence.
        const parts = d.arg.split('/')
        const named = parts.some((_, i) =>
          above.includes('`' + parts.slice(i).join('/') + '`'))
        Assert.ok(named,
          `${page.file}:${d.line} the prose above should name ` +
          `\`${d.arg}\` (or a trailing part of it) in a code span ` +
          `(docs/STYLE-GUIDE.md)`)
      }
    }
  })


  // The rewriter is the one thing this harness does to a snippet, and a
  // generator's documentation is exactly the corpus where a naive
  // replace goes wrong — the text a page generates can itself be an
  // import of this package. Pin both directions.
  test('specifier-rewrite-touches-only-real-imports', () => {
    const U = 'file:///x/dist/jostraca.js'
    const cases: [string, string][] = [
      [`import { Jostraca } from 'jostraca'\n`,
        `import { Jostraca } from '${U}'\n`],
      [`import { Jostraca } from "jostraca"\n`,
        `import { Jostraca } from "${U}"\n`],
      [`import {\n  Jostraca,\n} from 'jostraca'\n`,
        `import {\n  Jostraca,\n} from '${U}'\n`],
      [`export { cmp } from 'jostraca'\n`,
        `export { cmp } from '${U}'\n`],
      [`const j = await import('jostraca')\n`,
        `const j = await import('${U}')\n`],
      // The page's own generated content must survive untouched.
      [`Content("import { X } from 'jostraca'\\n")\n`,
        `Content("import { X } from 'jostraca'\\n")\n`],
      [`Content('a from "jostraca" b')\n`,
        `Content('a from "jostraca" b')\n`],
      [`Line(\`from 'jostraca'\`)\n`, `Line(\`from 'jostraca'\`)\n`],
      // A bare mention is not a specifier.
      [`// jostraca writes the tree\n`, `// jostraca writes the tree\n`],
    ]
    for (const [src, want] of cases) {
      Assert.equal(rewriteSpecifier(src, U), want,
        `rewriteSpecifier mishandled: ${JSON.stringify(src)}`)
    }
  })


  // Layer 4b: how-to frontmatter is complete and its group is real.
  test('how-to-frontmatter', () => {
    const dir = Path.join(DOCS_DIR, 'how-to')
    if (!Fs.existsSync(dir)) {
      return
    }
    const guides = Fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md') && 'README.md' !== f).sort()
    if (undefined === narrowed()) {
      Assert.ok(0 < guides.length, 'no how-to guides found')
    }

    for (const guide of guides) {
      const text = lf(Fs.readFileSync(Path.join(dir, guide), 'utf8'))
      const fm = text.match(/^---\n([\s\S]*?)\n---\n/)
      Assert.ok(fm, `how-to/${guide} has no frontmatter`)
      const front = fm[1]
      const description = front.match(/^description:\s*(.+)$/m)
      const group = front.match(/^group:\s*(\S+)\s*$/m)
      const order = front.match(/^order:\s*(\d+)\s*$/m)
      Assert.ok(description, `how-to/${guide} frontmatter needs a description`)
      Assert.ok(group, `how-to/${guide} frontmatter needs a group`)
      Assert.ok(order, `how-to/${guide} frontmatter needs an order`)
      Assert.ok(GROUPS.includes((group as RegExpMatchArray)[1]),
        `how-to/${guide} declares group ` +
        `\`${(group as RegExpMatchArray)[1]}\`, which is not one of ` +
        GROUPS.join(', '))

      // One H1, and it is the title. Counted over prose only: a
      // generated shell file whose first line is `# JOSTRACA_PROTECT`
      // is a perfectly ordinary thing for a page to show, and it is not
      // a heading.
      const h1 = prose(text).split('\n').filter((l) => /^# /.test(l))
      Assert.equal(h1.length, 1,
        `how-to/${guide} should have exactly one H1, found ${h1.length}`)
    }
  })


  // Layer 4c: every relative link resolves to a file that exists, AND
  // every fragment names a heading in it. The site sync is a link checker
  // too, but a broken link should fail here first — in the repository that
  // owns the page.
  //
  // The fragment half is not decoration. `reference-utilities.md#isbinext`
  // looked right and pointed at nothing, because the heading is
  // "`isbinext` and `isbincontent`" and its id is the whole phrase. A path
  // check alone approves that link forever.
  test('relative-links-resolve', () => {
    const broken: string[] = []
    const files = [...stylePages(), 'STYLE-GUIDE.md']
      .filter((f, i, a) => a.indexOf(f) === i)
      .filter((f) => Fs.existsSync(Path.join(DOCS_DIR, f)))

    for (const file of files) {
      const text = lf(Fs.readFileSync(Path.join(DOCS_DIR, file), 'utf8'))
      const from = Path.dirname(Path.join(DOCS_DIR, file))
      const re = /\[[^\]]*\]\(([^)\s]+)\)/g
      let m: RegExpExecArray | null
      while (null != (m = re.exec(text))) {
        const href = m[1]
        if (/^(https?:|mailto:|#)/.test(href)) {
          continue
        }
        const target = href.split('#')[0]
        if ('' === target) {
          continue
        }
        const abs = Path.resolve(from, target)
        if (!Fs.existsSync(abs)) {
          broken.push(`${file}: ${href}`)
          continue
        }
        const frag = href.includes('#') ? href.slice(href.indexOf('#') + 1) : ''
        if ('' !== frag && abs.endsWith('.md')) {
          const ids = headingIds(Fs.readFileSync(abs, 'utf8'))
          if (!ids.has(frag)) {
            broken.push(`${file}: ${href} (no such heading)`)
          }
        }
      }
    }
    Assert.deepEqual(broken, [],
      `links pointing at files that do not exist:\n${broken.join('\n')}`)
  })

})


// ---------------------------------------------------------------------
// The style gate: the banned list from
// .vale/styles/config/vocabularies/Jostraca/reject.txt, applied to
// prose only — fences are code, and quoted output inside them is the
// generator's business.
//
// The list is READ FROM THAT FILE, not copied here. Vale reads the same
// file in CI, so the fast local gate and the CI prose gate cannot
// disagree about what is banned; adding a phrase in one place arms
// both. Phrases whose legitimate technical uses are common (`real`,
// `shape`, `surface`, navigate a tree) are deliberately absent from it
// — see "What is not banned, and why" in docs/STYLE-GUIDE.md.

const REJECT_FILE = Path.join(
  REPO, '.vale', 'styles', 'config', 'vocabularies', 'Jostraca', 'reject.txt')

// Vale matches reject.txt entries case-insensitively on word
// boundaries; mirror exactly that so a phrase cannot pass one gate and
// fail the other.
function loadBanned(): [RegExp, string][] {
  return Fs.readFileSync(REJECT_FILE, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => '' !== line && !line.startsWith('#'))
    .map((pat) => [new RegExp(`\\b(?:${pat})\\b`, 'i'), pat])
}

const BANNED: [RegExp, string][] = loadBanned()


// Strip frontmatter, fenced blocks and inline code spans; what remains
// is prose.
function prose(md: string): string {
  return fenceless(md)
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/`[^`\n]*`/g, '')
}


describe('docs-style', () => {

  test('no-banned-phrases-in-prose', () => {
    const hits: string[] = []
    for (const { file, abs } of stylePaths()) {
      const text = prose(Fs.readFileSync(abs, 'utf8'))
      text.split('\n').forEach((line, i) => {
        for (const [re, name] of BANNED) {
          if (re.test(line)) {
            hits.push(`${file}:${i + 1} "${name}": ${line.trim()}`)
          }
        }
      })
    }
    Assert.deepEqual(hits, [],
      `banned phrases (docs/STYLE-GUIDE.md):\n${hits.join('\n')}`)
  })


  // One em-dash ASIDE per line: a single trailing dash, or one matched
  // pair around a parenthetical. The guide allows the dash and rations
  // it, which is the half a reviewer forgets; three on a line is the
  // stacking the ration exists to stop.
  test('em-dashes-are-rationed', () => {
    const hits: string[] = []
    for (const { file, abs } of stylePaths()) {
      prose(Fs.readFileSync(abs, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          const n = (line.match(/—/g) || []).length
          if (2 < n) {
            hits.push(`${file}:${i + 1} ${n} em dashes: ${line.trim()}`)
          }
        })
    }
    Assert.deepEqual(hits, [],
      `more than one em-dash aside on a line (docs/STYLE-GUIDE.md):\n` +
      hits.join('\n'))
  })


  // First person, the house rule that .vale.ini switches Google.We and
  // Google.FirstPerson OFF in favour of. Vale cannot express "only in
  // tutorials", which is why the rule lives here instead -- and until
  // this test existed, .vale.ini's comment claimed an enforcement that
  // was not there, so "we" on a reference page passed BOTH gates.
  //
  // STYLE-GUIDE.md voice rule 7: talk to the reader as "you". "We"
  // appears only in tutorials, walking through code together. "I"
  // appears nowhere.
  // Labels from stylePaths() are repo-relative.
  const TUTORIAL_PAGES = ['docs/tutorial.md']

  test('we-appears-only-in-tutorials', () => {
    const hits: string[] = []
    for (const { file, abs } of stylePaths()) {
      if (TUTORIAL_PAGES.includes(file)) {
        continue
      }
      prose(Fs.readFileSync(abs, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          const m = line.match(/\b(we|we'(?:ll|ve|re|d)|us|our|ours|let's)\b/i)
          if (m) {
            hits.push(`${file}:${i + 1} "${m[1]}": ${line.trim()}`)
          }
        })
    }
    Assert.deepEqual(hits, [],
      'first-person plural outside a tutorial ' +
      `(docs/STYLE-GUIDE.md, voice rule 7):\n${hits.join('\n')}`)
  })


  // "I" is stricter than Google's rule, and applies to every page.
  // I/O is a word, not a pronoun; the negative lookahead keeps it.
  test('first-person-singular-appears-nowhere', () => {
    const hits: string[] = []
    for (const { file, abs } of stylePaths()) {
      prose(Fs.readFileSync(abs, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          const m = line.match(
            /\bI(?!\/O)\b|\bI'(?:m|ve|ll|d)\b|\b(?:my|mine|myself)\b/i)
          if (m) {
            hits.push(`${file}:${i + 1} "${m[0]}": ${line.trim()}`)
          }
        })
    }
    Assert.deepEqual(hits, [],
      'first-person singular in documentation ' +
      `(docs/STYLE-GUIDE.md, voice rule 7):\n${hits.join('\n')}`)
  })


  test('no-emoji', () => {
    const hits: string[] = []
    for (const { file, abs } of stylePaths()) {
      lf(Fs.readFileSync(abs, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(line)) {
            hits.push(`${file}:${i + 1}: ${line.trim()}`)
          }
        })
    }
    Assert.deepEqual(hits, [],
      `emoji are not used in documentation:\n${hits.join('\n')}`)
  })


  // A repo-layout listing that happens to show CLAUDE.md is fine; it is
  // inside a fence, and it makes no claim the reader has to follow.
  test('no-internal-doc-references', () => {
    const hits: string[] = []
    for (const { file, abs } of readerPaths()) {
      for (const para of logical(fenceless(Fs.readFileSync(abs, 'utf8')))) {
        for (const [re, name] of INTERNAL_DOCS) {
          // matchAll, not match: a paragraph can carry more than one
          // citation, and reporting only the first hides the rest behind
          // a fix for the one named.
          for (const m of para.text.matchAll(re)) {
            if (null == m.index) {
              continue
            }
            const { line, text } = at(para, m.index)
            const hit = `${file}:${line} "${name}": ${text}`
            if (!hits.includes(hit)) {
              hits.push(hit)
            }
          }
        }
      }
    }
    Assert.deepEqual(hits, [],
      'documentation cites an internal working document ' +
      `(docs/STYLE-GUIDE.md):\n${hits.join('\n')}`)
  })


  // The guide and this gate must agree; the guide names this block, so
  // a reader of either finds the other.
  test('the-style-guide-names-this-gate', () => {
    const guide = Fs.readFileSync(
      Path.join(DOCS_DIR, 'STYLE-GUIDE.md'), 'utf8')
    Assert.ok(guide.includes('docs.test.ts'),
      'STYLE-GUIDE.md should point at this test file')
  })

})
