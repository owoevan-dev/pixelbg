/**
 * Building a backdrop: picture -> pixels -> palette -> documents.
 *
 * FFmpeg shrinks the picture (media.ts); edge-keeping smoothing calms its noise (clean.ts); a
 * palette is cut from it (quantize.ts) and lone specks take their neighbours' colour; the dashed
 * encoder writes the documents (dash.ts), or the plain one when some pixels are see-through
 * (encode.ts). A backdrop may be two documents, top rows and bottom rows.
 *
 * Two modes:
 * - normal: the width the user picks, shrunk only when even two documents would pass the
 *   desktop's limit;
 * - hd: the picture is decoded once at up to 1,200 pixels across, one palette is cut from it,
 *   and a binary search finds the widest copy that fits in two documents.
 */
import type { EngineInterface, ThemeColors } from 'claude-code'

import { despeckle, smooth } from './clean'
import { encodeDashLayers } from './dash'
import { encodeLayers, encodePreview, encodeStill, MAX_LAYERS, MAX_SVG_CHARS } from './encode'
import type { StillOptions } from './encode'
import { decodeStill, isLocalPath, isPicture, MediaError, PICTURE_EXTENSIONS } from './media'
import { fileName, isAbsolutePath } from './paths'
import type { Decoded } from './media'
import { buildPalette, mapPixels, TRANSPARENT } from './quantize'
import type { Indexed, Rgb } from './quantize'
import { shrink } from './resize'
import { MAX_WIDTH, MIN_WIDTH } from './settings'
import type { Art, Settings } from './settings'
import { t, Told } from './text'
import { pictureTheme } from './tint'

/** Smoothing reach (summed RGB difference) and despeckle reach (OKLab): see docs/design.md. */
const SMOOTH = 24
const SPECK = 0.08
/** Normal mode guesses a smaller width at most this many times. */
const NORMAL_TRIES = 6
/** The high-quality search stops when its bounds are this close. */
const SEARCH_STEP = 8
const SEARCH_FLOOR = MIN_WIDTH

export type Made = { decoded: Decoded; indexed: Indexed; svgs: string[] }

/**
 * Hand the engine a moment between heavy steps: the hooks worker answers a heartbeat, and a
 * step that keeps it busy for seconds gets the event it serves skipped.
 */
async function breathe($: EngineInterface): Promise<void> {
  await $.clock.sleep(1)
}

/** Smoothed pixels matched to `palette`, lone specks let go. */
function indexOf(cleaned: Decoded, palette: Rgb[]): Indexed {
  return despeckle(mapPixels(cleaned.rgba, cleaned.w, cleaned.h, palette), SPECK)
}

/** The documents for these pixels, or undefined when even two pass `maxPerLayer`. */
export function encodeArt(indexed: Indexed, options: StillOptions, maxPerLayer = MAX_SVG_CHARS): string[] | undefined {
  return indexed.px.includes(TRANSPARENT) ? encodeLayers(indexed, options, maxPerLayer) : encodeDashLayers(indexed, options, maxPerLayer, MAX_LAYERS)
}

/** Normal mode's pixels: smoothed, a palette of their own, lone specks let go. */
export function ownPalette(decoded: Decoded, colors: number): Indexed {
  const cleaned = smooth(decoded, SMOOTH)

  return indexOf(cleaned, buildPalette(cleaned.rgba, colors))
}

/** These pixels' size as a single document, in characters. */
function weight(indexed: Indexed, options: StillOptions): number {
  return (encodeDashLayers(indexed, options, Number.MAX_SAFE_INTEGER, 1)?.[0] ?? encodeStill(indexed, options)).length
}

/**
 * The widest copy of `base` that fits in two documents, with `colors` colours: the whole of it
 * when it fits, else a binary search over widths, shrinking in the mod. `pause` runs between
 * heavy steps.
 */
export async function widestFit(base: Decoded, colors: number, options: StillOptions, pause: () => Promise<void>): Promise<Made | undefined> {
  const cleanBase = smooth(base, SMOOTH)
  // One palette from the largest copy serves every width the search tries.
  const palette = buildPalette(cleanBase.rgba, colors)
  const attempt = async (decoded: Decoded, cleaned?: Decoded): Promise<Made | undefined> => {
    await pause()
    const indexed = indexOf(cleaned ?? smooth(decoded, SMOOTH), palette)

    await pause()
    const svgs = encodeArt(indexed, options)

    return svgs === undefined ? undefined : { decoded, indexed, svgs }
  }
  const whole = await attempt(base, cleanBase)

  if (whole !== undefined || base.w <= SEARCH_FLOOR) {
    return whole
  }
  // The narrowest width is tried first: if even it does not fit, nothing does. Then the search
  // keeps `lo` a width that fits and `hi` one that does not.
  let best = await attempt(shrink(base, SEARCH_FLOOR))

  if (best === undefined) {
    return undefined
  }
  let lo = SEARCH_FLOOR
  let hi = base.w

  while (hi - lo > SEARCH_STEP) {
    const mid = (lo + hi) >> 1
    const tried = await attempt(shrink(base, mid))

    if (tried !== undefined) {
      best = tried
      lo = mid
    } else {
      hi = mid
    }
  }

  return best
}

async function buildHd($: EngineInterface, s: Settings, path: string): Promise<Made | undefined> {
  const base = await decodeStill($, { ffmpeg: s.ffmpeg }, path, MAX_WIDTH, true)

  await breathe($)

  return widestFit(base, s.colors, { fit: s.fit }, () => breathe($))
}

async function buildNormal($: EngineInterface, s: Settings, path: string): Promise<Made | undefined> {
  const options = { fit: s.fit }
  let width = s.width

  for (let attempt = 0; attempt < NORMAL_TRIES; attempt++) {
    const decoded = await decodeStill($, { ffmpeg: s.ffmpeg }, path, width)

    await breathe($)
    const indexed = ownPalette(decoded, s.colors)

    await breathe($)
    const svgs = encodeArt(indexed, options)

    if (svgs !== undefined) {
      return { decoded, indexed, svgs }
    }
    if (decoded.w <= MIN_WIDTH) {
      return undefined
    }
    // Too big: the size grows with the pixel count, so guess from how far over it is.
    const guess = Math.floor(decoded.w * Math.sqrt((MAX_SVG_CHARS * MAX_LAYERS) / weight(indexed, options)) * 0.95)

    width = Math.max(MIN_WIDTH, Math.min(decoded.w - 1, guess))
  }

  return undefined
}

/** The app's colours from the picture; none when it gave none. */
function themeOf(indexed: Indexed): { theme?: ThemeColors } {
  try {
    const theme = pictureTheme(indexed)

    return theme === undefined ? {} : { theme }
  } catch {
    return {}
  }
}

/** What the pixels depend on: the picture, the quality, the colours, and the width in normal mode. */
export function buildKey(s: Settings): string {
  return JSON.stringify([s.path ?? '', s.quality, s.colors, s.quality === 'normal' ? s.width : 0])
}

/** The backdrop for these settings, and a note for the user (empty when there is nothing to say). */
export async function makeArt($: EngineInterface, s: Settings): Promise<{ art: Art; note: string }> {
  const path = s.path

  if (path === undefined) {
    throw new Told(t('err.noPicture'))
  }
  if (!isPicture(path)) {
    throw new Told(t('err.notPicture', { list: PICTURE_EXTENSIONS.join(', ') }))
  }
  // Checked before anything touches the path: a network share is never opened. Errors name the
  // file only, as they may end up in the conversation.
  if (!isLocalPath(path)) {
    throw new MediaError('local', fileName(path))
  }
  // A path kept by an older version may be relative: which file it meant cannot be known.
  if (!isAbsolutePath(path)) {
    throw new Told(t('err.notFound', { path: fileName(path) }))
  }
  const made = s.quality === 'hd' ? await buildHd($, s, path) : await buildNormal($, s, path)

  if (made === undefined) {
    throw new Told(t('err.tooDetailed'))
  }
  const { decoded, indexed, svgs } = made

  // A picture with nothing opaque in it would draw nothing at all: say so instead.
  if (!indexed.px.some(v => v !== TRANSPARENT)) {
    throw new Told(t('err.empty'))
  }

  await breathe($)
  const art: Art = {
    key: buildKey(s),
    svgs,
    preview: encodePreview(indexed),
    w: decoded.w,
    h: decoded.h,
    colors: indexed.palette.length,
    source: path,
    sourceW: decoded.sourceW,
    sourceH: decoded.sourceH,
    quality: s.quality,
    ...themeOf(indexed),
  }
  const note =
    s.quality === 'hd' ? t('note.hd', { w: decoded.w, colors: indexed.palette.length }) : decoded.w === s.width ? '' : t('note.shrunk', { asked: s.width, w: decoded.w })

  return { art, note }
}

/** The same documents for another fit: only the scaling line changes. The same art when it fits so already. */
export function refit(art: Art, fit: Settings['fit']): Art {
  const [from, to] = fit === 'contain' ? ['slice', 'meet'] : ['meet', 'slice']
  const old = `preserveAspectRatio='xMidYMid ${from}'`

  return art.svgs.some(s => s.includes(old)) ? { ...art, svgs: art.svgs.map(s => s.replace(old, `preserveAspectRatio='xMidYMid ${to}'`)) } : art
}
