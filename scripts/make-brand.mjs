// Draws pixelbg's mark, logo and the README's pipeline, from the grids below alone: no fonts,
// no outside pictures. Everything is one ink on a plain ground, with a dark version for dark mode.
//
//   node scripts/make-brand.mjs          write assets/brand/* and docs/images/pipeline*.svg
//   node scripts/make-brand.mjs --check  only check that the committed pictures match
//
// The mark is a window holding a stepped hill and a low sun, on a 16 x 16 grid, so it stays crisp
// at 16, 32, 128 or 512 pixels. The wordmark uses the same grid: lowercase letters drawn for it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { png, readPng } from './png.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const INK = { light: '#111111', dark: '#ffffff' }
const GROUND = { light: '#ffffff', dark: '#0d1117' }

// ---------------------------------------------------------------------------------------------
// The grids

/** The mark: the 14 x 12 cells inside its 16 x 16 square. */
const MARK = [
  '.############.',
  '#............#',
  '#............#',
  '#........##..#',
  '#........##..#',
  '#............#',
  '#....##......#',
  '#...####.....#',
  '#..######....#',
  '#.##########.#',
  '#............#',
  '.############.',
]

/** Lowercase letters: two rows above the x-height, five rows of it, two below. */
const LETTERS = {
  p: ['....', '....', '###.', '#..#', '#..#', '#..#', '###.', '#...', '#...'],
  i: ['#', '.', '#', '#', '#', '#', '#', '.', '.'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....', '.....'],
  e: ['....', '....', '.##.', '#..#', '####', '#...', '.###', '....', '....'],
  l: ['#', '#', '#', '#', '#', '#', '#', '.', '.'],
  b: ['#...', '#...', '###.', '#..#', '#..#', '#..#', '###.', '....', '....'],
  g: ['....', '....', '.###', '#..#', '#..#', '#..#', '.###', '...#', '###.'],
}

/** A grid of '#' and '.' rows as a list of inked cells. */
function cellsOf(rows, dx = 0, dy = 0) {
  return rows.flatMap((row, y) => [...row].flatMap((c, x) => (c === '#' ? [[x + dx, y + dy]] : [])))
}

/** The wordmark's cells, from column 0, its top row level with the mark's third row. */
function wordmark(word, dx, dy) {
  const cells = []
  let x = dx

  for (const letter of word) {
    const rows = LETTERS[letter]

    cells.push(...cellsOf(rows, x, dy))
    x += rows[0].length + 1
  }

  return { cells, width: x - dx - 1 }
}

const mark = { cells: cellsOf(MARK), w: 14, h: 12 }
const GAP = 3
const word = wordmark('pixelbg', mark.w + GAP, 2)
const logo = { cells: [...mark.cells, ...word.cells], w: mark.w + GAP + word.width, h: 12 }

// ---------------------------------------------------------------------------------------------
// Writing them

/** Cells as SVG: one path, a run of cells per row piece, on a grid one unit per cell. */
function svgOf(shape, ink, pad = 0) {
  const rows = new Map()

  for (const [x, y] of shape.cells) {
    rows.set(y, [...(rows.get(y) ?? []), x])
  }
  let d = ''

  for (const [y, xs] of [...rows].sort((a, b) => a[0] - b[0])) {
    xs.sort((a, b) => a - b)
    for (let i = 0; i < xs.length; ) {
      let j = i

      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) {
        j += 1
      }
      d += `M${xs[i] + pad} ${y + pad}h${j - i + 1}v1h-${j - i + 1}z`
      i = j + 1
    }
  }
  const w = shape.w + 2 * pad
  const h = shape.h + 2 * pad

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 16}" height="${h * 16}" shape-rendering="crispEdges"><path fill="${ink}" d="${d}"/></svg>\n`
}

/** Cells as RGB pixels, `scale` pixels a cell, centred on a `W` x `H` ground. */
function rasterOf(shape, scale, W, H, ink, ground) {
  const hex = c => [1, 3, 5].map(i => Number.parseInt(c.slice(i, i + 2), 16))
  const rgb = new Uint8Array(W * H * 3)
  const [gr, gg, gb] = hex(ground)

  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = gr
    rgb[i * 3 + 1] = gg
    rgb[i * 3 + 2] = gb
  }
  const ox = Math.floor((W - shape.w * scale) / 2)
  const oy = Math.floor((H - shape.h * scale) / 2)
  const colour = hex(ink)

  for (const [x, y] of shape.cells) {
    for (let yy = 0; yy < scale; yy++) {
      for (let xx = 0; xx < scale; xx++) {
        rgb.set(colour, ((oy + y * scale + yy) * W + ox + x * scale + xx) * 3)
      }
    }
  }

  return { w: W, h: H, rgb }
}

/** The README's pipeline: five steps in boxes, the first filled. */
function pipeline(mode) {
  const ink = INK[mode]
  const sub = mode === 'light' ? '#6a6a6a' : '#a3a3a3'
  const steps = [
    ['Shrink', 'with FFmpeg, to fit'],
    ['Clean', 'noise out, edges kept'],
    ['Palette', '24 colours, in OKLab'],
    ['Encode', 'one dashed line per colour'],
    ['Draw', 'behind the Code tab'],
  ]
  let body = ''

  steps.forEach(([title, note], i) => {
    const x = 18 + i * 200
    const filled = i === 0

    body += `<rect x="${x}" y="34" width="164" height="58" rx="9" fill="${filled ? ink : 'none'}" stroke="${ink}" stroke-width="2.5"/>`
    body += `<text x="${x + 82}" y="70" font-size="21" font-weight="600" fill="${filled ? GROUND[mode] : ink}">${title}</text>`
    body += `<text x="${x + 82}" y="120" font-size="15" fill="${sub}">${note}</text>`
    if (i < steps.length - 1) {
      body += `<path d="M${x + 170} 63 L${x + 192} 63 M${x + 185} 56 L${x + 193} 63 L${x + 185} 70" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
    }
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="150" viewBox="0 0 1000 150" role="img" aria-label="${steps.map(s => s[0]).join(', ')}"><g font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif" text-anchor="middle">${body}</g></svg>\n`
}

const check = process.argv.includes('--check')
let stale = 0

/** The same picture? SVGs compare as text, PNGs by their pixels. */
function same(path, data) {
  if (!existsSync(join(root, path))) {
    return false
  }
  if (path.endsWith('.svg')) {
    return readFileSync(join(root, path), 'utf8') === data
  }
  const a = readPng(readFileSync(join(root, path)))
  const b = readPng(data)

  return a.w === b.w && a.h === b.h && Buffer.compare(Buffer.from(a.rgb), Buffer.from(b.rgb)) === 0
}

/** Write a file; with --check, only compare it with the one in the repository. */
function write(path, data) {
  if (check) {
    if (!same(path, data)) {
      console.log(`${path} no longer matches this script`)
      stale += 1
    }

    return
  }
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), data)
  console.log(`wrote ${path}`)
}

for (const mode of ['light', 'dark']) {
  const suffix = mode === 'light' ? '' : '-dark'
  const ink = INK[mode]
  const ground = GROUND[mode]

  write(`assets/brand/mark${suffix}.svg`, svgOf(mark, ink, 1))
  write(`assets/brand/logo${suffix}.svg`, svgOf(logo, ink, 1))
  // The README's logo: ink on the page's own ground, so it sits in the page.
  const { w, h, rgb } = rasterOf(logo, 22, 1200, 12 * 22 + 96, ink, ground)

  write(`assets/brand/logo${suffix}-1200.png`, png(w, h, rgb))
  write(`docs/images/pipeline${suffix}.svg`, pipeline(mode))
}
{
  // The plugin's icon: the mark on white, a cell 26 pixels.
  const { w, h, rgb } = rasterOf(mark, 26, 512, 512, INK.light, GROUND.light)

  write('assets/brand/icon-512.png', png(w, h, rgb))
}
{
  // A card for links to the repository (GitHub's social preview).
  const { w, h, rgb } = rasterOf(logo, 18, 1280, 640, INK.light, GROUND.light)

  write('assets/brand/social-preview.png', png(w, h, rgb))
}
if (check) {
  console.log(stale === 0 ? 'the brand pictures match this script' : `${stale} picture(s) to draw again: node scripts/make-brand.mjs`)
  process.exit(stale === 0 ? 0 : 1)
}
