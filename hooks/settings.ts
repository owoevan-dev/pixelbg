/**
 * What pixelbg keeps in its shared snapshot (shared.ts): the settings, and the finished backdrop
 * ("art").
 *
 * Both are read back through these functions, which accept only what they recognise and clamp
 * every number, so a value from another version or a hand-edited file never reaches the encoder
 * or the desktop unchecked.
 */
import type { ThemeColors } from 'claude-code'

import { MAX_LAYERS } from './encode'
import { checkColors } from './make-colors.js'
import type { Fit } from './encode'
import { isSpoken } from './strings/all'
import type { Language } from './text'

/** `normal`: the width the user picks. `hd`: the widest picture that fits, found by a search. */
export type Quality = 'normal' | 'hd'
export type { Language } from './text'

export type Settings = {
  /** The picture, as the user gave it; absent until one is chosen. */
  path?: string
  width: number
  colors: number
  fit: Fit
  dim: number
  blur: number
  opacity: number
  enabled: boolean
  ffmpeg: string
  quality: Quality
  /** The app's colours follow the picture (tint.ts). */
  tint: boolean
  language: Language
}

/** One or two documents (top rows, bottom rows) that stack into the one picture. */
export type Art = {
  /** The settings it was made for (build.ts, `buildKey`): a session can tell whether it fits. */
  key: string
  svgs: string[]
  preview: string
  w: number
  h: number
  colors: number
  source: string
  sourceW: number
  sourceH: number
  quality: Quality
  /** The app's colours made from this picture, when it gave any. */
  theme?: ThemeColors
}

/** The desktop draws one Svg of up to this many characters. */
export const MAX_DOC_CHARS = 131072
/** The widest picture either mode makes. */
export const MAX_WIDTH = 1200
export const MIN_WIDTH = 16

export const DEFAULTS: Settings = {
  width: 160,
  colors: 24,
  fit: 'cover',
  dim: 0.15,
  blur: 0,
  opacity: 0.55,
  enabled: true,
  ffmpeg: 'ffmpeg',
  quality: 'hd',
  tint: true,
  language: 'auto',
}

/** The elements pixelbg's encoders write, and for each attribute they use, the values they write. */
const OWN_TAGS = new Set(['svg', 'defs', 'g', 'path', 'use', 'rect'])
const NUMBER = /^\d+$/
const OWN_VALUES: Record<string, RegExp> = {
  xmlns: /^http:\/\/www\.w3\.org\/2000\/svg$/,
  viewBox: /^\d+ \d+ \d+ \d+$/,
  preserveAspectRatio: /^xMidYMid (meet|slice)$/,
  'shape-rendering': /^crispEdges$/,
  fill: /^(none|#[0-9a-f]{6})$/,
  stroke: /^#[0-9a-f]{6}$/,
  'stroke-width': /^1$/,
  'stroke-dasharray': /^\d+( \d+)*$/,
  width: NUMBER,
  height: NUMBER,
  x: NUMBER,
  y: NUMBER,
  d: /^[MmhvZz0-9 .-]+$/,
  id: /^z\d+$/,
  href: /^#z\d+$/,
}
/** One tag: a name, then attributes in single quotes, nothing else. */
const TAG = /^<(\/?)([a-z]+)((?:\s[A-Za-z-]+='[^'<>]*')*)\s*(\/?)>$/

/**
 * Is this an SVG document as pixelbg writes it? Every tag must be one of its elements with only
 * attributes it writes, each value of the form it writes, and no text, comments or other markup
 * between the tags. What comes back from the snapshot or a thumbnail file is drawn only if so,
 * whoever wrote it.
 */
export function isOwnSvg(doc: string): boolean {
  if (!doc.startsWith('<svg ') || !doc.endsWith('</svg>') || doc.replace(/<[^<>]*>/g, '') !== '') {
    return false
  }
  // Every element closed, in order, all inside the one svg that opens the document.
  const open: string[] = []
  let first = true

  for (const [token] of doc.matchAll(/<[^<>]*>/g)) {
    const tag = TAG.exec(token)

    if (tag === null || !OWN_TAGS.has(tag[2] ?? '')) {
      return false
    }
    const name = tag[2] ?? ''

    if (tag[1] === '/') {
      if (open.pop() !== name || (tag[3] ?? '') !== '' || tag[4] === '/') {
        return false
      }
    } else if ((first ? name !== 'svg' || tag[4] === '/' : open.length === 0)) {
      return false
    } else if (tag[4] !== '/') {
      open.push(name)
    }
    first = false
    const seen = new Set<string>()

    for (const [, attribute = '', value = ''] of (tag[3] ?? '').matchAll(/\s([A-Za-z-]+)='([^']*)'/g)) {
      if (!Object.prototype.hasOwnProperty.call(OWN_VALUES, attribute) || seen.has(attribute) || OWN_VALUES[attribute]?.test(value) !== true) {
        return false
      }
      seen.add(attribute)
    }
  }

  return open.length === 0
}

/** The design system's words for a theme it would refuse or not paint at all (make-colors.js). */
const REFUSED = /^Desktop won't paint|nothing paints|paints nothing|refuses that/

/**
 * A stored theme, if the design system's own check finds nothing wrong with its shape and nothing
 * the desktop would refuse; otherwise none (the backdrop is still shown, in the app's own colours).
 */
function themeOf(value: unknown): ThemeColors | undefined {
  try {
    const v = record(value)

    return v.v === 1 && typeof v.inputs === 'object' && v.inputs !== null && !checkColors(value).some(line => REFUSED.test(line)) ? (value as ThemeColors) : undefined
  } catch {
    return undefined
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function num(x: unknown, lo: number, hi: number, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback
}

export function readSettings(value: unknown): Settings {
  const v = record(value)

  return {
    ...(typeof v.path === 'string' && v.path !== '' ? { path: v.path } : {}),
    width: Math.round(num(v.width, MIN_WIDTH, MAX_WIDTH, DEFAULTS.width)),
    colors: Math.round(num(v.colors, 2, 64, DEFAULTS.colors)),
    fit: v.fit === 'contain' ? 'contain' : 'cover',
    dim: num(v.dim, 0, 0.9, DEFAULTS.dim),
    blur: num(v.blur, 0, 64, DEFAULTS.blur),
    opacity: num(v.opacity, 0, 1, DEFAULTS.opacity),
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULTS.enabled,
    ffmpeg: typeof v.ffmpeg === 'string' && v.ffmpeg !== '' ? v.ffmpeg : DEFAULTS.ffmpeg,
    quality: v.quality === 'normal' || v.quality === 'hd' ? v.quality : DEFAULTS.quality,
    tint: typeof v.tint === 'boolean' ? v.tint : DEFAULTS.tint,
    language: typeof v.language === 'string' && isSpoken(v.language) ? v.language : 'auto',
  }
}

/** The stored backdrop, if it is whole and within the desktop's limits; otherwise none. */
export function readArt(value: unknown): Art | undefined {
  const v = record(value)
  const svgs = Array.isArray(v.svgs) ? v.svgs : []
  const valid =
    svgs.length >= 1 &&
    svgs.length <= MAX_LAYERS &&
    svgs.every(s => typeof s === 'string' && s.length <= MAX_DOC_CHARS && isOwnSvg(s)) &&
    typeof v.w === 'number' &&
    typeof v.h === 'number' &&
    typeof v.source === 'string'

  const size = (x: unknown, lo: number, hi: number) => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi

  if (!valid || !size(v.w, 1, 4000) || !size(v.h, 1, 1_000_000)) {
    return undefined
  }
  const theme = themeOf(v.theme)

  return {
    key: typeof v.key === 'string' ? v.key : '',
    svgs: svgs as string[],
    preview: typeof v.preview === 'string' && v.preview.length <= 60000 && isOwnSvg(v.preview) ? v.preview : '',
    w: v.w as number,
    h: v.h as number,
    colors: size(v.colors, 0, 256) ? (v.colors as number) : 0,
    source: v.source as string,
    sourceW: size(v.sourceW, 0, 1_000_000) ? (v.sourceW as number) : 0,
    sourceH: size(v.sourceH, 0, 1_000_000) ? (v.sourceH as number) : 0,
    quality: v.quality === 'normal' ? 'normal' : 'hd',
    ...(theme === undefined ? {} : { theme }),
  }
}
