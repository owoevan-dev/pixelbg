/**
 * Palette pixels -> SVG documents, each colour one dashed stroke along a zigzag.
 *
 * The same layered runs as encode.ts (colours painted most frequent first, a run reaching across
 * pixels of colours painted after its own), written differently: one path walks every row in
 * turn, left to right then right to left, a unit down between rows (the zigzag, written once).
 * Each colour draws that path with `stroke-dasharray` set to its runs along it: dash, gap, dash,
 * gap. A run costs two numbers, and nothing at all is spent on finding the start of a row.
 *
 * A dash pattern starts over at each subpath, which is why the walk is one unbroken line; the
 * steps down between rows fall in gaps, except where a colour holds both ends, and there drawing
 * them only covers that colour's own pixels again.
 */
import { segmentRuns } from './runs'
import { hex, TRANSPARENT } from './quantize'
import type { Indexed } from './quantize'
import { docHead } from './encode'
import type { StillOptions } from './encode'

/** The zigzag through rows y0..y1, in path data. */
function zigzag(w: number, y0: number, y1: number): string {
  let d = `M0 ${y0}.5`

  for (let y = y0; y < y1; y++) {
    d += (y - y0) % 2 === 0 ? `h${w}` : `h-${w}`
    if (y < y1 - 1) {
      d += 'v1'
    }
  }

  return d
}

/**
 * A colour's dash pattern along the zigzag through rows y0..y1, from its runs: per row, the
 * pixel spans [first, last] it paints. Undefined when it paints nothing there.
 */
function pattern(w: number, y0: number, y1: number, runs: readonly (readonly (readonly [number, number])[] | undefined)[]): string | undefined {
  // Marks along the walk as [start, end) spans; the step after row y is at y*(w+1)+w.
  const spans: [number, number][] = []
  const edge: boolean[] = []

  for (let y = y0; y < y1; y++) {
    const i = y - y0
    const at = i * (w + 1)
    const row = runs[y] ?? []
    const forward = i % 2 === 0
    const mapped = row.map(([a, b]): [number, number] => (forward ? [at + a, at + b + 1] : [at + w - 1 - b, at + w - a]))

    if (!forward) {
      mapped.reverse()
    }
    spans.push(...mapped)
    // Whether this row's run reaches the side the walk leaves it by.
    edge.push(row.some(([a, b]) => (forward ? b === w - 1 : a === 0)))
  }
  if (spans.length === 0) {
    return undefined
  }
  // Bridge a step down where the runs on both sides of it reach it.
  for (let k = 0; k < spans.length - 1; k++) {
    const cur = spans[k] as [number, number]
    const next = spans[k + 1] as [number, number]

    if (next[0] === cur[1] + 1) {
      const i = Math.floor(cur[1] / (w + 1))
      const leaves = (cur[1] - i * (w + 1)) === w
      const enters = next[0] === (i + 1) * (w + 1)

      if (leaves && enters && edge[i] === true) {
        next[0] = cur[0]
        spans.splice(k, 1)
        k -= 1
      }
    }
  }
  const out: number[] = []
  let cursor = 0

  for (const [s, e] of spans) {
    if (out.length === 0) {
      if (s > 0) {
        out.push(0, s)
      }
    } else {
      out.push(s - cursor)
    }
    out.push(e - s)
    cursor = e
  }
  // A gap past the end, so the pattern never starts over within the walk.
  out.push((y1 - y0) * (w + 1))

  return out.join(' ')
}

/**
 * Rows per zigzag. A dash pattern's positions are summed in floats along the path, so a very
 * long one drifts by a fraction of a unit near its end; walks of about 60,000 units stay exact.
 */
export function blockRows(w: number): number {
  return Math.max(8, Math.floor(60000 / (w + 1)))
}

type RowSpans = (readonly (readonly [number, number])[] | undefined)[]

/** The zigzag blocks through rows y0..y1. */
function blocksOf(w: number, y0: number, y1: number): [number, number][] {
  const step = blockRows(w)
  const blocks: [number, number][] = []

  for (let b = y0; b < y1; b += step) {
    blocks.push([b, Math.min(y1, b + step)])
  }

  return blocks
}

/** The zigzag paths for these blocks, for a document's defs: `#z0`, `#z1`… */
function zigzagDefs(w: number, blocks: readonly [number, number][]): string {
  return blocks.map(([b0, b1], k) => `<path id='z${k}' d='${zigzag(w, b0, b1)}'/>`).join('')
}

/** Each colour, in `order`, as a group of dashed uses of the blocks' zigzags. */
function dashedColours(w: number, blocks: readonly [number, number][], order: readonly number[], runs: Map<number, RowSpans>, colour: (c: number) => string): string {
  let body = ''

  for (const c of order) {
    let uses = ''

    blocks.forEach(([b0, b1], k) => {
      const p = pattern(w, b0, b1, runs.get(c) ?? [])

      if (p !== undefined) {
        uses += `<use href='#z${k}' stroke-dasharray='${p}'/>`
      }
    })
    if (uses !== '') {
      body += `<g stroke='${colour(c)}'>${uses}</g>`
    }
  }

  return body
}

function dashDoc(art: Indexed, order: readonly number[], base: number | undefined, runs: Map<number, RowSpans>, options: StillOptions, y0: number, y1: number): string {
  const fill = base === undefined || y1 <= y0 ? '' : `<rect x='0' y='${y0}' width='${art.w}' height='${y1 - y0}' fill='${hex(art.palette[base] ?? [0, 0, 0])}'/>`
  const blocks = blocksOf(art.w, y0, y1)
  const body = dashedColours(art.w, blocks, order.filter(c => c !== base), runs, c => hex(art.palette[c] ?? [0, 0, 0]))
  // A picture of one colour is its rect alone: the zigzags are written only when something uses them.
  const defs = body === '' ? '' : `<defs>${zigzagDefs(art.w, blocks)}</defs>`

  return `${docHead(art.w, art.h, options.fit)}${defs}${fill}${body}</svg>`
}

/**
 * The picture as one or two dashed documents (top rows, bottom rows), each within
 * `maxPerLayer`; undefined when two would not do. Stacked, they line up into the picture.
 */
export function encodeDashLayers(art: Indexed, options: StillOptions, maxPerLayer: number, maxLayers = 2): string[] | undefined {
  if (art.px.includes(TRANSPARENT)) {
    return undefined
  }
  const { order, base, runs } = segmentRuns(art)
  const whole = dashDoc(art, order, base, runs, options, 0, art.h)

  if (whole.length <= maxPerLayer) {
    return [whole]
  }
  if (maxLayers < 2 || whole.length > maxPerLayer * 2) {
    return undefined
  }
  // Cut where the halves weigh about the same: count runs per row.
  const weight = new Array<number>(art.h).fill(0)

  for (const rows of runs.values()) {
    rows.forEach((row, y) => {
      weight[y] = (weight[y] ?? 0) + (row?.length ?? 0)
    })
  }
  const total = weight.reduce((a, b) => a + b, 0)
  let cut = 0

  for (let sum = 0; cut < art.h && sum + (weight[cut] ?? 0) <= total / 2; cut++) {
    sum += weight[cut] ?? 0
  }
  for (const shift of [0, -8, 8, -24, 24, -60, 60]) {
    const at = Math.min(art.h - 1, Math.max(1, cut + shift))
    const first = dashDoc(art, order, base, runs, options, 0, at)
    const second = dashDoc(art, order, base, runs, options, at, art.h)

    if (first.length <= maxPerLayer && second.length <= maxPerLayer) {
      return [first, second]
    }
  }

  return undefined
}
