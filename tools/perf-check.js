// Compare the latest performance run against the committed baseline.
//
//   node tools/perf-check.js           compare, exit non-zero on regression
//   node tools/perf-check.js --write   record the current run as the baseline
//
// Driven by `make perf` and `make perf-baseline`. Both harnesses must have
// run first: go/perf_test.go writes latest-go.tsv, ts/tools/bench.js
// writes latest-ts.tsv.
//
// Comparison is on the calibration ratio, not raw ns/op, so a baseline
// recorded on one machine still means something on another. See
// test/spec/perf/README.md.

const Fs = require('node:fs')
const Path = require('node:path')
const Os = require('node:os')
const { execSync } = require('node:child_process')

const PERF = Path.join(__dirname, '..', 'test', 'spec', 'perf')
const BASELINE = Path.join(PERF, 'baseline.tsv')
const LATEST = ['ts', 'go'].map((s) => Path.join(PERF, `latest-${s}.tsv`))

// A workload may run this many times slower than baseline before it is
// called a regression. Generous by design: these are wall-clock numbers
// from a shared machine, and a checker that cries wolf gets switched off.
const TOLERANCE = Number(process.env.PERF_TOLERANCE || 2.5)

// Anything under this is too fast to time reliably; ratio noise on a
// sub-100ns workload is not signal.
const MIN_NS = 50


function parse(path) {
  if (!Fs.existsSync(path)) {
    return null
  }

  // CRLF-normalised for the same reason as ts/test/spec.test.ts.
  const rows = Fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n')
  const out = new Map()

  // Column positions come from the header, because the two file shapes
  // differ: a latest-*.tsv carries ns_per_op, the baseline does not.
  // Destructuring by position instead would read `ratio` as undefined for
  // the baseline, and a NaN ratio silently satisfies every threshold.
  let cols = null

  for (const row of rows) {
    if ('' === row.trim() || row.startsWith('#')) {
      continue
    }

    const cells = row.split('\t')

    if (null == cols) {
      cols = {}
      for (const [i, name] of cells.entries()) {
        cols[name] = i
      }
      for (const req of ['id', 'stack', 'ratio']) {
        if (null == cols[req]) {
          throw new Error(
            `${path}: header has no ${req} column: ${cells.join(', ')}`)
        }
      }
      continue
    }

    const id = cells[cols.id]
    const stack = cells[cols.stack]
    const ratio = Number(cells[cols.ratio])
    const ns = null == cols.ns_per_op ? null : Number(cells[cols.ns_per_op])

    if (!Number.isFinite(ratio) || 0 >= ratio) {
      throw new Error(`${path}: ${id}/${stack} has a bad ratio: ` +
        JSON.stringify(cells[cols.ratio]))
    }
    if (null != ns && !Number.isFinite(ns)) {
      throw new Error(`${path}: ${id}/${stack} has a bad ns_per_op: ` +
        JSON.stringify(cells[cols.ns_per_op]))
    }

    out.set(`${id}\t${stack}`, { id, stack, ns, ratio })
  }

  if (null == cols) {
    throw new Error(`${path}: no header row`)
  }

  return out
}


function loadLatest() {
  const merged = new Map()

  for (const path of LATEST) {
    const one = parse(path)
    if (null == one) {
      throw new Error(
        `missing ${path} -- run both harnesses first (make perf)`)
    }
    for (const [key, val] of one) {
      merged.set(key, val)
    }
  }

  return merged
}


function version(cmd, fallback) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split('\n')[0]
  }
  catch {
    return fallback
  }
}


function write(latest) {
  // The machine and toolchain are recorded because the ratio only mostly
  // divides them out -- a reader comparing wildly different hardware
  // deserves to know what the numbers came from.
  const head = [
    '# Performance baselines for the workloads in workloads.tsv.',
    '#',
    '# Ratios are workload ns/op divided by a calibration loop measured in',
    '# the same process, which is what makes them portable between machines.',
    '# Regenerate with `make perf-baseline`; check with `make perf`.',
    '#',
    `# recorded: ${new Date().toISOString().slice(0, 10)}`,
    `# platform: ${Os.platform()}/${Os.arch()} ${Os.cpus()[0]?.model || 'unknown cpu'}`,
    `# node:     ${process.version}`,
    `# go:       ${version('go version', 'unknown')}`,
    '',
    ['id', 'stack', 'ratio'].join('\t'),
  ]

  const keys = [...latest.keys()].sort()
  for (const key of keys) {
    const r = latest.get(key)
    head.push([r.id, r.stack, r.ratio.toFixed(6)].join('\t'))
  }

  Fs.writeFileSync(BASELINE, head.join('\n') + '\n')
  console.log(`wrote ${BASELINE} (${keys.length} entries)`)
}


function compare(latest) {
  const baseline = parse(BASELINE)
  if (null == baseline) {
    throw new Error(
      `no baseline at ${BASELINE} -- record one with \`make perf-baseline\``)
  }

  const regressions = []
  const untimeable = []
  const added = []
  const removed = []

  console.log(
    'workload'.padEnd(18) + 'stack'.padEnd(6) +
    'ns/op'.padStart(11) + 'ratio'.padStart(11) +
    'baseline'.padStart(11) + 'change'.padStart(9))

  for (const key of [...latest.keys()].sort()) {
    const now = latest.get(key)
    const was = baseline.get(key)

    if (null == was) {
      added.push(key.replace('\t', '/'))
      continue
    }

    const change = now.ratio / was.ratio

    let note = ''
    if (now.ns < MIN_NS) {
      untimeable.push(key.replace('\t', '/'))
      note = ' (too fast to time)'
    }
    else if (TOLERANCE < change) {
      regressions.push({ key, now, was, change })
      note = ' REGRESSION'
    }

    console.log(
      now.id.padEnd(18) + now.stack.padEnd(6) +
      now.ns.toFixed(1).padStart(11) +
      now.ratio.toFixed(6).padStart(11) +
      was.ratio.toFixed(6).padStart(11) +
      (change.toFixed(2) + 'x').padStart(9) + note)
  }

  for (const key of baseline.keys()) {
    if (!latest.has(key)) {
      removed.push(key.replace('\t', '/'))
    }
  }

  console.log()

  // Coverage changes are reported, never silently tolerated: a baseline
  // that has quietly stopped covering half the workloads still passes
  // every threshold it is asked about.
  if (0 < added.length) {
    console.log(`new workloads, not in baseline: ${added.join(', ')}`)
    console.log('  run `make perf-baseline` to record them')
  }
  if (0 < removed.length) {
    console.log(`baseline entries with no result: ${removed.join(', ')}`)
  }
  if (0 < untimeable.length) {
    console.log(
      `not compared, under ${MIN_NS}ns: ${untimeable.join(', ')}`)
  }

  if (0 < regressions.length) {
    console.error(`\n${regressions.length} regression(s) over ` +
      `${TOLERANCE}x baseline:`)
    for (const r of regressions) {
      console.error(`  ${r.key.replace('\t', '/')}: ` +
        `${r.change.toFixed(2)}x slower ` +
        `(ratio ${r.was.ratio.toFixed(6)} -> ${r.now.ratio.toFixed(6)})`)
    }
    process.exit(1)
  }

  console.log(`no regressions over ${TOLERANCE}x baseline`)
}


const latest = loadLatest()

if (process.argv.includes('--write')) {
  write(latest)
}
else {
  compare(latest)
}
