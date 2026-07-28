/* Copyright (c) 2024 Richard Rodger, MIT License */

// Mutation check for the diff/merge engine — "test the tests".
//
// The engine is the one piece that has to be byte-identical across the two
// stacks, and it is held there by a 1 190-case corpus. A corpus is only
// worth what it catches, so this deliberately breaks the engine in small
// ways and asserts the corpus notices.
//
// It also runs the other way round. Some lines LOOK like tie-breaks and
// are not: they pick between two values that are already equal. Those are
// declared `kills: false`, and the check fails if one of them turns out to
// matter after all — which would mean a refactor quietly gave a
// decorative line real consequences.
//
//   cd ts && npm run build && node tools/mutate-diff.js
//
// Runs in about a second: no test suite is spawned, the mutant is replayed
// straight over the committed corpus.

const Fs = require('node:fs')
const Path = require('node:path')
const Module = require('node:module')


const ENGINE = Path.join(__dirname, '..', 'dist', 'diff.js')
const CORPUS = Path.join(
  __dirname, '..', '..', 'go', 'testdata', 'parity', 'diff_corpus.json')


// Each mutation is an exact, unique replacement in the compiled engine.
//
// `kills: true`  — the corpus MUST diverge. The line is load-bearing and
//                  the corpus is what stops it drifting.
// `kills: false` — the corpus MUST NOT diverge, for the stated reason.
//                  These are the claims worth machine-checking, because
//                  "this looks like a decision but isn't" is exactly the
//                  kind of thing a comment gets wrong.
const MUTATIONS = [
  {
    name: 'lcs-split-tie-break-prefers-largest',
    from: 'if (sum >= best) {',
    to: 'if (sum > best) {',
    kills: true,
    why: 'The one real tie-break. Equally-long subsequences differ, and ' +
      'the split choice decides which lines a user sees kept.',
  },

  {
    name: 'lcs-row-max-tie',
    from: 'else if (prev[j + 1] >= cur[j]) {',
    to: 'else if (prev[j + 1] > cur[j]) {',
    kills: false,
    why: 'Not a tie-break: this is max(prev[j+1], cur[j]). On a tie both ' +
      'branches assign the same number.',
  },

  {
    name: 'lcs-single-row-occurrence',
    from: 'for (let i = b.length - 1; 0 <= i; i--) {',
    to: 'for (let i = 0; i < b.length; i++) {',
    kills: false,
    why: 'Not a tie-break either: the base case pushes a[0] whichever ' +
      'position in b matched, so first and last occurrence are the same ' +
      'string. The backwards walk is only there to mirror how a ' +
      'full-table oracle recovers the LCS.',
  },

  {
    name: 'lcs-no-prefix-suffix-trim',
    from: 'while (head < a.length && head < b.length && a[head] === b[head]) {',
    to: 'while (false) {',
    kills: false,
    why: 'Trimming the common prefix is a speed optimisation and must not ' +
      'change what comes out. If this starts killing, the "optimisation" ' +
      'is altering user files.',
  },
]


// Load a mutated copy of the engine without touching the real one on disk
// or poisoning require's cache.
function loadMutant(source) {
  const mod = new Module(ENGINE, null)
  mod.filename = ENGINE
  mod.paths = Module._nodeModulePaths(Path.dirname(ENGINE))
  mod._compile(source, ENGINE)
  return mod.exports
}


// Replay the corpus and count cases where the mutant disagrees with the
// output recorded from the real engine. A throw counts as a divergence:
// the corpus would fail on it just the same.
function divergences(engine, corpus) {
  const spec = { labels: corpus.labels }
  let count = 0
  let first = null

  for (const c of corpus.cases) {
    let got
    try {
      got = 'merge' === c.kind ?
        engine.merge(c.generated, c.baseline, c.existing, spec) :
        engine.diff(c.generated, c.existing, spec)
    }
    catch (err) {
      count++
      first = first || { case: c, err: err.message }
      continue
    }

    if (got.content !== c.content ||
      got.conflict !== c.conflict ||
      got.outcome !== c.outcome) {
      count++
      first = first || { case: c, got }
    }
  }

  return { count, first }
}


function main() {
  const source = Fs.readFileSync(ENGINE, 'utf8')
  const corpus = JSON.parse(Fs.readFileSync(CORPUS, 'utf8'))

  // Sanity: the unmutated engine must agree with the corpus completely,
  // or every result below is meaningless.
  const base = divergences(loadMutant(source), corpus)
  if (0 !== base.count) {
    console.error(
      `FATAL: the engine already disagrees with the corpus on ` +
      `${base.count}/${corpus.cases.length} cases. Rebuild, or regenerate ` +
      `the corpus if the change was intended.`)
    process.exit(2)
  }

  let failed = 0

  for (const mut of MUTATIONS) {
    const at = source.indexOf(mut.from)
    if (-1 === at) {
      console.error(
        `FAIL ${mut.name}: mutation target not found in dist/diff.js\n` +
        `      looked for: ${mut.from}\n` +
        `      The engine changed shape; update this mutation.`)
      failed++
      continue
    }
    if (source.indexOf(mut.from, at + 1) !== -1) {
      console.error(
        `FAIL ${mut.name}: mutation target is not unique in dist/diff.js`)
      failed++
      continue
    }

    const { count, first } = divergences(
      loadMutant(source.replace(mut.from, mut.to)), corpus)

    const killed = 0 < count
    const ok = killed === mut.kills

    if (ok) {
      console.log(
        `ok   ${mut.name}: ` +
        (mut.kills ?
          `killed by ${count}/${corpus.cases.length} cases` :
          `survives, as documented`))
    }
    else {
      failed++
      if (mut.kills) {
        console.error(
          `FAIL ${mut.name}: SURVIVED — the corpus does not cover this.\n` +
          `      ${mut.why}\n` +
          `      Add cases that distinguish it, or the line is not ` +
          `actually load-bearing and the comment on it is wrong.`)
      }
      else {
        console.error(
          `FAIL ${mut.name}: killed by ${count}/${corpus.cases.length} ` +
          `cases, but is documented as having no effect.\n` +
          `      ${mut.why}\n` +
          `      Either the code changed meaning or the claim was wrong. ` +
          `First divergence:\n` +
          `      ${JSON.stringify(first && first.case).slice(0, 300)}`)
      }
    }
  }

  if (0 < failed) {
    console.error(`\n${failed}/${MUTATIONS.length} mutation checks failed`)
    process.exit(1)
  }

  console.log(`\n${MUTATIONS.length}/${MUTATIONS.length} mutation checks passed`)
}


main()
