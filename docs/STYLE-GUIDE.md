# Documentation style guide

How the Jostraca documentation is written. This guide is normative for
`docs/*.md`, `docs/how-to/*.md`, `adr/*.md`, the package READMEs, and the
prose on
[jostraca.org](https://jostraca.org) (whose authored pages cite this file
from `jostraca/web`'s AGENTS.md). It exists so that a page written next
year sounds like a page written this year, and so that a reviewer can
point at a rule instead of arguing taste.

Three sources feed it, in a fixed priority order. The same order is
encoded in `.vale.ini`, and every rule switched off there names the
reason:

    house voice  ->  Google  ->  Vale defaults

1. **This file.** Where it rules, it rules. The house voice is Richard
   Rodger's blog register, and the places it wins are listed with their
   reasons rather than left as silent exceptions: first-person plural in
   tutorials, British spellings, quotation punctuation outside the
   quotes, and the parenthesis ration.
2. The [Google developer documentation style
   guide](https://developers.google.com/style) for everything this file
   does not cover: second person, present tense, active voice,
   sentence-style capitalisation in headings, serial commas, one idea
   per sentence, dash spacing.
3. [Vale](https://vale.sh) defaults, which mostly means spelling.

Two gates check it, and both run in CI:

| Gate | Runs | Checks |
|---|---|---|
| `vale docs adr README.md ts/README.md` | `.github/workflows/docs.yml` | Google's rules plus the banned list, at the levels set in `.vale.ini` |
| `ts/test/docs.test.ts` | `npm test` | the banned list, the em-dash ration, the first-person rules, no emoji, no internal-document citations, and that every code snippet executes |

The banned list is read from one file by both, so they cannot drift.
A Google rule sitting at `warning` rather than `error` was tried at
error level first and found wrong for these pages; `.vale.ini` records
what it produced and why it was demoted.

## The structure: Diátaxis, enforced by placement

Every page is exactly one of four kinds, and the kind decides what the
page may do:

| Kind | Files | May | May not |
|---|---|---|---|
| Tutorial | `tutorial.md` | teach step by step, show output for every step, defer detail with a link | argue design, list every prop, assume the reader's goal |
| How-to | `how-to/*.md` | solve one named task, assume competence, link the reference | teach basics, explain design, drift into a second task |
| Reference | `reference-components.md`, `reference-options.md`, `reference-utilities.md`, `reference-go.md` | state facts exhaustively and dryly, pin claims to tests | narrate, persuade, teach |
| Explanation | `explanation.md` | argue, compare, admit trade-offs, tell the design's story | be the only place a fact lives |

One fact appears in all four kinds at different altitudes—met in the
tutorial, used in a how-to, specified in the reference, argued in the
explanation—but the normative statement lives in the reference and
everything else links to it.

`index.md` is the doorway and belongs to no kind: it routes, and states
no fact of its own that a page below it does not also state.

## Documentation does not cite internal documents

**A documentation page never sends a reader to a plan, a decision
record, a build log, or an agent instruction file.** Those are working
documents: written for the people changing this repository, argued rather
than stated, and stale the moment the code moves past them. A reader who
follows a link out of the documentation and lands in one has been handed
the project's notes in place of an answer.

The internal set, by name:

| Document | What it is |
|---|---|
| `adr/*.md` | decision records: what was decided, and the reasoning available at the time |
| `PARITY_PLAN.md`, `DEPENDENCY_PLAN.md`, `go/PORT_PLAN.md` | analysis and recommendations, revised as the code moves |
| `go/BUILD_LOG.md` | per-phase notes from building the Go port |
| `CODE_REVIEW.md` | review findings |
| `CLAUDE.md`, `AGENTS.md` | instructions to contributors and agents working in the repository |

The ban covers the name as much as the link. "As the parity plan
records" fails for the same reason the URL does: the reader still cannot
act on the sentence without leaving the documentation.

State the fact instead. "TypeScript is the source of truth; change it
first, then bring Go into parity" is what a reader needs, and a link to
the guide that also says so adds nothing to it. Where the fact belongs in
the documentation and is missing, write it into the Diátaxis page that
owns it rather than pointing outside.

The rule runs one way. Internal documents cite each other and cite the
documentation freely, because an ADR that does not show its working is
not an ADR. Only the direction out of documentation is closed.

Three things are not internal documents, and stay linkable. **Source** is
code: `test/spec/`, a file under `ts/src/`, or the test a claim is pinned
to. **This guide** is normative rather than exploratory, and it names the
internal documents in order to ban them. **The other READMEs** are
documentation themselves.

`ts/test/docs.test.ts` enforces this over `docs/`, `docs/how-to/` and the
three READMEs. Vale does not, because the set it lints includes `adr/`,
where the citations are correct.

## The voice

The house voice is Richard Rodger's blog register, adapted per document
kind. The portable part of that voice is its *rhythm*, not its stock
phrases. Ten habits, with the register they apply in:

1. **Open with a concrete fact or a plainly stated problem, then a
   short dry beat.** Tutorials and how-tos. Reference pages open by
   stating what the thing is.
2. **Introduce code with a short colon-terminated sentence**—"Write
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
including commit messages that quote the docs.

**The list itself lives in
`.vale/styles/config/vocabularies/Jostraca/reject.txt`**, one regular
expression per line. That file is the single source of truth: Vale
reads it in CI, and `ts/test/docs.test.ts` (the `docs-style` block)
reads the same file rather than keeping a second copy, so the two
gates cannot disagree about what is banned. Add a phrase there and both
pick it up. What follows is a reader's summary of it, not a second
list; every phrase is shown as code so that quoting a banned phrase in
this guide does not fail the gate.

It draws on two sources: the original house list, and
[claudisms.ai](https://claudisms.ai/), a catalogue of the patterns that
mark machine-written prose.

**Filler and false emphasis**: `worth noting` · `important to note` ·
`it cannot be overstated` · `at its core` · `when it comes to` ·
`let's break it down` · `here's where it gets interesting` ·
`the point is` · `because it matters`.

**Inflated vocabulary**: `delve` · `dive into` · `robust` · `seamless` ·
`comprehensive` · `holistic` · `intricate` · `leverage` · `foster` ·
`shed light on` · `pave the way` · `pivotal` · `transformative` ·
`game-changing` · `cutting-edge` · `groundbreaking` · `testament to` ·
`paradigm shift` · `realm` · `landscape of` · `underscores the` ·
`lean into` · `throughline` · `double-click on` · `mature setup`.

**Consultant register**: `north star` · `key takeaways` ·
`best practices` (name the practice instead) · `at the end of the day` ·
`pressure-test` · `right-size` · `strategic imperative` ·
`three things to know` · `dispatches from` · `best operators` ·
`lessons learned`.

**Metaphor inflation**: `load-bearing` · `heavy lifting` ·
`is doing the work` · `different physics` · `hits hardest` ·
`quietly` (say `silently`, which is the term of art for a failure that
reports nothing).

**The contrast frame and its cousins**: `not just` · `not only X but Y` ·
`it's not about` · `the whole game` · `the entire point` ·
`the only thing that matters`. Say what the thing is.

**False singularity**: `the right way/answer/tool/question` ·
`the best thing you can do` · `if I had to pick` · `what struck me` ·
`stuck with me` · `struck a chord` · `hit a nerve` ·
`we've seen this movie before`.

**Reflective pose**: `sit with` · `worth exploring/considering/asking` ·
`keeps coming back to` · `that's the tell` · `the honest version is` ·
`where I landed`.

**Invented observation about people**: `most people` ·
`everyone I've worked with` · `a lot of folks` · `nobody I know`. If it
did not happen, do not claim to have noticed it.

**Signposting**: `let's explore` · `now let's turn to` · `moving on to` ·
`in today's rapidly evolving` · `reflecting a broader trend` ·
`great question`.

### What is not banned, and why

Several entries on claudisms.ai are deliberately absent, because they
name things this project documents. A gate that fires on the subject
matter is a gate people learn to switch off.

| Not banned | Because |
|---|---|
| `real` | `real filesystem` is the distinction the in-memory mode exists to draw. |
| `shape` | The options validator is a package called `shape`. |
| `engine` | There is a diff engine and a template engine. |
| `surface` | `the option surface` is how the reference describes an API. |
| `hold`, `carry`, `hands` | A slice holds bytes, a node carries meta, a function hands back a `Result`. |
| `lives` | `the normative statement lives in the reference` is this guide, one section up. |
| `decision record` | `audit()` emits one per file. The internal-document gate matches the citation shape (`as the decision record explains`), never the bare noun, for exactly this reason. |

The rule behind the list: ban the phrase that adds nothing, never the
word that names a thing.

**Patterns** (not mechanically checkable, enforced at review):

- Announcing structure before delivering it ("There are three things to
  understand").
- Restating the question before answering it.
- A closing one-liner that restates the thesis.
- Stacked short declaratives (four or more in a row).
- Superlative self-ranking ("the most important thing", "the part that
  matters most").
- A list of `**Bold term**: explanation` pairs, which is the single most
  recognisable machine-written list. Write sentences, or a table.

**Punctuation rulings**:

- Em dashes are allowed, and take **no space on either side**:
  `a dash—like this`. That is Google's ruling
  ([dashes](https://developers.google.com/style/dashes)) and
  `Google.EmDash` fails the build on a spaced one. They stay **rationed
  to one aside per sentence**: either a single dash before a trailing
  clause, or one matched pair around a parenthetical, never both and
  never two asides. `docs.test.ts` enforces the ration, Vale enforces
  the spacing. Prefer a comma or parentheses when the aside is mild.
  (claudisms.ai bans the em dash outright. This project keeps it, because
  the voice it also asks for uses it; the spacing follows Google and the
  ration is ours.)
- In a link list, separate the link from its gloss with a full stop, not
  a dash: `- [Copy a directory](how-to/copy-a-directory.md). Copies a tree...`.
- No emoji in documentation.
- Sentence-style capitalisation in headings (Google style).
- British spellings (`-ise`, `-isation`). Google style is US English;
  this is one of the places the house voice wins, and
  `accept.txt` carries them.

## Terminology

- The project is **Jostraca** (capital J) in prose; the package is
  `jostraca`.
- **component**—one of `Project`, `Folder`, `File`, `Content`,
  `Line`, `Fragment`, `Slot`, `Inject`, `Copy`, `List`, `None`, or a
  function wrapped by `cmp()`. Not "tag", not "element".
- **define phase** and **build phase**—the two halves of a
  `generate()` call. Never "render"; nothing is rendered.
- **model**—the data object substituted into templates. Not
  "context", which is `ctx$`, a different thing.
- **fragment**—an external file read into the output. **slot**—a
  marked region inside a fragment.
- **existing-file mode**—one of `write`, `preserve`, `present`,
  `diff`, `merge`. Say "mode", not "strategy".
- **baseline**—the previous generate, kept under `.jostraca/`, used
  as the merge base. Not "ancestor", except when describing three-way
  merge in general.
- **protected file**—one carrying `JOSTRACA_PROTECT`. Jostraca
  *skips* it; it does not "ignore" it.
- Say **overwrite** for what `write: true` does. It is the honest word.

## Code snippets: every one is tested

A fenced snippet in a Diátaxis page is either executed by
`ts/test/docs.test.ts` or carries a visible, reasoned skip. The
directive vocabulary—an HTML comment on its own line immediately
before the fence:

```markdown
<!-- test: scenario first-tree -->
Opens a named scenario: one temp directory, lasting until the next
scenario directive or the end of the page. Every run, input and
assertion below it shares that directory, which is how "now regenerate
over the edited file" recipes are modelled.

Add `posix` after the name — `scenario first-tree posix` — for a
scenario Windows cannot produce, and the whole scenario is skipped
there. Use it only where the platform is the reason: a POSIX file mode
is one, because fs.chmod on Windows toggles the read-only attribute and
nothing else. It is not a way to avoid fixing an example.

<!-- test: input tpl/header.txt -->
The next fence is written to <scenario-dir>/tpl/header.txt before the
next run. Re-declaring a path overwrites it—that is how a page
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
suite—give it a directive or delete the tag.

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
message.

To ban a phrase, add the regular expression to
`.vale/styles/config/vocabularies/Jostraca/reject.txt` and summarise it in
the preceding list. Both gates pick it up from that one file; there is no second
list to update, and `docs.test.ts` names this file, so a drift is a
build failure with a pointer.

To change a Google rule's level, edit `.vale.ini` and write down what
the rule produced on a clean run. "It was noisy" is not a reason; "it
maps `touch` to `tap`, and 9 of its 22 hits were docs about touching a
file" is. A rule demoted without that note reads later as an oversight,
and gets re-promoted by someone repeating the work.
