/**
 * Reading pictures through FFmpeg, the one outside program pixelbg runs on pictures.
 *
 * The mod has no image decoders of its own: FFmpeg reads the picture (any format it knows; an
 * animated one's first frame), turns it upright as its EXIF or display matrix says, scales it and
 * writes raw RGBA to a file in the system's temporary folder, which the mod reads back as bytes
 * and then empties. FFmpeg and ffprobe are started directly, with an argument list and no shell,
 * and may open local files only: every input is given as `file:<path>` with the protocol
 * whitelist set to `file`, so a path can be neither an option nor a URL.
 */
import type { EngineInterface } from 'claude-code'

import { fromBase64 } from './base64'
import { firstFolder, homeFolder, onWindows } from './host'
import type { Variable } from './host'

export type Tools = { ffmpeg: string }
export type Decoded = { w: number; h: number; rgba: Uint8Array; sourceW: number; sourceH: number }

/** File types pixelbg takes. FFmpeg reads more; these are the pictures people keep. */
export const PICTURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif']

/**
 * The most pixels one decode may hold: its RGBA must stay well under the 4 MiB the engine reads
 * from a file at once. A tall picture is decoded narrower to stay inside it.
 */
export const MAX_PIXELS = 900_000

/**
 * Input options that keep FFmpeg and ffprobe to files on this computer, read by the readers of the
 * picture types pixelbg takes only: a playlist or concat list named like a picture (which could
 * make FFmpeg read some other local file) is refused.
 */
const LOCAL_ONLY = ['-protocol_whitelist', 'file', '-format_whitelist', 'image2,gif,mov,mp4,m4a,3gp,3g2,mj2']

/**
 * The types FFmpeg's image reader takes. That reader treats `%d` in a name as a numbered sequence
 * (`frame %02d.png` would show `frame 01.png`), so for these it is named, with sequences off. GIF
 * and AVIF have readers of their own, which take a name as it is.
 */
const IMAGE_READER = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'])

function readerOptions(path: string): string[] {
  return IMAGE_READER.has(extensionOf(path)) ? ['-f', 'image2', '-pattern_type', 'none'] : []
}

/**
 * What went wrong reading a picture: FFmpeg would not start (`start`: not installed, or the path
 * set for it is wrong), could not read the file (`probe`, `decode`), wrote less than it should
 * have (`short`), the path is not a file on this computer (`local`), the picture is too long and
 * thin to decode within the engine's limit (`shape`), there is no folder for the temporary file
 * (`temp`), or it could not be emptied afterwards (`cleanup`). text.ts turns each into a sentence.
 */
export class MediaError extends Error {
  readonly kind: 'start' | 'probe' | 'decode' | 'short' | 'local' | 'shape' | 'temp' | 'cleanup'
  readonly detail: string

  constructor(kind: MediaError['kind'], detail: string) {
    super(`${kind}: ${detail}`)
    this.kind = kind
    this.detail = detail
  }
}

/** A path's last part: the file's name. */
function lastPart(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * Text that names these paths (FFmpeg's error lines do, and a program's own errors) with each
 * path cut to its file name: the folders say more than an error needs, and errors can end up in
 * the conversation. Both slashes and a `file:` prefix are matched.
 */
export function namesOnly(text: string, paths: readonly string[]): string {
  let out = text

  for (const path of paths.filter(p => /[\\/]/.test(p))) {
    for (const form of new Set([path, path.replace(/\\/g, '/'), path.replace(/\//g, '\\')])) {
      out = out.split(`file:${form}`).join(lastPart(path)).split(form).join(lastPart(path))
    }
  }

  return out
}

/** Run one of the FFmpeg tools; a program that cannot start (or hangs) becomes a MediaError. */
async function tool($: EngineInterface, argv: string[], timeoutMs: number) {
  try {
    return await $.process.run(argv, { timeoutMs })
  } catch (error) {
    const program = argv[0] ?? ''

    throw new MediaError('start', `${lastPart(program)}: ${namesOnly(error instanceof Error ? error.message : String(error), [program])}`)
  }
}

export function extensionOf(path: string): string {
  return path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? ''
}

export function isPicture(path: string): boolean {
  return PICTURE_EXTENSIONS.includes(extensionOf(path))
}

/**
 * A path to a file on this computer: a drive path, or a path with no URL scheme in front, and not
 * a network share (`\\server\…`, `//server/…`): opening one could make the system reach another
 * machine, which `file:` alone does not prevent.
 */
export function isLocalPath(path: string): boolean {
  return path !== '' && !/^[\\/]{2}/.test(path) && (/^[A-Za-z]:[\\/]/.test(path) || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path))
}

/** ffprobe beside ffmpeg: the same folder, or the PATH when ffmpeg is found there. */
export function ffprobeFor(ffmpeg: string): string {
  return ffmpeg.replace(/ffmpeg(\.exe)?$/i, (_, exe: string | undefined) => `ffprobe${exe ?? ''}`)
}

/** The input as FFmpeg is given it: always a local file, even when its name starts with a dash. */
function input(path: string): string {
  if (!isLocalPath(path)) {
    throw new MediaError('local', lastPart(path))
  }

  return `file:${path}`
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line !== '') ?? ''
  )
}

/**
 * The mod's folder in the system's temporary folder, made if missing: `dir`, and `shown`, the same
 * written with the variable it came from (`%TEMP%/pixelbg`), which says where without whose. Only
 * a folder this system takes as absolute counts (host.ts). Without a temporary folder, one of
 * pixelbg's own in the user's folders (`pixelbg-temp`, private to the user, unlike a shared
 * `/tmp`); on Linux and macOS without those either, `/tmp`. Never the session's own folder: on a
 * system that cannot be told, or Windows with none of these, nothing is converted.
 */
export async function tempDir($: EngineInterface): Promise<{ dir: string; shown: string }> {
  const windows = await onWindows($)
  const temp: Variable = ['TEMP', await $.env.get('TEMP')]
  const tmp: Variable = ['TMP', await $.env.get('TMP')]
  const home: Variable = ['HOME', await $.env.get('HOME')]
  const found = firstFolder(
    windows ? [temp, tmp, ['LOCALAPPDATA', await $.env.get('LOCALAPPDATA')], ['USERPROFILE', await $.env.get('USERPROFILE')], home] : [['TMPDIR', await $.env.get('TMPDIR')], tmp, temp, home],
    windows,
  )

  if (found === undefined && windows !== false) {
    throw new MediaError('temp', '')
  }
  const own = found !== undefined && ['LOCALAPPDATA', 'USERPROFILE', 'HOME'].includes(found.name) ? '/pixelbg-temp' : '/pixelbg'
  const dir = found === undefined ? '/tmp/pixelbg' : `${found.folder}${own}`
  const shown = found === undefined ? dir : windows ? `%${found.name}%${own}` : `$${found.name}${own}`

  // fs.write makes the folder; FFmpeg will not.
  await $.fs.write(`${dir}/.keep`, '')

  return { dir, shown }
}

/**
 * The picture's size as it is shown: its first frame's, with width and height swapped when the
 * frame carries a quarter turn (a phone photo's EXIF orientation, a rotated video frame).
 */
export async function probeSize($: EngineInterface, tools: Tools, path: string): Promise<{ w: number; h: number }> {
  const run = await tool(
    $,
    [ffprobeFor(tools.ffmpeg), '-v', 'error', ...LOCAL_ONLY, ...readerOptions(path), '-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_entries', 'frame=width,height:frame_side_data=rotation', '-of', 'json', input(path)],
    30000,
  )
  let frame: { width?: unknown; height?: unknown; side_data_list?: { rotation?: unknown }[] } | undefined

  try {
    frame = (JSON.parse(run.stdout) as { frames?: (typeof frame)[] }).frames?.[0]
  } catch {
    frame = undefined
  }
  const w = Number(frame?.width)
  const h = Number(frame?.height)

  if (run.exitCode !== 0 || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new MediaError('probe', namesOnly(firstLine(run.stderr), [path]) || `exit ${run.exitCode}`)
  }
  const turn = Math.abs(Math.round(Number(frame?.side_data_list?.find(s => s.rotation !== undefined)?.rotation ?? 0))) % 180

  return turn === 90 ? { w: h, h: w } : { w, h }
}

/**
 * The decode's size: `width` across (with `atMost`, a ceiling: a smaller picture keeps its own
 * width, at least 64, unenlarged), the picture's shape kept, and narrower when that would hold
 * more than MAX_PIXELS. A picture too long and thin to fit even one pixel wide is refused.
 */
export function decodeSize(source: { w: number; h: number }, width: number, atMost = false): { w: number; h: number } {
  let w = Math.max(1, Math.round(atMost ? Math.min(width, Math.max(64, source.w)) : width))
  let h = Math.max(1, Math.round((w * source.h) / source.w))

  if (w * h > MAX_PIXELS) {
    w = Math.max(1, Math.floor(Math.sqrt((MAX_PIXELS * source.w) / source.h)))
    h = Math.max(1, Math.round((w * source.h) / source.w))
    // Rounding the height up can tip it over: a pixel narrower until it fits.
    while (w > 1 && w * h > MAX_PIXELS) {
      w -= 1
      h = Math.max(1, Math.round((w * source.h) / source.w))
    }
  }
  if (w * h > MAX_PIXELS) {
    throw new MediaError('shape', `${source.w}x${source.h}`)
  }

  return { w, h }
}

/**
 * One decode at a time in a session: its decodes share one temporary file, and the panel's
 * thumbnails and a conversion can be asked for at once. Each session (each load of the mod) has a
 * file of its own, so sessions converting at the same time never share one either.
 */
let decoding: Promise<unknown> = Promise.resolve()
const SESSION_FILE = `still-${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}.rgba`

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const turn = decoding.then(work, work)

  decoding = turn.catch(() => undefined)

  return turn
}

/** The picture at `width` pixels across (see decodeSize), as RGBA. */
export async function decodeStill($: EngineInterface, tools: Tools, path: string, width: number, atMost = false): Promise<Decoded> {
  const source = await probeSize($, tools, path)
  const { w, h } = decodeSize(source, width, atMost)
  // Shrinking averages areas; enlarging a small sprite keeps its pixels square.
  const flags = source.w > w ? 'area' : 'neighbor'

  return oneAtATime(async () => {
    const temp = await tempDir($)
    const out = `${temp.dir}/${SESSION_FILE}`

    try {
      const run = await tool(
        $,
        [tools.ffmpeg, '-v', 'error', '-y', ...LOCAL_ONLY, ...readerOptions(path), '-i', input(path), '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=${flags}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', out],
        60000,
      )

      if (run.exitCode !== 0) {
        throw new MediaError('decode', namesOnly(firstLine(run.stderr), [path, out]) || `exit ${run.exitCode}`)
      }
      const read = await $.fs.read(out, { as: 'bytes' })
      const rgba = fromBase64(typeof read === 'string' ? '' : read.base64)

      if (rgba.length < w * h * 4) {
        throw new MediaError('short', `${rgba.length} / ${w * h * 4}`)
      }

      return { w, h, rgba: rgba.subarray(0, w * h * 4), sourceW: source.w, sourceH: source.h }
    } finally {
      // Leave no copy of the picture behind, whatever happened: the mod cannot delete files, so
      // it empties this one, tries once more if that fails, and says so if it still cannot.
      const emptied = await $.fs.write(out, '').then(
        () => true,
        () => $.clock.sleep(100).then(() => $.fs.write(out, '').then(() => true, () => false)),
      )

      if (!emptied) {
        // Where it is, written with its variable (%TEMP%/pixelbg/…): enough to find it, nothing of whose.
        throw new MediaError('cleanup', `${temp.shown}/${SESSION_FILE}`)
      }
    }
  })
}

/** Is FFmpeg there? Its version line, or why not. */
export async function checkFfmpeg($: EngineInterface, tools: Tools): Promise<{ ok: true; version: string } | { ok: false; why: string }> {
  try {
    const run = await $.process.run([tools.ffmpeg, '-version'], { timeoutMs: 15000 })

    return run.exitCode === 0 ? { ok: true, version: firstLine(run.stdout) } : { ok: false, why: namesOnly(firstLine(run.stderr), [tools.ffmpeg]) || `exit ${run.exitCode}` }
  } catch (error) {
    return { ok: false, why: namesOnly(String(error instanceof Error ? error.message : error), [tools.ffmpeg]) }
  }
}

export type Recent = { path: string; name: string; mtimeMs: number }

/** The newest pictures in the user's Downloads, Pictures and Desktop folders. */
export async function recentPictures($: EngineInterface, limit = 10): Promise<Recent[]> {
  const home = await homeFolder($)

  if (home === undefined) {
    return []
  }
  const found: Recent[] = []
  const sep = home.includes('\\') ? '\\' : '/'

  for (const folder of ['Downloads', 'Pictures', 'Desktop']) {
    const dir = `${home.replace(/[\\/]+$/, '')}${sep}${folder}`

    try {
      for (const entry of await $.fs.list(dir)) {
        if (entry.kind === 'file' && isPicture(entry.name)) {
          found.push({ path: `${dir}${sep}${entry.name}`, name: entry.name, mtimeMs: entry.mtimeMs })
        }
      }
    } catch {
      // A folder that is missing or unreadable is skipped.
    }
  }

  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit)
}
