import { expect, test } from 'claude-code/testing'

import { fromBase64 } from '../hooks/base64'
import { despeckle, smooth } from '../hooks/clean'
import { encodeDashLayers } from '../hooks/dash'
import { encodeLayers, encodePreview, encodeStill } from '../hooks/encode'
import { buildPalette, hex, mapPixels, medianCut, oklab, quantize, TRANSPARENT } from '../hooks/quantize'
import type { Indexed, Rgb } from '../hooks/quantize'
import { shrink } from '../hooks/resize'

/**
 * Paint a plain document back into palette numbers, in document order as a browser does: the
 * base rect over its rows, then each colour's runs over whatever came before.
 */
function decodePlain(svg: string, art: Indexed, out = new Uint8Array(art.w * art.h).fill(TRANSPARENT)): Uint8Array {
  const colors = art.palette.map(hex)
  const shapes = /<rect x='0' y='(\d+)' width='\d+' height='(\d+)' fill='(#[0-9a-f]{6})'\/>|<path stroke='(#[0-9a-f]{6})' d='([^']*)'\/>/g

  for (const [, ry, rh, rectColor, pathColor, d] of svg.matchAll(shapes)) {
    if (rectColor !== undefined) {
      out.fill(colors.indexOf(rectColor), Number(ry) * art.w, (Number(ry) + Number(rh)) * art.w)
      continue
    }
    const index = colors.indexOf(pathColor ?? '')
    let end = 0
    let row = 0

    for (const [, op, xs, ys, ns] of (d ?? '').matchAll(/([Mm])(-?\d+) (-?\d+)(?:\.5)?h(\d+)/g)) {
      const x = op === 'M' ? Number(xs) : end + Number(xs)
      row = op === 'M' ? Number(ys) : row
      out.fill(index, row * art.w + x, row * art.w + x + Number(ns))
      end = x + Number(ns)
    }
  }

  return out
}

/**
 * Paint dashed documents back into palette numbers: the base rect, then each colour's dashes
 * along each zigzag block. A dash covers the pixels its stretch of the walk passes over; the
 * steps down between rows cover nothing.
 */
function decodeDash(svgs: readonly string[], w: number, h: number, palette: readonly Rgb[]): Uint8Array {
  const out = new Uint8Array(w * h).fill(TRANSPARENT)
  const colors = palette.map(hex)

  for (const svg of svgs) {
    const blocks = new Map<string, number>()

    for (const [, id, y0] of svg.matchAll(/<path id='(z\d+)' d='M0 (\d+)\.5/g)) {
      blocks.set(id ?? '', Number(y0))
    }
    for (const [, rect, ry, rh, rc, group, gc] of svg.matchAll(/(<rect x='0' y='(\d+)' width='\d+' height='(\d+)' fill='(#[0-9a-f]{6})'\/>)|<g stroke='(#[0-9a-f]{6})'>((?:<use [^>]*\/>)*)<\/g>/g)) {
      if (rect !== undefined) {
        out.fill(colors.indexOf(rc ?? ''), Number(ry) * w, (Number(ry) + Number(rh)) * w)
        continue
      }
      const c = colors.indexOf(group ?? '')

      for (const [, id, dashes] of (gc ?? '').matchAll(/<use href='#(z\d+)' stroke-dasharray='([^']*)'\/>/g)) {
        const y0 = blocks.get(id ?? '') ?? 0
        let at = 0

        ;(dashes ?? '').split(' ').map(Number).forEach((n, k) => {
          if (k % 2 === 0) {
            for (let s = at; s < at + n; s++) {
              const row = Math.floor(s / (w + 1))
              const along = s - row * (w + 1)

              if (along < w && y0 + row < h) {
                out[(y0 + row) * w + (row % 2 === 0 ? along : w - 1 - along)] = c
              }
            }
          }
          at += n
        })
      }
    }
  }

  return out
}

/** A diagonal gradient with a red disc, and a see-through corner unless `opaque`. */
function picture(w: number, h: number, opaque = false): Uint8Array {
  const rgba = new Uint8Array(w * h * 4)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inDisc = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (h / 4) ** 2

      rgba.set([inDisc ? 230 : Math.round((255 * x) / w), inDisc ? 40 : Math.round((255 * y) / h), inDisc ? 40 : 120, !opaque && x < 6 && y < 6 ? 0 : 255], (y * w + x) * 4)
    }
  }

  return rgba
}

/** Palette numbers in runs of one to six, so rows hold both specks and stretches. */
function noise(w: number, h: number, colours: number, seed = 1): Indexed {
  let s = seed
  const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const palette: Rgb[] = Array.from({ length: colours }, (_, i) => [(i * 53) % 256, (i * 97) % 256, (i * 151) % 256])
  const px = new Uint8Array(w * h)
  let v = 0

  for (let i = 0; i < px.length; i++) {
    if (rand() < 0.35) {
      v = Math.floor(rand() * colours)
    }
    px[i] = v
  }

  return { w, h, palette, px }
}

test('a plain document paints back exactly its palette numbers, see-through pixels left out', () => {
  const art = quantize(picture(64, 40), 64, 40, 16)
  const svg = encodeStill(art, { fit: 'cover' })

  expect(art.palette.length).toBeLessThanOrEqual(16)
  expect(art.px[0]).toBe(TRANSPARENT)
  expect([...decodePlain(svg, art)]).toEqual([...art.px])
})

test('an opaque picture gets a base rect, and fewer runs than one per stretch', () => {
  const art = quantize(picture(120, 75, true), 120, 75, 32)
  const svg = encodeStill(art, { fit: 'cover' })
  let stretches = 0

  for (let i = 0; i < art.px.length; i++) {
    if (i % art.w === 0 || art.px[i] !== art.px[i - 1]) {
      stretches += 1
    }
  }

  expect(svg).toContain("<rect x='0' y='0'")
  expect([...decodePlain(svg, art)]).toEqual([...art.px])
  expect((svg.match(/h\d+/g) ?? []).length).toBeLessThan(stretches)
})

test('two plain documents split the rows and stack into exactly the one picture', () => {
  for (const opaque of [false, true]) {
    const art = quantize(picture(96, 60, opaque), 96, 60, 32)
    const whole = encodeStill(art, { fit: 'cover' })
    const limit = Math.ceil(whole.length * 0.6)
    const layers = encodeLayers(art, { fit: 'cover' }, limit) ?? []
    const stacked = new Uint8Array(art.w * art.h).fill(TRANSPARENT)

    expect(layers.length).toBe(2)
    for (const layer of layers) {
      expect(layer.length).toBeLessThanOrEqual(limit)
      decodePlain(layer, art).forEach((v, i) => {
        if (v !== TRANSPARENT) {
          stacked[i] = v
        }
      })
    }
    expect([...stacked]).toEqual([...art.px])
  }
})

test('one plain document when it fits, none when two would not', () => {
  const art = quantize(picture(64, 40), 64, 40, 16)
  const whole = encodeStill(art, { fit: 'cover' })

  expect(encodeLayers(art, { fit: 'cover' }, whole.length)).toEqual([whole])
  expect(encodeLayers(art, { fit: 'cover' }, Math.floor(whole.length / 3))).toBeUndefined()
})

test('dashed documents paint every pixel exactly', () => {
  for (const [w, h, colours] of [
    [37, 23, 6],
    [64, 40, 12],
    [120, 90, 24],
    // Wider than one zigzag block holds rows for: several blocks.
    [1100, 70, 8],
  ] as const) {
    const art = noise(w, h, colours, w)
    const docs = encodeDashLayers(art, { fit: 'cover' }, 1e7, 2)

    expect(docs?.length).toBe(1)
    expect([...decodeDash(docs ?? [], w, h, art.palette)]).toEqual([...art.px])
  }
})

test('two dashed documents split the rows and stay within the size asked for', () => {
  const art = noise(200, 150, 16, 9)
  const whole = encodeDashLayers(art, { fit: 'cover' }, 1e7, 1)?.[0] ?? ''
  const limit = Math.ceil(whole.length * 0.6)
  const docs = encodeDashLayers(art, { fit: 'cover' }, limit, 2) ?? []

  expect(docs.length).toBe(2)
  expect(docs.every(d => d.length <= limit)).toBe(true)
  expect([...decodeDash(docs, 200, 150, art.palette)]).toEqual([...art.px])
})

test('the dashed encoding is smaller than the plain one, and refuses see-through pixels', () => {
  const art = noise(160, 90, 16, 3)
  const plain = encodeStill(art, { fit: 'cover' }).length
  const dashed = (encodeDashLayers(art, { fit: 'cover' }, 1e7, 1)?.[0] ?? '').length

  expect(dashed).toBeLessThan(plain * 0.8)
  expect(encodeDashLayers(quantize(picture(32, 20), 32, 20, 8), { fit: 'cover' }, 1e7, 2)).toBeUndefined()
})

test('the fit reaches the document', () => {
  const art = quantize(picture(32, 20), 32, 20, 8)

  expect(encodeStill(art, { fit: 'cover' })).toContain("preserveAspectRatio='xMidYMid slice'")
  expect(encodeStill(art, { fit: 'contain' })).toContain("preserveAspectRatio='xMidYMid meet'")
})

test('refining the palette in OKLab never shows the picture worse than median cut alone', () => {
  const rgba = picture(120, 75, true)
  const error = (art: Indexed) => {
    const labs = art.palette.map(p => oklab(...p))
    let sum = 0

    for (let i = 0; i < art.px.length; i++) {
      const p = oklab(rgba[i * 4] ?? 0, rgba[i * 4 + 1] ?? 0, rgba[i * 4 + 2] ?? 0)
      const q = labs[art.px[i] ?? 0] ?? p
      sum += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
    }

    return sum / art.px.length
  }

  for (const colors of [4, 8, 16]) {
    expect(error(mapPixels(rgba, 120, 75, buildPalette(rgba, colors)))).toBeLessThanOrEqual(error(mapPixels(rgba, 120, 75, medianCut(rgba, colors))) + 1e-9)
  }
})

test('a picture with few colours keeps them exactly', () => {
  const rgba = new Uint8Array(8 * 4 * 4)

  for (let i = 0; i < 32; i++) {
    rgba.set(i % 3 === 0 ? [255, 0, 0, 255] : i % 3 === 1 ? [0, 255, 0, 255] : [0, 0, 255, 255], i * 4)
  }

  expect(quantize(rgba, 8, 4, 16).palette.map(hex).sort()).toEqual(['#0000ff', '#00ff00', '#ff0000'])
})

test('shrinking averages each covered area, weighting colour by opacity', () => {
  // 4x2: left half opaque red and see-through black, right half opaque blue.
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255])
  const out = shrink({ w: 4, h: 2, rgba, sourceW: 4, sourceH: 2 }, 2)

  expect(out.w).toBe(2)
  expect([...out.rgba.subarray(0, 4)]).toEqual([255, 0, 0, 128])
  expect([...out.rgba.subarray(4, 8)]).toEqual([0, 0, 255, 255])
})

test('smoothing calms noise in flat areas and keeps edges sharp', () => {
  const w = 8
  const h = 3
  const rgba = new Uint8Array(w * h * 4)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Left half grey with a little noise, right half black: one sharp edge.
      const v = x < 4 ? 120 + ((x + y) % 2 === 0 ? 4 : -4) : 0
      rgba.set([v, v, v, 255], (y * w + x) * 4)
    }
  }
  const out = smooth({ w, h, rgba, sourceW: w, sourceH: h }, 24).rgba
  const at = (x: number, y: number) => out[(y * w + x) * 4] ?? -1

  expect(Math.abs(at(1, 1) - at(2, 1))).toBeLessThan(8)
  expect(at(3, 1)).toBeGreaterThan(110)
  expect(at(4, 1)).toBe(0)
})

test('despeckle takes a near colour for a lone pixel, and leaves far ones', () => {
  const palette: Rgb[] = [
    [100, 100, 100],
    [104, 100, 100],
    [255, 0, 0],
  ]
  const art: Indexed = { w: 5, h: 1, palette, px: Uint8Array.from([0, 0, 1, 0, 0]) }

  expect([...despeckle(art).px]).toEqual([0, 0, 0, 0, 0])
  expect([...despeckle({ ...art, px: Uint8Array.from([0, 0, 2, 0, 0]) }).px]).toEqual([0, 0, 2, 0, 0])
  expect([...despeckle({ ...art, px: Uint8Array.from([0, 0, 1, TRANSPARENT, 0]) }).px]).toEqual([0, 0, 1, TRANSPARENT, 0])
})

test('the panel preview stays small and shows the whole picture', () => {
  const art = quantize(picture(400, 250), 400, 250, 64)
  const preview = encodePreview(art, 320, 20000)

  expect(preview.length).toBeLessThanOrEqual(20000)
  expect(preview).toContain("width='320'")
  expect(preview).toContain("preserveAspectRatio='xMidYMid meet'")
})

test('base64 decodes as the runtime does', () => {
  expect([...fromBase64('AAEC/w==')]).toEqual([0, 1, 2, 255])
  expect([...fromBase64('aGk=')]).toEqual([104, 105])
  expect([...fromBase64('')]).toEqual([])
})
