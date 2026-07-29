#!/usr/bin/env node
// Gate: src/diff.ts must stay at 100% line, branch and function coverage.
//
// The diff engine is the one piece that must be byte-identical to the Go
// port. A branch covered on one side and not the other is exactly how the
// two implementations drifted apart before, so "mostly covered" is not
// good enough here.
'use strict'

const { execFileSync } = require('node:child_process')

const out = execFileSync(process.execPath, [
  '--test',
  '--experimental-test-coverage',
  '--test-reporter=tap',
  'dist-test/diff.test.js',
], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
  // Lets the suite skip its timing test: instrumented timings measure the
  // instrumentation, not the algorithm.
  env: { ...process.env, JOSTRACA_COVERAGE: '1' },
})

// Coverage table row: # diff.js | 100.00 | 100.00 | 100.00 |
const row = out.split('\n').find(l => /^#\s+diff\.js\s*\|/.test(l.trim()))

if (!row) {
  console.error('could not find diff.js in the coverage report')
  process.exit(1)
}

const [line, branch, funcs] = row
  .split('|').slice(1, 4).map(s => parseFloat(s.trim()))

console.log(`diff.ts coverage: line ${line}% branch ${branch}% funcs ${funcs}%`)

if (100 !== line || 100 !== branch || 100 !== funcs) {
  console.error('src/diff.ts must stay at 100% coverage')
  process.exit(1)
}
