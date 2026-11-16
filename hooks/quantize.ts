/**
 * RGBA pixels -> a small palette and one palette index per pixel.
 *
 * Median cut makes a first palette (each box split at the median of its widest channel), k-means
 * in OKLab refines it, and every pixel takes its nearest palette colour in OKLab. Pixels under
 * half opacity become TRANSPARENT and are left out, so the app's background shows through them.
 */

export const TRANSPARENT = 255

export type Rgb = readonly [number, number, number]
export type Indexed = { w: number; h: number; palette: Rgb[]; px: Uint8Array }

const SAMPLE = 60000

/**
 * About `count` of the opaque pixels, picked at pseudo-random places among them (the same places
 * every time, so a picture always gives the same palette). Any fixed step could fall in step with
 * a regular pattern in the picture (stripes, a checkerboard) and see only one of its colours.
 */
function opaqueSample(rgba: Uint8Array, count: number): Rgb[] {
  const n = Math.floor(rgba.length / 4)
  const opaque: number[] = []

  for (let i = 0; i < n; i++) {
    if ((rgba[i * 4 + 3] ?? 0) >= 128) {
      opaque.push(i)
    }
  }
  const take = (i: number): Rgb => [rgba[i * 4] ?? 0, rgba[i * 4 + 1] ?? 0, rgba[i * 4 + 2] ?? 0]

  if (opaque.length <= count) {
    return opaque.map(take)
  }
  let seed = 0x2545f491
  const sample: Rgb[] = []

  for (let k = 0; k < count; k++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    sample.push(take(opaque[seed % opaque.length] ?? 0))
  }

  return sample
}

export function medianCut(rgba: Uint8Array, colors: number): Rgb[] {
  const sample = opaqueSample(rgba, SAMPLE)

  if (sample.length === 0) {
    return []
  }
  // Each box keeps its widest channel and score, worked out once when the box is made.
  type Box = { pixels: Rgb[]; channel: number; score: number }
  const boxOf = (pixels: Rgb[]): Box => {
    const lo = [255, 255, 255]
    const hi = [0, 0, 0]

    for (const p of pixels) {
      for (let c = 0; c < 3; c++) {
        const v = p[c] ?? 0

        if (v < (lo[c] ?? 255)) {
          lo[c] = v
        }
        if (v > (hi[c] ?? 0)) {
          hi[c] = v
        }
      }
    }
    const ranges = [0, 1, 2].map(c => (hi[c] ?? 0) - (lo[c] ?? 0))
    const channel = ranges.indexOf(Math.max(...ranges))

    // Wide boxes with many pixels split first.
    return { pixels, channel, score: pixels.length > 1 ? (ranges[channel] ?? 0) * Math.sqrt(pixels.length) : 0 }
  }
  const boxes: Box[] = [boxOf(sample)]

  while (boxes.length < colors) {
    let pick = -1
    let best = 0

    boxes.forEach((box, i) => {
      if (box.score > best) {
        best = box.score
        pick = i
      }
    })
    if (pick < 0) {
      break
    }
    const channel = boxes[pick]?.channel ?? 0
    const box = (boxes[pick]?.pixels ?? []).slice().sort((p, q) => (p[channel] ?? 0) - (q[channel] ?? 0))
    const at = (i: number) => box[i]?.[channel] ?? 0
    // Split where the value changes nearest the median, so one colour never lands in two boxes.
    let cut = box.length >> 1

    while (cut < box.length && at(cut) === at(cut - 1)) {
      cut += 1
    }
    if (cut === box.length) {
      cut = box.length >> 1
      while (cut > 0 && at(cut) === at(cut - 1)) {
        cut -= 1
      }
    }
    boxes.splice(pick, 1, boxOf(box.slice(0, cut)), boxOf(box.slice(cut)))
  }
  const seen = new Set<string>()

  return boxes
    .map(({ pixels }) => {
      let r = 0
      let g = 0
      let b = 0

      for (const p of pixels) {
        r += p[0]
        g += p[1]
        b += p[2]
      }

      return [Math.round(r / pixels.length), Math.round(g / pixels.length), Math.round(b / pixels.length)] as const
    })
    .filter(p => {
      const key = p.join(',')

      return seen.has(key) ? false : (seen.add(key), true)
    })
}

// ---------------------------------------------------------------------------------------
// OKLab: a colour space where distance follows what the eye sees (Björn Ottosson's
// published conversion). Palettes are refined and pixels matched in it.

type Lab = [number, number, number]

const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

export function oklab(r: number, g: number, b: number): Lab {
  const R = LINEAR[r] ?? 0
  const G = LINEAR[g] ?? 0
  const B = LINEAR[b] ?? 0
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)

  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

function d2(p: Lab, q: Lab): number {
  return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2
}

const KMEANS_SAMPLE = 40000
const KMEANS_ROUNDS = 5

/**
 * The palette: median cut gives a first guess, then a few rounds of k-means in OKLab move each
 * colour to the middle of the pixels nearest it, so the small areas the eye cares about (skin,
 * eyes) get colours of their own instead of the nearest large area's.
 */
export function buildPalette(rgba: Uint8Array, colors: number): Rgb[] {
  const seed = medianCut(rgba, Math.max(2, Math.min(64, colors)))
  const rgb = opaqueSample(rgba, KMEANS_SAMPLE)
  const lab = rgb.map(p => oklab(...p))

  if (seed.length === 0 || rgb.length === 0) {
    return seed
  }
  let centers = seed.map(p => oklab(...p))
  let palette: Rgb[] = seed

  for (let round = 0; round < KMEANS_ROUNDS; round++) {
    const sums = centers.map(() => [0, 0, 0, 0, 0, 0, 0])

    lab.forEach((p, i) => {
      let best = 0
      let bestD = Infinity

      for (let k = 0; k < centers.length; k++) {
        const d = d2(p, centers[k] ?? p)

        if (d < bestD) {
          bestD = d
          best = k
        }
      }
      const s = sums[best]
      const q = rgb[i]

      if (s !== undefined && q !== undefined) {
        s[0] = (s[0] ?? 0) + p[0]
        s[1] = (s[1] ?? 0) + p[1]
        s[2] = (s[2] ?? 0) + p[2]
        s[3] = (s[3] ?? 0) + q[0]
        s[4] = (s[4] ?? 0) + q[1]
        s[5] = (s[5] ?? 0) + q[2]
        s[6] = (s[6] ?? 0) + 1
      }
    })
    centers = sums.map((s, k) => ((s[6] ?? 0) > 0 ? [(s[0] ?? 0) / (s[6] ?? 1), (s[1] ?? 0) / (s[6] ?? 1), (s[2] ?? 0) / (s[6] ?? 1)] : (centers[k] ?? [0, 0, 0])))
    palette = sums.map((s, k) =>
      (s[6] ?? 0) > 0 ? ([Math.round((s[3] ?? 0) / (s[6] ?? 1)), Math.round((s[4] ?? 0) / (s[6] ?? 1)), Math.round((s[5] ?? 0) / (s[6] ?? 1))] as const) : (palette[k] ?? [0, 0, 0]),
    )
  }
  const seen = new Set<string>()

  return palette.filter(p => {
    const key = p.join(',')

    return seen.has(key) ? false : (seen.add(key), true)
  })
}

/** Every pixel's nearest palette colour in OKLab, remembered at 6 bits a channel. */
export function mapPixels(rgba: Uint8Array, w: number, h: number, palette: Rgb[]): Indexed {
  const px = new Uint8Array(w * h).fill(TRANSPARENT)
  const labs = palette.map(p => oklab(...p))
  const memo = new Map<number, number>()

  for (let i = 0; i < w * h; i++) {
    if ((rgba[i * 4 + 3] ?? 0) < 128 || palette.length === 0) {
      continue
    }
    const r = rgba[i * 4] ?? 0
    const g = rgba[i * 4 + 1] ?? 0
    const b = rgba[i * 4 + 2] ?? 0
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2)
    let index = memo.get(key)

    if (index === undefined) {
      const p = oklab(r, g, b)
      let best = Infinity

      index = 0
      for (let k = 0; k < labs.length; k++) {
        const d = d2(p, labs[k] ?? p)

        if (d < best) {
          best = d
          index = k
        }
      }
      memo.set(key, index)
    }
    px[i] = index
  }

  return { w, h, palette, px }
}

export function quantize(rgba: Uint8Array, w: number, h: number, colors: number): Indexed {
  return mapPixels(rgba, w, h, buildPalette(rgba, colors))
}

export function hex(p: Rgb): string {
  return `#${p.map(c => c.toString(16).padStart(2, '0')).join('')}`
}
