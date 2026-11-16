/**
 * Light cleaning around the palette: edge-keeping smoothing before it, despeckle after it.
 *
 * Fewer colour changes along a row mean fewer runs to draw, so the same budget holds more
 * pixels. Measured on a tune set and a separate validate set of pictures, the two together
 * gave 3 to 6% more width at the same budget, with colour and edges a little closer to the
 * picture on both sets (docs/design.md).
 */
import type { Decoded } from './media'
import { oklab, TRANSPARENT } from './quantize'
import type { Indexed } from './quantize'

/**
 * Each pixel becomes the mean of those of its 3x3 neighbours whose colour is within `t` of its
 * own (summed over R, G and B): flat areas lose their noise, and edges, which differ by more,
 * stay sharp.
 */
export function smooth(d: Decoded, t = 24): Decoded {
  const { w, h, rgba: s } = d
  const out = new Uint8Array(s.length)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r0 = s[i] ?? 0
      const g0 = s[i + 1] ?? 0
      const b0 = s[i + 2] ?? 0
      let r = 0
      let g = 0
      let b = 0
      let n = 0

      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy

        if (yy < 0 || yy >= h) {
          continue
        }
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx

          if (xx < 0 || xx >= w) {
            continue
          }
          const j = (yy * w + xx) * 4
          const rj = s[j] ?? 0
          const gj = s[j + 1] ?? 0
          const bj = s[j + 2] ?? 0

          if (Math.abs(rj - r0) + Math.abs(gj - g0) + Math.abs(bj - b0) <= t) {
            r += rj
            g += gj
            b += bj
            n += 1
          }
        }
      }
      out[i] = Math.round(r / n)
      out[i + 1] = Math.round(g / n)
      out[i + 2] = Math.round(b / n)
      out[i + 3] = s[i + 3] ?? 255
    }
  }

  return { ...d, rgba: out }
}

/**
 * A pixel whose left and right neighbours share a colour, close to its own (within `t` in
 * OKLab), takes theirs: a one-pixel speck costs two runs and is rarely seen.
 */
export function despeckle(art: Indexed, t = 0.08): Indexed {
  const labs = art.palette.map(c => oklab(c[0], c[1], c[2]))
  const near = (a: number, b: number) => {
    const p = labs[a]
    const q = labs[b]

    return p !== undefined && q !== undefined && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < t
  }
  const px = art.px.slice()

  for (let y = 0; y < art.h; y++) {
    for (let x = 1; x < art.w - 1; x++) {
      const i = y * art.w + x
      const l = art.px[i - 1] ?? TRANSPARENT
      const r = art.px[i + 1] ?? TRANSPARENT
      const v = art.px[i] ?? TRANSPARENT

      if (l === r && v !== l && l !== TRANSPARENT && v !== TRANSPARENT && near(v, l)) {
        px[i] = l
      }
    }
  }

  return { ...art, px }
}
