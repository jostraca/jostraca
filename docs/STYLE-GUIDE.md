# Documentation style guide

How the Jostraca documentation is written. This guide is normative for
`docs/*.md`, `docs/how-to/*.md`, the package READMEs, and the prose on
[jostraca.dev](https://jostraca.dev) (whose authored pages cite this file
from `jostraca/web`'s AGENTS.md). It exists so that a page written next
year sounds like a page written this year, and so that a reviewer can
point at a rule instead of arguing taste.

Three sources feed it, in priority order:

1. **This file.** Where it rules, it rules.
2. The [Google developer documentation style
   guide](https://developers.google.com/style) for everything this file
   does not cover: second person, present tense, active voice,
   sentence-style capitalisation in headings, serial commas, one idea
   per sentence.
3. The register table below decides the fights between the two voices
   the docs blend: Google's plainness and the house voice.

## The structure: Diátaxis, enforced by placement

Every page is exactly one of four kinds, and the kind decides what the
page may do:

| Kind | Files | May | May not |
|---|---|---|---|
| Tutorial | `tutorial.md` | teach step by step, show output for every step, defer detail with a link | argue design, list every prop, assume the reader's goal |
| How-to | `how-to/*.md` | solve one named task, assume competence, link the reference | teach basics, explain design, drift into a second task |
| Reference | `reference-components.md`, `reference-options.md`, `reference-utilities.md`, `reference-go.md` | state facts exhaustively and dryly, pin claims to tests | narrate, persuade, teach |
| Explanation | `explanation.md` | argue, compare, admit trade-offs, tell the design's story | be the only place a fact lives |

One fact appears in all four kinds at different altitudes — met in the
tutorial, used in a how-to, specified in the reference, argued in the
explanation — but the normative statement lives in the reference and
everything else links to it.

`index.md` is the doorway and belongs to no kind: it routes, and states
no fact of its own that a page below it does not also state.

## The voice

The house voice is Richard Rodger's blog register, adapted per document
kind. The portable part of that voice is its *rhythm*, not its stock
phrases. Ten habits, with the register they apply in:

1. **Open with a concrete fact or a plainly stated problem, then a
   short dry beat.** Tutorials and how-tos. Reference pages open by
   stating what the thing is.
2. **Introduce code with a short colon-terminated sentence** — "Write
   this as `gen.mjs`:", "Now run it:". Never "The following code
   snippet demonstrates". Everywhere.
3. **After a code block, point at the one interesting thing.** Do not
   recap the code. Everywhere.
4. **Parentheses carry definitions, caveats, and at most one dry aside
   per page.** Tutorials and how-tos. In reference pages, parentheses
   carry facts only.
5. **A trade-off gets bolted on with a dash, and the dash earns its
   place.** One per paragraph at most, never two in a sentence.
6. **Alternate one long explanatory sentence with one short verdict
   sentence.** The short sentence is the payoff. Everywhere.
7. **Talk to the reader as "you", and route them** ("If you only want
   to copy a directory, skip to…"). "We" appears only in tutorials,
   walking through code together. "I" appears nowhere.
8. **Show that the code is real.** Every example is executed by the
   test suite; when a page says so, say it plainly ("this listing is
   what the generator wrote, not what the author remembers").
9. **Jokes are self-directed or about the industry's mundanity, and the
   register goes fully serious the moment correctness or a user's
   hand-edited file is on the table.** Never joke about the reader,
   other tools, or the consequences of an overwrite.
10. **Close by handing the reader something**: a link, a next step, one
    sentence. No summary paragraphs that restate the page.

Exclamation marks: at most one per page, in tutorials only, on a
genuine payoff.

## Banned phrases and patterns

These read as generated filler. Do not use them, in any document,
including commit messages that quote the docs. The enforced subset
lives in `ts/test/docs.test.ts` (the `docs-style` block) and fails the
build; the full list is normative here.

**Words and phrases**: worth noting · it's important to note · at its
core · when it comes to · let's break it down · here's where it gets
interesting · delve · dive into · robust · seamless · comprehensive ·
holistic · leverage · harness (verb) · foster · navigate (figurative) ·
landscape (figurative) · realm · testament to · pivotal ·
transformative · game-changing · cutting-edge · groundbreaking ·
underscore (verb) · shed light on · pave the way · unpack · surface
(verb, for insights) · lean into · load-bearing · doing the heavy
lifting · the right way/answer/tool/question · at the end of the day ·
paradigm shift · north star · key takeaways · best practices (name the
practice instead) · the whole game · that's the tell · sit with · worth
exploring · worth considering.

**Patterns**:

- The contrast frame "not just X, it's Y" / "It's not about X, it's
  about Y", and its cousin "not X — it is Y". One per page at most;
  zero is better. Say what the thing is.
- Announcing structure before delivering it ("There are three things to
  understand").
- Restating the question before answering it.
- A closing one-liner that restates the thesis.
- Stacked short declaratives (four or more in a row).
- Superlative self-ranking ("the most important thing", "the part that
  matters most").
- Invented observation about people ("most teams find", "everyone I've
  worked with").

**Punctuation rulings**:

- Em dashes are allowed — the house voice uses them — but rationed to
  **one aside per sentence**: either a single dash before a trailing
  clause, or one matched pair around a parenthetical, never both and
  never two asides. Prefer a comma or parentheses when the aside is
  mild. (A source that banned them outright also banned the voice this
  guide adopts; the phrases above are the part of that list this
  project takes.)
- No emoji in documentation.
- Sentence-style capitalisation in headings (Google style).

## Terminology

- The project is **Jostraca** (capital J) in prose; the package is
  `jostraca`.
- **component** — one of `Project`, `Folder`, `File`, `Content`,
  `Line`, `Fragment`, `Slot`, `Inject`, `Copy`, `List`, `None`, or a
  function wrapped by `cmp()`. Not "tag", not "element".
- **define phase** and **build phase** — the two halves of a
  `generate()` call. Never "render"; nothing is rendered.
- **model** — the data object substituted into templates. Not
  "context", which is `ctx$`, a different thing.
- **fragment** — an external file read into the output. **slot** — a
  marked region inside a fragment.
- **existing-file mode** — one of `write`, `preserve`, `present`,
  `diff`, `merge`. Say "mode", not "strategy".
- **baseline** — the previous generate, kept under `.jostraca/`, used
  as the merge base. Not "ancestor", except when describing three-way
  merge in general.
- **protected file** — one carrying `JOSTRACA_PROTECT`. Jostraca
  *skips* it; it does not "ignore" it.
- Say **overwrite** for what `write: true` does. It is the honest word.

## Code snippets: every one is tested

A fenced snippet in a Diátaxis page is either executed by
`ts/test/docs.test.ts` or carries a visible, reasoned skip. The
directive vocabulary — an HTML comment on its own line immediately
before the fence:

```markdown
<!-- test: scenario first-tree -->
Opens a named scenario: one temp directory, lasting until the next
scenario directive or the end of the page. Every run, input and
assertion below it shares that directory, which is how "now regenerate
over the edited file" recipes are modelled.

<!-- test: input tpl/header.txt -->
The next fence is written to <scenario-dir>/tpl/header.txt before the
next run. Re-declaring a path overwrites it — that is how a page
simulates a hand edit between two generates. Name the path in the prose
above the fence too; the harness checks that a trailing part of it
appears in a code span within three lines.

<!-- test: run -->
The next js fence is executed with the scenario directory as its
working directory. Write ordinary module code: `import { Jostraca }
from 'jostraca'` is rewritten to the built package in ts/dist, and
nothing else is touched. Top-level await is available.

<!-- test: out -->
The next text fence lists every path the run left under the output
folder, one per line, relative and sorted. Jostraca's own `.jostraca/`
bookkeeping is excluded. A line holding only "..." matches any run of
lines.

<!-- test: file out/app/index.js -->
The next fence is the exact content of that generated file. Name it in
the prose above, in a code span, like an input. A fence cannot express
"and no newline at the end", so where the generated file has none, end
the fence with git's own marker line:
\ No newline at end of file

<!-- test: skip <reason> -->
Deliberately unexecuted, with a non-empty reason a reviewer can weigh.
```

Untagged fences (diagrams, directory trees drawn for illustration,
quoted error text) make no claim and are exempt. A fence tagged with a
language and carrying no directive is a page defect and fails the
suite — give it a directive or delete the tag.

Two rules of taste:

- A doc example shows a moment: one generator, a handful of files,
  short output. Anything needing a large fixture corpus belongs in
  `ts/test/`, and the page links to it.
- Examples are plain JavaScript with `import`. A snippet that exists to
  show a *type* is a `ts` fence and carries a skip naming the type it
  shows.

## Per-kind templates

**Tutorial section**: goal sentence → snippet → output → the one
observation → forward link. Every step's output shown, every snippet
executed.

**How-to guide**: title is the task in imperative or "-ing" form; one
sentence of situation; the recipe; one paragraph of what to watch for;
links (reference for the constructs, the tutorial for the basics it
assumes). Frontmatter: `description`, `group`, `order`.

**Reference section**: definition, then behaviour, then edge cases,
then a pinned example. Every claim that has a test can name it.

**Explanation section**: the question, the answer, the argument, the
trade-off admitted. May quote history when the history is the argument.

## Updating this guide

Change it the way behaviour changes: in the same commit as the first
page that follows the new rule, with the reasoning in the commit
message. The enforced phrase list in `docs.test.ts` and this file must
agree; the test names this file, so a drift is a build failure with a
pointer.
