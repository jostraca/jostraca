// Performance baselines for the shared workloads in
// test/spec/perf/workloads.tsv, which go/perf_test.go also runs.
//
// Results are reported as a ratio against a calibration loop rather than
// as raw ns/op. Raw times say as much about the machine as about the code;
// the ratio divides the machine out, so a baseline recorded on a laptop
// still means something in CI. Raw ns/op is written alongside for context.
//
// Run via `make perf`. Requires a built dist/ (npm run build).

const Fs = require('node:fs')
const Path = require('node:path')

const Basic = require('../dist/util/basic.js')
const DiffUtil = require('../dist/diff.js')

const ROOT = Path.join(__dirname, '..', '..')
const WORKLOADS = Path.join(ROOT, 'test', 'spec', 'perf', 'workloads.tsv')
const LATEST = Path.join(ROOT, 'test', 'spec', 'perf', 'latest-ts.tsv')

// Same adapters as ts/test/spec.test.ts. Kept in step with that table by
// the shared workload file: an unknown fn is a hard error in both.
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
}


// A fixed pure-CPU loop with no dependency on any code under test, so a
// regression in jostraca itself cannot move the anchor and mask itself.
// Must stay equivalent to perfCalibrate in go/perf_test.go.
function calibrate() {
  let h = 2166136261
  for (let round = 0; round < 200; round++) {
    for (let i = 0; i < 1000; i++) {
      h ^= i & 0xff
      h = Math.imul(h, 16777619)
    }
  }
  return h >>> 0
}


function loadWorkloads() {
  // CRLF-normalised for the same reason as ts/test/spec.test.ts.
  const text = Fs.readFileSync(WORKLOADS, 'utf8').replace(/\r\n/g, '\n')
  const out = []
  let header = false

  for (const [i, row] of text.split('\n').entries()) {
    if ('' === row.trim() || row.startsWith('#')) {
      continue
    }

    const cells = row.split('\t')

    if (!header) {
      const want = 'id\tfn\targs'
      if (row !== want) {
        throw new Error(`${WORKLOADS}: header is ${JSON.stringify(row)}, ` +
          `want ${JSON.stringify(want)}`)
      }
      header = true
      continue
    }

    if (3 !== cells.length) {
      throw new Error(`${WORKLOADS}:${i + 1}: ${cells.length} cells, want 3`)
    }

    out.push({ id: cells[0], fn: cells[1], args: JSON.parse(cells[2]) })
  }

  return out
}


// Auto-scaling timing loop, the same shape testing.Benchmark uses: grow
// the iteration count until the run is long enough for the clock to be
// meaningful, then report ns per operation.
const MIN_NS = 300e6

function measure(run) {
  // Warm up so JIT compilation is not counted as workload cost.
  for (let i = 0; i < 100; i++) {
    run()
  }

  let iters = 1
  for (;;) {
    const start = process.hrtime.bigint()
    for (let i = 0; i < iters; i++) {
      run()
    }
    const elapsed = Number(process.hrtime.bigint() - start)

    if (MIN_NS <= elapsed || 1e9 <= iters) {
      return elapsed / iters
    }

    // Scale toward the target, capped so one slow workload cannot
    // explode the iteration count in a single step.
    const grow = Math.min(100, Math.max(2, Math.ceil(MIN_NS / (elapsed || 1))))
    iters *= grow
  }
}


function anchor(when) {
  const ns = measure(calibrate)
  if (0 >= ns) {
    throw new Error(`calibration (${when}) measured ${ns} ns/op`)
  }
  console.log(`calibration ${when}: ${ns.toFixed(0)} ns/op`)
  return ns
}


function main() {
  const workloads = loadWorkloads()

  // The anchor is measured twice, before and after the workloads, and the
  // lower reading wins.
  //
  // A single up-front measurement was wrong here in particular: `make perf`
  // runs `npm run build` and then this script, so the first thing measured
  // runs on a machine that has just finished a TypeScript compile. The
  // anchor came in ~25% high (227k vs a 183-191k steady state) while the
  // workloads, running later as the machine settled, did not -- so every
  // ratio was pushed down together. The anchor was adding variance rather
  // than dividing it out. Taking the minimum of a reading at each end stops
  // one contaminated moment from setting the scale.
  let anchorNs = anchor('before')

  const rows = ['id\tstack\tns_per_op\tratio']
  const measured = []

  for (const w of workloads) {
    const fn = FN[w.fn]
    if (!fn) {
      throw new Error(`${w.id}: fn ${JSON.stringify(w.fn)} is not dispatched`)
    }

    // Fail rather than time a broken call.
    fn(w.args)

    measured.push(measure(() => fn(w.args)))
  }

  anchorNs = Math.min(anchorNs, anchor('after'))
  console.log(`calibration: ${anchorNs.toFixed(0)} ns/op (lower of two)`)

  for (const [i, w] of workloads.entries()) {
    const ns = measured[i]
    const ratio = ns / anchorNs

    rows.push(`${w.id}\tts\t${ns.toFixed(1)}\t${ratio.toFixed(6)}`)
    console.log(
      `${w.id.padEnd(18)} ${ns.toFixed(1).padStart(10)} ns/op  ` +
      `ratio ${ratio.toFixed(6)}`)
  }

  Fs.mkdirSync(Path.dirname(LATEST), { recursive: true })
  Fs.writeFileSync(LATEST, rows.join('\n') + '\n')
  console.log(`wrote ${LATEST} (${workloads.length} workloads)`)
}

main()
