// A small PNG writer and reader for the scripts that draw this repository's pictures: RGB, 8 bits
// a channel, no metadata chunks (scripts/check.mjs refuses those). The reader lets `--check`
// compare a committed picture's pixels with what its script draws now.
import { readFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n

  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }

  return c >>> 0
})

function crc32(bytes) {
  let c = 0xffffffff

  for (const b of bytes) {
    c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  }

  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)

  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)

  return out
}

/** RGB pixels (3 bytes each, row by row) as the bytes of a PNG file. */
export function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h)

  for (let y = 0; y < h; y++) {
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1)
  }
  const head = Buffer.alloc(13)

  head.writeUInt32BE(w, 0)
  head.writeUInt32BE(h, 4)
  head[8] = 8
  head[9] = 2

  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** The pixels of an 8-bit RGB PNG file, as `png` writes it (any row filter is read). */
export function readPng(bytes) {
  let at = 8
  let w = 0
  let h = 0
  const data = []

  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('latin1', at + 4, at + 8)

    if (type === 'IHDR') {
      w = bytes.readUInt32BE(at + 8)
      h = bytes.readUInt32BE(at + 12)
      if (bytes[at + 16] !== 8 || bytes[at + 17] !== 2) {
        throw new Error('only 8-bit RGB PNG files are read')
      }
    } else if (type === 'IDAT') {
      data.push(bytes.subarray(at + 8, at + 8 + length))
    }
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(data))
  const stride = w * 3
  const rgb = new Uint8Array(stride * h)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)

    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }

  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]

    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]
      const a = x >= 3 ? rgb[y * stride + x - 3] : 0
      const b = y > 0 ? rgb[(y - 1) * stride + x] : 0
      const c = x >= 3 && y > 0 ? rgb[(y - 1) * stride + x - 3] : 0
      const add = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter] ?? 0

      rgb[y * stride + x] = (v + add) & 255
    }
  }

  return { w, h, rgb }
}

/** Does the PNG file at `path` hold exactly these pixels? */
export function samePixels(path, image) {
  try {
    const found = readPng(readFileSync(path))

    return found.w === image.w && found.h === image.h && Buffer.compare(Buffer.from(found.rgb), Buffer.from(image.rgb.buffer, image.rgb.byteOffset, image.rgb.length)) === 0
  } catch {
    return false
  }
}
