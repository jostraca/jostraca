import assert from 'node:assert'


// Whether POSIX permission bits mean anything on this platform.
//
// They do not on Windows: `fs.chmod` there only toggles the read-only
// attribute, and `fs.stat` always reports 0o666 (or 0o444 when read-only).
// A `mode` asserted as 0o755 comes back as 0o666, and nothing is wrong —
// there is no execute bit to set.
//
// So the mode ASSERTIONS are skipped on Windows, not the tests. Everything
// around them — the content written, the atomic rename completing, no temp
// file left behind — is platform-independent and still checked. Guard the
// narrowest thing that is actually untestable.
export const POSIX_MODES = 'win32' !== process.platform


type Matcher = RegExp | Error | ((err: unknown) => boolean)

type Asserter = {
  equal: (expected: unknown) => void
  equals: (expected: unknown) => void
  exist: () => void
  include: (expected: unknown) => void
  includes: (expected: unknown) => void
  throws: (matcher?: Matcher) => void
  rejects: (matcher?: Matcher) => Promise<void>
  true: () => void
  false: () => void
}

export function expect(actual: any): Asserter {
  return {
    equal: (expected) => assert.deepStrictEqual(actual, expected),
    equals: (expected) => assert.deepStrictEqual(actual, expected),
    exist: () => assert.ok(actual !== null && actual !== undefined),
    include: (expected) => assert.partialDeepStrictEqual(actual, expected),
    includes: (expected) => assert.partialDeepStrictEqual(actual, expected),
    throws: (matcher) => assert.throws(actual, matcher as any),
    rejects: (matcher) => assert.rejects(actual, matcher as any),
    true: () => assert.strictEqual(actual, true),
    false: () => assert.strictEqual(actual, false),
  }
}
