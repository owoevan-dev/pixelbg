/**
 * A pretend machine for the tests: files in memory, an FFmpeg that "decodes" pictures drawn by
 * code, a mock clock, a store, and a fixed environment. No file, picture or program of the real
 * machine is touched.
 */
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { buildKey } from '../hooks/build'
import { encodeStill } from '../hooks/encode'
import { quantize } from '../hooks/quantize'
import { DEFAULTS } from '../hooks/settings'

/** A picture drawn at any size: RGBA, w*h*4 bytes. */
export type Drawing = (w: number, h: number) => Uint8Array

/**
 * A picture FFmpeg can read: its size as shown, how to draw it, and `turned` for one stored on its
 * side with a quarter-turn mark (a phone photo): ffprobe then reports the stored size and the turn.
 */
export type Source = { w: number; h: number; draw: Drawing; turned?: boolean }

export type Fake = {
  clock: MockClock
  files: Map<string, string>
  /** Every program started, by its arguments. */
  runs: string[][]
  toasts: string[]
  themes: string[]
  /** The pictures FFmpeg can read, by path. */
  sources: Map<string, Source>
  /** Set to make every probe this slow, in (mock) milliseconds. */
  slowProbeMs: number
  /** Set to make FFmpeg unable to start. */
  missing: boolean
  /**
   * Set to make every decode this slow, in (mock) milliseconds. Like FFmpeg with `-y`, a decode
   * empties its output file when it starts and fills it when it ends.
   */
  slowDecodeMs: number
  /** Set to make reading decoded pixels back this slow; the read sees the file as it is at the end. */
  slowReadMs: number
  /** How many times the theme was cleared. */
  clears: number
  /** The locale the system reports to `reg` or `defaults`. */
  locale: string
  /** Files that exist but cannot be read (a read throws). */
  unreadable: Set<string>
  /** Set to make every theme.set this slow, in (mock) milliseconds. */
  slowThemeMs: number
  /** Theme changes in the order they took effect. */
  themeOps: ('set' | 'clear')[]
  /** Writes refused while this says so (the write fails, nothing is written). */
  refuse: (path: string, text: string) => boolean
  /** How many theme.clear calls to refuse next. */
  refuseClears: number
  /** Set to make asking the system for its language (reg, defaults) this slow. */
  slowLocaleMs: number
  /** The session's working folder. */
  cwd: string
  /** Set to make every probe fail with this error line, as FFmpeg prints it (it may name the file). */
  probeError: string
  /** Reads to slow down once, by path: the first read of each waits this long (mock ms). */
  slowReadOnce: Map<string, number>
  /** Every path asked about with fs.exists. */
  lookups: string[]
  /** How many theme.set calls to refuse next. */
  refuseSets: number
  /** Set to make theme.set answer that it will not draw, for this reason. */
  drawReason: string
  /** Every command registered, in order. */
  registered: string[]
  /** The shared snapshot on disk, parsed; undefined when there is none. */
  snapshot: () => Record<string, unknown> | undefined
  /** Write a shared snapshot, as another session would. */
  putSnapshot: (snapshot: unknown) => void
  /** Write a library entry's file, as another session would. */
  putEntry: (entry: Record<string, unknown>) => void
  /** Every library entry file, parsed, by id. */
  entries: () => Map<string, Record<string, unknown>>
  /** Is this entry removed? Its removal marker says, else the entry's own field. */
  isRemoved: (id: string) => boolean
  /** A command's answer, the clock moved on until it comes. */
  command: (args: string) => Promise<string>
  /** Start the session, as the engine does once the session is ready. */
  start: () => Promise<void>
  /** Move the clock on until `done` holds (or a long while has passed). */
  until: (done: () => boolean) => Promise<void>
  /** How many times FFmpeg decoded a picture (probes not counted). */
  decodes: () => number
  /** A file's text, if it was written. */
  text: (path: string) => string | undefined
  /** The decodes' temporary files written so far. */
  tempFiles: () => string[]
}

/** Where the fake machine keeps pixelbg's shared snapshot, library entries and thumbnails. */
export const SNAPSHOT = 'T:/local/pixelbg/current.json'
export const ENTRIES = 'T:/local/pixelbg/library'
export const THUMBS = 'T:/local/pixelbg/thumbs'
export const REMOVALS = 'T:/local/pixelbg/removed'

/**
 * The engine hands hooks Windows paths, FFmpeg's arguments keep forward slashes: one key for both.
 * On a Windows test machine the engine also resolves a path from the root against the current
 * drive; the tests' Linux paths all live under /srv and /tmp, and keep that form whatever machine
 * runs them. (T: is the tests' own pretend drive, never one the engine adds.)
 */
export const key = (path: string) =>
  path
    .split(String.fromCharCode(92))
    .join('/')
    .replace(/^(?![Tt]:)[A-Za-z]:(?=\/(srv|tmp)\/)/, '')

export function toBase64(bytes: Uint8Array): string {
  let s = ''

  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(s)
}

/** Stripes of a few colours with a busy band in the middle: detail that costs characters. */
export function stripes(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4)
  const colours = [
    [30, 40, 90],
    [200, 120, 60],
    [240, 220, 180],
    [90, 160, 80],
    [160, 40, 50],
    [20, 20, 30],
  ]

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const busy = y > h / 3 && y < (2 * h) / 3
      const k = busy ? (x * 7 + y * 13 + ((x * y) % 5)) % colours.length : Math.floor((y * 4) / h)
      const c = colours[k] ?? [0, 0, 0]

      rgba.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], (y * w + x) * 4)
    }
  }

  return rgba
}

/** A warm picture with a red edge, for the colour tests. */
export function warm(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4)

  for (let i = 0; i < w * h; i++) {
    rgba.set(i % w < Math.max(2, w / 10) ? [220, 60, 50, 255] : [235, 210 - (i % 7), 170, 255], i * 4)
  }

  return rgba
}

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const failed = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

/** `env`: variables over the defaults; `store`: what the mod's store holds at the start. */
export function fake($: Engine, on: On, options: { env?: Record<string, string>; store?: Record<string, unknown> } = {}): Fake {
  const f: Fake = {
    clock: mock.clock(on),
    files: new Map(),
    runs: [],
    toasts: [],
    themes: [],
    sources: new Map(),
    slowProbeMs: 0,
    missing: false,
    slowDecodeMs: 0,
    slowReadMs: 0,
    clears: 0,
    locale: 'en-US',
    unreadable: new Set(),
    slowThemeMs: 0,
    themeOps: [],
    refuse: () => false,
    refuseClears: 0,
    slowLocaleMs: 0,
    cwd: 'T:/work',
    probeError: '',
    slowReadOnce: new Map(),
    lookups: [],
    refuseSets: 0,
    drawReason: '',
    registered: [],
    snapshot: () => {
      const text = f.text(SNAPSHOT)

      return text === undefined ? undefined : (JSON.parse(text) as Record<string, unknown>)
    },
    putSnapshot: (snapshot: unknown) => {
      f.files.set(SNAPSHOT, toBase64(new TextEncoder().encode(JSON.stringify(snapshot))))
    },
    putEntry: (entry: Record<string, unknown>) => {
      const whole = { version: 1, removed: false, addedAt: 1, ...entry }

      f.files.set(`${ENTRIES}/${String(entry.id)}.json`, toBase64(new TextEncoder().encode(JSON.stringify(whole))))
    },
    entries: () =>
      new Map(
        [...f.files.keys()]
          .filter(k => k.startsWith(`${ENTRIES}/`) && k.endsWith('.json'))
          .map(k => {
            let entry: Record<string, unknown>

            try {
              entry = JSON.parse(f.text(k) ?? '{}') as Record<string, unknown>
            } catch {
              entry = { damaged: true }
            }

            return [k.slice(ENTRIES.length + 1, -5), entry] as const
          }),
      ),
    isRemoved: (id: string) => {
      const mark = f.text(`${REMOVALS}/${id}.json`)

      return mark !== undefined ? (JSON.parse(mark) as { removed: boolean }).removed : f.entries().get(id)?.removed === true
    },
    command: async (args: string) => {
      let answer: unknown
      const pending = $.command.run({ command: 'pixelbg', args } as never).then(r => {
        answer = r
      })

      await f.until(() => answer !== undefined)
      await pending

      return String((answer as { text?: unknown } | undefined)?.text ?? '')
    },
    start: async () => {
      await $.session.start({ cwd: 'T:/work', surface: 'desktop', isInteractive: true })
      await f.clock.advance(1)
    },
    until: async (done: () => boolean) => {
      for (let i = 0; i < 5000 && !done(); i++) {
        await f.clock.advance(20)
      }
      if (!done()) {
        throw new Error('timed out waiting for a condition that never came true')
      }
    },
    decodes: () => f.runs.filter(argv => !(argv[0] ?? '').includes('ffprobe') && argv.includes('-i')).length,
    tempFiles: () => [...f.files.keys()].filter(k => k.startsWith('T:/tmp/pixelbg/still-') && k.endsWith('.rgba')),
    text: (path: string) => {
      const data = f.files.get(key(path))

      return data === undefined ? undefined : new TextDecoder().decode(Uint8Array.from(atob(data), c => c.charCodeAt(0)))
    },
  }

  mock.store(on, options.store)
  mock.env(on, { TEMP: 'T:/tmp', LOCALAPPDATA: 'T:/local', USERPROFILE: 'T:/home', LANG: 'en_US.UTF-8', ...options.env })
  // A relative source (no drive) stands for that file in whatever folder the engine resolves it in.
  const known = (path: string) =>
    f.sources.has(path) ||
    f.files.has(path) ||
    [...f.files.keys()].some(k => k.startsWith(`${path.replace(/\/+$/, '')}/`)) ||
    [...f.sources.keys()].some(k => !k.includes(':') && path.endsWith(`/${k}`))

  on('fs.exists', (_, e) => {
    f.lookups.push(e.path)

    return { value: known(key(e.path)) }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: f.cwd }))
  /** The picture at this path: by its exact path, or a relative source found in the session's folder. */
  const sourceOf = (path: string) => f.sources.get(path) ?? [...f.sources].find(([k]) => !k.includes(':') && path.endsWith(`/${k}`))?.[1]

  on('command.register', (_, e) => {
    f.registered.push(e.name)

    return { value: { command: e.name } }
  })
  // The panel opens, as the desktop would place it.
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('fs.write', (_, e) => {
    if (f.refuse(key(e.path), e.text)) {
      throw new Error(`EIO: ${e.path}`)
    }
    f.files.set(key(e.path), toBase64(new TextEncoder().encode(e.text)))

    return { value: undefined }
  })
  on('fs.read', async (_, e) => {
    if (f.unreadable.has(key(e.path))) {
      throw new Error(`EACCES: ${e.path}`)
    }
    if (f.slowReadMs > 0 && e.path.endsWith('.rgba')) {
      await f.clock.sleep(f.slowReadMs)
    }
    const data = f.files.get(key(e.path))
    const text = f.text(e.path)
    const once = f.slowReadOnce.get(key(e.path))

    // Read now, answered later: what comes back is the file as it was when the read began.
    if (once !== undefined) {
      f.slowReadOnce.delete(key(e.path))
      await f.clock.sleep(once)
    }
    if (data === undefined) {
      throw new Error(`ENOENT: ${e.path}`)
    }

    return { value: e.as === 'bytes' ? { base64: data } : (text ?? '') }
  })
  // A folder lists the files written under it (one level).
  on('fs.list', (_, e) => {
    const dir = `${key(e.path).replace(/\/+$/, '')}/`
    const names = new Set(
      [...f.files.keys()].filter(k => k.startsWith(dir) && !k.slice(dir.length).includes('/')).map(k => k.slice(dir.length)),
    )

    return { value: [...names].map(name => ({ name, kind: 'file', mtimeMs: 0, size: 0 })) as never }
  })
  on('theme.set', async (_, e) => {
    if (f.slowThemeMs > 0) {
      await f.clock.sleep(f.slowThemeMs)
    }
    if (f.refuseSets > 0) {
      f.refuseSets -= 1
      throw new Error('the host refused to set the theme')
    }
    f.themes.push(JSON.stringify(e))
    f.themeOps.push('set')

    return { value: f.drawReason === '' ? { isDrawn: true, requestId: 'backdrop' } : ({ isDrawn: false, requestId: 'backdrop', reason: f.drawReason } as never) }
  })
  on('theme.clear', () => {
    if (f.refuseClears > 0) {
      f.refuseClears -= 1
      throw new Error('the host refused to clear the theme')
    }
    f.clears += 1
    f.themeOps.push('clear')

    return { value: { isDrawn: false, reason: 'cleared', wasSet: true } } as never
  })
  on('ui.toast', (_, e) => {
    f.toasts.push(JSON.stringify(e))

    return { value: undefined }
  })
  on('process.run', async (_, e) => {
    const argv = [...e.argv]

    f.runs.push(argv)
    if (f.missing) {
      throw new Error(`spawn ${argv[0]} ENOENT`)
    }
    const input = key((argv[argv.indexOf('-i') + 1] ?? '').replace(/^file:/, ''))

    if ((argv[0] === 'reg' || argv[0] === 'defaults') && f.slowLocaleMs > 0) {
      await f.clock.sleep(f.slowLocaleMs)
    }
    if (argv[0] === 'reg') {
      return ok(`\r\nHKEY_CURRENT_USER\\Control Panel\\International\r\n    LocaleName    REG_SZ    ${f.locale}\r\n`)
    }
    if (argv[0] === 'defaults') {
      return ok(`${f.locale.replace('-', '_')}\n`)
    }
    if ((argv[0] ?? '').includes('ffprobe') && argv[1] !== '-version') {
      if (f.slowProbeMs > 0) {
        await f.clock.sleep(f.slowProbeMs)
      }
      const source = sourceOf(key((argv[argv.length - 1] ?? '').replace(/^file:/, '')))

      if (f.probeError !== '') {
        return failed(f.probeError)
      }
      if (source === undefined) {
        return failed('No such file or directory')
      }
      // As ffprobe answers for the first frame: the stored size, and a turn when there is one.
      const frame = source.turned
        ? { width: source.h, height: source.w, side_data_list: [{ rotation: -90 }, {}] }
        : { width: source.w, height: source.h }

      return ok(JSON.stringify({ frames: [frame] }))
    }
    if (argv[1] === '-version') {
      return ok('ffmpeg version 0.0-test\n')
    }
    // ffmpeg … -i <in> -frames:v 1 -vf scale=w:h:flags=… -f rawvideo -pix_fmt rgba <out>
    const source = sourceOf(input)
    const [, w = '0', h = '0'] = /scale=(\d+):(\d+)/.exec(argv[argv.indexOf('-vf') + 1] ?? '') ?? []

    if (source === undefined) {
      return failed(`${input}: Invalid data found when processing input`)
    }
    if (f.slowDecodeMs > 0) {
      f.files.set(key(argv[argv.length - 1] ?? ''), '')
      await f.clock.sleep(f.slowDecodeMs)
    }
    f.files.set(key(argv[argv.length - 1] ?? ''), toBase64(source.draw(Number(w), Number(h))))

    return ok('')
  })

  return f
}

export const BACKDROP = {
  plugin: 'pixelbg',
  surface: 'desktop',
  component: 'Backdrop',
  requestId: 'backdrop',
  props: { scene: 'pixelbg', plugin: 'pixelbg', glass: { blur: 0, opacity: 0.55 } },
} as const

export const PANE = {
  plugin: 'pixelbg',
  component: 'Pane',
  requestId: 'pixelbg-panel',
  props: {
    title: 'Pixel backdrop',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/** A backdrop another session made: a 40×30 picture of `settings.path`, made for these settings (fit: cover). */
export function otherArt(settings: Record<string, unknown>): Record<string, unknown> {
  const rgba = new Uint8Array(40 * 30 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256))

  return {
    key: buildKey({ ...DEFAULTS, ...settings }),
    svgs: [encodeStill(quantize(rgba, 40, 30, 8), { fit: 'cover' })],
    preview: '',
    w: 40,
    h: 30,
    colors: 8,
    source: String(settings.path),
    sourceW: 40,
    sourceH: 30,
    quality: 'hd',
  }
}
