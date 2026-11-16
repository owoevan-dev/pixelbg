import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BACKDROP, fake, otherArt, stripes, warm } from './harness'

const PICTURE = 'T:/pictures/lake.png'
const BUSY = 'T:/pictures/busy.png'

/** The documents the backdrop draws now: the picture's layers, then the veil if any. */
async function backdrop($: Engine): Promise<string[]> {
  const ui = await $.ui.mount({ ...BACKDROP, requestId: `b${Math.random()}` })
  const svgs = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))

  await ui.unmount()

  return svgs
}

test('set: a picture becomes the backdrop, decoded once, in high quality by default', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(PICTURE, { w: 320, h: 180, draw: warm })
  const answer = await f.command(`set ${PICTURE}`)

  expect(answer).toContain('Backdrop set in')
  expect(answer).toContain('High quality: chose 320 wide')
  // Answers enter the conversation: they name the file, never its folders.
  expect(answer).toContain('Picture: lake.png')
  expect(answer).not.toContain('T:/pictures')
  expect(f.decodes()).toBe(1)
  // No copy of the picture is left in the temporary folder.
  expect(f.tempFiles().every(k => f.text(k) === '') && f.tempFiles().length === 1).toBe(true)
  const svgs = await backdrop($)

  // One picture document, then the veil (dimming 15% by default).
  expect(svgs.length).toBe(2)
  expect(svgs[0]).toContain("viewBox='0 0 320 180'")
  expect(svgs[1]).toContain("fill-opacity='0.15'")
})

test('high quality searches for the widest copy that fits two documents', { timeoutMs: 120000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(BUSY, { w: 1000, h: 600, draw: stripes })
  const answer = await f.command(`set ${BUSY}`)
  const width = Number(/chose (\d+) wide/.exec(answer)?.[1])
  const svgs = (await backdrop($)).filter(s => !s.includes("viewBox='0 0 1 1'"))

  expect(width).toBeGreaterThan(32)
  expect(width).toBeLessThan(1000)
  expect(svgs.length).toBeGreaterThanOrEqual(1)
  expect(svgs.every(s => s.length <= 125000)).toBe(true)
  // Decoded once; the search shrinks in the mod.
  expect(f.decodes()).toBe(1)
})

test('size switches to normal mode and uses that width', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(PICTURE, { w: 320, h: 180, draw: warm })
  await f.command(`set ${PICTURE}`)
  const answer = await f.command('size 96')

  expect(answer).toContain('Quality: normal (width 96')
  expect(f.runs.at(-1)?.join(' ')).toContain('scale=96:54')
  expect((await backdrop($))[0]).toContain("viewBox='0 0 96 54'")
})

test('fit, dim and glass change the backdrop without converting again', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(PICTURE, { w: 160, h: 90, draw: warm })
  await f.command(`set ${PICTURE}`)
  const decodes = f.decodes()

  await f.command('fit contain')
  await f.command('dim 40')
  await f.command('glass 8 70')
  const svgs = await backdrop($)

  expect(f.decodes()).toBe(decodes)
  expect(svgs[0]).toContain("preserveAspectRatio='xMidYMid meet'")
  expect(svgs[1]).toContain("fill-opacity='0.4'")
  expect(f.themes.at(-1)).toContain('"blur":8')
  expect(f.themes.at(-1)).toContain('"opacity":0.7')
})

test('off clears the theme and draws nothing; on brings it back', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(PICTURE, { w: 160, h: 90, draw: warm })
  await f.command(`set ${PICTURE}`)
  expect(await f.command('off')).toContain('is off')
  expect(await f.command('on')).toContain('Backdrop: on')
  expect((await backdrop($)).length).toBeGreaterThan(0)
})

test('a failed conversion changes nothing: the last backdrop and settings stay', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(PICTURE, { w: 160, h: 90, draw: warm })
  await f.command(`set ${PICTURE}`)
  // The file is there but FFmpeg cannot read it.
  f.files.set('T:/pictures/broken.png', '')
  const answer = await f.command('set T:/pictures/broken.png')

  expect(answer).toContain('FFmpeg could not read this picture')
  expect(await f.command('status')).toContain('Picture: lake.png')
})

test('wrong input gets a plain answer', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.files.set('T:/docs/notes.txt', '')
  expect(await f.command('set T:/docs/notes.txt')).toContain('takes pictures')
  expect(await f.command('set T:/nowhere/missing.png')).toContain('File not found')
  expect(await f.command('set 3')).toContain('No such number')
  expect(await f.command('colors 999')).toContain('from 2 to 64')
  expect(await f.command('quality ultra')).toContain('Give normal')
  expect(await f.command('fit stretch')).toContain('Give cover')
  expect(await f.command('language xx')).toContain('one of: en, zh-TW, zh-CN, ja')
  expect(await f.command('nonsense')).toContain('/pixelbg set')
})

test('without FFmpeg the answer says how to get it', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(PICTURE, { w: 160, h: 90, draw: warm })
  f.missing = true
  expect(await f.command(`set ${PICTURE}`)).toContain('Install FFmpeg')
  expect(await f.command('ffmpeg T:/tools/ffmpeg.exe')).toContain('does not work')
  f.missing = false
  // Named by its file name only: where it is installed stays out of the conversation.
  expect(await f.command('ffmpeg T:/tools/ffmpeg.exe')).toContain('Now using ffmpeg.exe')
  await f.command(`set ${PICTURE}`)
  expect(f.runs.at(-2)?.[0]).toBe('T:/tools/ffprobe.exe')
  expect(f.runs.at(-1)?.[0]).toBe('T:/tools/ffmpeg.exe')
})

test('a path that starts with a dash reaches FFmpeg as a file, not an option', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set('-x.png', { w: 64, h: 36, draw: warm })
  await f.command('set -x.png')
  // Made absolute in the session's folder, and given to FFmpeg as a file in any case.
  expect(f.runs.every(argv => !argv.some(a => a.startsWith('-x')))).toBe(true)
  expect(f.runs.some(argv => argv.includes('file:T:/work/-x.png'))).toBe(true)
})

test('a slow conversion answers in time, goes on, and says when it is done', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(PICTURE, { w: 160, h: 90, draw: warm })
  f.slowProbeMs = 9000
  const answer = await f.command(`set ${PICTURE}`)

  expect(f.clock.now()).toBeLessThan(10000)
  expect(answer).toContain('goes on in the background')
  // Another conversion waits its turn; quick changes do not.
  expect(await f.command('colors 8')).toContain('still running')
  await f.until(() => f.toasts.length > 0)
  expect(f.toasts.join(' ')).toContain('Backdrop set in')
})

test('the language can be chosen, and follows the system by default', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on, { env: { LANG: 'zh_TW.UTF-8' } })

  await f.start()
  expect(await f.command('help')).toContain('像素背景')
  expect(await f.command('language en')).toContain('Language: en')
  expect(await f.command('help')).toContain('Pixel backdrop')
  expect(await f.command('language auto')).toContain('auto (zh-TW)')
})

test('the help names every verb, with the real defaults', async ($, on) => {
  const f = fake($, on)
  const help = await f.command('help')

  for (const verb of ['set', 'recent', 'quality', 'size', 'colors', 'fit', 'dim', 'glass', 'tint', 'on | off', 'ffmpeg', 'language']) {
    expect(help).toContain(`/pixelbg ${verb}`)
  }
  expect(help).toContain('default 24')
  expect(help).toContain('default 160')
  expect(help).toContain('default 0 55')
})

test('a new session puts the stored backdrop up again without converting', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set(PICTURE, { w: 160, h: 90, draw: warm })
  await f.command(`set ${PICTURE}`)
  const decodes = f.decodes()
  const themes = f.themes.length

  // The engine reloads the mod: its own variables start over, the store stays.
  await f.start()
  expect(f.decodes()).toBe(decodes)
  expect(f.themes.length).toBe(themes + 1)
  expect(f.themes.at(-1)).toContain('"scene":"pixelbg"')
})

test('a stored picture without a usable backdrop is converted again at the start', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.putSnapshot({ version: 1, id: 's1', revision: 1, chosen: {}, settings: { path: PICTURE, quality: 'normal', width: 64 }, art: { svgs: ['not a picture'] } })

  f.sources.set(PICTURE, { w: 160, h: 90, draw: warm })
  await f.start()
  await f.until(() => f.themes.length > 0)
  expect(f.decodes()).toBe(1)
  expect((await backdrop($))[0]).toContain("viewBox='0 0 64 36'")
})

// The system language picks one of the sixteen, and anything else gets English.
for (const [lang, expected] of [
  ['ja_JP.UTF-8', 'ピクセル背景'],
  ['zh_CN.UTF-8', '输入 /pixelbg 打开侧边面板'],
  ['ko_KR.UTF-8', '픽셀 배경'],
  ['pt_PT.UTF-8', 'Fundo em pixels'],
  ['nl_NL.UTF-8', 'Pixel backdrop'],
] as const) {
  test(`a system in ${lang} gets the help in the language it maps to`, { timeoutMs: 30000 }, async ($, on) => {
    const f = fake($, on, { env: { LANG: lang } })

    await f.start()
    expect(await f.command('help')).toContain(expected)
  })
}

test('a language can be chosen by its code, in any case', { timeoutMs: 30000 }, async ($, on) => {
  const f = fake($, on)

  expect(await f.command('language JA')).toContain('言語：ja')
  expect(await f.command('language zh-cn')).toContain('语言：zh-CN')
  expect(await f.command('help')).toContain('/pixelbg language <auto | code>')
})

test('every open session takes up another session’s change within seconds', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)
  const wait = async (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      await f.clock.advance(100)
    }
  }

  f.sources.set(PICTURE, { w: 160, h: 90, draw: warm })
  await f.start()
  await f.command(`set ${PICTURE}`)
  const mine = f.snapshot() as { revision: number; settings: Record<string, unknown> }

  // Another session turns the backdrop off: this one follows.
  f.putSnapshot({ ...mine, id: 'other-1', revision: mine.revision + 1, settings: { ...mine.settings, enabled: false } })
  await wait(3200)
  expect(f.clears).toBe(1)
  expect(await f.command('status')).toContain('Backdrop: off')

  // Then it turns it on with a picture of its own: this one shows that picture.
  const themes = f.themes.length
  const settings = { ...mine.settings, enabled: true, path: 'T:/pictures/other.png' }

  f.putSnapshot({ ...mine, id: 'other-2', revision: mine.revision + 2, settings, art: otherArt(settings) })
  await wait(3200)
  expect(f.themes.length).toBe(themes + 1)
  expect((await backdrop($))[0]).toContain("viewBox='0 0 40 30'")
  expect(await f.command('status')).toContain('Picture: other.png')
})

test('a snapshot another session is still writing is taken up only once it is whole', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)
  const wait = async (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      await f.clock.advance(100)
    }
  }

  f.sources.set(PICTURE, { w: 160, h: 90, draw: warm })
  await f.start()
  await f.command(`set ${PICTURE}`)
  const mine = f.snapshot() as { revision: number; settings: Record<string, unknown> }
  const before = (await backdrop($))[0]
  const themes = f.themes.length
  const settings = { ...mine.settings, path: 'T:/pictures/other.png' }
  const whole = JSON.stringify({ ...mine, id: 'other-1', revision: mine.revision + 1, settings, art: otherArt(settings) })

  // The file is cut short: keep what is shown, and try again later.
  f.files.set('T:/local/pixelbg/current.json', btoa(whole.slice(0, whole.length / 2)))
  await wait(3200)
  expect((await backdrop($))[0]).toBe(before)
  expect(f.themes.length).toBe(themes)
  // Once it is whole, it is taken up.
  f.files.set('T:/local/pixelbg/current.json', btoa(whole))
  await wait(3200)
  expect((await backdrop($))[0]).toContain("viewBox='0 0 40 30'")
})
