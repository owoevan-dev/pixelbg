/**
 * The side panel (`/pixelbg`): a status row, the backdrop's preview, the picture library and every
 * setting. Minimized, it is a small card with a switch.
 *
 * Buttons cannot be disabled, so a press that would start a second conversion while one runs is
 * ignored (`act`). Sliders are Client modules (slider.ts) that post their position; what they
 * change in the pixels waits for the slider to settle, the glass follows the drag live.
 */
import type { Elements, EngineInterface, RenderElement, Timer } from 'claude-code'

import { addEntry, makeThumb, MAX_CARDS, MAX_NAME, readLibrary, readThumbs, renameEntry, setRemoved, writeThumb } from './library'
import type { Item } from './library'
import { MediaError, recentPictures } from './media'
import { fileName, resolvePath, samePath } from './paths'
import { MAX_WIDTH } from './settings'
import type { Settings } from './settings'
import { change, show, shown } from './show'
import { S } from './state'
import type { Live } from './state'
import { errorText, isSpoken, LANGUAGES, t } from './text'
import type { Key } from './text'

type Desk = Elements['desktop']

export const PANE = 'pixelbg-panel'

const DIM_STEPS = Array.from({ length: 19 }, (_, i) => i * 5)
const OPACITY_STEPS = Array.from({ length: 21 }, (_, i) => i * 5)
const BLUR_STEPS = [0, 2, 4, 8, 12, 16, 24]
const COLOR_STEPS = [4, 8, 12, 16, 24, 32, 48, 64]
const WIDTH_STEPS = [48, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 640, 768, 896, 1024, MAX_WIDTH]
/** Glass updates while dragging, at most this often; pixel work waits this long after the last move. */
const LIVE_MS = 100
const SETTLE_MS = 300
const RECENT_SHOWN = 8

export const commas = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
export const chars = (svgs: readonly string[]) => svgs.reduce((n, s) => n + s.length, 0)
const nearest = (steps: readonly number[], v: number) => steps.reduce((best, s, i) => (Math.abs(s - v) < Math.abs((steps[best] ?? 0) - v) ? i : best), 0)

// ---------------------------------------------------------------------------------------
// Actions

/** A result for the status row, about the snapshot this session holds now. */
export function setNote(text: string): void {
  S.lastNote = text
  S.noteFor = S.id
}

/** Run one conversion from the panel; ignored while another runs. */
export function act($: EngineInterface, work: () => Promise<string>): void {
  if (S.busy !== '') {
    return
  }
  S.busy = 'convert'
  S.lastError = ''
  S.lastNote = ''
  $.ui.invalidate('ui.render')
  void work()
    .then(note => {
      setNote(note)
    })
    .catch((error: unknown) => {
      S.lastError = errorText(error)
    })
    .finally(() => {
      S.busy = ''
      $.ui.invalidate('ui.render')
    })
}

/** A quick change: no busy line (it would only flash), errors still shown. */
function quick($: EngineInterface, work: () => Promise<unknown>): void {
  void work().catch((error: unknown) => {
    S.lastError = errorText(error)
    $.ui.invalidate('ui.render')
  })
}

/**
 * Choose a picture on purpose (Use, or the add box): its pixels are made anew, as it may have
 * changed on disk, and so is its card's thumbnail once that worked.
 */
async function choose($: EngineInterface, path: string): Promise<string> {
  const note = await change($, { path, enabled: true }, true)
  const item = S.library.find(i => samePath(i.path, path))

  if (item !== undefined) {
    S.thumbs.delete(item.id)
    void ensureThumbs($)
  }

  return note
}

function use($: EngineInterface, path: string): void {
  S.removed = undefined
  act($, () => choose($, path))
}

/** The library and its thumbnails as they are on disk, with a word when some entries could not be read. */
export async function loadLibrary($: EngineInterface): Promise<void> {
  const { items, unreadable } = await readLibrary($)

  S.library = items
  S.thumbs = await readThumbs($, items)
  S.unreadableEntries = unreadable
  if (unreadable > 0) {
    S.lastError = t('library.unreadable')
  }
  $.ui.invalidate('ui.render')
}

/** A library change: written first; then the panel shows the library as it is on disk. A failed write changes nothing. */
async function edit($: EngineInterface, write: () => Promise<unknown>): Promise<void> {
  await write()
  await loadLibrary($)
}

/**
 * Thumbnails for entries that have none, one at a time, each in a file of its own (so making one
 * never rewrites an entry). Entries added meanwhile are picked up; a failed save is reported.
 */
export async function ensureThumbs($: EngineInterface): Promise<void> {
  if (S.thumbing) {
    return
  }
  S.thumbing = true
  const tried = new Set<string>()

  try {
    for (;;) {
      const item = S.library.find(i => !S.thumbs.has(i.id) && !tried.has(i.id))

      if (item === undefined) {
        break
      }
      tried.add(item.id)
      await $.clock.sleep(1)
      let thumb = ''

      try {
        thumb = await makeThumb($, { ffmpeg: S.settings.ffmpeg }, item.path)
      } catch (error) {
        // Unreadable: the card says so, and it is tried again when FFmpeg's path changes. A
        // temporary file left holding the decoded picture is said out loud, as for a conversion,
        // and is no reason to mark the picture unreadable: no thumbnail is kept, so it is tried again.
        if (error instanceof MediaError && error.kind === 'cleanup') {
          S.lastError = errorText(error)
          $.ui.invalidate('ui.render')
          continue
        }
      }
      try {
        await writeThumb($, item.id, thumb)
        S.thumbs.set(item.id, thumb)
      } catch (error) {
        S.lastError = errorText(error)
      }
      $.ui.invalidate('ui.render')
    }
  } finally {
    S.thumbing = false
  }
}

/** Thumbnails that failed get another try (after FFmpeg's path changes). */
export function retryThumbs($: EngineInterface): void {
  for (const [id, thumb] of S.thumbs) {
    if (thumb === '') {
      S.thumbs.delete(id)
    }
  }
  void ensureThumbs($)
}

async function addToLibrary($: EngineInterface, path: string): Promise<Item> {
  const item = await addEntry($, path, samePath)

  await loadLibrary($)
  void ensureThumbs($)

  return item
}

export async function openPanel($: EngineInterface): Promise<string> {
  await loadLibrary($)
  void ensureThumbs($)
  const opened = await $.ui.open({ id: PANE, title: t('panel.title') })

  return opened.isPlaced ? t('panel.opened') : t('panel.notPlaced', { reason: opened.reason })
}

// ---------------------------------------------------------------------------------------
// Sliders

type SliderId = 'dim' | 'opacity' | 'blur' | 'colors' | 'width'
type SliderDef = { id: SliderId; title: Key; steps: readonly number[]; show: (v: number) => string; value: (s: Settings) => number }

export const SLIDERS: readonly SliderDef[] = [
  { id: 'dim', title: 'slider.dim', steps: DIM_STEPS, show: n => `${n}%`, value: s => Math.round(s.dim * 100) },
  { id: 'opacity', title: 'slider.opacity', steps: OPACITY_STEPS, show: n => `${n}%`, value: s => Math.round(s.opacity * 100) },
  { id: 'blur', title: 'slider.blur', steps: BLUR_STEPS, show: n => (n === 0 ? t('slider.none') : `${n}`), value: s => s.blur },
  { id: 'colors', title: 'slider.colors', steps: COLOR_STEPS, show: n => t('slider.colorsN', { n }), value: s => s.colors },
  { id: 'width', title: 'slider.width', steps: WIDTH_STEPS, show: n => `${n}`, value: s => s.width },
]

let glassTimer: Timer | undefined
let settleTimer: Timer | undefined
let settling: Partial<Settings> = {}

/** The glass follows the drag on screen, at most ten theme updates a second; nothing is saved yet. */
function liveGlass($: EngineInterface): void {
  glassTimer?.cancel()
  glassTimer = $.clock.after(LIVE_MS, () => quick($, () => show($)))
}

/** A slider let go: commit only its own setting, then show the committed value. */
function commitLive($: EngineInterface, key: keyof Live, value: number): void {
  glassTimer?.cancel()
  quick($, async () => {
    try {
      await change($, { [key]: value })
    } finally {
      // Unless the slider is being dragged again meanwhile, show the committed value.
      if (S.live[key] === value) {
        delete S.live[key]
      }
      $.ui.invalidate('ui.render')
    }
  })
}

/**
 * Pixel work waits for the sliders to settle; colours and width let go together apply together.
 * While a conversion runs, what was let go waits for it to end rather than being dropped.
 */
function settle($: EngineInterface, patch: Partial<Settings>): void {
  settling = { ...settling, ...patch }
  settleTimer?.cancel()
  const fire = (): void => {
    if (S.busy !== '') {
      settleTimer = $.clock.after(SETTLE_MS, fire)

      return
    }
    const pending = settling

    settling = {}
    S.removed = undefined
    act($, () => change($, pending))
  }

  settleTimer = $.clock.after(SETTLE_MS, fire)
}

/**
 * A slider moved to `index` of its steps (`final` once the drag ends or a key steps it). While it
 * is dragged, the value is shown but not saved; letting go saves that one setting.
 */
export function moveSlider($: EngineInterface, id: string, index: number, final: boolean): void {
  const def = SLIDERS.find(d => d.id === id)
  const v = def?.steps[Math.max(0, Math.min(def.steps.length - 1, Math.round(index)))]

  if (def === undefined || v === undefined) {
    return
  }
  switch (def.id) {
    case 'dim':
    case 'opacity': {
      S.live[def.id] = v / 100
      if (final) {
        commitLive($, def.id, v / 100)
      } else if (def.id === 'opacity') {
        liveGlass($)
      }
      // The veil is its own layer: dimming changes without a rebuild.
      $.ui.invalidate('ui.render')

      return
    }
    case 'blur':
      S.live.blur = v
      if (final) {
        commitLive($, 'blur', v)
      } else {
        liveGlass($)
      }

      return
    case 'colors':
    case 'width':
      if (final) {
        settle($, { [def.id]: v })
      }
  }
}

// ---------------------------------------------------------------------------------------
// Drawing

function statusRow($: EngineInterface, el: Desk): RenderElement {
  const { Box, Text, Button } = el
  const { busy, lastError, removed } = S
  // A result written for an earlier snapshot (another picture, other settings, another language) is not shown.
  const lastNote = S.noteFor === S.id ? S.lastNote : ''
  const settings = shown()
  const message =
    busy !== ''
      ? t(settings.quality === 'hd' ? 'busy.convertHd' : 'busy.convert')
      : lastError !== ''
        ? `⚠ ${lastError}`
        : removed !== undefined
          ? t('removed', { name: removed.name })
          : lastNote
  const undo = () => {
    const back = S.removed

    if (back === undefined) {
      return
    }
    // The Undo button stays until the entry is back on disk: a failed save leaves it to press again.
    quick($, async () => {
      await edit($, () => setRemoved($, back.id, false))
      if (S.removed?.id === back.id) {
        S.removed = undefined
      }
      $.ui.invalidate('ui.render')
    })
  }

  // One fixed row: its height never changes, so nothing below it jumps.
  return Box({
    flexDirection: 'row',
    gap: 1,
    alignItems: 'center',
    children: [
      Text({ weight: 'semibold', children: settings.enabled ? '●' : '○' }),
      Box({
        flexGrow: 1,
        children: [
          Text({
            wrap: 'truncate',
            color: lastError !== '' && busy === '' ? 'error' : undefined,
            dimColor: lastError === '',
            children: message || t(settings.enabled ? 'state.on' : 'state.off'),
          }),
        ],
      }),
      ...(removed !== undefined ? [Button({ key: 'undo', label: t('undo'), onPress: undo })] : []),
      Button({ key: 'toggle', label: t(settings.enabled ? 'toggle.off' : 'toggle.on'), onPress: () => quick($, () => change($, { enabled: !S.settings.enabled })) }),
    ],
  })
}

function preview($: EngineInterface, el: Desk): RenderElement[] {
  const { Box, Text, Button, Svg } = el
  const art = S.art

  if (art === undefined) {
    return []
  }

  return [
    art.preview !== ''
      ? Svg({ source: art.preview, alt: t('preview.alt', { name: fileName(art.source) }) })
      : Box({
          flexDirection: 'row',
          gap: 1,
          alignItems: 'center',
          children: [
            Text({ dimColor: true, children: t('preview.none') }),
            Button({ key: 'rebuild', label: t('rebuild'), onPress: () => use($, art.source) }),
          ],
        }),
    Text({ dimColor: true, size: 'caption', children: t('art.line', { w: art.w, h: art.h, colors: art.colors, layers: art.svgs.length, chars: commas(chars(art.svgs)) }) }),
  ]
}

function libraryRows($: EngineInterface, el: Desk): RenderElement[] {
  const { Box, Text, Button, Input } = el
  const rows: RenderElement[] = []
  const toggleRecent = () => {
    S.showRecent = !S.showRecent
    if (S.showRecent) {
      quick($, async () => {
        S.recent = await recentPictures($)
        $.ui.invalidate('ui.render')
      })
    }
    $.ui.invalidate('ui.render')
  }

  rows.push(heading(el, t('library'), [Button({ key: 'recent-toggle', label: t(S.showRecent ? 'recent.hide' : 'recent.show'), onPress: toggleRecent })]))
  rows.push(
    Input({
      key: 'add',
      placeholder: t('add.placeholder'),
      submitLabel: t('add.submit'),
      onSubmit: value =>
        act($, async () => {
          const item = await addToLibrary($, await resolvePath($, value))

          S.removed = undefined

          // Chosen on purpose, like Use: made anew, as the file may have changed on disk.
          return choose($, item.path)
        }),
    }),
  )
  if (S.showRecent) {
    const fresh = S.recent.filter(r => !S.library.some(i => samePath(i.path, r.path))).slice(0, RECENT_SHOWN)

    rows.push(
      fresh.length === 0
        ? Text({ dimColor: true, children: t('recent.none') })
        : Box({
            flexDirection: 'column',
            children: fresh.map((r, i) =>
              Button({
                key: `recent-${i}`,
                plain: true,
                label: `＋ ${r.name.length > MAX_NAME ? `${r.name.slice(0, MAX_NAME - 3)}…` : r.name}`,
                onPress: () =>
                  quick($, async () => {
                    await addToLibrary($, r.path)
                    $.ui.invalidate('ui.render')
                  }),
              }),
            ),
          }),
    )
  }
  rows.push(
    S.library.length === 0
      ? Text({ dimColor: true, children: t('library.empty') })
      : Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, children: S.library.slice(0, MAX_CARDS).map(item => card($, el, item)) }),
  )
  if (S.library.length > MAX_CARDS) {
    rows.push(Text({ dimColor: true, size: 'caption', children: t('library.more', { n: S.library.length - MAX_CARDS, max: MAX_CARDS }) }))
  }

  return rows
}

/** One library entry: thumbnail, name and actions; renaming swaps the name for a field. */
function card($: EngineInterface, el: Desk, item: Item): RenderElement {
  const { Box, Text, Button, Input, Svg } = el
  const current = S.settings.path !== undefined && samePath(S.settings.path, item.path)
  const saved = S.thumbs.get(item.id)
  const thumb =
    saved === undefined
      ? Text({ dimColor: true, size: 'caption', children: t('card.thumbMaking') })
      : saved === ''
        ? Text({ color: 'error', size: 'caption', children: t('card.thumbFailed') })
        : Svg({ source: saved, alt: t('card.thumbAlt', { name: item.name }) })
  const redraw = () => $.ui.invalidate('ui.render')
  const rename = (value: string) => {
    const name = value.trim().slice(0, MAX_NAME)

    S.renaming = ''
    if (name !== '' && name !== item.name) {
      quick($, () => edit($, () => renameEntry($, item.id, name)))
    }
    redraw()
  }
  const remove = () =>
    quick($, async () => {
      await edit($, () => setRemoved($, item.id, true))
      S.removed = item
      S.lastNote = ''
      redraw()
    })
  const body =
    S.renaming === item.id
      ? [
          Input({ key: `name-${item.id}`, value: item.name, submitLabel: t('card.save'), onSubmit: rename }),
          Button({
            key: `cancel-${item.id}`,
            label: t('card.cancel'),
            onPress: () => {
              S.renaming = ''
              redraw()
            },
          }),
        ]
      : [
          Text({ wrap: 'truncate', weight: current ? 'semibold' : 'regular', children: `${current ? '✓ ' : ''}${item.name}` }),
          Box({
            flexDirection: 'row',
            gap: 1,
            children: [
              Button({ key: `use-${item.id}`, label: t(current ? 'card.useAgain' : 'card.use'), variant: current ? 'secondary' : 'primary', onPress: () => use($, item.path) }),
              Button({
                key: `ren-${item.id}`,
                label: t('card.rename'),
                onPress: () => {
                  S.renaming = item.id
                  redraw()
                },
              }),
              Button({ key: `del-${item.id}`, label: t('card.remove'), onPress: remove }),
            ],
          }),
        ]

  return Box({ key: `card-${item.id}`, flexDirection: 'column', width: 26, gap: 0, children: [thumb, ...body] })
}

function heading(el: Desk, text: string, extra: RenderElement[] = []): RenderElement {
  const { Box, Text } = el

  return Box({ flexDirection: 'row', gap: 1, alignItems: 'center', children: [Text({ weight: 'semibold', children: text }), ...extra] })
}

function slider(el: Desk, def: SliderDef): RenderElement {
  const { Box, Text, Client } = el

  return Box({
    flexDirection: 'row',
    gap: 1,
    alignItems: 'center',
    children: [
      Box({ width: 12, children: [Text({ children: t(def.title) })] }),
      Client({
        key: `slider-${def.id}`,
        module: './slider.ts',
        props: { id: def.id, index: nearest(def.steps, def.value(shown())), labels: def.steps.map(def.show) },
        height: 1,
        flexGrow: 1,
      }),
    ],
  })
}

function settingsRows($: EngineInterface, el: Desk): RenderElement[] {
  const { Select } = el
  const s = S.settings
  const def = (id: SliderId) => SLIDERS.find(d => d.id === id) as SliderDef

  return [
    heading(el, t('quality')),
    Select({
      key: 'quality',
      label: t('mode'),
      options: [
        { value: 'normal', label: t('mode.normal') },
        { value: 'hd', label: t('mode.hd') },
      ],
      value: s.quality,
      onSelect: value => {
        S.removed = undefined
        act($, () => change($, { quality: value === 'normal' ? 'normal' : 'hd' }))
      },
    }),
    ...(s.quality === 'normal' ? [slider(el, def('width'))] : []),
    slider(el, def('colors')),
    heading(el, t('look')),
    Select({
      key: 'fit',
      label: t('fit'),
      options: [
        { value: 'cover', label: t('fit.cover') },
        { value: 'contain', label: t('fit.contain') },
      ],
      value: s.fit,
      onSelect: value => quick($, () => change($, { fit: value === 'contain' ? 'contain' : 'cover' })),
    }),
    Select({
      key: 'tint',
      label: t('tint'),
      options: [
        { value: 'on', label: t('tint.on') },
        { value: 'off', label: t('tint.off') },
      ],
      value: s.tint ? 'on' : 'off',
      onSelect: value => quick($, () => change($, { tint: value === 'on' })),
    }),
    slider(el, def('dim')),
    slider(el, def('opacity')),
    slider(el, def('blur')),
    Select({
      key: 'language',
      label: t('language'),
      // Each language in its own name, so it can be found whatever the panel speaks now.
      options: [{ value: 'auto', label: t('language.auto') }, ...Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))],
      value: s.language,
      onSelect: value => quick($, () => change($, { language: isSpoken(value) ? value : 'auto' })),
    }),
  ]
}

export function panel($: EngineInterface, el: Desk): RenderElement {
  const { Box } = el

  return Box({ flexDirection: 'column', gap: 1, children: [statusRow($, el), ...preview($, el), ...libraryRows($, el), ...settingsRows($, el)] })
}

/** The minimized panel, a small card the desktop seats beside the chat: state and a switch. */
export function widget($: EngineInterface, el: Desk): RenderElement {
  const { Box, Text, Button } = el
  const { art, busy, settings } = S

  return Box({
    flexDirection: 'column',
    gap: 1,
    children: [
      Text({ weight: 'semibold', children: t(settings.enabled ? 'widget.on' : 'widget.off') }),
      Text({ dimColor: true, size: 'caption', children: busy !== '' ? t('busy.convert') : art === undefined ? t('widget.empty') : `${fileName(art.source)} · ${art.w}×${art.h}` }),
      Button({ key: 'toggle', label: t(settings.enabled ? 'widget.turnOff' : 'widget.turnOn'), onPress: () => quick($, () => change($, { enabled: !S.settings.enabled })) }),
    ],
  })
}
