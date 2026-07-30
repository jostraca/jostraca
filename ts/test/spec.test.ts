import { test, describe } from 'node:test'
import Assert from 'node:assert'
import Fs from 'node:fs'
import Path from 'node:path'

// Internal module paths, not the package entry: the corpus covers helpers
// such as `get` that are not on the public API surface. point.test.ts
// already reaches into dist/ the same way.
import * as Basic from '../dist/util/basic'
import * as DiffUtil from '../dist/diff'


// The shared corpus, driven by both stacks. See test/spec/README.md.
// __dirname is ts/dist-test at run time, so the repo root is two up.
const SPEC_DIR = Path.join(__dirname, '..', '..', 'test', 'spec')


type Case = {
  file: string
  line: number
  id: string
  fn: string
  args: any[]
  expect: any
  error: string
}


// One adapter per corpus `fn`. Shapes are chosen so the result serializes
// identically in Go: `omap` yields an ordered pair list because that is
// the only way to assert key order in a language whose maps have none.
const FN: Record<string, (a: any[]) => any> = {
  camelify: (a) => (Basic as any).camelify(a[0]),
  snakify: (a) => (Basic as any).snakify(a[0]),
  kebabify: (a) => (Basic as any).kebabify(a[0]),
  partify: (a) => (Basic as any).partify(a[0]),
  lcf: (a) => (Basic as any).lcf(a[0]),
  ucf: (a) => (Basic as any).ucf(a[0]),
  escre: (a) => (Basic as any).escre(a[0]),
  indent: (a) => (Basic as any).indent(a[0], a[1]),
  isbinext: (a) => (Basic as any).isbinext(a[0]),
  isbincontent: (a) => (Basic as any).isbincontent(a[0]),
  get: (a) => (Basic as any).get(a[0], a[1]),
  getx: (a) => (Basic as any).getx(a[0], a[1]),
  deep: (a) => (Basic as any).deep(...a),
  omap: (a) => Object.entries((Basic as any).omap(a[0])),
  template: (a) => (Basic as any).template(a[0], a[1], a[2]),
  names: (a) => 2 === a.length
    ? (Basic as any).names(a[0], a[1])
    : (Basic as any).names(a[0], a[1], a[2]),
  lines: (a) => (DiffUtil as any).lines(a[0]),
  lcs: (a) => (DiffUtil as any).lcs(a[0], a[1]),
}


function loadCases(): Case[] {
  const out: Case[] = []

  const files = Fs.readdirSync(SPEC_DIR)
    .filter((n) => n.endsWith('.tsv'))
    .sort()

  if (0 === files.length) {
    throw new Error('no .tsv files found in ' + SPEC_DIR)
  }

  for (const file of files) {
    // Corpus files are committed LF and .gitattributes keeps them that way,
    // but normalise anyway: a clone made before that entry existed, or a
    // zip download, still lands CRLF, and a stray \r on the last cell is a
    // baffling failure to debug (`want "error", got "error\r"`). The Go
    // runner does the same.
    const text = Fs.readFileSync(Path.join(SPEC_DIR, file), 'utf8')
      .replace(/\r\n/g, '\n')
    const rows = text.split('\n')
    let header: string[] | null = null

    for (const [i, row] of rows.entries()) {
      if ('' === row.trim() || row.startsWith('#')) {
        continue
      }

      const cells = row.split('\t')

      if (null == header) {
        header = cells
        const want = ['id', 'fn', 'args', 'expect', 'error']
        Assert.deepStrictEqual(header, want,
          `${file}: header is ${JSON.stringify(header)}, want ${JSON.stringify(want)}`)
        continue
      }

      // A short row means a trailing empty cell was trimmed by an editor;
      // pad rather than crash on an out-of-range index.
      while (cells.length < 5) {
        cells.push('')
      }
      Assert.equal(cells.length, 5,
        `${file}:${i + 1}: ${cells.length} cells, want 5`)

      const error = cells[4]

      out.push({
        file,
        line: i + 1,
        id: cells[0],
        fn: cells[1],
        args: JSON.parse(cells[2]),
        expect: '' === error ? JSON.parse(cells[3]) : undefined,
        error,
      })
    }
  }

  return out
}


// Canonical JSON with object keys sorted, matching what Go's
// json.Marshal produces. Arrays keep their order — they have a
// meaningful one, and that is what the ordering cases rely on.
function canon(val: any): string {
  return JSON.stringify(sorted(val))
}

function sorted(val: any): any {
  if (null == val || 'object' !== typeof val) {
    // undefined is a miss, and both stacks report misses as null.
    return undefined === val ? null : val
  }
  if (Array.isArray(val)) {
    return val.map(sorted)
  }
  const out: any = {}
  for (const key of Object.keys(val).sort()) {
    out[key] = sorted(val[key])
  }
  return out
}


describe('spec-corpus', () => {

  const cases = loadCases()

  // A corpus that silently shrinks to nothing would pass. Assert it is
  // actually populated, and report the count so the two stacks can be
  // compared at a glance.
  test('corpus-loaded', () => {
    Assert.ok(100 < cases.length,
      `only ${cases.length} cases loaded from ${SPEC_DIR}`)
    console.log(`spec corpus: ${cases.length} cases`)
  })

  // Unknown `fn` is a failure, not a skip: a corpus entry one stack
  // ignores is exactly the divergence this suite exists to catch.
  test('all-fns-dispatched', () => {
    const missing = [...new Set(cases.map((c) => c.fn))]
      .filter((fn) => !(fn in FN))
      .sort()
    Assert.deepStrictEqual(missing, [],
      'corpus uses undispatched fns: ' + missing.join(', '))
  })

  test('ids-unique', () => {
    const seen = new Map<string, string>()
    for (const c of cases) {
      const key = c.file + ':' + c.id
      Assert.ok(!seen.has(key), `duplicate id ${key}`)
      seen.set(key, c.file)
    }
  })

  for (const c of cases) {
    test(`${c.file}/${c.id}`, () => {
      const where = `${c.file}:${c.line} ${c.id}`

      if ('' !== c.error) {
        Assert.throws(
          () => FN[c.fn](c.args),
          (err: any) => {
            Assert.ok(String(err.message).includes(c.error),
              `${where}: message ${JSON.stringify(err.message)} ` +
              `does not contain ${JSON.stringify(c.error)}`)
            return true
          },
          `${where}: expected a throw containing ${JSON.stringify(c.error)}`)
        return
      }

      const actual = FN[c.fn](c.args)
      Assert.equal(canon(actual), canon(c.expect), where)
    })
  }

})
