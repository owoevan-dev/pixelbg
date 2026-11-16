/**
 * Shrinking RGBA in the mod: each output pixel averages the source pixels its area covers,
 * colour weighted by opacity, so the high-quality search decodes the picture once.
 */
import type { Decoded } from './media'

export function shrink(src: Decoded, w: number): Decoded {
  if (w >= src.w) {
    return src
  }
  const h = Math.max(4, Math.round((w * src.h) / src.w))
  const out = new Uint8Array(w * h * 4)

  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * src.h) / h)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src.h) / h))

    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * src.w) / w)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src.w) / w))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.w + sx) * 4
          const alpha = src.rgba[i + 3] ?? 0
          r += (src.rgba[i] ?? 0) * alpha
          g += (src.rgba[i + 1] ?? 0) * alpha
          b += (src.rgba[i + 2] ?? 0) * alpha
          a += alpha
          n += 1
        }
      }
      const o = (y * w + x) * 4
      out[o] = a === 0 ? 0 : Math.round(r / a)
      out[o + 1] = a === 0 ? 0 : Math.round(g / a)
      out[o + 2] = a === 0 ? 0 : Math.round(b / a)
      out[o + 3] = Math.round(a / n)
    }
  }

  return { w, h, rgba: out, sourceW: src.sourceW, sourceH: src.sourceH }
}
