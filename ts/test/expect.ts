import assert from 'node:assert'

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
