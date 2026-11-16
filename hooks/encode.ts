/**
 * Palette pixels -> SVG documents sized for a desktop backdrop: the plain encoding.
 *
 * Colours are painted in the order of runs.ts, most frequent first. The first fills the box with
 * one rect when no pixel is see-through; every later colour is a stroked path of its runs, one
 * unit tall, with relative moves along a row (`M3 7.5h5m4 0h2`). See-through pixels are never
 * painted. dash.ts writes the same runs about a third smaller but must paint every pixel, so this
 * encoding serves pictures with see-through pixels, and the small previews in the panel.
 */
import { hex, TRANSPARENT } from './quantize'
import type { Indexed } from './quantize'
import { segmentRuns } from './runs'
import type { LayeredRuns } from './runs'

export type Fit = 'cover' | 'contain'
export type StillOptions = { fit: Fit }

/** Below the desktop's 131,072 characters per Svg, with room to spare. */
export const MAX_SVG_CHARS = 125000
/** A backdrop may hold 262,144 characters in all: two documents. */
export const MAX_LAYERS = 2

/**
 * The head every picture document shares: the picture's own grid as the view box, scaled to cover
 * the window (cropping) or to fit inside it, crisp pixel edges, strokes one unit wide.
 */
export function docHead(w: number, h: number, fit: Fit): string {
  const aspect = fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'

  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' preserveAspectRatio='${aspect}' shape-rendering='crispEdges' fill='none' stroke-width='1'>`
}

/** The runs as path text: per row, each colour's moves and lines for that row. */
type Prepared = { art: Indexed; order: number[]; base: number | undefined; rows: Map<number, string>[] }

function prepare(art: Indexed): Prepared {
  const { order, base, runs }: LayeredRuns = segmentRuns(art)
  const rows = Array.from({ length: art.h }, () => new Map<number, string>())

  for (const [c, perRow] of runs) {
    perRow.forEach((spans, y) => {
      let d = ''
      let end: number | undefined

      for (const [first, last] of spans ?? []) {
        const n = last - first + 1
        d += end === undefined ? `M${first} ${y}.5h${n}` : `m${first - end} 0h${n}`
        end = first + n
      }
      if (d !== '') {
        rows[y]?.set(c, d)
      }
    })
  }

  return { art, order, base, rows }
}

/** Rows y0..y1 as a document with the whole picture's view box, so documents stack. */
function rowsDoc(p: Prepared, options: StillOptions, y0: number, y1: number): string {
  const { art, order, base, rows } = p
  const colour = (c: number) => hex(art.palette[c] ?? [0, 0, 0])
  // The base covers this document's rows alone, so a document of other rows stays see-through.
  const fill = base === undefined || y1 <= y0 ? '' : `<rect x='0' y='${y0}' width='${art.w}' height='${y1 - y0}' fill='${colour(base)}'/>`
  let body = ''

  for (const c of order) {
    let d = ''

    for (let y = y0; y < y1; y++) {
      d += rows[y]?.get(c) ?? ''
    }
    if (c !== base && d !== '') {
      body += `<path stroke='${colour(c)}' d='${d}'/>`
    }
  }

  return `${docHead(art.w, art.h, options.fit)}${fill}${body}</svg>`
}

export function encodeStill(art: Indexed, options: StillOptions): string {
  return rowsDoc(prepare(art), options, 0, art.h)
}

/**
 * The picture as one document, or as two (top rows and bottom rows) when one would pass
 * `maxPerLayer`; undefined when even two would. Stacked, they line up into the one picture.
 */
export function encodeLayers(art: Indexed, options: StillOptions, maxPerLayer = MAX_SVG_CHARS): string[] | undefined {
  const prepared = prepare(art)
  const whole = rowsDoc(prepared, options, 0, art.h)

  if (whole.length <= maxPerLayer) {
    return [whole]
  }
  if (whole.length > maxPerLayer * MAX_LAYERS) {
    return undefined
  }
  // Cut where each half's path text is closest to equal.
  const cost = prepared.rows.map(row => [...row.values()].reduce((n, d) => n + d.length, 0))
  const total = cost.reduce((a, b) => a + b, 0)
  let cut = 0

  for (let sum = 0; cut < art.h && sum + (cost[cut] ?? 0) <= total / 2; cut++) {
    sum += cost[cut] ?? 0
  }
  const first = rowsDoc(prepared, options, 0, cut)
  const second = rowsDoc(prepared, options, cut, art.h)

  return first.length <= maxPerLayer && second.length <= maxPerLayer ? [first, second] : undefined
}

/** The picture's pixels sampled down to fit a `box` x `box` square: the nearest source pixel, palette kept. */
function sample(art: Indexed, box: number): Indexed {
  const scale = Math.min(1, box / art.w, box / art.h)

  if (scale >= 1) {
    return art
  }
  const w = Math.max(1, Math.round(art.w * scale))
  const h = Math.max(1, Math.round(art.h * scale))
  const px = new Uint8Array(w * h)

  for (let y = 0; y < h; y++) {
    const sy = Math.min(art.h - 1, Math.floor(((y + 0.5) * art.h) / h))

    for (let x = 0; x < w; x++) {
      px[y * w + x] = art.px[sy * art.w + Math.min(art.w - 1, Math.floor(((x + 0.5) * art.w) / w))] ?? TRANSPARENT
    }
  }

  return { w, h, palette: art.palette, px }
}

/** The grids a preview tries, finest first; the last is small enough for any picture. */
const PREVIEW_GRIDS = [160, 120, 96, 64, 48, 32, 24, 16, 12, 8]

/**
 * A small copy for the side panel: the whole picture (`meet`), shown within a `box` x `box`
 * square, its grid coarser until the copy weighs at most `maxChars`; empty if none does.
 */
export function encodePreview(art: Indexed, box = 320, maxChars = 50000): string {
  for (const grid of PREVIEW_GRIDS) {
    const small = sample(art, grid)
    const scale = Math.min(box / small.w, box / small.h)
    const doc = rowsDoc(prepare(small), { fit: 'contain' }, 0, small.h).replace(
      '<svg ',
      `<svg width='${Math.max(1, Math.round(small.w * scale))}' height='${Math.max(1, Math.round(small.h * scale))}' `,
    )

    if (doc.length <= maxChars) {
      return doc
    }
  }

  return ''
}
