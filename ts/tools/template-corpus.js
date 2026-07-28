// Cross-stack differential corpus for the template engine.
//
// The template engine is in exactly the position the merge engine was in
// before it was unified: two independent implementations (go/template.go is
// 746 lines; the TS engine lives in src/util/basic.ts), whose "parity" test
// was hand-transcribed Go expectations copied from the TS test file. That
// is the setup that let merge disagree on ~72% of non-trivial inputs while
// every test passed.
//
// This records TS's exact output — or its exact failure — for every case.
// go/template_corpus_ts_test.go replays them and asserts byte equality.
'use strict'

const { template } = require('../dist/jostraca')

// Named replace functions, so function-valued replaces are exercised too.
// JSON cannot carry a closure; both stacks implement this fixed set by
// name. `$fn` is the marker key.
const FNS = {
  upper: (groups) => String(groups['$&']).toUpperCase(),
  lower: (groups) => String(groups['$&']).toLowerCase(),
  fixed: () => 'FIXED',
  wrap: (groups) => '[' + groups['$&'] + ']',
}

function hydrate(replace) {
  if (null == replace) {
    return undefined
  }
  const out = {}
  for (const [k, v] of Object.entries(replace)) {
    out[k] = (null != v && 'object' === typeof v && v.$fn) ? FNS[v.$fn] : v
  }
  return out
}

function buildCases() {
  const cases = []

  const add = (name, src, model, spec) => {
    const entry = { name, src, model: model || {}, spec: spec || {} }
    try {
      entry.out = template(src, model || {}, {
        ...spec,
        replace: hydrate(spec && spec.replace),
      })
    }
    catch (err) {
      entry.error = true
    }
    cases.push(entry)
  }

  // --- model substitution ------------------------------------------------
  const model = {
    name: 'Acme',
    n: 42,
    f: 1.5,
    t: true,
    fal: false,
    nil: null,
    obj: { a: 1, b: 'two' },
    arr: [1, 2, 3],
    deep: { one: { two: { three: 'THREE' } } },
    uni: 'héllo 世界 🎉',
    empty: '',
    dollar: 'a$$b',
  }

  add('plain', 'Hello $$name$$!\n', model)
  add('nested', 'v=$$deep.one.two.three$$\n', model)
  add('number', 'n=$$n$$ f=$$f$$\n', model)
  add('boolean', 't=$$t$$ f=$$fal$$\n', model)
  add('null-left-in-place', 'x=$$nil$$\n', model)
  add('missing-left-in-place', 'x=$$nope$$ y=$$a.b.c$$\n', model)
  add('object-jsonified', 'o=$$obj$$\n', model)
  add('array-jsonified', 'a=$$arr$$\n', model)
  add('unicode', 'u=$$uni$$\n', model)
  add('empty-string-value', 'e=[$$empty$$]\n', model)
  add('value-containing-markers', 'd=$$dollar$$\n', model)
  add('adjacent', '$$name$$$$name$$\n', model)
  add('repeated', '$$name$$ $$name$$ $$name$$\n', model)
  add('unterminated', 'a $$name b\n', model)
  add('lone-dollars', '$$ $$$ $$$$\n', model)
  add('quoted-ref', '$$"literal"$$\n', model)
  add('no-markers', 'plain text\nline two\n', model)
  add('empty-src', '', model)
  add('crlf', 'a\r\n$$name$$\r\n', model)
  add('marker-at-edges', '$$name$$middle$$n$$', model)
  add('multiline-value', 'x=$$name$$\ny=$$n$$\n', model)

  // --- value formatting ---------------------------------------------------
  //
  // Where two independently written engines most often disagree. JS and Go
  // differ on exponent padding (1e-7 vs 1e-07) and on object key order
  // (JSON.stringify preserves insertion order; Go's json.Marshal sorts).
  //
  // CAVEAT: numbers reach Go through JSON as float64, so this exercises the
  // float64 path — which is what a user gets from JSON/YAML config, the
  // common case for a generator. TestTemplateIntAndFloatFormatAlike covers
  // the native-int path Go-side.
  const nums = {
    int: 42, zero: 0, one_point_oh: 1.0, tenth: 0.1, third: 1 / 3,
    big: 1e21, tiny: 1e-7, huge: 9007199254740993, neg: -17,
    exp: 1.5e300, frac: 2.5, sum: 0.1 + 0.2, negfrac: -0.25,
  }
  for (const k of Object.keys(nums)) {
    add('num-' + k, '[$$' + k + '$$]', nums)
  }

  const shapes = {
    emptyobj: {}, emptyarr: [],
    objkeys: { z: 1, a: 2, m: 3 },
    nested: { a: [1, { b: 'c' }] },
    arrmixed: [1, 'two', true, null],
    strwithquote: 'he said "hi"',
    strwithnl: 'a\nb',
    strwithuni: 'é世🎉',
    arrofobj: [{ n: 1 }, { n: 2 }],
    deepnest: { a: { b: { c: { d: [1, 2] } } } },
  }
  for (const k of Object.keys(shapes)) {
    add('shape-' + k, '[$$' + k + '$$]', shapes)
  }

  // --- custom delimiters -------------------------------------------------
  add('custom-delims', '{{name}} and {{n}}\n', model,
    { open: '\\{\\{', close: '\\}\\}', ref: '[^}]+' })
  add('custom-delims-missing', '{{nope}}\n', model,
    { open: '\\{\\{', close: '\\}\\}', ref: '[^}]+' })

  // --- replace: plain string keys ----------------------------------------
  add('replace-plain', 'aaa BBB ccc\n', {}, { replace: { BBB: 'XXX' } })
  add('replace-multiple', 'a b c\n', {}, { replace: { a: '1', b: '2', c: '3' } })
  add('replace-longest-first', 'foobar\n', {}, { replace: { foo: 'F', foobar: 'FB' } })
  add('replace-overlap', 'abcabc\n', {}, { replace: { abc: 'X' } })
  add('replace-with-model', '$$name$$ and TOKEN\n', model, { replace: { TOKEN: 'T' } })
  add('replace-value-with-dollar', 'TOKEN\n', {}, { replace: { TOKEN: 'a$&b' } })
  add('replace-empty-value', 'a TOKEN b\n', {}, { replace: { TOKEN: '' } })

  // --- replace: regex keys (RE2-safe only; no lookaround) ----------------
  add('replace-regex-digits', 'a 123 b 45 c\n', {}, { replace: { '/[0-9]+/': 'N' } })
  add('replace-regex-word', 'foo bar\n', {}, { replace: { '/\\bbar\\b/': 'BAZ' } })
  add('replace-regex-class', 'a1b2c3\n', {}, { replace: { '/[a-c]/': 'X' } })
  add('replace-regex-alt', 'cat dog\n', {}, { replace: { '/cat|dog/': 'PET' } })

  // --- replace: #Tag keys -------------------------------------------------
  add('replace-tag', 'before\n  // #Foo\nafter\n', {}, { replace: { '#Foo': 'INSERTED' } })
  add('replace-tag-missing', 'before\nafter\n', {}, { replace: { '#Foo': 'INSERTED' } })
  add('replace-tag-indent', 'a\n    // #Bar\nb\n', {}, { replace: { '#Bar': 'I' } })

  // --- replace: function values ------------------------------------------
  add('replace-fn-upper', 'aaa token bbb\n', {}, { replace: { token: { $fn: 'upper' } } })
  add('replace-fn-lower', 'AAA TOKEN BBB\n', {}, { replace: { TOKEN: { $fn: 'lower' } } })
  add('replace-fn-fixed', 'x TOKEN y\n', {}, { replace: { TOKEN: { $fn: 'fixed' } } })
  add('replace-fn-wrap', 'x TOKEN y\n', {}, { replace: { TOKEN: { $fn: 'wrap' } } })
  add('replace-fn-regex', 'a 12 b 345 c\n', {}, { replace: { '/[0-9]+/': { $fn: 'wrap' } } })

  // --- eject --------------------------------------------------------------
  add('eject-strings', 'DROP\nSTART\nkeep $$name$$\nEND\nDROP\n', model,
    { eject: ['START', 'END'] })
  add('eject-missing-start', 'keep\nEND\ndrop\n', model, { eject: ['START', 'END'] })
  add('eject-missing-end', 'drop\nSTART\nkeep\n', model, { eject: ['START', 'END'] })
  add('eject-neither', 'all kept\n', model, { eject: ['START', 'END'] })
  // End before start: no resolvable region, so nothing is ejected. TS used
  // to hit substring's argument-swapping and return the region backwards;
  // Go returned ''. Neither was designed.
  add('eject-inverted', 'a\nEND\nmiddle\nSTART\nb\n', model,
    { eject: ['START', 'END'] })
  add('eject-inverted-adjacent', 'ENDSTART\n', model, { eject: ['START', 'END'] })

  // --- randomised ---------------------------------------------------------
  let seed = 20260725 >>> 0
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)]

  const atoms = [
    'plain ', 'word ', '\n', '  ', '$$name$$', '$$n$$', '$$nope$$', '$$obj$$',
    '$$', '$', 'TOKEN', 'BBB', '123', 'x', '#Foo', '// #Foo\n', '$$uni$$',
    '$$deep.one.two.three$$', '\t', 'END', 'START',
  ]
  const specs = [
    {},
    { replace: { TOKEN: 'T' } },
    { replace: { BBB: 'X', TOKEN: 'T' } },
    { replace: { '/[0-9]+/': 'N' } },
    { replace: { '#Foo': 'F' } },
    { replace: { TOKEN: { $fn: 'upper' } } },
    { eject: ['START', 'END'] },
  ]

  for (let i = 0; i < 400; i++) {
    const parts = []
    const n = 1 + Math.floor(rnd() * 12)
    for (let k = 0; k < n; k++) {
      parts.push(pick(atoms))
    }
    add('random-' + i, parts.join(''), model, pick(specs))
  }

  return cases
}

module.exports = { buildCases, FNS }
