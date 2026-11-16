/**
 * The app's colours from the picture: a look (makeColors) whose surfaces carry the picture's main
 * hue, faintly, and whose accents are the picture's own vivid colours.
 *
 * Surfaces are flat colours, darkest first in dark mode and lightest last in light mode, so only
 * the hue and a little chroma come from the picture; their lightness stays where text reads well.
 * Desktop ignores a whole theme it would not paint, so a theme that fails is tried again greyer,
 * and none is given when even that fails.
 */
import type { ThemeColors } from 'claude-code'

import { makeColors } from './make-colors.js'
import { oklab, TRANSPARENT } from './quantize'
import type { Indexed, Rgb } from './quantize'

type Lch = { l: number; c: number; h: number }

function lch(c: Rgb): Lch {
  const [l, a, b] = oklab(c[0], c[1], c[2])

  return { l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
}

const toByte = (v: number) => {
  const x = Math.min(1, Math.max(0, v))

  return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055))
}

/** OKLCH to hex, chroma lowered until the colour fits in sRGB. */
export function hexOf(l: number, c: number, h: number): string {
  for (let chroma = c; ; chroma *= 0.85) {
    const a = chroma * Math.cos((h * Math.PI) / 180)
    const b = chroma * Math.sin((h * Math.PI) / 180)
    const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
    const rgb = [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S]

    if (rgb.every(v => v >= -0.001 && v <= 1.001) || chroma < 0.002) {
      return `#${rgb.map(v => toByte(v).toString(16).padStart(2, '0')).join('')}`
    }
  }
}

const hexRgb = (c: Rgb) => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

/** Hue degrees (OKLab) of each role's usual colour, and the app-like colour used when the picture has none near it. */
const ROLE_HUES = { danger: [27, '#d4483b'], success: [145, '#3f9a5a'], warning: [75, '#c8901e'], pro: [305, '#8a5cc8'] } as const

export function pictureTheme(art: Indexed): ThemeColors | undefined {
  const count = new Array<number>(art.palette.length).fill(0)

  for (const v of art.px) {
    if (v !== TRANSPARENT) {
      count[v] = (count[v] ?? 0) + 1
    }
  }
  const colours = art.palette.map((c, i) => ({ rgb: c, n: count[i] ?? 0, ...lch(c) })).filter(c => c.n > 0)

  if (colours.length === 0) {
    return undefined
  }
  // The main hue: the busiest bin of a hue histogram, each colour weighed by how much of the
  // picture it covers and how coloured it is (greys say nothing about hue).
  const bins = new Array<number>(36).fill(0)

  for (const c of colours) {
    bins[Math.floor(c.h / 10) % 36] = (bins[Math.floor(c.h / 10) % 36] ?? 0) + c.n * Math.min(c.c, 0.12)
  }
  const peak = bins.indexOf(Math.max(...bins))
  const inPeak = colours.filter(c => hueGap(c.h, peak * 10 + 5) <= 15 && c.c > 0.02)
  const weight = inPeak.reduce((n, c) => n + c.n, 0)
  const hue = weight > 0 ? peak * 10 + 5 : 260
  const strength = weight > 0 ? inPeak.reduce((n, c) => n + c.n * c.c, 0) / weight : 0
  // Accent: the most vivid colour that covers a fair part of the picture.
  const vivid = colours.filter(c => c.c > 0.06 && c.l > 0.25 && c.l < 0.9).sort((p, q) => q.c * Math.sqrt(q.n) - p.c * Math.sqrt(p.n))
  const roles: Record<string, string> = {}
  const accent = vivid[0]

  if (accent !== undefined) {
    roles.accent = hexRgb(accent.rgb)
  }
  for (const [role, [h, fallback]] of Object.entries(ROLE_HUES)) {
    const near = vivid.filter(c => c !== accent && hueGap(c.h, h) <= 30)
    roles[role] = near[0] === undefined ? fallback : hexRgb(near[0].rgb)
  }

  // From most to least colour in the surfaces, until Desktop would paint it; last, the app's
  // own accent colours with the picture's hue in the surfaces alone.
  const tries: [number, Record<string, string>][] = [
    [1, roles],
    [0.5, roles],
    [0, roles],
    [0.5, {}],
  ]

  for (const [tint, chosen] of tries) {
    const c = Math.min(0.035, Math.max(0.008, strength * 0.4)) * tint
    const dark = (l: number, k = 1) => hexOf(l, c * k, hue)
    const light = (l: number, k = 1) => hexOf(l, c * 0.6 * k, hue)

    try {
      const { theme, problems } = makeColors({
        label: '像素背景配色',
        roles: chosen,
        dark: {
          gray: {
            anchors: {
              'surface-0': dark(0.17),
              'surface-1': dark(0.2),
              'surface-2': dark(0.23),
              'surface-3': dark(0.25),
              'text-primary': dark(0.95, 0.3),
              'text-secondary': dark(0.83, 0.5),
              'text-muted': dark(0.72, 0.6),
            },
          },
        },
        light: {
          gray: {
            anchors: {
              'surface-0': light(0.935),
              'surface-1': light(0.955),
              'surface-2': light(0.975),
              'surface-3': light(0.975),
              'text-primary': light(0.22, 0.6),
              'text-secondary': light(0.4, 0.8),
              'text-muted': light(0.5, 0.8),
            },
          },
        },
      })

      if (!problems.some(line => line.startsWith("Desktop won't paint"))) {
        return theme
      }
    } catch {
      // A colour the design system can't use: try greyer.
    }
  }

  return undefined
}
