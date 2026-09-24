/* Copyright (c) 2024 Richard Rodger, MIT License */

// Text that has to survive templating BYTE FOR BYTE.
//
// A Fragment source, a text Copy source and an Inject target are read as
// text, and a file saved in Latin-1 is not valid UTF-8. Decoding it as
// UTF-8 replaced every invalid byte with U+FFFD, so the output lost the
// user's bytes; Go reads the same files as byte strings and keeps them.
//
// `decodeText` maps each byte that is not part of a valid UTF-8 sequence to
// the lone surrogate U+DC80..U+DCFF, the escape PEP 383 uses. Nothing a
// template matches is a lone surrogate, and a regex `.` takes one as one
// character, as Go's regexp takes an invalid byte. `encodeText` maps those
// surrogates back to their bytes and UTF-8 encodes everything else. Valid
// UTF-8 decodes and encodes exactly as Buffer's own utf8 codec does.

import { isUtf8 } from 'node:buffer'


const ESCAPED = /(?<![\uD800-\uDBFF])[\uDC80-\uDCFF]/g


// Whether `raw` held bytes that are not valid UTF-8, and so decoded to
// escapes that only `encodeText` writes back.
type Decoded = { text: string, escaped: boolean }


function decodeText(raw: Buffer | string): Decoded {
  // A provider may hand back a string; it has been decoded already.
  if ('string' === typeof raw) {
    return { text: raw, escaped: false }
  }

  if (isUtf8(raw)) {
    return { text: raw.toString('utf8'), escaped: false }
  }

  const parts: string[] = []
  const n = raw.length
  let run = 0
  let i = 0

  const flush = (end: number) => {
    if (run < end) {
      parts.push(raw.toString('utf8', run, end))
    }
  }

  while (i < n) {
    const b = raw[i]
    const width = seqWidth(raw, i)

    if (0 < width) {
      i += width
      continue
    }

    flush(i)
    parts.push(String.fromCharCode(0xDC00 + b))
    i++
    run = i
  }
  flush(n)

  return { text: parts.join(''), escaped: true }
}


// The length of the valid UTF-8 sequence starting at `i`, or 0. Strict, as
// isUtf8 is: no overlong forms, no surrogates, nothing above U+10FFFF. A
// surrogate spelled in three bytes must not decode, since encodeText would
// write the lone surrogate back as one raw byte, not as those three.
function seqWidth(raw: Buffer, i: number): number {
  const b = raw[i]
  if (b < 0x80) {
    return 1
  }

  let need = 0
  let lo = 0x80
  let hi = 0xBF

  if (0xC2 <= b && b <= 0xDF) {
    need = 1
  }
  else if (0xE0 <= b && b <= 0xEF) {
    need = 2
    lo = 0xE0 === b ? 0xA0 : 0x80
    hi = 0xED === b ? 0x9F : 0xBF
  }
  else if (0xF0 <= b && b <= 0xF4) {
    need = 3
    lo = 0xF0 === b ? 0x90 : 0x80
    hi = 0xF4 === b ? 0x8F : 0xBF
  }
  else {
    return 0
  }

  if (raw.length <= i + need) {
    return 0
  }

  const b1 = raw[i + 1]
  if (b1 < lo || hi < b1) {
    return 0
  }
  for (let k = 2; k <= need; k++) {
    const bk = raw[i + k]
    if (bk < 0x80 || 0xBF < bk) {
      return 0
    }
  }

  return need + 1
}


function encodeText(text: string): Buffer {
  ESCAPED.lastIndex = 0
  if (!ESCAPED.test(text)) {
    return Buffer.from(text, 'utf8')
  }

  const parts: Buffer[] = []
  let last = 0
  ESCAPED.lastIndex = 0
  for (const m of text.matchAll(ESCAPED)) {
    const at = m.index as number
    parts.push(Buffer.from(text.substring(last, at), 'utf8'))
    parts.push(Buffer.from([m[0].charCodeAt(0) - 0xDC00]))
    last = at + 1
  }
  parts.push(Buffer.from(text.substring(last), 'utf8'))

  return Buffer.concat(parts)
}


// A node that spliced escaped text into `target` passes the mark on, so
// whichever node finally writes the text encodes it with encodeText.
function escapedInto(node: { meta: any }, target: { meta?: any }) {
  if (node.meta?.escaped && null != target) {
    target.meta = target.meta || {}
    target.meta.escaped = true
  }
}


export type {
  Decoded
}

export {
  decodeText,
  encodeText,
  escapedInto,
}
