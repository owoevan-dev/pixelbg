/** Base64 to bytes, using the runtime's own decoder where it has one. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LOOKUP = new Int16Array(128).fill(-1)

for (let i = 0; i < ALPHABET.length; i++) {
  LOOKUP[ALPHABET.charCodeAt(i)] = i
}

type WithFromBase64 = { fromBase64?: (s: string) => Uint8Array }

export function fromBase64(text: string): Uint8Array {
  const native = (Uint8Array as unknown as WithFromBase64).fromBase64

  if (typeof native === 'function') {
    return native(text)
  }
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0

  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)] ?? 0
    const b = LOOKUP[clean.charCodeAt(i + 1)] ?? 0
    const c = i + 2 < clean.length ? (LOOKUP[clean.charCodeAt(i + 2)] ?? 0) : -1
    const d = i + 3 < clean.length ? (LOOKUP[clean.charCodeAt(i + 3)] ?? 0) : -1
    out[o++] = (a << 2) | (b >> 4)
    if (c >= 0) {
      out[o++] = ((b & 15) << 4) | (c >> 2)
    }
    if (d >= 0) {
      out[o++] = ((c & 3) << 6) | d
    }
  }

  return out.subarray(0, o)
}
