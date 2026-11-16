import { expect, test } from 'claude-code/testing'

import { checkColors } from '../hooks/make-colors.js'
import type { Indexed, Rgb } from '../hooks/quantize'
import { pictureTheme } from '../hooks/tint'
import { fake, warm } from './harness'

/** A picture of these colours, each covering `n` pixels. */
function art(colours: readonly [Rgb, number][]): Indexed {
  const px: number[] = []

  colours.forEach(([, n], i) => {
    for (let k = 0; k < n; k++) {
      px.push(i)
    }
  })

  return { w: px.length, h: 1, palette: colours.map(([c]) => c), px: Uint8Array.from(px) }
}

const pictures: Record<string, Indexed> = {
  warm: art([
    [[240, 220, 180], 500],
    [[200, 150, 90], 300],
    [[120, 70, 40], 100],
    [[220, 60, 50], 40],
  ]),
  blue: art([
    [[120, 140, 210], 600],
    [[60, 70, 130], 300],
    [[240, 240, 255], 100],
  ]),
  grey: art([
    [[30, 30, 30], 500],
    [[200, 200, 200], 500],
  ]),
  loud: art([
    [[255, 0, 200], 300],
    [[0, 255, 60], 300],
    [[255, 230, 0], 300],
    [[0, 30, 255], 300],
  ]),
}

test('every kind of picture gives colours the desktop will paint', () => {
  for (const [name, picture] of Object.entries(pictures)) {
    const theme = pictureTheme(picture)

    expect({ name, has: theme !== undefined }).toEqual({ name, has: true })
    expect(checkColors(theme).filter(line => line.startsWith("Desktop won't paint"))).toEqual([])
  }
})

test('the surfaces lean to the picture: warm for a warm picture, blue for a blue one', () => {
  const page = (picture: Indexed) => {
    const hex = String((pictureTheme(picture) as unknown as { inputs: { light: Record<string, string> } }).inputs.light['gray-0'])

    return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16))
  }
  const [wr = 0, , wb = 0] = page(pictures.warm as Indexed)
  const [br = 0, , bb = 0] = page(pictures.blue as Indexed)

  expect(wr).toBeGreaterThan(wb)
  expect(bb).toBeGreaterThan(br)
})

test('the theme carries the picture colours with the switch on, and not with it off', async ($, on) => {
  const f = fake($, on)

  f.sources.set('T:/pictures/warm.png', { w: 64, h: 36, draw: warm })
  expect(await f.command('set T:/pictures/warm.png')).toContain('App colours: from the picture')
  expect(f.themes.at(-1)).toContain('"colors"')
  expect(f.themes.at(-1)).toContain('"scene":"pixelbg"')

  const decodes = f.decodes()

  expect(await f.command('tint off')).toContain('App colours: the app’s own')
  expect(f.themes.at(-1)).not.toContain('"colors"')
  expect(f.themes.at(-1)).toContain('"scene":"pixelbg"')
  // The colours were made with the picture: switching needs no new conversion.
  expect(await f.command('tint on')).toContain('App colours: from the picture')
  expect(f.decodes()).toBe(decodes)
})
