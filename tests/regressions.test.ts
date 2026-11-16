/**
 * One test for each problem the 0.1.0 pre-release review found, so none comes back.
 */
import { expect, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'

import { buildKey, widestFit } from '../hooks/build'
import { encodeDashLayers } from '../hooks/dash'
import { encodePreview } from '../hooks/encode'
import { idFor } from '../hooks/library'
import { decodeSize, MAX_PIXELS, MediaError } from '../hooks/media'
import { samePath } from '../hooks/paths'
import { hex, quantize, TRANSPARENT } from '../hooks/quantize'
import type { Indexed, Rgb } from '../hooks/quantize'
import { DEFAULTS, isOwnSvg } from '../hooks/settings'
import { FOLLOW_MS } from '../hooks/shared'
import { answerText, Told } from '../hooks/text'
import { BACKDROP, ENTRIES, fake, otherArt, PANE, REMOVALS, SNAPSHOT, THUMBS, toBase64, warm } from './harness'

const RED = 'T:/pictures/red.png'
const BLUE = 'T:/pictures/blue.png'
const LAKE = 'T:/pictures/lake.png'

const solid = (c: Rgb) => (w: number, h: number) => {
  const rgba = new Uint8Array(w * h * 4)

  for (let i = 0; i < w * h; i++) {
    rgba.set([c[0], c[1], c[2], 255], i * 4)
  }

  return rgba
}
const asFile = (text: string) => toBase64(new TextEncoder().encode(text))

/** Palette numbers in runs of one to six. */
function noise(w: number, h: number, colours: number, seed = 1): Indexed {
  let s = seed
  const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const palette: Rgb[] = Array.from({ length: colours }, (_, i) => [(i * 53) % 256, (i * 97) % 256, (i * 151) % 256])
  const px = new Uint8Array(w * h)
  let v = 0

  for (let i = 0; i < px.length; i++) {
    if (rand() < 0.35) {
      v = Math.floor(rand() * colours)
    }
    px[i] = v
  }

  return { w, h, palette, px }
}

test('a thumbnail and a conversion at the same time each get their own picture', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(BLUE, { w: 64, h: 36, draw: solid([30, 60, 220]) })
  f.sources.set(RED, { w: 64, h: 36, draw: solid([220, 40, 40]) })
  f.putEntry({ id: 'b', name: 'blue', path: BLUE })
  f.slowDecodeMs = 40
  f.slowReadMs = 30
  // Opening the panel starts the blue thumbnail; the red conversion starts while it runs.
  await f.command('panel')
  await f.command(`set ${RED}`)
  await f.until(() => (f.text(`${THUMBS}/b.svg`) ?? '') !== '')
  const thumb = f.text(`${THUMBS}/b.svg`) ?? ''
  const ui = await $.ui.mount({ ...BACKDROP })
  const backdrop = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source)).join('')

  expect(thumb).toContain('#1e3cdc')
  expect(thumb).not.toContain('#dc2828')
  expect(backdrop).toContain('#dc2828')
  expect(backdrop).not.toContain('#1e3cdc')
  expect(f.tempFiles().every(k => f.text(k) === '') && f.tempFiles().length === 1).toBe(true)
  await ui.unmount()
})

test('the temporary file is emptied even when reading it fails', async ($, on) => {
  const f = fake($, on)

  // FFmpeg "writes" fewer bytes than asked for.
  f.sources.set(RED, { w: 64, h: 36, draw: () => new Uint8Array(16).fill(200) })
  expect(await f.command(`set ${RED}`)).toContain('less than expected')
  expect(f.tempFiles().every(k => f.text(k) === '') && f.tempFiles().length === 1).toBe(true)
})

test('a damaged library entry is left as it is, and the others still show', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)
  const damaged = '{"version":1,"id":"b","name":"sea","pa'

  f.putEntry({ id: 'a', name: 'lake', path: LAKE })
  f.files.set(`${ENTRIES}/b.json`, asFile(damaged))
  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command('panel')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /could not be read/ }))?.text).toContain('left as they are')
  expect((await ui.find({ type: 'Button', key: 'use-a' }))?.key).toBe('use-a')
  await ui.input({ key: 'add', text: RED })
  await f.until(() => f.themes.length > 0)
  expect(f.text(`${ENTRIES}/b.json`)).toBe(damaged)
  expect([...f.entries().keys()].filter(id => id !== 'b').map(id => f.entries().get(id)?.name).sort()).toEqual(['lake', 'red'])
  await ui.unmount()
})

test('pictures added from two windows are both kept', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.putEntry({ id: 'a', name: 'lake', path: LAKE })
  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command('panel')
  // Another window adds a picture after this one has read the library.
  f.putEntry({ id: 'w', name: 'other window', path: 'T:/pictures/other.png', addedAt: 2 })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.input({ key: 'add', text: RED })
  await f.until(() => f.themes.length > 0)
  expect([...f.entries().values()].map(e => e.name).sort()).toEqual(['lake', 'other window', 'red'])
  // The panel shows the library as it is on disk, the other window's picture included.
  expect((await ui.find({ type: 'Button', key: 'use-w' }))?.key).toBe('use-w')
  await ui.unmount()
})

test('off during a conversion stays off when the conversion ends', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  f.slowProbeMs = 9000
  expect(await f.command(`set ${RED}`)).toContain('background')
  expect(await f.command('off')).toContain('is off')
  const themes = f.themes.length

  await f.until(() => f.toasts.length > 0)
  const status = await f.command('status')

  expect(status).toContain('Backdrop: off')
  expect(status).toContain('Picture: red.png')
  expect(f.themes.length).toBe(themes)
})

test('while off, changing a setting leaves the theme alone', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  // Never shown: nothing of ours to take down, so another mod's theme stays.
  await f.command('off')
  await f.command('tint off')
  expect(f.clears).toBe(0)
  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  await f.command('off')
  expect(f.clears).toBe(1)
  await f.command('tint on')
  await f.command('fit contain')
  expect(f.clears).toBe(1)
})

test('a phone photo stored on its side keeps its shape', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  // Shown 80 wide and 120 tall; stored 120 x 80 with a quarter-turn mark.
  f.sources.set(RED, { w: 80, h: 120, draw: warm, turned: true })
  await f.command(`set ${RED}`)
  expect(f.runs.at(-1)?.join(' ')).toContain('scale=80:120')
  await f.command('size 40')
  expect(f.runs.at(-1)?.join(' ')).toContain('scale=40:60')
  const ui = await $.ui.mount({ ...BACKDROP })

  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain("viewBox='0 0 40 60'")
  await ui.unmount()
})

test('a long, thin picture is decoded within the engine limit, or refused', () => {
  const thin = decodeSize({ w: 1, h: 17000 }, 160)

  expect(thin.w * thin.h).toBeLessThanOrEqual(MAX_PIXELS)
  expect(thin.h / thin.w).toBeGreaterThan(10000)
  expect(() => decodeSize({ w: 1, h: 2_000_000 }, 160)).toThrow(MediaError)
})

test('previews and thumbnails stay within their size, however tall the picture', () => {
  const thumb = encodePreview(noise(48, 85, 8, 5), 112, 6000)
  const preview = encodePreview(noise(64, 4000, 24, 7), 320, 50000)

  expect(thumb.length).toBeGreaterThan(0)
  expect(thumb.length).toBeLessThanOrEqual(6000)
  expect(preview.length).toBeGreaterThan(0)
  expect(preview.length).toBeLessThanOrEqual(50000)
  // A tall preview fits its box by height.
  expect(preview).toContain("height='320'")
})

test('see-through stripes do not hide the picture from the palette', () => {
  const w = 400
  const h = 300
  const rgba = new Uint8Array(w * h * 4)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      rgba.set(x % 2 === 0 ? [0, 0, 0, 0] : [220, 30, 30, 255], (y * w + x) * 4)
    }
  }
  const art = quantize(rgba, w, h, 24)

  expect(art.palette.length).toBeGreaterThan(0)
  expect(art.px.filter(v => v !== TRANSPARENT).length).toBe(60000)
})

test('high quality tries the narrowest width before giving up', { timeoutMs: 60000 }, async () => {
  const art = noise(64, 4096, 8, 11)
  const rgba = new Uint8Array(art.w * art.h * 4)

  art.px.forEach((v, i) => {
    const c = art.palette[v] ?? [0, 0, 0]
    rgba.set([c[0], c[1], c[2], 255], i * 4)
  })
  const made = await widestFit({ w: art.w, h: art.h, rgba, sourceW: art.w, sourceH: art.h }, 8, { fit: 'cover' }, async () => {})

  expect(made).toBeDefined()
  expect(made?.decoded.w ?? 0).toBeLessThan(64)
  expect(made?.svgs.every(s => s.length <= 125000)).toBe(true)
})

test('only files on this computer reach FFmpeg', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)
  const url = 'https://example.com/a.png'

  f.putEntry({ id: 'u', name: 'remote', path: url })
  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command('panel')
  // Its thumbnail fails, and is saved empty so the card says so.
  await f.until(() => f.text(`${THUMBS}/u.svg`) !== undefined)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'use-u' })
  for (let i = 0; i < 50; i++) {
    await f.clock.advance(20)
  }
  expect((await ui.find({ type: 'Text', text: /only files on this computer/ }))?.text).toContain('a.png')
  await f.command(`set ${RED}`)
  expect(f.runs.some(argv => argv.some(a => a.includes('example.com')))).toBe(false)
  for (const argv of f.runs.filter(a => (a[0] ?? '').includes('ff') && a.includes('-v'))) {
    expect(argv.slice(argv.indexOf('-protocol_whitelist'), argv.indexOf('-protocol_whitelist') + 2)).toEqual(['-protocol_whitelist', 'file'])
    // Only formats that read one local file: no playlist or concat list named like a picture.
    expect(argv.slice(argv.indexOf('-format_whitelist'), argv.indexOf('-format_whitelist') + 2)).toEqual(['-format_whitelist', 'image2,gif,mov,mp4,m4a,3gp,3g2,mj2'])
  }
  await ui.unmount()
})

test('documents read back must be exactly of the forms pixelbg writes', () => {
  const head = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 4'>"

  for (const foreign of [
    `${head}<defs><path id='z0' d='M0 0.5h4'/></defs><g stroke='#000000'><use href='https://example.com/x#z0' stroke-dasharray='1 1'/></g></svg>`,
    `${head}<!-- a comment --></svg>`,
    `${head}<rect x='0' y='0' width='4' height='4' fill='red'/></svg>`,
    `${head}<path stroke='#000000' d='M0 0.5h4' onclick='x'/></svg>`,
    `${head}<path stroke='#000000' d='M0 0.5h4 L 9 9 Q'/></svg>`,
    `${head}<rect x='0' y='0' width='4' height='4' fill='#000000' style='x'/></svg>`,
  ]) {
    expect({ foreign, own: isOwnSvg(foreign) }).toEqual({ foreign, own: false })
  }
  expect(isOwnSvg(`${head}<defs><path id='z0' d='M0 0.5h4v1h-4'/></defs><g stroke='#000000'><use href='#z0' stroke-dasharray='0 2 2 9'/></g></svg>`)).toBe(true)
})

test('the backdrop is drawn in the desktop app only', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'mobile' })

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('the system language is looked up once, and only where there is something to ask', { timeoutMs: 30000 }, async ($, on) => {
  const windows = fake($, on, { env: { LANG: '', OS: 'Windows_NT' } })

  windows.locale = 'zh-TW'
  await windows.start()
  expect(await windows.command('help')).toContain('像素背景')
  await windows.command('language en')
  await windows.command('language auto')
  expect(windows.runs.filter(argv => argv[0] === 'reg').length).toBe(1)
  expect(windows.runs.some(argv => argv[0] === 'defaults')).toBe(false)
})

test('elsewhere than Windows and macOS, no program is asked for the language', async ($, on) => {
  const linux = fake($, on, { env: { LANG: '', HOME: '/var/empty' } })

  await linux.start()
  expect(await linux.command('help')).toContain('Pixel backdrop')
  expect(linux.runs.length).toBe(0)
})

// --- From the third review --------------------------------------------------------------------

test('a session that has not yet seen another session’s new picture keeps it when it changes something', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  const mine = f.snapshot() as { revision: number; chosen: Record<string, number>; settings: Record<string, unknown> }
  const settings = { ...mine.settings, path: BLUE }

  // Another session picks the blue picture; this one, before it looks, dims the backdrop.
  f.putSnapshot({ ...mine, id: 'other', revision: mine.revision + 1, chosen: { ...mine.chosen, path: mine.revision + 1 }, settings, art: otherArt(settings) })
  await f.command('dim 50')
  const shared = f.snapshot() as { settings: { path: string; dim: number }; art: { source: string } }

  expect(shared.settings.path).toBe(BLUE)
  expect(shared.settings.dim).toBe(0.5)
  expect(shared.art.source).toBe(BLUE)
  expect(await f.command('status')).toContain('Picture: blue.png')
})

test('a library entry that cannot be read is never written over', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.putEntry({ id: 'a', name: 'lake', path: LAKE })
  const original = f.files.get(`${ENTRIES}/a.json`)

  f.unreadable.add(`${ENTRIES}/a.json`)
  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command('panel')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /could not be read/ }))?.text).toContain('left as they are')
  await ui.input({ key: 'add', text: RED })
  await f.until(() => f.themes.length > 0)
  expect(f.files.get(`${ENTRIES}/a.json`)).toBe(original)
  await ui.unmount()
})

test('a relative path is kept as the absolute path of the file this session meant', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set('cover.png', { w: 64, h: 36, draw: warm })
  await f.command('set cover.png')
  expect((f.snapshot()?.settings as { path?: string } | undefined)?.path).toBe('T:/work/cover.png')
})

test('a picture whose name holds a printf pattern is read as named', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set('T:/pictures/frame %02d.png', { w: 64, h: 36, draw: warm })
  f.sources.set('T:/pictures/anim %d.gif', { w: 64, h: 36, draw: warm })
  await f.command('set T:/pictures/frame %02d.png')
  for (const argv of f.runs.filter(a => a.some(x => x.endsWith('frame %02d.png')))) {
    expect(argv.join(' ')).toContain('-f image2 -pattern_type none')
  }
  await f.command('set T:/pictures/anim %d.gif')
  // GIF has a reader of its own, which takes the name as it is (and has no such option).
  for (const argv of f.runs.filter(a => a.some(x => x.endsWith('anim %d.gif')))) {
    expect(argv.includes('-pattern_type')).toBe(false)
  }
})

test('an ordinary tall picture is not refused by rounding', () => {
  const size = decodeSize({ w: 800, h: 1440 }, 1200, true)

  expect(size.w * size.h).toBeLessThanOrEqual(MAX_PIXELS)
  expect(size.w).toBeGreaterThan(700)
})

test('off works even when the backdrop is missing and the picture has moved', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.putSnapshot({ version: 1, id: 's1', revision: 1, chosen: {}, settings: { path: 'T:/moved/away.png', enabled: true } })
  expect(await f.command('off')).toContain('is off')
  expect(await f.command('status')).toContain('Backdrop: off')
  expect(f.decodes()).toBe(0)
})

test('off while the theme is still being set leaves it off on screen', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  f.slowThemeMs = 1000
  let done = 0
  const glass = $.command.run({ command: 'pixelbg', args: 'glass 8 70' } as never).then(() => (done += 1))

  await f.clock.advance(10)
  const off = $.command.run({ command: 'pixelbg', args: 'off' } as never).then(() => (done += 1))

  await f.until(() => done === 2)
  await Promise.all([glass, off])
  expect(f.themeOps.at(-1)).toBe('clear')
})

// --- From the fourth review -------------------------------------------------------------------

/** A slider in the panel let go (or still dragged) at `index` of its steps, as its Client posts it. */
function slide(ui: Mounted<'desktop', 'Pane'>, id: string, index: number, final: boolean): Promise<void> {
  return ui.post({ kind: 'slider', id, index, final }, { in: `slider-${id}` })
}

test('a failed save changes nothing, and the same change works once saving does', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  const before = f.snapshot()
  const themes = f.themes.length

  f.refuse = path => path === SNAPSHOT
  expect(await f.command('dim 50')).not.toContain('Updated')
  expect(f.snapshot()).toEqual(before)
  expect(f.themes.length).toBe(themes)
  expect(await f.command('status')).toContain('dim 15%')
  f.refuse = () => false
  await f.command('dim 50')
  expect((f.snapshot()?.settings as { dim?: number }).dim).toBe(0.5)
  expect(await f.command('status')).toContain('dim 50%')
})

test('a change made in another window during a conversion is kept, and both end on one snapshot', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)
  let done = false

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  f.slowProbeMs = 2000
  const pending = $.command.run({ command: 'pixelbg', args: `set ${RED}` } as never).then(() => (done = true))

  await f.clock.advance(100)
  // Another window dims the backdrop while this one converts.
  f.putSnapshot({ version: 1, id: 'other', revision: 1, chosen: { dim: 1 }, settings: { ...DEFAULTS, dim: 0.5 } })
  await f.until(() => done)
  await pending
  const shared = f.snapshot() as { id: string; settings: { path: string; dim: number; enabled: boolean }; art: { source: string } }

  expect(shared.settings.path).toBe(RED)
  expect(shared.settings.enabled).toBe(true)
  expect(shared.settings.dim).toBe(0.5)
  expect(shared.art.source).toBe(RED)
  // This session shows exactly what is on disk.
  expect(await f.command('status')).toContain('dim 50%')
})

test('a picture another window chose during a conversion stays, and the answer says so', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)
  let answer = ''

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  f.slowProbeMs = 2000
  const pending = $.command.run({ command: 'pixelbg', args: `set ${RED}` } as never).then(r => (answer = String((r as { text?: string }).text)))

  await f.clock.advance(100)
  const settings = { ...DEFAULTS, path: BLUE, enabled: true }

  f.putSnapshot({ version: 1, id: 'other', revision: 1, chosen: { path: 1, enabled: 1 }, settings, art: otherArt(settings) })
  await f.until(() => answer !== '')
  await pending
  expect(answer).toContain('Another window changed the picture meanwhile')
  expect((f.snapshot()?.settings as { path?: string }).path).toBe(BLUE)
  const ui = await $.ui.mount({ ...BACKDROP })

  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain("viewBox='0 0 40 30'")
  await ui.unmount()
})

test('a session that starts after a fit change shows that fit without converting', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)
  const settings = { ...DEFAULTS, path: BLUE, fit: 'contain' }

  // The backdrop on disk was made for "cover"; the settings say "contain".
  f.putSnapshot({ version: 1, id: 'x', revision: 1, chosen: {}, settings, art: otherArt(settings) })
  f.sources.set(BLUE, { w: 40, h: 30, draw: warm })
  await f.start()
  const ui = await $.ui.mount({ ...BACKDROP })

  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain("preserveAspectRatio='xMidYMid meet'")
  expect(f.decodes()).toBe(0)
  await ui.unmount()
})

test('a snapshot this version cannot read is never written over, and older files are left alone', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)
  const later = asFile(JSON.stringify({ version: 2, id: 'later', settings: {} }))
  const old = asFile(JSON.stringify({ version: 1, stamp: 's1', settings: { path: LAKE } }))

  f.files.set(SNAPSHOT, later)
  f.files.set('T:/local/pixelbg/state.json', old)
  f.files.set('T:/local/pixelbg/library.json', old)
  await f.start()
  expect(await f.command('dim 50')).toContain('settings file could not be read')
  expect(f.files.get(SNAPSHOT)).toBe(later)
  // A file that exists but cannot be read is treated the same way, never as missing.
  f.unreadable.add(SNAPSHOT)
  expect(await f.command('off')).toContain('settings file could not be read')
  expect(f.files.get(SNAPSHOT)).toBe(later)
  expect(f.files.get('T:/local/pixelbg/state.json')).toBe(old)
  expect(f.files.get('T:/local/pixelbg/library.json')).toBe(old)
  expect(f.themes.length).toBe(0)
})

test('letting go of one slider saves that setting only, never one still being dragged', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Blur is being dragged (index 3: 8) while opacity is let go at index 14 (70%).
  await slide(ui, 'blur', 3, false)
  await slide(ui, 'opacity', 14, true)
  await f.until(() => (f.snapshot()?.settings as { opacity?: number }).opacity === 0.7)
  expect((f.snapshot()?.settings as { blur?: number }).blur).toBe(0)
  // The blur shown follows the drag; letting go of it saves it.
  expect(f.themes.at(-1)).toContain('"blur":8')
  await slide(ui, 'blur', 3, true)
  await f.until(() => (f.snapshot()?.settings as { blur?: number }).blur === 8)
  expect((f.snapshot()?.settings as { opacity?: number }).opacity).toBe(0.7)
  await ui.unmount()
})

test('colours and width let go together are converted once, together', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  await f.command('size 96')
  const decodes = f.decodes()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Colours to 12 (index 2), then width to 64 (index 1), within the settling time.
  await slide(ui, 'colors', 2, true)
  await f.clock.advance(100)
  await slide(ui, 'width', 1, true)
  await f.until(() => (f.snapshot()?.settings as { width?: number }).width === 64)
  await f.clock.advance(500)
  expect((f.snapshot()?.settings as { colors?: number }).colors).toBe(12)
  expect(f.decodes()).toBe(decodes + 1)
  await ui.unmount()
})

test('off chosen again during a conversion still wins, even when it was already off', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)
  let done = false

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  await f.command('off')
  const themes = f.themes.length

  f.slowProbeMs = 2000
  const pending = $.command.run({ command: 'pixelbg', args: `set ${RED}` } as never).then(() => (done = true))

  await f.clock.advance(100)
  await f.command('off')
  await f.until(() => done)
  await pending
  expect(await f.command('status')).toContain('Backdrop: off')
  expect(f.themes.length).toBe(themes)
})

test('a theme the host failed to clear is cleared by the next change', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  f.refuseClears = 1
  expect(await f.command('off')).not.toContain('is off')
  expect(f.clears).toBe(0)
  await f.command('off')
  expect(f.clears).toBe(1)
  expect(f.themeOps.at(-1)).toBe('clear')
})

test('a thumbnail finished after its entry was removed never brings the entry back', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.putEntry({ id: 'a', name: 'lake', path: LAKE })
  f.sources.set(LAKE, { w: 64, h: 36, draw: warm })
  f.slowDecodeMs = 500
  await f.command('panel')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'del-a' })
  await f.until(() => (f.text(`${THUMBS}/a.svg`) ?? '') !== '')
  expect(f.isRemoved('a')).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'use-a' })).toBeUndefined()
  await ui.unmount()
})

test('when a library change cannot be saved, the panel keeps showing what is on disk', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.putEntry({ id: 'a', name: 'lake', path: LAKE })
  await f.command('panel')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  f.refuse = path => path === `${REMOVALS}/a.json`
  await ui.press({ key: 'del-a' })
  await f.clock.advance(100)
  expect((await ui.find({ type: 'Button', key: 'use-a' }))?.key).toBe('use-a')
  expect(await ui.find({ type: 'Button', key: 'undo' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^⚠/ }))?.text).toMatch(/^⚠ ./)
  await ui.unmount()
})

test('thumbnails are made for pictures added while others are being made', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on, { env: { USERPROFILE: 'T:/me' } })
  const recent = 'T:/me/Downloads/red.png'

  f.putEntry({ id: 'a', name: 'lake', path: LAKE })
  f.sources.set(LAKE, { w: 64, h: 36, draw: warm })
  f.files.set(recent, 'cGljdHVyZQ==')
  f.sources.set(recent, { w: 64, h: 36, draw: solid([220, 40, 40]) })
  f.slowDecodeMs = 300
  await f.command('panel')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Added from the recent list (which applies nothing) while the first thumbnail is still made.
  await ui.press({ key: 'recent-toggle' })
  await f.clock.advance(20)
  await ui.press({ key: 'recent-0' })
  await f.until(() => f.entries().size === 2 && [...f.entries().keys()].every(id => (f.text(`${THUMBS}/${id}.svg`) ?? '') !== ''))
  await ui.unmount()
})

test('without a user folder for its files, pixelbg saves nothing', { timeoutMs: 30000 }, async ($, on) => {
  // LOCALAPPDATA is not absolute and there is no home folder.
  const f = fake($, on, { env: { LOCALAPPDATA: 'pixelbg-data', USERPROFILE: '', HOME: '' } })

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  expect(await f.command(`set ${RED}`)).toContain('found no user folder')
  expect([...f.files.keys()]).toEqual([])
  expect(f.decodes()).toBe(0)
})

test('a temporary file that cannot be emptied is reported, and nothing is committed', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  f.refuse = (path, text) => path.startsWith('T:/tmp/pixelbg/still-') && text === ''
  expect(await f.command(`set ${RED}`)).toContain('could not empty its temporary file')
  expect(f.snapshot()).toBeUndefined()
  expect(f.themes.length).toBe(0)
})

test('error answers write the home folder as ~', { timeoutMs: 30000 }, async ($, on) => {
  // As Windows gives it, with backslashes, while the answer's path has forward ones.
  const f = fake($, on, { env: { USERPROFILE: ['T:', 'me'].join(String.fromCharCode(92)) } })
  const answer = await f.command('set T:/me/Pictures/missing.png')

  // The file's name only: neither the home folder nor any folder in it.
  expect(answer).toContain('missing.png')
  expect(answer).not.toContain('T:/me')
  expect(answer).not.toContain('Pictures/')
})

test('a path from the root gets the session’s drive', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command('set /pictures/red.png')
  expect((f.snapshot()?.settings as { path?: string }).path).toBe(RED)
})

test('choosing the same picture again converts it again (it may have changed on disk)', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  await f.command(`set ${RED}`)
  expect(f.decodes()).toBe(2)
})

test('the same file: Windows paths ignore case and slashes, other paths do not', () => {
  expect(samePath('T:/Pictures/Lake.PNG', 't:\\pictures\\lake.png')).toBe(true)
  expect(samePath('/srv/me/Lake.png', '/srv/me/lake.png')).toBe(false)
  expect(samePath('/srv/me/lake.png', '/srv/me/lake.png')).toBe(true)
})

test('a one-colour picture makes a dashed document without empty defs', () => {
  const art = quantize(solid([10, 20, 30])(16, 8), 16, 8, 8)
  const docs = encodeDashLayers(art, { fit: 'cover' }, 125000) ?? []

  expect(docs.length).toBe(1)
  expect(docs[0]).not.toContain('<defs')
  expect(isOwnSvg(docs[0] ?? '')).toBe(true)
})

test('a pattern in step with a fixed sampling stride still shows all its colours', () => {
  // 240,000 pixels: a fixed stride of 4 would see only the first of every four columns.
  const w = 480
  const h = 500
  const rgba = new Uint8Array(w * h * 4)

  for (let i = 0; i < w * h; i++) {
    rgba.set(i % 4 === 0 ? [220, 30, 30, 255] : [30, 60, 220, 255], i * 4)
  }
  const art = quantize(rgba, w, h, 8)

  expect(art.palette.map(hex).sort()).toEqual(['#1e3cdc', '#dc1e1e'])
})

test('a language chosen while the system’s is still being looked up stays chosen', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on, { env: { LANG: '', OS: 'Windows_NT' } })
  let started = false

  f.locale = 'zh-TW'
  f.slowLocaleMs = 3000
  const start = $.session.start({ cwd: 'T:/work', surface: 'desktop', isInteractive: true }).then(() => (started = true))

  await f.clock.advance(10)
  expect(await f.command('language ja')).toContain('言語：ja')
  await f.until(() => started)
  await start
  expect(await f.command('help')).toContain('ピクセル背景')
})

// ---------------------------------------------------------------------------------------
// From the real-app check

/** The panel's status row: the text beside the on/off dot. */
async function statusText(ui: Mounted<'desktop', 'Pane'>): Promise<string> {
  const texts = await ui.findAll({ type: 'Text' })
  const dot = texts.findIndex(x => x.text === '●' || x.text === '○')

  return texts[dot + 1]?.text ?? ''
}

/** The status row once it reads as wanted, with time moving on meanwhile. */
async function statusWhen(f: ReturnType<typeof fake>, ui: Mounted<'desktop', 'Pane'>, ok: (text: string) => boolean): Promise<string> {
  for (let i = 0; i < 2000; i++) {
    const text = await statusText(ui)

    if (ok(text)) {
      return text
    }
    await f.clock.advance(20)
  }
  throw new Error(`the status row never came right: ${await statusText(ui)}`)
}

test('the status row drops a result once another window has changed the picture', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.start()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.input({ key: 'add', text: RED })
  await statusWhen(f, ui, text => /High quality: chose \d+ wide/.test(text))
  const mine = f.snapshot() as { revision: number; chosen: Record<string, number>; settings: Record<string, unknown> }
  const settings = { ...DEFAULTS, ...mine.settings, path: BLUE }

  // Another window picks another picture; this one takes it up on its next look.
  f.putSnapshot({ version: 1, id: 'other', revision: mine.revision + 1, chosen: { ...mine.chosen, path: mine.revision + 1 }, settings, art: otherArt(settings) })
  await f.clock.advance(FOLLOW_MS + 100)
  expect(await statusWhen(f, ui, text => !/High quality/.test(text))).toBe('Backdrop on')
  await ui.unmount()
})

test('the status row drops a result written in another language', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.start()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.input({ key: 'add', text: RED })
  await statusWhen(f, ui, text => /High quality: chose/.test(text))
  await f.command('language ja')
  expect(await statusText(ui)).toBe('背景オン')
  await ui.unmount()
})

// ---------------------------------------------------------------------------------------
// From the fifth review

test('a picture chosen while another window picks a colour count shows, in the colours chosen last', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)
  let done = false

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  f.slowProbeMs = 2000
  const pending = $.command.run({ command: 'pixelbg', args: `set ${RED}` } as never).then(() => (done = true))

  await f.clock.advance(100)
  // Another window, with no picture yet, chooses 12 colours and saves first.
  f.putSnapshot({ version: 1, id: 'other', revision: 1, chosen: { colors: 1 }, settings: { ...DEFAULTS, colors: 12 } })
  await f.until(() => done)
  await pending
  const shared = f.snapshot() as { settings: { path: string; colors: number; enabled: boolean }; art?: { key: string } }

  expect(shared.settings.path).toBe(RED)
  expect(shared.settings.colors).toBe(12)
  expect(shared.art?.key).toBe(buildKey({ ...DEFAULTS, path: RED, enabled: true, colors: 12 }))
  expect(f.themes.length).toBeGreaterThan(0)
})

test('off chosen in another window while a picture converts stays off', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)
  let done = false

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  f.slowProbeMs = 2000
  const pending = $.command.run({ command: 'pixelbg', args: `set ${RED}` } as never).then(() => (done = true))

  await f.clock.advance(100)
  f.putSnapshot({ version: 1, id: 'other', revision: 1, chosen: { colors: 1, enabled: 1 }, settings: { ...DEFAULTS, colors: 12, enabled: false } })
  await f.until(() => done)
  await pending
  const shared = f.snapshot() as { settings: { path: string; enabled: boolean } }

  expect(shared.settings.path).toBe(RED)
  expect(shared.settings.enabled).toBe(false)
  expect(f.themes.length).toBe(0)
})

test('turning on after the colours changed while off shows the backdrop in those colours', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  await f.command('off')
  await f.command('colors 12')
  const before = f.themes.length

  await f.command('on')
  const shared = f.snapshot() as { art?: { key: string } }

  expect(shared.art?.key).toBe(buildKey({ ...DEFAULTS, path: RED, enabled: true, colors: 12 }))
  expect(f.themes.length).toBeGreaterThan(before)
})

test('command answers never name the folders of a path the user did not type', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.cwd = 'T:/work/ExampleProject'
  const missing = await f.command('set ./missing.png')

  expect(missing).toContain('missing.png')
  expect(missing).not.toContain('ExampleProject')
  // FFmpeg's own error line names the file with its folders.
  f.files.set('T:/work/ExampleProject/broken.png', '')
  f.probeError = 'file:T:/work/ExampleProject/broken.png: Invalid data found when processing input'
  const broken = await f.command('set ./broken.png')

  expect(broken).toContain('broken.png')
  expect(broken).not.toContain('ExampleProject')
  f.probeError = ''
  // A chosen FFmpeg is named by its file name only, here and in the status.
  expect(await f.command('ffmpeg T:/tools/ExampleTools/ffmpeg.exe')).not.toContain('ExampleTools')
  expect(await f.command('ffmpeg')).not.toContain('ExampleTools')
  expect(await f.command('status')).not.toContain('ExampleTools')
})

test('on Linux, Windows-style folders in the environment are skipped, and nothing lands in the project', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on, { env: { OS: '', LOCALAPPDATA: 'T:/local', TEMP: 'T:/temp', TMP: '', USERPROFILE: '', HOME: '/srv/me' } })

  f.cwd = '/srv/project'
  f.sources.set('/srv/me/pictures/red.png', { w: 64, h: 36, draw: warm })
  await f.start()
  expect(await f.command('set /srv/me/pictures/red.png')).toContain('red.png')
  expect(f.text('/srv/me/.pixelbg/current.json')).toBeDefined()
  expect([...f.files.keys()].filter(k => !k.startsWith('/'))).toEqual([])
})

test('a window whose theme the host refused to clear tries again on its next look', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.start()
  await f.command(`set ${RED}`)
  const mine = f.snapshot() as { revision: number; chosen: Record<string, number>; settings: Record<string, unknown> }

  // Another window turns the backdrop off; the host refuses this window's first clear.
  f.putSnapshot({ ...mine, id: 'other', revision: mine.revision + 1, chosen: { ...mine.chosen, enabled: mine.revision + 1 }, settings: { ...mine.settings, enabled: false } })
  f.refuseClears = 1
  await f.clock.advance(FOLLOW_MS + 100)
  expect(f.clears).toBe(0)
  await f.clock.advance(FOLLOW_MS + 100)
  expect(f.clears).toBe(1)
})

test('a removal made while the same card is being renamed stays removed', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.putEntry({ id: 'a', name: 'lake', path: LAKE })
  await f.command('panel')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // The rename reads the entry, and its answer comes late: the removal lands in between.
  f.slowReadOnce.set(`${ENTRIES}/a.json`, 1000)
  await ui.press({ key: 'ren-a' })
  await ui.input({ key: 'name-a', text: 'renamed' })
  await ui.press({ key: 'del-a' })
  await f.clock.advance(1500)
  expect(f.isRemoved('a')).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'use-a' })).toBeUndefined()
  await ui.unmount()
})

test('pasting the same picture into the add box again converts it again', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.input({ key: 'add', text: RED })
  await f.until(() => f.themes.length > 0)
  const pixels = () => JSON.stringify((f.snapshot() as { art?: { svgs: string[] } }).art?.svgs)
  const before = pixels()

  // The file changes on disk, and is pasted again: the backdrop itself is made anew.
  f.sources.set(RED, { w: 64, h: 36, draw: solid([20, 40, 200]) })
  await ui.input({ key: 'add', text: RED })
  await f.until(() => pixels() !== before)
  expect(pixels()).not.toBe(before)
  await ui.unmount()
})

test('a network share is refused before anything looks at it', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)
  const share = ['', '', 'server', 'share', 'pic.png'].join(String.fromCharCode(92))

  expect(await f.command(`set ${share}`)).toContain('only files on this computer')
  expect(await f.command('set //server/share/pic.png')).toContain('only files on this computer')
  expect(f.lookups.filter(path => path.includes('server'))).toEqual([])
  expect(f.runs.filter(argv => argv.join(' ').includes('server'))).toEqual([])
})

test('a thumbnail whose temporary file cannot be emptied says so in the panel', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.putEntry({ id: 'a', name: 'lake', path: LAKE })
  f.sources.set(LAKE, { w: 64, h: 36, draw: warm })
  f.refuse = (path, text) => path.includes('/still-') && text === ''
  await f.command('panel')
  await f.until(() => f.decodes() > 0)
  await f.clock.advance(500)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = (await ui.find({ type: 'Text', text: /could not empty/ }))?.text ?? ''

  // Where it is, with the variable it came from: enough to find it, nothing of whose.
  expect(row).toContain('%TEMP%/pixelbg/still-')
  // Not kept as a picture that cannot be read: it is tried again.
  expect(f.text(`${THUMBS}/a.svg`)).toBeUndefined()
  await ui.unmount()
})
test('an error line that names other folders stays out of the answer, and the panel keeps it', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  // FFmpeg fails over some other file, which it names with its folders, one with a space.
  f.files.set('T:/work/broken.png', '')
  f.probeError = 'error while loading shared libraries: T:/opt/Studio Team/libthing.dll'
  const answer = await f.command('set ./broken.png')

  expect(answer).toContain('/pixelbg panel shows the details')
  expect(answer).not.toContain('Studio')
  expect(answer).not.toContain('Team')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /libthing/ }))?.text).toContain('Studio Team')
  await ui.unmount()
})

test('answers are made of what pixelbg knows is safe, never of a system message', () => {
  // A system error whose message names folders with spaces and an apostrophe: its code only.
  const system = answerText(new Error("EEXIST: file already exists, mkdir 'T:/ordinary failure/Studio Team/O'Brien files/pixelbg'"))

  expect(system).toContain('EEXIST')
  for (const word of ['ordinary', 'Studio', 'Brien', 'pixelbg\'']) {
    expect(system).not.toContain(word)
  }
  // FFmpeg's detail when it names no folder, else a pointer to the panel.
  expect(answerText(new MediaError('probe', 'Invalid data found when processing input'))).toContain('Invalid data found')
  expect(answerText(new MediaError('decode', 'T:/x/Studio Team/a.rgba: Permission denied'))).not.toContain('Studio')
  // pixelbg's own: its sentences, and the cleanup location written with its variable.
  expect(answerText(new Told('File not found: a.png'))).toBe('File not found: a.png')
  expect(answerText(new MediaError('cleanup', '%TEMP%/pixelbg/still-1.rgba'))).toContain('%TEMP%/pixelbg/still-1.rgba')
})

// ---------------------------------------------------------------------------------------
// From the sixth review

test('a colour change in another window keeps the picture chosen here, made in those colours', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)
  let done = false

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  f.sources.set(BLUE, { w: 64, h: 36, draw: solid([20, 40, 200]) })
  await f.command(`set ${RED}`)
  const mine = f.snapshot() as { revision: number; chosen: Record<string, number>; settings: Record<string, unknown> }

  f.slowProbeMs = 2000
  const pending = $.command.run({ command: 'pixelbg', args: `set ${BLUE}` } as never).then(() => (done = true))

  await f.clock.advance(100)
  // Another window only sets 12 colours, on the red picture it shows, and saves first.
  const red12 = { ...mine.settings, colors: 12 }

  f.putSnapshot({ version: 1, id: 'other', revision: mine.revision + 1, chosen: { ...mine.chosen, colors: mine.revision + 1 }, settings: red12, art: otherArt(red12) })
  await f.until(() => done)
  await pending
  const shared = f.snapshot() as { settings: { path: string; colors: number }; art?: { key: string; source: string } }

  expect(shared.settings.path).toBe(BLUE)
  expect(shared.settings.colors).toBe(12)
  expect(shared.art?.source).toBe(BLUE)
  expect(shared.art?.key).toBe(buildKey({ ...DEFAULTS, ...red12, path: BLUE } as never))
})

test('the same file chosen again in another window keeps that window’s fresher pixels', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)
  let done = false

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  f.slowProbeMs = 2000
  const pending = $.command.run({ command: 'pixelbg', args: `set ${RED}` } as never).then(() => (done = true))

  await f.clock.advance(100)
  // Meanwhile the file changed, and another window chose it again: its pixels show the new file.
  const settings = { ...DEFAULTS, path: RED, enabled: true }

  f.putSnapshot({ version: 1, id: 'other', revision: 1, chosen: { path: 1, enabled: 1 }, settings, art: otherArt(settings) })
  await f.until(() => done)
  await pending
  expect((f.snapshot() as { art: { w: number } }).art.w).toBe(40)
})

test('a backdrop the host refused to draw at the start is put up on the next look', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)
  const settings = { ...DEFAULTS, path: BLUE, enabled: true }

  f.putSnapshot({ version: 1, id: 'x', revision: 1, chosen: {}, settings, art: otherArt(settings) })
  f.refuseSets = 1
  await f.start().catch(() => undefined)
  expect(f.themes.length).toBe(0)
  await f.clock.advance(FOLLOW_MS + 100)
  expect(f.themes.length).toBe(1)
})

test('a slider let go while a conversion runs is applied once it ends', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)
  let done = false

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  f.slowProbeMs = 2000
  const pending = $.command.run({ command: 'pixelbg', args: `set ${RED}` } as never).then(() => (done = true))

  await f.clock.advance(100)
  // Colours to 12 (index 2) while the picture still converts.
  await slide(ui, 'colors', 2, true)
  await f.until(() => done)
  await pending
  await f.until(() => (f.snapshot()?.settings as { colors?: number }).colors === 12)
  expect((f.snapshot()?.settings as { colors?: number }).colors).toBe(12)
  await ui.unmount()
})

test('undo that cannot be saved keeps its button, to press again', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.putEntry({ id: 'a', name: 'lake', path: LAKE })
  await f.command('panel')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'del-a' })
  f.refuse = path => path === `${REMOVALS}/a.json`
  await ui.press({ key: 'undo' })
  await f.clock.advance(100)
  expect((await ui.find({ type: 'Button', key: 'undo' }))?.key).toBe('undo')
  f.refuse = () => false
  await ui.press({ key: 'undo' })
  await f.clock.advance(100)
  expect((await ui.find({ type: 'Button', key: 'use-a' }))?.key).toBe('use-a')
  await ui.unmount()
})

test('a removal marker that cannot be read hides its entry, says so, and is never written over', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)
  const damaged = toBase64(new TextEncoder().encode('{"version":2,'))

  f.putEntry({ id: 'a', name: 'lake', path: LAKE })
  f.files.set(`${REMOVALS}/a.json`, damaged)
  await f.command('panel')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Button', key: 'use-a' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /left as they are/ }))?.text).toContain('left as they are')
  expect(f.files.get(`${REMOVALS}/a.json`)).toBe(damaged)
  await ui.unmount()
})

test('stored entries and snapshots of the wrong shape are left alone, never rewritten', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)
  const odd = asFile(JSON.stringify({ version: 1, id: 'x', revision: 1, chosen: {}, settings: null }))

  f.files.set(SNAPSHOT, odd)
  f.putEntry({ id: 'a', name: 'lake', path: LAKE, removed: 'yes' })
  await f.start()
  expect(await f.command('dim 50')).toContain('settings file could not be read')
  expect(f.files.get(SNAPSHOT)).toBe(odd)
  await f.command('panel')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Button', key: 'use-a' })).toBeUndefined()
  await ui.unmount()
})

test('an entry’s id comes from its picture, so two windows adding it write one entry', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(LAKE, { w: 64, h: 36, draw: warm })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.input({ key: 'add', text: LAKE })
  await f.until(() => f.themes.length > 0)
  expect([...f.entries().keys()]).toEqual([idFor(LAKE)])
  // Windows paths are the same file whatever their case and slashes.
  expect(idFor('T:/Pictures/Lake.PNG')).toBe(idFor(['t:', 'pictures', 'lake.png'].join(String.fromCharCode(92))))
  await ui.unmount()
})

test('using a picture again makes its card’s thumbnail again', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.putEntry({ id: 'a', name: 'lake', path: LAKE })
  f.sources.set(LAKE, { w: 64, h: 36, draw: warm })
  await f.command('panel')
  await f.until(() => (f.text(`${THUMBS}/a.svg`) ?? '') !== '')
  const before = f.text(`${THUMBS}/a.svg`)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // The file changed on disk; Use makes the backdrop and the thumbnail anew.
  f.sources.set(LAKE, { w: 64, h: 36, draw: solid([20, 40, 200]) })
  await ui.press({ key: 'use-a' })
  await f.until(() => f.text(`${THUMBS}/a.svg`) !== before)
  expect(f.text(`${THUMBS}/a.svg`)).not.toBe(before)
  await ui.unmount()
})

test('a bare name picks the exact name before another case of it', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.putEntry({ id: 'u', name: 'big', path: 'T:/a/LAKE.PNG', addedAt: 2 })
  f.putEntry({ id: 'l', name: 'small', path: 'T:/b/lake.png', addedAt: 1 })
  f.sources.set('T:/b/lake.png', { w: 64, h: 36, draw: warm })
  f.sources.set('T:/a/LAKE.PNG', { w: 64, h: 36, draw: warm })
  await f.start()
  await f.command('set lake.png')
  expect((f.snapshot()?.settings as { path?: string }).path).toBe('T:/b/lake.png')
})

test('without a folder for its files, /pixelbg is still there to say why', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on, { env: { LOCALAPPDATA: '', USERPROFILE: '', HOME: '' } })

  await f.start().catch(() => undefined)
  expect(f.registered).toContain('pixelbg')
  expect(await f.command('dim 50')).toContain('no user folder')
})

test('when the session’s folder cannot tell the system, nothing is written anywhere', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on, { env: { OS: 'Windows_NT' } })

  f.cwd = 'somewhere'
  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  expect([...f.files.keys()]).toEqual([])
})

test('a bare drive letter is not a folder: the data goes to the home folder', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on, { env: { LOCALAPPDATA: 'T:', USERPROFILE: 'T:/me' } })

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  await f.command(`set ${RED}`)
  expect(f.text('T:/me/.pixelbg/current.json')).toBeDefined()
})

test('in a project on a network share, a bare name is never looked for there', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.cwd = '//server/share/project'
  await f.command('set cover.png')
  expect(f.lookups.filter(path => path.includes('cover') || path.includes('server'))).toEqual([])
})

test('a FFmpeg given by a relative path is kept as an absolute one, and needs ffprobe beside it', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  await f.command('ffmpeg ./bin/ffmpeg.exe')
  expect((f.snapshot()?.settings as { ffmpeg?: string }).ffmpeg).toBe('T:/work/bin/ffmpeg.exe')
  expect(f.runs.some(argv => argv[0] === 'T:/work/bin/ffprobe.exe' && argv[1] === '-version')).toBe(true)
})

test('a reason the desktop gives for not drawing reaches the answer with no folders in it', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(RED, { w: 64, h: 36, draw: warm })
  f.drawReason = 'no desktop window for T:/work/ExampleProject/session yet'
  const answer = await f.command(`set ${RED}`)

  expect(answer).toContain('no desktop window')
  expect(answer).not.toContain('ExampleProject')
})
