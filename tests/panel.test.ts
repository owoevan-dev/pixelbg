import { expect, test } from 'claude-code/testing'

import { BACKDROP, fake, PANE, warm } from './harness'

test('the panel draws every control on the desktop', async ($, on) => {
  fake($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  for (const key of ['toggle', 'recent-toggle']) {
    expect((await ui.find({ type: 'Button', key }))?.key).toBe(key)
  }
  for (const key of ['quality', 'fit', 'tint', 'language']) {
    expect((await ui.find({ type: 'Select', key }))?.key).toBe(key)
  }
  for (const key of ['slider-colors', 'slider-dim', 'slider-opacity', 'slider-blur']) {
    expect((await ui.find({ type: 'Client', key }))?.props.module).toBe('hooks/slider.ts')
  }
  // High quality is the default and finds its own width: no width slider.
  expect(await ui.find({ type: 'Client', key: 'slider-width' })).toBeUndefined()
  expect((await ui.find({ type: 'Input', key: 'add' }))?.key).toBe('add')
  expect((await ui.find({ type: 'Text', text: /library is empty/ }))?.text).toContain('library is empty')
  await ui.unmount()
})

test('the status row is always there, so nothing below it moves', async ($, on) => {
  fake($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /Backdrop (on|off)/ }))?.text).toMatch(/Backdrop (on|off)/)
  await ui.unmount()
})

test('a slider draws its track and the label of its position', async ($, on) => {
  fake($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const drawn = await ui.find({ type: 'Text', in: 'slider-dim', text: /%/ })

  expect(drawn?.text).toContain('●')
  expect(drawn?.text).toMatch(/15%$/)
  await ui.unmount()
})

test('normal mode shows the width slider', async ($, on) => {
  fake($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.select({ key: 'quality', value: 'normal' })
  expect((await ui.find({ type: 'Client', key: 'slider-width' }))?.key).toBe('slider-width')
  await ui.unmount()
})

test('a path pasted in the panel joins the library and becomes the backdrop', { timeoutMs: 60000 }, async ($, on) => {
  const f = fake($, on)

  f.sources.set('T:/pictures/lake.png', { w: 160, h: 90, draw: warm })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.input({ key: 'add', text: 'T:/pictures/lake.png' })
  await f.until(() => f.themes.length > 0)
  await f.clock.advance(50)
  expect((await ui.find({ type: 'Text', text: /✓ lake/ }))?.text).toContain('lake')
  expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThan(0)
  // One file per entry, holding its name and path.
  expect([...f.entries().values()].map(e => [e.name, e.path, e.removed])).toEqual([['lake', 'T:/pictures/lake.png', false]])
  await ui.unmount()

  // The backdrop is up.
  const back = await $.ui.mount({ ...BACKDROP })

  expect((await back.findAll({ type: 'Svg' })).length).toBeGreaterThan(0)
  await back.unmount()
})

test('removing a library entry can be undone, and never touches the file', async ($, on) => {
  const f = fake($, on)
  f.putEntry({ id: 'a1', name: 'lake', path: 'T:/pictures/lake.png' })
  f.files.set('T:/pictures/lake.png', 'cGljdHVyZQ==')
  await f.command('panel')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'del-a1' })
  expect(await ui.find({ type: 'Button', key: 'use-a1' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Removed/ }))?.text).toContain('untouched')
  // The entry is marked removed (other windows see it go); the picture itself is untouched.
  expect(f.isRemoved('a1')).toBe(true)
  expect(f.files.get('T:/pictures/lake.png')).toBe('cGljdHVyZQ==')
  await ui.press({ key: 'undo' })
  expect((await ui.find({ type: 'Button', key: 'use-a1' }))?.key).toBe('use-a1')
  expect(f.isRemoved('a1')).toBe(false)
  await ui.unmount()
})

test('the panel speaks Traditional Chinese on a Chinese system', async ($, on) => {
  await fake($, on, { env: { LANG: 'zh_TW.UTF-8' } }).start()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /圖庫是空的/ }))?.text).toContain('圖庫是空的')
  expect((await ui.find({ type: 'Button', key: 'recent-toggle' }))?.props.label).toBe('從最近檔案加入')
  await ui.unmount()
})

test('the language menu lists every language in its own name', async ($, on) => {
  fake($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const options = ((await ui.find({ type: 'Select', key: 'language' }))?.props.options ?? []) as { value: string; label: string }[]

  expect(options.length).toBe(17)
  expect(options.map(o => o.label)).toContain('日本語')
  expect(options.map(o => o.label)).toContain('简体中文')
  await ui.select({ key: 'language', value: 'ko' })
  expect((await ui.find({ type: 'Button', key: 'recent-toggle' }))?.props.label).toBe('최근 파일에서 추가')
  await ui.unmount()
})

test('minimized to a widget, the panel keeps its switch', async ($, on) => {
  fake($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget', anchoredEdges: ['bottom', 'right'] } })

  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.key).toBe('toggle')
  expect(await ui.find({ type: 'Select', key: 'quality' })).toBeUndefined()
  await ui.unmount()
})

test('other surfaces get a pointer to the desktop app', async ($, on) => {
  fake($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /desktop app/ }))?.text).toContain('Code tab')
  await ui.unmount()
})

test('no backdrop is drawn before a picture is chosen', async ($, on) => {
  fake($, on)
  const ui = await $.ui.mount({ ...BACKDROP })

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})
