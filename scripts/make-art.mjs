// Draws the README's example pictures from code alone: an original evening scene, and what
// pixelbg makes of it. Nothing is taken from elsewhere, so every picture here is the project's
// own (MIT, like the code). The mark and logo come from scripts/make-brand.mjs.
//
//   node scripts/make-art.mjs            write docs/images/demo-*.png
//   node scripts/make-art.mjs --check    only check that the committed pictures hold these pixels
//
// The pixel versions come from pixelbg's own pipeline (hooks/build.ts). The one difference from
// the mod: there FFmpeg shrinks the picture, here the mod's own area average does.
import { mkdirSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { png, samePixels } from './png.mjs'

register('./ts-resolve.mjs', import.meta.url)

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { ownPalette, widestFit } = await import('../hooks/build.ts')
const { shrink } = await import('../hooks/resize.ts')

// ---------------------------------------------------------------------------------------------
// The scene: dusk over hills and a lake, with stars, a low sun and pines on the shore.

const mix = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t))
const mixRgb = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
const hash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453

  return s - Math.floor(s)
}
/** Smooth 1-D noise, a few octaves. */
function ridge(x, seed) {
  let v = 0
  let amp = 1
  let f = 1

  for (let o = 0; o < 5; o++) {
    const i = Math.floor(x * f)
    const t = x * f - i
    const s = t * t * (3 - 2 * t)

    v += amp * mix(hash(i, seed), hash(i + 1, seed), s)
    amp *= 0.5
    f *= 2.1
  }

  return v / 1.9375
}

const SKY = [
  [0, [18, 20, 54]],
  [0.35, [52, 38, 96]],
  [0.62, [150, 70, 120]],
  [0.82, [236, 128, 96]],
  [1, [255, 196, 120]],
]

function sky(t) {
  for (let i = 1; i < SKY.length; i++) {
    const [t0, c0] = SKY[i - 1]
    const [t1, c1] = SKY[i]

    if (t <= t1) {
      return mixRgb(c0, c1, (t - t0) / (t1 - t0))
    }
  }

  return SKY[SKY.length - 1][1]
}

/** The scene at pixel (x, y) of a w x h frame. */
function scene(x, y, w, h) {
  const u = x / w
  const v = y / h
  const horizon = 0.64
  const sun = [0.66, 0.4]
  const r = Math.hypot((u - sun[0]) * (w / h), v - sun[1])
  const above = (vv, uu) => {
    let c = sky(vv / horizon)
    const rr = Math.hypot((uu - sun[0]) * (w / h), vv - sun[1])

    c = mixRgb(c, [255, 214, 140], Math.max(0, 0.5 - rr) * 0.9)
    if (rr < 0.085) {
      c = mixRgb([255, 240, 186], [255, 196, 118], rr / 0.085)
    }

    return c
  }

  if (v < horizon) {
    let c = above(v, u)

    // Stars, thinning toward the glow.
    if (hash(x, y) > 0.9975 - v * 0.004 && v < 0.45 && r > 0.2) {
      c = mixRgb(c, [250, 245, 225], 0.85)
    }
    // Three ranges of hills, far to near, each darker and less hazed.
    const ranges = [
      [0.5, 0.1, 3, [110, 70, 120], 0.55],
      [0.56, 0.12, 5, [70, 42, 92], 0.3],
      [0.61, 0.07, 9, [34, 22, 52], 0.08],
    ]

    for (const [base, height, seed, colour, haze] of ranges) {
      const top = base - height * ridge(u * 3 + seed, seed)

      if (v > top) {
        c = mixRgb(colour, sky(v / horizon), haze)
      }
    }
    // Pines on the near shore.
    for (let k = 0; k < 14; k++) {
      const px = hash(k, 7) * 0.4 + (k % 2 ? 0 : 0.6)
      const ph = 0.06 + hash(k, 9) * 0.07
      const half = ph * 0.32 * (1 - (horizon - v) / ph)

      if (v > horizon - ph && Math.abs(u - px) * (w / h) < half) {
        c = [16, 14, 30]
      }
    }

    return c
  }
  // The lake: the sky mirrored, rippled, darker with depth.
  const depth = (v - horizon) / (1 - horizon)
  const ripple = Math.sin(y * 0.9 + Math.sin(x * 0.05) * 2) * 0.004 * (1 + depth * 4)
  const mirrored = above(horizon - (v - horizon) * 0.9, u + ripple)

  return mixRgb(mirrored, [14, 16, 40], 0.25 + depth * 0.55)
}

function draw(w, h) {
  const rgba = new Uint8Array(w * h * 4)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = scene(x, y, w, h)
      rgba.set([Math.round(r), Math.round(g), Math.round(b), 255], (y * w + x) * 4)
    }
  }

  return { w, h, rgba, sourceW: w, sourceH: h }
}

/** Palette pixels as RGB, each pixel `scale` times wider and taller. */
function rgbOf(indexed, scale = 1) {
  const W = indexed.w * scale
  const H = indexed.h * scale
  const out = new Uint8Array(W * H * 3)

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = indexed.palette[indexed.px[Math.floor(y / scale) * indexed.w + Math.floor(x / scale)]] ?? [0, 0, 0]
      out.set(c, (y * W + x) * 3)
    }
  }

  return { w: W, h: H, rgb: out }
}

// ---------------------------------------------------------------------------------------------

const check = process.argv.includes('--check')
const source = draw(1280, 720)
const noPause = async () => {}
const hd = await widestFit(shrink(source, 1200), 24, { fit: 'cover' }, noPause)
const normal = ownPalette(shrink(source, 160), 24)
const chars = svgs => svgs.reduce((n, s) => n + s.length, 0)

if (hd === undefined) {
  throw new Error('the scene did not fit')
}
console.log(`high quality: ${hd.decoded.w}x${hd.decoded.h}, ${hd.indexed.palette.length} colours, ${hd.svgs.length} document(s), ${chars(hd.svgs)} characters`)
console.log(`normal 160: ${normal.w}x${normal.h}, ${normal.palette.length} colours`)

let stale = 0
const out = (path, image) => {
  if (check) {
    if (!samePixels(join(root, path), image)) {
      console.log(`${path} no longer matches this script`)
      stale += 1
    }

    return
  }
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), png(image.w, image.h, image.rgb))
  console.log(`wrote ${path}`)
}
const rgb = new Uint8Array(source.w * source.h * 3)

for (let i = 0; i < source.w * source.h; i++) {
  rgb.set(source.rgba.subarray(i * 4, i * 4 + 3), i * 3)
}
out('docs/images/demo-source.png', { w: source.w, h: source.h, rgb })
out('docs/images/demo-hd.png', rgbOf(hd.indexed))
out('docs/images/demo-normal.png', rgbOf(normal, 8))
if (check) {
  console.log(stale === 0 ? 'the example pictures match this script, pixel for pixel' : `${stale} picture(s) to draw again: node scripts/make-art.mjs`)
  process.exit(stale === 0 ? 0 : 1)
}
