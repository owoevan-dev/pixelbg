/**
 * The layered runs of encode.ts as numbers: colours in paint order (most frequent first, the
 * first filling the box when nothing is see-through), and per colour, per row, the pixel spans
 * [first, last] it paints. A run may reach across pixels of colours painted after its own.
 */
import { TRANSPARENT } from './quantize'
import type { Indexed } from './quantize'

export type Span = readonly [first: number, last: number]
export type LayeredRuns = {
  order: number[]
  base: number | undefined
  /** runs.get(colour)[y]: that row's spans, or undefined. */
  runs: Map<number, (Span[] | undefined)[]>
}

export function segmentRuns(art: Indexed): LayeredRuns {
  const count = new Array<number>(art.palette.length).fill(0)
  let clear = false

  for (const v of art.px) {
    if (v === TRANSPARENT) {
      clear = true
    } else {
      count[v] = (count[v] ?? 0) + 1
    }
  }
  const order = art.palette
    .map((_, i) => i)
    .filter(i => (count[i] ?? 0) > 0)
    .sort((a, b) => (count[b] ?? 0) - (count[a] ?? 0))
  const rank = new Int16Array(art.palette.length).fill(-1)

  order.forEach((c, i) => {
    rank[c] = i
  })
  const base = clear ? undefined : order[0]
  const runs = new Map<number, (Span[] | undefined)[]>()
  type Open = { c: number; rank: number; first: number; last: number }

  for (let y = 0; y < art.h; y++) {
    const stack: Open[] = []
    const close = (run: Open) => {
      let rows = runs.get(run.c)

      if (rows === undefined) {
        rows = []
        runs.set(run.c, rows)
      }
      const row = rows[y] ?? []
      row.push([run.first, run.last])
      rows[y] = row
    }
    const offset = y * art.w

    for (let x = 0; x < art.w; x++) {
      const v = art.px[offset + x] ?? TRANSPARENT

      if (v === TRANSPARENT) {
        while (stack.length > 0) {
          close(stack.pop() as Open)
        }
        continue
      }
      const r = rank[v] ?? 0

      while (stack.length > 0 && (stack[stack.length - 1] as Open).rank > r) {
        close(stack.pop() as Open)
      }
      if (v === base) {
        continue
      }
      const top = stack[stack.length - 1]

      if (top !== undefined && top.rank === r) {
        top.last = x
      } else {
        stack.push({ c: v, rank: r, first: x, last: x })
      }
    }
    while (stack.length > 0) {
      close(stack.pop() as Open)
    }
  }
  // Runs close out of order (the stack); each row's spans left to right.
  for (const rows of runs.values()) {
    for (const row of rows) {
      row?.sort((a, b) => a[0] - b[0])
    }
  }

  return { order, base, runs }
}
